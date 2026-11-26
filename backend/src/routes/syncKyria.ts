import { Router } from "express";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest, requireAuth, requireRole } from "../auth/middleware";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { limparLeituras } from "../kyria/registroLeitura";
import { col, registrarListaConsultavel } from "./listaConsultavel";
import { prisma } from "../db/prisma";
import { KYRIA_SYNC_JOBS } from "../kyria/registry";
import { kyriaFullUrl } from "../kyria/client";
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


// ---------------------------------------------------------------------------
// Leituras do Kyria (25/11/2026, adaptado do controle de leituras do CaxHub_Dash): cada execução de um job (kyria_leituras) e cada chamada HTTP à
// API dentro dela (kyria_leituras_paginas), gravadas por kyria/registroLeitura.ts. A tela "Leituras do Kyria" lê daqui. Todo o router é só de
// admin. Limpar apaga os logs MENOS a leitura em andamento e NUNCA toca no SyncLog (histórico das sincronizações) nem no cursor do feed
// (kyria_sync_cursor, de onde o job de apontamentos retoma).
// ---------------------------------------------------------------------------
const NOME_DO_JOB = Prisma.raw(
  `CASE l.job_name ${KYRIA_SYNC_JOBS.map((j) => `WHEN '${j.jobName.replace(/'/g, "''")}' THEN '${j.displayName.replace(/'/g, "''")}'`).join(" ")} ELSE l.job_name END`
);
const STATUS_LEITURA = ["em_andamento", "concluida", "falhou", "interrompida"] as const;
const qTexto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const qDia = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(qTexto(v)) ? qTexto(v) : null);

registrarListaConsultavel(
  syncKyriaRouter,
  "/leituras",
  async (req) => {
    const job = KYRIA_SYNC_JOBS.some((j) => j.jobName === qTexto(req.query.job)) ? qTexto(req.query.job) : null;
    const status = (STATUS_LEITURA as readonly string[]).includes(qTexto(req.query.status)) ? qTexto(req.query.status) : null;
    const de = qDia(req.query.de);
    const ate = qDia(req.query.ate);
    return {
      interna: Prisma.sql`
        SELECT l.id, l.job_name AS "jobName", ${NOME_DO_JOB} AS tabela, l.recurso, l.limite, l.timeout_ms AS "timeoutMs",
               l.iniciada_em AS "iniciadaEm", l.finalizada_em AS "finalizadaEm",
               CASE l.status WHEN 'em_andamento' THEN 'Em andamento' WHEN 'concluida' THEN 'Concluída' WHEN 'falhou' THEN 'Falhou' WHEN 'interrompida' THEN 'Interrompida' ELSE l.status END AS status,
               l.status AS "statusCodigo", l.paginas, l.linhas,
               a.chamadas, a.erros, a.ms_medio AS "msMedio", a.ms_max AS "msMax", a.espera_s AS "esperaS",
               (EXTRACT(EPOCH FROM (COALESCE(l.finalizada_em, l.atualizada_em) - l.iniciada_em)) * 1000)::int AS "duracaoMs",
               l.ultimo_cursor AS "ultimoCursor", l.erro
        FROM kyria_leituras l
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS chamadas, (count(*) FILTER (WHERE p.status = 'erro'))::int AS erros, round(avg(p.ms_kyria))::int AS ms_medio,
                 max(p.ms_kyria)::int AS ms_max, COALESCE(sum(p.espera_s), 0)::int AS espera_s
          FROM kyria_leituras_paginas p WHERE p.leitura_id = l.id
        ) a ON TRUE
        WHERE (${job}::text IS NULL OR l.job_name = ${job}::text)
          AND (${status}::text IS NULL OR l.status = ${status}::text)
          AND (${de}::date IS NULL OR (l.iniciada_em AT TIME ZONE 'America/Sao_Paulo')::date >= ${de}::date)
          AND (${ate}::date IS NULL OR (l.iniciada_em AT TIME ZONE 'America/Sao_Paulo')::date <= ${ate}::date)`,
      colunas: [
        col.data("iniciadaEm", { obrigatoria: true }),
        col.texto("tabela", { obrigatoria: true }),
        col.texto("jobName"),
        col.texto("status"),
        col.texto("recurso"),
        col.inteiro("paginas"),
        col.inteiro("linhas"),
        col.inteiro("limite"),
        col.inteiro("timeoutMs"),
        col.inteiro("chamadas"),
        col.inteiro("erros"),
        col.inteiro("msMedio"),
        col.inteiro("msMax"),
        col.inteiro("esperaS"),
        col.inteiro("duracaoMs"),
        col.data("finalizadaEm"),
        col.texto("ultimoCursor"),
        col.texto("erro"),
      ],
      totais: ["linhas", "chamadas", "erros"],
      ordemPadrao: Prisma.sql`x."iniciadaEm" DESC, x."id" DESC`,
      pageSizePadrao: 25,
    };
  },
  "kyria-leituras"
);

