import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

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
      const data = { codemp: row.codemp, codfpg: row.codfpg, desfpg: row.desfpg, abrfpg: row.abrfpg, sitfpg: row.sitfpg, ...carimbo(inicio) };
      await prisma.formaPagamento.upsert({
        where: { codemp_codfpg: { codemp: row.codemp, codfpg: row.codfpg } },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.FormaPagamentoWhereInput>(prisma.formaPagamento, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: rows.length,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: varredura ? varredura.resumo : undefined,
        varreduraModo: varredura?.modo ?? null,
        varreduraDetectados: varredura?.candidatos ?? null,
        varreduraInicio: varredura ? inicio : null,
        duracaoMs: Date.now() - inicio.getTime(),
      },
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
