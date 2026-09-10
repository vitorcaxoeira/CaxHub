import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "filial-sync";
export const CRON_EXPR = "10 3 * * *";
// Único campo de data é "DatPal" (alteração pro Palmtop, não do registro em si).
export const CAMPO_DATA: string | null = null;
export const QUERY ="SELECT codemp AS codemp, codfil AS codfil, nomfil AS nomfil, sigfil AS sigfil FROM e070fil";

interface FilialRow {
  codemp: number;
  codfil: number;
  nomfil: string;
  sigfil: string;
}

export async function runFilialSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const rows = (await runSqlViaSoap(query)) as FilialRow[];

    for (const row of rows) {
      // `update`/`create` são objetos SEPARADOS aqui — carimbo capturado uma vez fora e
      // espalhado nos dois literais.
      const carimboAtual = carimbo(inicio);
      await prisma.filial.upsert({
        where: { codemp_codfil: { codemp: row.codemp, codfil: row.codfil } },
        update: { nomfil: row.nomfil, sigfil: row.sigfil, ...carimboAtual },
        create: { ...row, ...carimboAtual },
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.FilialWhereInput>(prisma.filial, {
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

// Dados cadastrais de filial mudam raramente — roda 1x por dia às 3h10.
export function scheduleFilialSync(): void {
  cron.schedule(CRON_EXPR, runFilialSync);
}
