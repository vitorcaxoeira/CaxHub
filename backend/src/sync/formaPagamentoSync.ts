import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "formas_pagamento-sync";
export const CRON_EXPR = "40 4 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT CodEmp AS codemp, CodFpg AS codfpg, DesFpg AS desfpg, AbrFpg AS abrfpg, SitFpg AS sitfpg FROM E066FPG`;

interface FormaPagamentoRow {
  codemp: number;
  codfpg: number;
  desfpg: string;
  abrfpg: string;
  sitfpg: string;
}

export async function runFormaPagamentoSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codfpg"])) as FormaPagamentoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfpg: row.codfpg, desfpg: row.desfpg, abrfpg: row.abrfpg, sitfpg: row.sitfpg };
      await prisma.formaPagamento.upsert({
        where: { codemp_codfpg: { codemp: row.codemp, codfpg: row.codfpg } },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success", duracaoMs: Date.now() - inicio.getTime() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleFormaPagamentoSync(): void {
  cron.schedule(CRON_EXPR, runFormaPagamentoSync);
}