// As chamadas HTTP de UMA leitura (?leituraId=), na ordem em que foram feitas.
registrarListaConsultavel(
  syncKyriaRouter,
  "/chamadas",
  async (req) => {
    const leituraId = /^\d{1,9}$/.test(qTexto(req.query.leituraId)) ? Number(qTexto(req.query.leituraId)) : null;
    return {
      interna: Prisma.sql`
        SELECT p.id, p.leitura_id AS "leituraId", p.disparada_em AS "disparadaEm", p.cursor, p.proximo_cursor AS "proximoCursor", p.limite, p.linhas, p.kb,
               p.ms_kyria AS "msKyria", p.tentativa, p.http_status AS "httpStatus", p.espera_s AS "esperaS",
               CASE p.status WHEN 'ok' THEN 'ok' ELSE 'erro' END AS status, p.request_id AS "requestId", p.erro
        FROM kyria_leituras_paginas p
        WHERE ${leituraId}::int IS NOT NULL AND p.leitura_id = ${leituraId}::int`,
      colunas: [
        col.data("disparadaEm", { obrigatoria: true }),
        col.texto("cursor"),
        col.texto("proximoCursor"),
        col.inteiro("limite"),
        col.inteiro("linhas"),
        col.inteiro("kb"),
        col.inteiro("msKyria"),
        col.inteiro("tentativa"),
        col.inteiro("httpStatus"),
        col.inteiro("esperaS"),
        col.texto("status"),
        col.texto("requestId"),
        col.texto("erro"),
      ],
      totais: ["linhas", "kb"],
      ordemPadrao: Prisma.sql`x."disparadaEm" ASC, x."id" ASC`,
      pageSizePadrao: 50,
    };
  },
  "kyria-leituras-chamadas"
);

async function auditarLimpeza(req: AuthenticatedRequest, escopo: string, apagadas: { leiturasApagadas: number; chamadasApagadas: number }) {
  await criarEventoAuditoria({
    origem: "tela",
    usuarioId: req.user!.userId,
    entidadeTipo: ENTIDADES_AUDITORIA.KYRIA_LEITURA,
    entidadeId: escopo,
    entidadeRotulo: escopo === "todas" ? "Leituras do Kyria · todas as tabelas" : `Leituras do Kyria · ${escopo}`,
    eventoTipo: "KYRIA_LEITURAS_LIMPAS",
    metadata: { escopo, ...apagadas },
    correlationId: req.correlationId!,
  });
}

// DELETE /leituras — limpa os logs de TODAS as tabelas (menos a leitura em andamento).
syncKyriaRouter.delete("/leituras", async (req: AuthenticatedRequest, res) => {
  try {
    const apagadas = await limparLeituras({});
    await auditarLimpeza(req, "todas", apagadas);
    res.json(apagadas);
  } catch (error) {
    handleError(res, error, "leituras:limpar-todas");
  }
});

// DELETE /:jobName/leituras — limpa os logs DESTA tabela, com a mesma preservação.
syncKyriaRouter.delete("/:jobName/leituras", async (req: AuthenticatedRequest, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const apagadas = await limparLeituras({ jobName: job.jobName });
    await auditarLimpeza(req, job.jobName, apagadas);
    res.json(apagadas);
  } catch (error) {
    handleError(res, error, "leituras:limpar");
  }
});
