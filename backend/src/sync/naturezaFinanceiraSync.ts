import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "naturezas_financeiras-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codemp AS codemp, ctafin AS ctafin, descta AS descta, abrcta AS abrcta, defgru AS defgru, anasin AS anasin, natfin AS natfin, sitfin AS sitfin FROM e091plf`;

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

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "ctafin", cast: "int" },
  { nome: "descta", cast: "text" },
  { nome: "abrcta", cast: "text" },
  { nome: "defgru", cast: "text" },
  { nome: "anasin", cast: "text" },
  { nome: "natfin", cast: "text" },
  { nome: "sitfin", cast: "text" },
];

function linhaDe(row: NaturezaFinanceiraRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.ctafin}`,
    valores: [
      String(row.codemp),
      String(row.ctafin),
      row.descta,
      row.abrcta,
      row.defgru,
      row.anasin,
      row.natfin,
      row.sitfin,
    ],
  };
}

export async function runNaturezaFinanceiraSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "ctafin"])) as NaturezaFinanceiraRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "naturezas_financeiras",
      colunas: COLUNAS,
      colunasPk: ["codemp", "ctafin"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.NaturezaFinanceiraWhereInput>(prisma.naturezaFinanceira, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)` +
          (varredura ? ` — ${varredura.resumo}` : ""),
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

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function scheduleNaturezaFinanceiraSync(): void {
  cron.schedule(CRON_EXPR, runNaturezaFinanceiraSync);
}
