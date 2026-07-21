import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "naturezas_financeiras-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT codemp AS codemp, ctafin AS ctafin, descta AS descta, abrcta AS abrcta, defgru AS defgru, anasin AS anasin, natfin AS natfin, sitfin AS sitfin FROM e091plf`;

interface NaturezaFinanceiraRow {
  codemp: number;
  ctafin: number;
  descta: string;
  abrcta: string;
  defgru: string;
  anasin: string;
  natfin: string;
  sitfin: string;
}

export async function runNaturezaFinanceiraSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "ctafin"])) as NaturezaFinanceiraRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, ctafin: row.ctafin, descta: row.descta, abrcta: row.abrcta, defgru: row.defgru, anasin: row.anasin, natfin: row.natfin, sitfin: row.sitfin };
      await prisma.naturezaFinanceira.upsert({
        where: { codemp_ctafin: { codemp: row.codemp, ctafin: row.ctafin } },
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

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function scheduleNaturezaFinanceiraSync(): void {
  cron.schedule(CRON_EXPR, runNaturezaFinanceiraSync);
}
