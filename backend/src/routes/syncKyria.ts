import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { KYRIA_SYNC_JOBS } from "../kyria/registry";
import { proximaExecucao } from "../sync/cronUtils";

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

syncKyriaRouter.post("/:jobName/run", async (req, res) => {
  try {
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (sincronizandoTodos || jobsEmAndamento.has(job.jobName)) {
      res.status(409).json({ error: "Sincronização já em andamento" });
      return;
    }

    jobsEmAndamento.add(job.jobName);
    job
      .run()
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
