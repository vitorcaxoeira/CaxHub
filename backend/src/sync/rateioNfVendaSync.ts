import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "rateios_nfv-sync";
export const CRON_EXPR = "10 6 * * *";
export const CAMPO_DATA: string | null = "DatGer";
// Campos ampliados a pedido do Vitor (24/08/2026, mesma sessão) — lista completa que ele deu,
// mesma ordem do dicionário do Senior (CriRat/SomSub, de domínio, e UsuGer/DatGer/HorGer/TipOri,
// auditoria, ficaram de fora — mesma exclusão que ele já tinha feito).
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, codsnf AS codsnf, numnfv AS numnfv, seqrat AS seqrat, datbas AS datbas, tnspro AS tnspro, tnsser AS tnsser, seqipv AS seqipv, seqisv AS seqisv, numprj AS numprj, codfpj AS codfpj, ctafin AS ctafin, ctared AS ctared, percta AS percta, vlrcta AS vlrcta, codccu AS codccu, perrat AS perrat, vlrrat AS vlrrat, obsrat AS obsrat FROM e140rat`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface RateioNfVendaRow {
  codemp: number;
  codfil: number;
  codsnf: string;
  numnfv: number;
  seqrat: number;
  datbas?: string;
  tnspro?: string;
  tnsser?: string;
  seqipv?: number;
  seqisv?: number;
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
  { nome: "codsnf", cast: "text" },
  { nome: "numnfv", cast: "int" },
  { nome: "seqrat", cast: "int" },
  { nome: "datbas", cast: "date" },
  { nome: "tnspro", cast: "text" },
  { nome: "tnsser", cast: "text" },
  { nome: "seqipv", cast: "int" },
  { nome: "seqisv", cast: "int" },
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

function linhaDe(row: RateioNfVendaRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.codsnf}-${row.numnfv}-${row.seqrat}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.codsnf,
      String(row.numnfv),
      String(row.seqrat),
      row.datbas != null ? String(row.datbas).slice(0, 10) : null,
      row.tnspro != null ? row.tnspro : null,
      row.tnsser != null ? row.tnsser : null,
      row.seqipv != null ? String(row.seqipv) : null,
      row.seqisv != null ? String(row.seqisv) : null,
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

export async function runRateioNfVendaSync(desde?: Date): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  const QUERY = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "codsnf", "numnfv", "seqrat"])) as RateioNfVendaRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "rateios_nfv",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "codsnf", "numnfv", "seqrat"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo, nunca só o schema). Escopo
    // `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do escopo.
    // Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela tela é
    // decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.RateioNfVendaWhereInput>(prisma.rateioNfVenda, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(BASE_QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
      desde,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: QUERY,
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
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Rateio da NF — roda 1x por dia às 6h10, por último (referencia os itens por sequência,
// SeqIsv/SeqIpv, ainda sem FK Prisma formal — ver plano da rodada de 24/08/2026).
export function scheduleRateioNfVendaSync(): void {
  cron.schedule(CRON_EXPR, () => runRateioNfVendaSync());
}
