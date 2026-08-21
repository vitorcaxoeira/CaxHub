import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "movimentos_receber-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
export const BASE_QUERY =`SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, seqmov AS seqmov, codtns AS codtns, datmov AS datmov, datpgt AS datpgt, codfpg AS codfpg, vlrmov AS vlrmov, vlrliq AS vlrliq, vlrjrs AS vlrjrs, vlrmul AS vlrmul, vlrdsc AS vlrdsc, diaatr AS diaatr, codpor AS codpor, codcrt AS codcrt, codccu AS codccu, numcco AS numcco FROM e301mcr`;

// Fase 1 do plano de filtros na importação: acumulador de predicados
// (sync/consultaSenior.ts), não concatenação — lista vazia devolve BASE_QUERY intacta.
function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  // Pedido do Vitor (21/08/2026): se o admin já salvou um predicado explícito no campo de
  // data (Filtro(Alterados), inclusive com a variável "última sincronização"), ele substitui
  // a injeção automática por inteiro em vez de empilhar os dois — "editável de verdade".
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface MovimentoTituloReceberRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  seqmov: number;
  codtns: string;
  datmov: string;
  datpgt?: string;
  codfpg?: number;
  vlrmov: number;
  vlrliq?: number;
  vlrjrs?: number;
  vlrmul?: number;
  vlrdsc?: number;
  diaatr?: number;
  codpor?: string;
  codcrt?: string;
  codccu?: string;
  numcco?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — casts conferidos contra
// schema.prisma (MovimentoTituloReceber): vlrmov/vlrliq/vlrjrs/vlrmul/vlrdsc Decimal(15,2),
// codpor/codcrt/codccu/numcco VarChar (por isso ::text, nunca ::varchar(N) — cast largo pra
// coluna estreita preserva o erro de truncamento em vez de truncar em silêncio). Sem carimbo
// — esta tabela não tem vistoEmSync/removidoEmSenior.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numtit", cast: "text" },
  { nome: "codtpt", cast: "text" },
  { nome: "seqmov", cast: "int" },
  { nome: "codtns", cast: "text" },
  { nome: "datmov", cast: "date" },
  { nome: "datpgt", cast: "date" },
  { nome: "codfpg", cast: "int" },
  { nome: "vlrmov", cast: "numeric" },
  { nome: "vlrliq", cast: "numeric" },
  { nome: "vlrjrs", cast: "numeric" },
  { nome: "vlrmul", cast: "numeric" },
  { nome: "vlrdsc", cast: "numeric" },
  { nome: "diaatr", cast: "int" },
  { nome: "codpor", cast: "text" },
  { nome: "codcrt", cast: "text" },
  { nome: "codccu", cast: "text" },
  { nome: "numcco", cast: "text" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)` — desloca o dia em
// America/Sao_Paulo. `.toFixed(2)` pra decimal, nunca number cru. `!= null` (não
// `!== undefined`) trata ausência de chave e null da mesma forma.
function linhaDe(row: MovimentoTituloReceberRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numtit}-${row.codtpt}-${row.seqmov}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.numtit,
      row.codtpt,
      String(row.seqmov),
      row.codtns,
      String(row.datmov).slice(0, 10),
      row.datpgt != null ? String(row.datpgt).slice(0, 10) : null,
      row.codfpg != null ? String(row.codfpg) : null,
      row.vlrmov.toFixed(2),
      row.vlrliq != null ? row.vlrliq.toFixed(2) : null,
      row.vlrjrs != null ? row.vlrjrs.toFixed(2) : null,
      row.vlrmul != null ? row.vlrmul.toFixed(2) : null,
      row.vlrdsc != null ? row.vlrdsc.toFixed(2) : null,
      row.diaatr != null ? String(row.diaatr) : null,
      row.codpor != null ? row.codpor : null,
      row.codcrt != null ? row.codcrt : null,
      row.codccu != null ? row.codccu : null,
      row.numcco != null ? row.numcco : null,
    ],
  };
}

export async function runMovimentoTituloReceberSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "seqmov",
    ])) as MovimentoTituloReceberRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "movimentos_receber",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numtit", "codtpt", "seqmov"],
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
export function scheduleMovimentoTituloReceberSync(): void {
  cron.schedule(CRON_EXPR, () => runMovimentoTituloReceberSync());
}
