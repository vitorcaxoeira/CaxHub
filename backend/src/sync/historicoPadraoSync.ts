import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "historicos_padrao-sync";
export const CRON_EXPR = "10 5 * * *";
export const CAMPO_DATA: string | null = null;
// SEM CodEmp — E046HPD é catálogo GLOBAL do Senior (PK só CodHpd, confirmado ao vivo contra o
// dicionário de dados), diferente da maioria das tabelas espelhadas neste projeto.
export const QUERY = `SELECT CodHpd AS codhpd, TitHpd AS tithpd, DesHpd AS deshpd, TipHpd AS tiphpd, IntAgr AS intagr FROM E046HPD`;

interface HistoricoPadraoRow {
  codhpd: number;
  tithpd?: string;
  deshpd: string;
  tiphpd: string;
  intagr?: string;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codhpd", cast: "int" },
  { nome: "tithpd", cast: "text" },
  { nome: "deshpd", cast: "text" },
  { nome: "tiphpd", cast: "text" },
  { nome: "intagr", cast: "text" },
];

function linhaDe(row: HistoricoPadraoRow): LinhaUpsert {
  return {
    chave: String(row.codhpd),
    valores: [
      String(row.codhpd),
      row.tithpd != null ? row.tithpd : null,
      row.deshpd,
      row.tiphpd,
      row.intagr != null ? row.intagr : null,
    ],
  };
}

// Catálogo de configuração (templates de texto do "Complemento Hist."), GLOBAL (sem codemp).
// Até 10/09/2026 ficava sem varredura de propósito (decisão de 01/09/2026) — revertido: a
// convenção nova (sempre completo em toda tabela espelho) passou a valer também aqui, ver
// comentário em schema.prisma.
export async function runHistoricoPadraoSync(): Promise<void> {
  const inicio = new Date();
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver uma resposta
    // vazia/truncada — por isso sempre paginamos com ORDER BY pela chave primária, mesmo esta
    // tabela sendo pequena (é o padrão de todo job neste projeto).
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codhpd"])) as HistoricoPadraoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "historicos_padrao",
      colunas: COLUNAS,
      colunasPk: ["codhpd"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // Escopo `{}`: catálogo GLOBAL sem partição por empresa, mesmo raciocínio de qualquer
    // outra tabela sem escopo especial — ver comentário em schema.prisma.
    const varredura = await executarVarreduraDoJob<Prisma.HistoricoPadraoWhereInput>(prisma.historicoPadrao, {
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

export function scheduleHistoricoPadraoSync(): void {
  cron.schedule(CRON_EXPR, runHistoricoPadraoSync);
}
