import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { KYRIA_SYNC_JOBS } from "../kyria/registry";
import { proximaExecucao } from "../sync/cronUtils";
import { jobAtivo } from "../kyria/jobAtivo";

// Painel de administração dos jobs de sincronização Kyria -> CaxHub — mesmo padrão de
// disparo "fire and forget" de sync-erp.ts, mas sem nada do que só faz sentido pro SOAP do
// Senior (filtro por campo, varredura de removidos, tamanho de lote): a API do Kyria é
// só-leitura e pequena, um COUNT(*) e um upsert em transação bastam por enquanto.
export const syncKyriaRouter = Router();
syncKyriaRouter.use(requireAuth, requireRole("admin"));

const jobsEmAndamento = new Set<string>();
let sincronizandoTodos = false;

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-kyria:${label}]`, message);
  res.status(500).json({ error: message });
}

// Degrada pra só o path se KYRIA_BASE_URL não estiver definida — diferente de kyriaConfig()
// (client.ts), que lança, esta rota só monta uma URL informativa pra tela, não bate na rede.
function kyriaFullUrl(path: string): string {
  const baseUrl = (process.env.KYRIA_BASE_URL ?? "").replace(/\/$/, "");
  return `${baseUrl}${path}`;
}

syncKyriaRouter.get("/", async (_req, res) => {
  try {
    const jobNames = KYRIA_SYNC_JOBS.map((j) => j.jobName);
    const logs = await prisma.syncLog.findMany({
      where: { jobName: { in: jobNames } },
      orderBy: { runAt: "desc" },
    });
    const ultimoPorJob = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      if (!ultimoPorJob.has(log.jobName)) ultimoPorJob.set(log.jobName, log);
    }

    const contagens = await Promise.all(KYRIA_SYNC_JOBS.map((job) => job.contarRegistros()));
    const configs = await prisma.kyriaSyncConfig.findMany();
    const inativos = new Set(configs.filter((c) => !c.ativo).map((c) => c.jobName));
    const agora = new Date();

    res.json({
      sincronizandoTodos,
      jobs: KYRIA_SYNC_JOBS.map((job, indice) => {
        const ultimo = ultimoPorJob.get(job.jobName);
        return {
          jobName: job.jobName,
          displayName: job.displayName,
          urlCompleta: kyriaFullUrl(job.path),
          ordemExecucao: indice + 1,
          ativo: !inativos.has(job.jobName),
          aceitaFiltros: !!job.validarFiltros,
          totalRegistros: contagens[indice],
          ultimaSincronizacao: ultimo?.runAt ?? null,
          ultimoStatus: ultimo?.status ?? null,
          ultimaMensagem: ultimo?.message ?? null,
          ultimaDuracaoMs: ultimo?.duracaoMs ?? null,
          proximaExecucao: proximaExecucao(job.cronExpr, agora),
          emAndamento: jobsEmAndamento.has(job.jobName),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "list");
  }
});

// Jobs que dependem (por FK, direta ou transitivamente) da tabela do job informado — ler as
// FKs do próprio Postgres em vez de hardcodar mantém isto certo quando surgir tabela nova.
async function jobsDependentes(jobName: string) {
  const raiz = KYRIA_SYNC_JOBS.find((j) => j.jobName === jobName);
  if (!raiz) return [];
  const tabelas = KYRIA_SYNC_JOBS.map((j) => j.tabelaLocal);
  const fks = await prisma.$queryRaw<{ filha: string; pai: string }[]>`
    SELECT c.conrelid::regclass::text AS filha, c.confrelid::regclass::text AS pai
    FROM pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY(${tabelas}) AND c.confrelid::regclass::text = ANY(${tabelas})`;
  const alcancadas = new Set<string>([raiz.tabelaLocal]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const fk of fks) {
      if (alcancadas.has(fk.pai) && !alcancadas.has(fk.filha)) {
        alcancadas.add(fk.filha);
        mudou = true;
      }
    }
  }
  alcancadas.delete(raiz.tabelaLocal);
  return KYRIA_SYNC_JOBS.filter((j) => alcancadas.has(j.tabelaLocal));
}

syncKyriaRouter.get("/:jobName/dependentes", async (req, res) => {
  try {
    if (!KYRIA_SYNC_JOBS.some((j) => j.jobName === req.params.jobName)) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const dependentes = await jobsDependentes(req.params.jobName);
    const configs = await prisma.kyriaSyncConfig.findMany({ where: { ativo: false } });
    const inativos = new Set(configs.map((c) => c.jobName));
    res.json({
      dependentes: dependentes
        .filter((j) => !inativos.has(j.jobName))
        .map((j) => ({ jobName: j.jobName, displayName: j.displayName, tabelaLocal: j.tabelaLocal })),
    });
  } catch (error) {
    handleError(res, error, "dependentes");
  }
});

syncKyriaRouter.patch("/:jobName/ativo", async (req, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (typeof req.body?.ativo !== "boolean") {
      res.status(400).json({ error: "Informe ativo (true/false)" });
      return;
    }
    // Desativar com cascata leva junto tudo que depende da tabela por FK (confirmado no modal).
    const alvos = [job.jobName];
    if (req.body.ativo === false && req.body.cascata === true) {
      alvos.push(...(await jobsDependentes(job.jobName)).map((j) => j.jobName));
    }
    await prisma.$transaction(
      alvos.map((jobName) =>
        prisma.kyriaSyncConfig.upsert({
          where: { jobName },
          create: { jobName, ativo: req.body.ativo },
          update: { ativo: req.body.ativo },
        })
      )
    );
    res.json({ jobName: job.jobName, ativo: req.body.ativo, afetados: alvos });
  } catch (error) {
    handleError(res, error, "ativo");
  }
});

syncKyriaRouter.post("/:jobName/run", async (req, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (!(await jobAtivo(job.jobName))) {
      res.status(409).json({ error: "Tabela inativa — ative-a para sincronizar" });
      return;
    }
    if (sincronizandoTodos || jobsEmAndamento.has(job.jobName)) {
      res.status(409).json({ error: "Sincronização já em andamento" });
      return;
    }

    // "Sinc. Filtros": from/to opcionais, só pra job que declara validarFiltros. Valida aqui
    // (antes do 202) pra o erro de regra chegar na tela em vez de morrer no log do job.
    const temFiltros = req.body?.from !== undefined || req.body?.to !== undefined;
    const filtros = temFiltros ? { from: req.body?.from, to: req.body?.to } : undefined;
    if (filtros) {
      if (!job.validarFiltros) {
        res.status(400).json({ error: "Esta tabela não aceita filtros" });
        return;
      }
      try {
        job.validarFiltros(filtros);
      } catch (erro) {
        res.status(400).json({ error: erro instanceof Error ? erro.message : String(erro) });
        return;
      }
    }

    jobsEmAndamento.add(job.jobName);
    job
      .run(filtros)
      .catch((error) => {
        console.error(`[sync-kyria:${job.jobName}] falhou:`, error instanceof Error ? error.message : error);
      })
      .finally(() => jobsEmAndamento.delete(job.jobName));

    res.status(202).json({ status: "iniciado" });
  } catch (error) {
    handleError(res, error, "run");
  }
});

syncKyriaRouter.post("/run-all", async (_req, res) => {
  try {
    if (sincronizandoTodos || jobsEmAndamento.size > 0) {
      res.status(409).json({ error: "Já existe uma sincronização em andamento" });
      return;
    }

    sincronizandoTodos = true;
    (async () => {
      for (const job of KYRIA_SYNC_JOBS) {
        if (!(await jobAtivo(job.jobName))) continue;
        jobsEmAndamento.add(job.jobName);
        try {
          await job.run();
        } finally {
          jobsEmAndamento.delete(job.jobName);
        }
      }
    })()
      .catch((error) => {
        console.error("[sync-kyria:run-all] falhou:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        sincronizandoTodos = false;
      });

    res.status(202).json({ status: "iniciado" });
  } catch (error) {
    handleError(res, error, "run-all");
  }
});
