import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "empresa-sync";
export const CRON_EXPR = "0 3 * * *";
// Único campo de data em e070emp é "DatPal" (data de alteração pro Palmtop, um recurso
// específico não relacionado a alteração geral do registro) — sem campo de geração/
// alteração real, não dá pra sincronizar só os alterados.
export const CAMPO_DATA: string | null = null;
const QUERY = "SELECT codemp AS codemp, nomemp AS nomemp, sigemp AS sigemp FROM e070emp";

interface EmpresaRow {
  codemp: number;
  nomemp: string;
  sigemp: string;
}

export async function runEmpresaSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoap(QUERY)) as EmpresaRow[];

    for (const row of rows) {
      await prisma.empresa.upsert({
        where: { codemp: row.codemp },
        update: { nomemp: row.nomemp, sigemp: row.sigemp },
        create: { codemp: row.codemp, nomemp: row.nomemp, sigemp: row.sigemp },
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

// Dados cadastrais de empresa mudam raramente — roda 1x por dia às 3h.
export function scheduleEmpresaSync(): void {
  cron.schedule(CRON_EXPR, runEmpresaSync);
}
