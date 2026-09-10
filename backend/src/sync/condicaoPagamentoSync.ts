import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "condicoes_pagamento-sync";
export const CRON_EXPR = "45 4 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT CodEmp AS codemp, CodCpg AS codcpg, DesCpg AS descpg, AbrCpg AS abrcpg, AplCpg AS aplcpg, SitCpg AS sitcpg FROM E028CPG`;

interface CondicaoPagamentoRow {
  codemp: number;
  codcpg: string;
  descpg: string;
  abrcpg: string;
  aplcpg: string;
  sitcpg: string;
}

export async function runCondicaoPagamentoSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codcpg"])) as CondicaoPagamentoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codcpg: row.codcpg, descpg: row.descpg, abrcpg: row.abrcpg, aplcpg: row.aplcpg, sitcpg: row.sitcpg, ...carimbo(inicio) };
      await prisma.condicaoPagamento.upsert({
        where: { codemp_codcpg: { codemp: row.codemp, codcpg: row.codcpg } },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.CondicaoPagamentoWhereInput>(prisma.condicaoPagamento, {
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

export function scheduleCondicaoPagamentoSync(): void {
  cron.schedule(CRON_EXPR, runCondicaoPagamentoSync);
}
