import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "titulos_receber-sync";
export const CRON_EXPR = "0 4 * * *";
// Não há campo de "alteração" dedicado nessa tabela — DatGer é "data da geração do
// registro". Um título muda de situação (baixas, protesto) sem necessariamente
// atualizar DatGer, então o modo incremental pode não capturar toda mudança de status;
// mesmo assim, é a melhor aproximação disponível ("geração ou alteração").
export const CAMPO_DATA: string | null = "DatGer";
export const BASE_QUERY =`SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, codcli AS codcli, sittit AS sittit, datemi AS datemi, vctori AS vctori, vctpro AS vctpro, vlrori AS vlrori, vlrabe AS vlrabe, codpor AS codpor FROM e301tcr`;

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

interface TituloReceberRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codcli: number;
  sittit: string;
  datemi: string;
  vctori: string;
  vctpro: string;
  vlrori: number;
  vlrabe?: number;
  codpor?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (TituloReceber): vlrori/vlrabe Decimal(15,2). Sem carimbo — esta tabela não
// tem vistoEmSync/removidoEmSenior.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numtit", cast: "text" },
  { nome: "codtpt", cast: "text" },
  { nome: "codcli", cast: "int" },
  { nome: "sittit", cast: "text" },
  { nome: "datemi", cast: "date" },
  { nome: "vctori", cast: "date" },
  { nome: "vctpro", cast: "date" },
  { nome: "vlrori", cast: "numeric" },
  { nome: "vlrabe", cast: "numeric" },
  { nome: "codpor", cast: "text" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma.
function linhaDe(row: TituloReceberRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numtit}-${row.codtpt}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.numtit,
      row.codtpt,
      String(row.codcli),
      row.sittit,
      String(row.datemi).slice(0, 10),
      String(row.vctori).slice(0, 10),
      String(row.vctpro).slice(0, 10),
      row.vlrori.toFixed(2),
      row.vlrabe != null ? row.vlrabe.toFixed(2) : null,
      row.codpor != null ? row.codpor : null,
    ],
  };
}

export async function runTituloReceberSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
    ])) as TituloReceberRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "titulos_receber",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numtit", "codtpt"],
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
export function scheduleTituloReceberSync(): void {
  cron.schedule(CRON_EXPR, () => runTituloReceberSync());
}
