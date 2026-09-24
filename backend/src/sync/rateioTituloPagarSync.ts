// Espelho local da tabela E501RAT do Senior ERP (C. Pagar - Títulos - Rateios dos
// Movimentos). Acrescentada em 16/09/2026 — linha de FATO da DRE do lado Pagar, espelho de
// rateioTituloReceberSync.ts. Depende de TituloPagar (FK real).
import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "rateios_pagar-sync";
export const CRON_EXPR = "20 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, codfor AS codfor, seqmov AS seqmov, seqrat AS seqrat, datbas AS datbas, codtns AS codtns, mesano AS mesano, crirat AS crirat, somsub AS somsub, numprj AS numprj, codfpj AS codfpj, ctafin AS ctafin, ctared AS ctared, percta AS percta, vlrcta AS vlrcta, codccu AS codccu, perrat AS perrat, vlrrat AS vlrrat, obsrat AS obsrat FROM e501rat`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface RateioTituloPagarRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codfor: number;
  seqmov: number;
  seqrat: number;
  datbas?: string;
  codtns?: string;
  mesano?: string;
  crirat: number;
  somsub: number;
  numprj?: number;
  codfpj?: number;
  ctafin?: number;
  ctared?: number;
  percta?: number;
  vlrcta?: number;
  codccu?: string;
  perrat?: number;
  vlrrat?: number;
  obsrat?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numtit", cast: "text" },
  { nome: "codtpt", cast: "text" },
  { nome: "codfor", cast: "int" },
  { nome: "seqmov", cast: "int" },
  { nome: "seqrat", cast: "int" },
  { nome: "datbas", cast: "date" },
  { nome: "codtns", cast: "text" },
  { nome: "mesano", cast: "date" },
  { nome: "crirat", cast: "int" },
  { nome: "somsub", cast: "int" },
  { nome: "numprj", cast: "int" },
  { nome: "codfpj", cast: "int" },
  { nome: "ctafin", cast: "int" },
  { nome: "ctared", cast: "int" },
  { nome: "percta", cast: "numeric" },
  { nome: "vlrcta", cast: "numeric" },
  { nome: "codccu", cast: "text" },
  { nome: "perrat", cast: "numeric" },
  { nome: "vlrrat", cast: "numeric" },
  { nome: "obsrat", cast: "text" },
];

function linhaDe(row: RateioTituloPagarRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numtit}-${row.codtpt}-${row.codfor}-${row.seqmov}-${row.seqrat}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.numtit,
      row.codtpt,
      String(row.codfor),
      String(row.seqmov),
      String(row.seqrat),
      row.datbas != null ? String(row.datbas).slice(0, 10) : null,
      row.codtns != null ? row.codtns : null,
      row.mesano != null ? String(row.mesano).slice(0, 10) : null,
      String(row.crirat),
      String(row.somsub),
      row.numprj != null ? String(row.numprj) : null,
      row.codfpj != null ? String(row.codfpj) : null,
      row.ctafin != null ? String(row.ctafin) : null,
      row.ctared != null ? String(row.ctared) : null,
      row.percta != null ? row.percta.toFixed(4) : null,
      row.vlrcta != null ? row.vlrcta.toFixed(2) : null,
      row.codccu != null ? row.codccu : null,
      row.perrat != null ? row.perrat.toFixed(4) : null,
      row.vlrrat != null ? row.vlrrat.toFixed(2) : null,
      row.obsrat != null ? row.obsrat : null,
    ],
  };
}

export async function runRateioTituloPagarSync(desde?: Date): Promise<void> {
  const inicio = new Date();
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver uma resposta
    // vazia/truncada — por isso sempre paginamos com ORDER BY pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "codfor",
      "seqmov",
      "seqrat",
    ])) as RateioTituloPagarRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "rateios_pagar",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numtit", "codtpt", "codfor", "seqmov", "seqrat"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    const varredura = await executarVarreduraDoJob<Prisma.RateioTituloPagarWhereInput>(prisma.rateioTituloPagar, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(BASE_QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
      desde,
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

export function scheduleRateioTituloPagarSync(): void {
  cron.schedule(CRON_EXPR, () => runRateioTituloPagarSync());
}
