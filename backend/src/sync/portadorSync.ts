import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "portadores-sync";
export const CRON_EXPR = "0 4 * * *";
// Único campo de data é "DatPal" (alteração pro Palmtop, não do registro em si).
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codemp AS codemp, codpor AS codpor, despor AS despor, abrpor AS abrpor, codban AS codban, codage AS codage, numcco AS numcco FROM e039por`;

interface PortadorRow {
  codemp: number;
  codpor: string;
  despor: string;
  abrpor: string;
  codban?: string;
  codage?: string;
  numcco?: string;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codpor", cast: "text" },
  { nome: "despor", cast: "text" },
  { nome: "abrpor", cast: "text" },
  { nome: "codban", cast: "text" },
  { nome: "codage", cast: "text" },
  { nome: "numcco", cast: "text" },
];

function linhaDe(row: PortadorRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codpor}`,
    valores: [
      String(row.codemp),
      row.codpor,
      row.despor,
      row.abrpor,
      row.codban != null ? row.codban : null,
      row.codage != null ? row.codage : null,
      row.numcco != null ? row.numcco : null,
    ],
  };
}

export async function runPortadorSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codpor"])) as PortadorRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "portadores",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codpor"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.PortadorWhereInput>(prisma.portador, {
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
export function schedulePortadorSync(): void {
  cron.schedule(CRON_EXPR, runPortadorSync);
}
