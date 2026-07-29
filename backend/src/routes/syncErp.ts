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
    // Última execução que REALMENTE varreu, que não é necessariamente a última execução:
    // sync incremental ("Alterados") nunca varre, então uma tabela pode ter sincronizado
    // agora e não ser varrida há meses. Sem separar os dois, a tela some com a informação
    // da varredura assim que roda um incremental, e o buraco fica invisível.
    const ultimaVarreduraPorJob = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      if (!ultimoPorJob.has(log.jobName)) ultimoPorJob.set(log.jobName, log);
      if (log.varreduraModo != null && !ultimaVarreduraPorJob.has(log.jobName)) {
        ultimaVarreduraPorJob.set(log.jobName, log);
      }
    }

    const contagens = await Promise.all(SYNC_JOBS.map((job) => job.contarRegistros()));
    // Só os jobs com detecção de exclusão ligada contam removidos; os demais devolvem null
    // e a tela não mostra nada na coluna.
    const removidos = await Promise.all(SYNC_JOBS.map((job) => job.contarRemovidos?.() ?? Promise.resolve(null)));

    const agora = new Date();
    res.json({
      sincronizandoTodos,
      jobs: SYNC_JOBS.map((job, indice) => {
        const ultimo = ultimoPorJob.get(job.jobName);
        const varredura = ultimaVarreduraPorJob.get(job.jobName);
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
          // `message` do SyncLog agora também carrega o resumo da varredura em execução
          // BEM-SUCEDIDA (ex.: "varredura SIMULADA: 3 sumiram do Senior"), não só erro.
          // Por isso vira `ultimaMensagem` e quem decide a cor na tela é `ultimoStatus` —
          // mandar isso como `ultimoErro` pintaria resumo de sucesso de vermelho.
          ultimaMensagem: ultimo?.message ?? null,
          totalRemovidos: removidos[indice],
          // Resultado da ÚLTIMA VARREDURA (não da última sincronização). `detectados`
          // conta o que ela achou, inclusive em modo "simular", quando nada foi gravado —
          // sem isso a tela mostraria zero durante toda a fase de observação, que é
          // justamente quando o número importa. `em` permite à tela avisar quando a
          // varredura está muito mais velha que a sincronização, sinal de tabela que só
          // vem rodando no modo "Alterados" e portanto nunca é varrida.
          ultimaVarredura:
            varredura?.varreduraModo != null
              ? {
                  modo: varredura.varreduraModo,
                  detectados: varredura.varreduraDetectados ?? 0,
                  em: varredura.runAt,
                }
              : null,
          // true = a tabela tem detecção configurada mas a última execução não varreu
          // (sync incremental). Vira alerta na tela quando persiste.
          temDeteccao: job.contarRemovidos != null,
          proximaExecucao: proximaExecucao(job.cronExpr, agora),
          emAndamento: jobsEmAndamento.has(job.jobName),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// GET /:jobName/removidos — amostra dos registros que a varredura marcou como excluídos
// no Senior, pra conferência manual lá no ERP. É o que permite validar a detecção antes
// de qualquer coisa começar a sumir das telas de negócio.
syncErpRouter.get("/:jobName/removidos", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (!job.listarRemovidos) {
      res.status(400).json({ error: "Esta tabela ainda não tem detecção de exclusão no Senior" });
      return;
    }
    const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));
    // Instante da última varredura deste job, pra listagem conseguir incluir os candidatos
    // que ainda não foram marcados (caso da simulação).
    const ultimaVarredura = await prisma.syncLog.findFirst({
      where: { jobName: job.jobName, varreduraInicio: { not: null } },
      orderBy: { runAt: "desc" },
      select: { varreduraInicio: true },
    });
    res.json({ itens: await job.listarRemovidos(limite, ultimaVarredura?.varreduraInicio ?? null) });
  } catch (error) {
    handleError(res, error, "removidos");
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
