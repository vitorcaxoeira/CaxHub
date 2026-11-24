import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "itens_servico_nfv-sync";
export const CRON_EXPR = "0 6 * * *";
export const CAMPO_DATA: string | null = "DatGer";
// Campos ampliados a pedido do Vitor (24/08/2026, mesma sessão) — "complemente" (aditivo):
// codser/cplisv/vlrbru já existentes preservados, mesma ordem do dicionário do Senior.
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, codsnf AS codsnf, numnfv AS numnfv, seqisv AS seqisv, tnsser AS tnsser, nopser AS nopser, filped AS filped, numped AS numped, seqisp AS seqisp, filctr AS filctr, numctr AS numctr, datcpt AS datcpt, seqcvs AS seqcvs, codser AS codser, cplisv AS cplisv, qtdfat AS qtdfat, qtddev AS qtddev, unimed AS unimed, codtpr AS codtpr, preuni AS preuni, vlrbru AS vlrbru FROM e140isv`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface ItemServicoNfVendaRow {
  codemp: number;
  codfil: number;
  codsnf: string;
  numnfv: number;
  seqisv: number;
  tnsser?: string;
  nopser?: string;
  filped?: number;
  numped?: number;
  seqisp?: number;
  filctr?: number;
  numctr?: number;
  datcpt?: string;
  seqcvs?: number;
  codser?: string;
  cplisv?: string;
  qtdfat?: number;
  qtddev?: number;
  unimed?: string;
  codtpr?: string;
  preuni?: number;
  vlrbru?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "codsnf", cast: "text" },
  { nome: "numnfv", cast: "int" },
  { nome: "seqisv", cast: "int" },
  { nome: "tnsser", cast: "text" },
  { nome: "nopser", cast: "text" },
  { nome: "filped", cast: "int" },
  { nome: "numped", cast: "int" },
  { nome: "seqisp", cast: "int" },
  { nome: "filctr", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "datcpt", cast: "date" },
  { nome: "seqcvs", cast: "int" },
  { nome: "codser", cast: "text" },
  { nome: "cplisv", cast: "text" },
  { nome: "qtdfat", cast: "numeric" },
  { nome: "qtddev", cast: "numeric" },
  { nome: "unimed", cast: "text" },
  { nome: "codtpr", cast: "text" },
  { nome: "preuni", cast: "numeric" },
  { nome: "vlrbru", cast: "numeric" },
];

function linhaDe(row: ItemServicoNfVendaRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.codsnf}-${row.numnfv}-${row.seqisv}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.codsnf,
      String(row.numnfv),
      String(row.seqisv),
      row.tnsser != null ? row.tnsser : null,
      row.nopser != null ? row.nopser : null,
      row.filped != null ? String(row.filped) : null,
      row.numped != null ? String(row.numped) : null,
      row.seqisp != null ? String(row.seqisp) : null,
      row.filctr != null ? String(row.filctr) : null,
      row.numctr != null ? String(row.numctr) : null,
      row.datcpt != null ? String(row.datcpt).slice(0, 10) : null,
      row.seqcvs != null ? String(row.seqcvs) : null,
      row.codser != null ? row.codser : null,
      row.cplisv != null ? row.cplisv : null,
      row.qtdfat != null ? row.qtdfat.toFixed(5) : null,
      row.qtddev != null ? row.qtddev.toFixed(5) : null,
      row.unimed != null ? row.unimed : null,
      row.codtpr != null ? row.codtpr : null,
      row.preuni != null ? row.preuni.toFixed(10) : null,
      row.vlrbru != null ? row.vlrbru.toFixed(2) : null,
    ],
  };
}

export async function runItemServicoNfVendaSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "codsnf", "numnfv", "seqisv"])) as ItemServicoNfVendaRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "itens_servico_nfv",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "codsnf", "numnfv", "seqisv"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo, nunca só o schema). Escopo
    // `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do escopo.
    // Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela tela é
    // decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.ItemServicoNfVendaWhereInput>(prisma.itemServicoNfVenda, {
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

// Itens de serviço da NF — roda 1x por dia às 6h, depois do cabeçalho (notas_fiscais_venda-sync).
export function scheduleItemServicoNfVendaSync(): void {
  cron.schedule(CRON_EXPR, () => runItemServicoNfVendaSync());
}
