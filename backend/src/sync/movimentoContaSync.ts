import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

export const JOB_NAME = "movimentos_conta-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
const BASE_QUERY = `SELECT codemp AS codemp, numcco AS numcco, datmov AS datmov, seqmov AS seqmov, codfil AS codfil, vlrmov AS vlrmov, debcre AS debcre, hismov AS hismov, sitmcc AS sitmcc, filmcr AS filmcr, nummcr AS nummcr, tptmcr AS tptmcr, seqmcr AS seqmcr, codpor AS codpor FROM e600mcc`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface MovimentoContaRow {
  codemp: number;
  numcco: string;
  datmov: string;
  seqmov: number;
  codfil?: number;
  vlrmov: number;
  debcre: string;
  hismov?: string;
  sitmcc?: string;
  filmcr?: number;
  nummcr?: string;
  tptmcr?: string;
  seqmcr?: number;
  codpor?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (MovimentoConta): vlrmov Decimal(15,2), debcre VarChar(1) NOT NULL. Sem
// carimbo — esta tabela não tem vistoEmSync/removidoEmSenior.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "numcco", cast: "text" },
  { nome: "datmov", cast: "date" },
  { nome: "seqmov", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "vlrmov", cast: "numeric" },
  { nome: "debcre", cast: "text" },
  { nome: "hismov", cast: "text" },
  { nome: "sitmcc", cast: "text" },
  { nome: "filmcr", cast: "int" },
  { nome: "nummcr", cast: "text" },
  { nome: "tptmcr", cast: "text" },
  { nome: "seqmcr", cast: "int" },
  { nome: "codpor", cast: "text" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma.
function linhaDe(row: MovimentoContaRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numcco}-${row.datmov}-${row.seqmov}`,
    valores: [
      String(row.codemp),
      row.numcco,
      String(row.datmov).slice(0, 10),
      String(row.seqmov),
      row.codfil != null ? String(row.codfil) : null,
      row.vlrmov.toFixed(2),
      row.debcre,
      row.hismov != null ? row.hismov : null,
      row.sitmcc != null ? row.sitmcc : null,
      row.filmcr != null ? String(row.filmcr) : null,
      row.nummcr != null ? row.nummcr : null,
      row.tptmcr != null ? row.tptmcr : null,
      row.seqmcr != null ? String(row.seqmcr) : null,
      row.codpor != null ? row.codpor : null,
    ],
  };
}

export async function runMovimentoContaSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numcco", "datmov", "seqmov"])) as MovimentoContaRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "movimentos_conta",
      colunas: COLUNAS,
      colunasPk: ["codemp", "numcco", "datmov", "seqmov"],
    });
    const msEscrita = Date.now() - inicioEscrita;

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)`,
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
export function scheduleMovimentoContaSync(): void {
  cron.schedule(CRON_EXPR, () => runMovimentoContaSync());
}
