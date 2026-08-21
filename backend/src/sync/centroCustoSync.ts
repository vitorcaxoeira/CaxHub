import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "centros_custo-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatAlt";
// claccu/nivccu/mskccu acrescentados em 13/08/2026. `claccu` já existia no schema desde
// 11/08 mas tinha ficado fora desta query por descuido — daí estar 0 de 228 preenchida. É a
// mesma falha que aconteceu com empresa.codmpc/codmpu e plano_contabil.despar: coluna no
// schema, esquecida no SELECT do sync.
export const BASE_QUERY =`SELECT codemp AS codemp, codccu AS codccu, desccu AS desccu, abrccu AS abrccu, tipccu AS tipccu, ccupai AS ccupai, anasin AS anasin, claccu AS claccu, nivccu AS nivccu, mskccu AS mskccu FROM e044ccu`;

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

interface CentroCustoRow {
  codemp: number;
  codccu: string;
  desccu: string;
  abrccu: string;
  tipccu: number;
  ccupai?: string;
  anasin?: string;
  claccu?: string;
  nivccu?: number;
  mskccu?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores. Sem carimbo (`carimbo`
// omitido abaixo) — esta tabela não grava visto_em_sync/removido_em_senior hoje, e a
// conversão pra lote não muda esse comportamento (ligar carimbo aqui é decisão à parte).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "desccu", cast: "text" },
  { nome: "abrccu", cast: "text" },
  { nome: "tipccu", cast: "int" },
  { nome: "ccupai", cast: "text" },
  { nome: "anasin", cast: "text" },
  { nome: "claccu", cast: "text" },
  { nome: "nivccu", cast: "int" },
  { nome: "mskccu", cast: "text" },
];

// `!= null` (não `!== undefined`) pra tratar ausência de chave e null da mesma forma.
function linhaDe(row: CentroCustoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codccu}`,
    valores: [
      String(row.codemp),
      row.codccu,
      row.desccu,
      row.abrccu,
      String(row.tipccu),
      row.ccupai != null ? row.ccupai : null,
      row.anasin != null ? row.anasin : null,
      row.claccu != null ? row.claccu : null,
      row.nivccu != null ? String(row.nivccu) : null,
      row.mskccu != null ? row.mskccu : null,
    ],
  };
}

export async function runCentroCustoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codccu"])) as CentroCustoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "centros_custo",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codccu"],
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
export function scheduleCentroCustoSync(): void {
  cron.schedule(CRON_EXPR, () => runCentroCustoSync());
}
