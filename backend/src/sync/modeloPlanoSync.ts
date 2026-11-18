import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "modelo_planos-sync";
export const CRON_EXPR = "55 4 * * *";
export const CAMPO_DATA: string | null = "DatAlt";
// E043PCM (Tabelas - Modelos de Planos - Contas ou Centros de Custos), com a estrutura do modelo de
// plano. Ficaram de fora: conta financeira/contábil relacionada (CtaCtb), rateio (ExiRat/ForRat), método
// de conversão, validade (ValIni/ValFin), atributos (AtrCtb/ColCtb) e a auditoria de geração.
export const QUERY = `SELECT CodMpc AS codmpc, CtaRed AS ctared, ClaCta AS clacta, DesCta AS descta, AbrCta AS abrcta, AnaSin AS anasin, NivCta AS nivcta, MskGcc AS mskgcc, DefGru AS defgru, NatCta AS natcta, DesPar AS despar, ClaPar AS clapar, CtaPar AS ctapar, CodCcu AS codccu, TipCcu AS tipccu, DatAlt AS datalt FROM e043pcm`;

interface ModeloPlanoRow {
  codmpc: number;
  ctared: number;
  clacta?: string | null;
  descta?: string | null;
  abrcta?: string | null;
  anasin?: string | null;
  nivcta?: number | null;
  mskgcc?: string | null;
  defgru?: string | null;
  natcta?: string | null;
  despar?: string | null;
  clapar?: string | null;
  ctapar?: number | null;
  codccu?: string | null;
  tipccu?: number | null;
  datalt?: string | null;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codmpc", cast: "int" },
  { nome: "ctared", cast: "int" },
  { nome: "clacta", cast: "text" },
  { nome: "descta", cast: "text" },
  { nome: "abrcta", cast: "text" },
  { nome: "anasin", cast: "text" },
  { nome: "nivcta", cast: "int" },
  { nome: "mskgcc", cast: "text" },
  { nome: "defgru", cast: "text" },
  { nome: "natcta", cast: "text" },
  { nome: "despar", cast: "text" },
  { nome: "clapar", cast: "text" },
  { nome: "ctapar", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "tipccu", cast: "int" },
  { nome: "datalt", cast: "date" },
];

// O Senior grava " " (espaço) no lugar de vazio — `trim` e vazio vira NULL, assim "sem valor" tem
// uma só representação (e `despar <> ''` deixa de enganar).
function textoOuNulo(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
const inteiroOuNulo = (v: number | null | undefined): string | null => (v == null ? null : String(v));
// "1900-12-31" e anteriores = "sem data" no Senior.
function dataOuNula(v: string | null | undefined): string | null {
  if (v == null) return null;
  const d = String(v).slice(0, 10);
  return d < "1901-01-01" ? null : d;
}

function linhaDe(row: ModeloPlanoRow): LinhaUpsert {
  return {
    chave: `${row.codmpc}-${row.ctared}`,
    valores: [
      String(row.codmpc),
      String(row.ctared),
      textoOuNulo(row.clacta),
      textoOuNulo(row.descta),
      textoOuNulo(row.abrcta),
      textoOuNulo(row.anasin),
      inteiroOuNulo(row.nivcta),
      textoOuNulo(row.mskgcc),
      textoOuNulo(row.defgru),
      textoOuNulo(row.natcta),
      textoOuNulo(row.despar),
      textoOuNulo(row.clapar),
      inteiroOuNulo(row.ctapar),
      textoOuNulo(row.codccu),
      inteiroOuNulo(row.tipccu),
      dataOuNula(row.datalt),
    ],
  };
}

// Fase 1 do plano de filtros na importação: acumulador de predicados (sync/consultaSenior.ts).
function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  // Se o admin já salvou um predicado explícito no campo de data, ele substitui a injeção automática.
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(QUERY, predicados);
}

export async function runModeloPlanoSync(desde?: Date): Promise<void> {
  const inicio = new Date();
  const query = montarQuery(desde);
  try {
    // Paginado com ORDER BY pela chave primária, como todo job do projeto.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codmpc", "ctared"])) as ModeloPlanoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "modelo_planos",
      colunas: COLUNAS,
      colunasPk: ["codmpc", "ctared"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // Espelho só-leitura: escopo `{}` (tabela toda). Varredura nasce "desligada" (default de
    // ConfiguracaoVarredura) — promoção pela tela é decisão manual.
    const varredura = await executarVarreduraDoJob<Prisma.ModeloPlanoWhereInput>(prisma.modeloPlano, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
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

// Modelos de plano mudam pouco — roda 1x por dia às 4h55. O modo incremental só roda quando
// disparado manualmente pela tela de administração de sincronização.
export function scheduleModeloPlanoSync(): void {
  cron.schedule(CRON_EXPR, () => runModeloPlanoSync());
}
