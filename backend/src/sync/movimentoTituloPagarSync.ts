// Espelho local da tabela E501MCP do Senior ERP (C. Pagar - Títulos - Movimentos).
// Acrescentada em 16/09/2026 pro DRE, mesmo molde de movimentoTituloReceberSync.ts. Depende
// de TituloPagar (FK real) e Transacao — precisa vir depois de ambos em registry.ts.
import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { filtroDoJob } from "./filtrosAtivos";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";
import { Prisma } from "@prisma/client";

export const JOB_NAME = "movimentos_pagar-sync";
export const CRON_EXPR = "15 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, codfor AS codfor, seqmov AS seqmov, codtns AS codtns, datmov AS datmov, datpgt AS datpgt, vlrmov AS vlrmov, vlrliq AS vlrliq, diaatr AS diaatr, codpor AS codpor, codcrt AS codcrt, ctafin AS ctafin, ctared AS ctared, codccu AS codccu, numcco AS numcco, datcco AS datcco, seqcco AS seqcco, seqmcr AS seqmcr, lctfin AS lctfin FROM e501mcp`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface MovimentoTituloPagarRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codfor: number;
  seqmov: number;
  codtns: string;
  datmov: string;
  datpgt?: string;
  vlrmov: number;
  vlrliq?: number;
  diaatr?: number;
  codpor?: string;
  codcrt?: string;
  ctafin?: number;
  ctared?: number;
  codccu?: string;
  numcco?: string;
  datcco?: string;
  seqcco?: number;
  seqmcr?: number;
  lctfin: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (MovimentoTituloPagar): vlrmov/vlrliq Decimal(15,2).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numtit", cast: "text" },
  { nome: "codtpt", cast: "text" },
  { nome: "codfor", cast: "int" },
  { nome: "seqmov", cast: "int" },
  { nome: "codtns", cast: "text" },
  { nome: "datmov", cast: "date" },
  { nome: "datpgt", cast: "date" },
  { nome: "vlrmov", cast: "numeric" },
  { nome: "vlrliq", cast: "numeric" },
  { nome: "diaatr", cast: "int" },
  { nome: "codpor", cast: "text" },
  { nome: "codcrt", cast: "text" },
  { nome: "ctafin", cast: "int" },
  { nome: "ctared", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "numcco", cast: "text" },
  { nome: "datcco", cast: "date" },
  { nome: "seqcco", cast: "int" },
  { nome: "seqmcr", cast: "int" },
  { nome: "lctfin", cast: "text" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)` — "2025-03-14" é UTC mas
// "2025-03-14T00:00:00" é local, e em America/Sao_Paulo isso desloca o dia.
function linhaDe(row: MovimentoTituloPagarRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numtit}-${row.codtpt}-${row.codfor}-${row.seqmov}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.numtit,
      row.codtpt,
      String(row.codfor),
      String(row.seqmov),
      row.codtns,
      String(row.datmov).slice(0, 10),
      row.datpgt != null ? String(row.datpgt).slice(0, 10) : null,
      row.vlrmov.toFixed(2),
      row.vlrliq != null ? row.vlrliq.toFixed(2) : null,
      row.diaatr != null ? String(row.diaatr) : null,
      row.codpor != null ? row.codpor : null,
      row.codcrt != null ? row.codcrt : null,
      row.ctafin != null ? String(row.ctafin) : null,
      row.ctared != null ? String(row.ctared) : null,
      row.codccu != null ? row.codccu : null,
      row.numcco != null ? row.numcco : null,
      row.datcco != null ? String(row.datcco).slice(0, 10) : null,
      row.seqcco != null ? String(row.seqcco) : null,
      row.seqmcr != null ? String(row.seqmcr) : null,
      row.lctfin,
    ],
  };
}

export async function runMovimentoTituloPagarSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "codfor",
      "seqmov",
    ])) as MovimentoTituloPagarRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "movimentos_pagar",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numtit", "codtpt", "codfor", "seqmov"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    const varredura = await executarVarreduraDoJob<Prisma.MovimentoTituloPagarWhereInput>(prisma.movimentoTituloPagar, {
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

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleMovimentoTituloPagarSync(): void {
  cron.schedule(CRON_EXPR, () => runMovimentoTituloPagarSync());
}
