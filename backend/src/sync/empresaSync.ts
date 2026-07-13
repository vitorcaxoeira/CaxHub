import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "empresa-sync";
const QUERY = "SELECT codemp AS codemp, nomemp AS nomemp FROM e070emp";

interface EmpresaRow {
  codemp: number;
  nomemp: string;
}

export async function runEmpresaSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoap(QUERY)) as EmpresaRow[];

    for (const row of rows) {
      await prisma.empresa.upsert({
        where: { codemp: row.codemp },
        update: { nomemp: row.nomemp },
        create: { codemp: row.codemp, nomemp: row.nomemp },
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
  cron.schedule("0 3 * * *", runEmpresaSync);
}
