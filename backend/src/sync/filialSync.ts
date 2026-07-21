import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "filial-sync";
export const CRON_EXPR = "10 3 * * *";
// Único campo de data é "DatPal" (alteração pro Palmtop, não do registro em si).
export const CAMPO_DATA: string | null = null;
const QUERY = "SELECT codemp AS codemp, codfil AS codfil, nomfil AS nomfil, sigfil AS sigfil FROM e070fil";

interface FilialRow {
  codemp: number;
  codfil: number;
  nomfil: string;
  sigfil: string;
}

export async function runFilialSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoap(QUERY)) as FilialRow[];

    for (const row of rows) {
      await prisma.filial.upsert({
        where: { codemp_codfil: { codemp: row.codemp, codfil: row.codfil } },
        update: { nomfil: row.nomfil, sigfil: row.sigfil },
        create: row,
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

// Dados cadastrais de filial mudam raramente — roda 1x por dia às 3h10.
export function scheduleFilialSync(): void {
  cron.schedule(CRON_EXPR, runFilialSync);
}
