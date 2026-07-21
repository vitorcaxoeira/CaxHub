import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { SYNC_JOBS } from "../sync/registry";
import { proximaExecucao } from "../sync/cronUtils";

// Painel de administração dos jobs de sincronização Senior -> CaxHub: quando cada
// tabela sincronizou pela última vez, quando roda de novo automaticamente, e uma ação
// manual (Todos ou só Alterados, quando o job suporta) — mesmo padrão de disparo
// "fire and forget" já usado em financeiro.ts (contas a receber).
export const syncErpRouter = Router();
syncErpRouter.use(requireAuth, requireRole("admin"));

const jobsEmAndamento = new Set<string>();
let sincronizandoTodos = false;

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-erp:${label}]`, message);
  res.status(500).json({ error: message });
}

syncErpRouter.get("/", async (_req, res) => {
  try {
    const jobNames = SYNC_JOBS.map((j) => j.jobName);
    const logs = await prisma.syncLog.findMany({
      where: { jobName: { in: jobNames } },
      orderBy: { runAt: "desc" },
    });

    const ultimoPorJob = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      if (!ultimoPorJob.has(log.jobName)) ultimoPorJob.set(log.jobName, log);
    }

    const contagens = await Promise.all(SYNC_JOBS.map((job) => job.contarRegistros()));

    const agora = new Date();
    res.json({
      sincronizandoTodos,
      jobs: SYNC_JOBS.map((job, indice) => {
        const ultimo = ultimoPorJob.get(job.jobName);
        return {
          jobName: job.jobName,
          displayName: job.displayName,
          // Ordem em que "Sincronizar Todas as Tabelas" executa esta tabela — mesma ordem
          // de SYNC_JOBS, que respeita as dependências de FK (ex.: FaseProposta antes de
          // AtividadeConsultor).
          ordemExecucao: indice + 1,
          totalRegistros: contagens[indice],
          suportaAlterados: job.suportaAlterados,
          ultimaSincronizacao: ultimo?.runAt ?? null,
          ultimoStatus: ultimo?.status ?? null,
          ultimoErro: ultimo?.message ?? null,
          proximaExecucao: proximaExecucao(job.cronExpr, agora),
          emAndamento: jobsEmAndamento.has(job.jobName),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

syncErpRouter.post("/:jobName/run", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (sincronizandoTodos || jobsEmAndamento.has(job.jobName)) {
      res.status(409).json({ error: "Sincronização já em andamento" });
      return;
    }

    const modo = req.body?.modo === "alterados" ? "alterados" : "todos";
    if (modo === "alterados" && !job.suportaAlterados) {
      res.status(400).json({ error: "Esta tabela não tem campo de data de geração/alteração — só aceita sincronizar Todos" });
      return;
    }

    let desde: Date | undefined;
    if (modo === "alterados") {
      const ultimoSucesso = await prisma.syncLog.findFirst({
        where: { jobName: job.jobName, status: "success" },
        orderBy: { runAt: "desc" },
      });
      if (!ultimoSucesso) {
        res.status(400).json({ error: "Nunca sincronizado com sucesso ainda — rode Todos primeiro" });
        return;
      }
      desde = ultimoSucesso.runAt;
    }

    jobsEmAndamento.add(job.jobName);
    job
      .run(desde)
      .catch((error) => {
        console.error(`[sync-erp:${job.jobName}] falhou:`, error instanceof Error ? error.message : error);
      })
      .finally(() => jobsEmAndamento.delete(job.jobName));

    res.status(202).json({ status: "iniciado", modo });
  } catch (error) {
    handleError(res, error, "run");
  }
});

syncErpRouter.post("/run-all", async (_req, res) => {
  try {
    if (sincronizandoTodos || jobsEmAndamento.size > 0) {
      res.status(409).json({ error: "Já existe uma sincronização em andamento" });
      return;
    }

    sincronizandoTodos = true;
    (async () => {
      // Sequencial e na ordem de SYNC_JOBS (respeita dependências de FK, ex.: FaseProposta
      // antes de AtividadeConsultor) — mesmo padrão do runSincronizacaoContasReceber.
      for (const job of SYNC_JOBS) {
        jobsEmAndamento.add(job.jobName);
        try {
          await job.run();
        } finally {
          jobsEmAndamento.delete(job.jobName);
        }
      }
    })()
      .catch((error) => {
        console.error("[sync-erp:run-all] falhou:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        sincronizandoTodos = false;
      });

    res.status(202).json({ status: "iniciado" });
  } catch (error) {
    handleError(res, error, "run-all");
  }
});
