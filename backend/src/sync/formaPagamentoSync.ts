import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "formas_pagamento-sync";
export const CRON_EXPR = "40 4 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT CodEmp AS codemp, CodFpg AS codfpg, DesFpg AS desfpg, AbrFpg AS abrfpg, SitFpg AS sitfpg FROM E066FPG`;

interface FormaPagamentoRow {
  codemp: number;
  codfpg: number;
  desfpg: string;
  abrfpg: string;
  sitfpg: string;
}

export async function runFormaPagamentoSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfpg"])) as FormaPagamentoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfpg: row.codfpg, desfpg: row.desfpg, abrfpg: row.abrfpg, sitfpg: row.sitfpg };
      await prisma.formaPagamento.upsert({
        where: { codemp_codfpg: { codemp: row.codemp, codfpg: row.codfpg } },
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

export function scheduleFormaPagamentoSync(): void {
  cron.schedule(CRON_EXPR, runFormaPagamentoSync);
}
