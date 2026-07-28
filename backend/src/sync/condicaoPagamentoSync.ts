import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "condicoes_pagamento-sync";
export const CRON_EXPR = "45 4 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT CodEmp AS codemp, CodCpg AS codcpg, DesCpg AS descpg, AbrCpg AS abrcpg, AplCpg AS aplcpg, SitCpg AS sitcpg FROM E028CPG`;

interface CondicaoPagamentoRow {
  codemp: number;
  codcpg: string;
  descpg: string;
  abrcpg: string;
  aplcpg: string;
  sitcpg: string;
}

export async function runCondicaoPagamentoSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codcpg"])) as CondicaoPagamentoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codcpg: row.codcpg, descpg: row.descpg, abrcpg: row.abrcpg, aplcpg: row.aplcpg, sitcpg: row.sitcpg };
      await prisma.condicaoPagamento.upsert({
        where: { codemp_codcpg: { codemp: row.codemp, codcpg: row.codcpg } },
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

export function scheduleCondicaoPagamentoSync(): void {
  cron.schedule(CRON_EXPR, runCondicaoPagamentoSync);
}
