import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "fases_proposta-sync";
export const CRON_EXPR = "50 3 * * *";
// Tabela de domínio simples (fasid/fasdes) — sem campo de data de geração/alteração.
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT USU_FasId AS fasid, USU_FasDes AS fasdes FROM USU_TFasesPro`;

interface FasePropostaRow {
  fasid: number;
  fasdes: string;
}

export async function runFasePropostaSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["fasid"])) as FasePropostaRow[];

    for (const row of rows) {
      const data = { fasid: row.fasid, fasdes: row.fasdes };
      await prisma.faseProposta.upsert({
        where: { fasid: row.fasid },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Roda antes do atividadeConsultorSync (4h) — AtividadeConsultor.fasid é FK pra cá,
// então essa tabela precisa estar atualizada primeiro.
export function scheduleFasePropostaSync(): void {
  cron.schedule(CRON_EXPR, runFasePropostaSync);
}
