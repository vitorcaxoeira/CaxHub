import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "tipos_titulo-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codtpt AS codtpt, destpt AS destpt, abrtpt AS abrtpt, recsom AS recsom, pagsom AS pagsom, apltpt AS apltpt, sittpt AS sittpt FROM e002tpt`;

interface TipoTituloRow {
  codtpt: string;
  destpt: string;
  abrtpt: string;
  recsom: string;
  pagsom: string;
  apltpt?: string;
  sittpt?: string;
}

// apltpt/sittpt são opcionais no schema (String?) — omitidos pelo Senior viram NULL, nunca
// string vazia, mesmo cuidado do resto do projeto (ver comentário em upsertEmLote.ts).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codtpt", cast: "text" },
  { nome: "destpt", cast: "text" },
  { nome: "abrtpt", cast: "text" },
  { nome: "recsom", cast: "text" },
  { nome: "pagsom", cast: "text" },
  { nome: "apltpt", cast: "text" },
  { nome: "sittpt", cast: "text" },
];

function linhaDe(row: TipoTituloRow): LinhaUpsert {
  return {
    chave: row.codtpt,
    valores: [
      row.codtpt,
      row.destpt,
      row.abrtpt,
      row.recsom,
      row.pagsom,
      row.apltpt != null ? row.apltpt : null,
      row.sittpt != null ? row.sittpt : null,
    ],
  };
}

export async function runTipoTituloSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoap(query)) as TipoTituloRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "tipos_titulo",
      colunas: COLUNAS,
      colunasPk: ["codtpt"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.TipoTituloWhereInput>(prisma.tipoTitulo, {
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
export function scheduleTipoTituloSync(): void {
  cron.schedule(CRON_EXPR, runTipoTituloSync);
}
