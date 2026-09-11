import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { diffCampos, criarEventoAuditoria, paraDiff } from "../audit/registrarEvento";
import { CAMPOS_AUDITADOS_PROPOSTA_ITEM } from "../audit/camposAuditados";
import { EVENTOS_AUDITORIA, ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdPropostaItem } from "../audit/identidadeEntidade";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "propostas_itens-sync";
export const CRON_EXPR = "0 4 * * *";
// USU_TE077ITE não tem campo de data de geração/alteração no dicionário do Senior.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT USU_CodEmp AS codemp, USU_CodPro AS codpro, USU_SeqIte AS seqite, USU_NumPrj AS numprj, USU_CodSer AS codser, USU_QtdHor AS qtdhor, USU_ValHor AS valhor, USU_DesPro AS despro, USU_EntPro AS entpro, USU_CodFpj AS codfpj, USU_FatSer AS fatser, USU_SitMot AS sitmot, USU_ForFat AS forfat, USU_TipPrj AS tipprj, USU_FrmPrj AS frmprj, USU_SitPrz AS sitprz, USU_ATVPSO AS atvpso, USU_DepExe AS depexe FROM USU_TE077ITE`;

export interface PropostaItemRow {
  codemp: number;
  codpro: number;
  seqite: number;
  numprj: number;
  codser: string;
  qtdhor?: number;
  valhor?: number;
  despro?: string;
  entpro?: string;
  codfpj: number;
  fatser?: string;
  sitmot?: number;
  forfat?: number;
  tipprj?: number;
  frmprj?: number;
  sitprz?: number;
  atvpso?: number;
  depexe?: number;
}

// Objeto tipado usado só pro diff de auditoria — ver mesmo raciocínio em propostaSync.ts.
function dataTipada(row: PropostaItemRow, inicio: Date) {
  return {
    codemp: row.codemp, codpro: row.codpro, seqite: row.seqite, numprj: row.numprj, codser: row.codser,
    qtdhor: row.qtdhor, valhor: row.valhor, despro: row.despro, entpro: row.entpro, codfpj: row.codfpj,
    fatser: row.fatser, sitmot: row.sitmot, forfat: row.forfat, tipprj: row.tipprj, frmprj: row.frmprj,
    sitprz: row.sitprz, atvpso: row.atvpso != null ? BigInt(row.atvpso) : null, depexe: row.depexe,
    vistoEmSync: inicio, removidoEmSenior: null as Date | null,
  };
}

// schema.prisma (PropostaItem): valhor Decimal(11,2), atvpso BigInt.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codpro", cast: "int" },
  { nome: "seqite", cast: "int" },
  { nome: "numprj", cast: "int" },
  { nome: "codser", cast: "text" },
  { nome: "qtdhor", cast: "int" },
  { nome: "valhor", cast: "numeric" },
  { nome: "despro", cast: "text" },
  { nome: "entpro", cast: "text" },
  { nome: "codfpj", cast: "int" },
  { nome: "fatser", cast: "text" },
  { nome: "sitmot", cast: "int" },
  { nome: "forfat", cast: "int" },
  { nome: "tipprj", cast: "int" },
  { nome: "frmprj", cast: "int" },
  { nome: "sitprz", cast: "int" },
  { nome: "atvpso", cast: "bigint" },
  { nome: "depexe", cast: "int" },
];

function linhaDe(row: PropostaItemRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codpro}-${row.seqite}`,
    valores: [
      String(row.codemp),
      String(row.codpro),
      String(row.seqite),
      String(row.numprj),
      row.codser,
      row.qtdhor != null ? String(row.qtdhor) : null,
      row.valhor != null ? row.valhor.toFixed(2) : null,
      row.despro != null ? row.despro : null,
      row.entpro != null ? row.entpro : null,
      String(row.codfpj),
      row.fatser != null ? row.fatser : null,
      row.sitmot != null ? String(row.sitmot) : null,
      row.forfat != null ? String(row.forfat) : null,
      row.tipprj != null ? String(row.tipprj) : null,
      row.frmprj != null ? String(row.frmprj) : null,
      row.sitprz != null ? String(row.sitprz) : null,
      row.atvpso != null ? String(row.atvpso) : null,
      row.depexe != null ? String(row.depexe) : null,
    ],
  };
}

// Corpo do processamento extraído à parte de runPropostaItemSync() para poder ser
// exercitado com linhas sintéticas (ver backend/prisma/verificarAceiteAuditoria.ts) sem
// depender do webservice SOAP real — mesma lógica, sem mudança de comportamento. `inicio`
// tem default pra não quebrar chamadas existentes que não passam — ver mesmo raciocínio em
// propostaSync.ts.
//
// HÍBRIDO (11/09/2026, porte do upsert em lote do CaxHub_Atlas) — mesmo raciocínio de
// propostaSync.ts: linha SEM mudança de campo auditado vai pro upsertEmLote (caminho quente,
// maioria numa sync incremental); linha NOVA ou com alteração continua upsert+evento na
// MESMA transação, preservando a atomicidade só onde ela importa (auditoria).
export async function processarLinhasPropostaItem(rows: PropostaItemRow[], inicio: Date = new Date()): Promise<{ msFetch: number; msEscrita: number; lotes: number }> {
  if (rows.length === 0) return { msFetch: 0, msEscrita: 0, lotes: 0 };

  const inicioFetch = Date.now();
  const existentes = await prisma.propostaItem.findMany({
    where: { OR: rows.map((r) => ({ codemp: r.codemp, codpro: r.codpro, seqite: r.seqite })) },
  });
  const msFetch = Date.now() - inicioFetch;
  const existentePorChave = new Map(existentes.map((e) => [`${e.codemp}-${e.codpro}-${e.seqite}`, e]));

  const linhasSemMudanca: LinhaUpsert[] = [];
  const linhasComMudanca: { row: PropostaItemRow; data: ReturnType<typeof dataTipada>; ehNovo: boolean; alteracoes: ReturnType<typeof diffCampos>["alteracoes"] }[] = [];

  for (const row of rows) {
    const existente = existentePorChave.get(`${row.codemp}-${row.codpro}-${row.seqite}`) ?? null;
    const data = dataTipada(row, inicio);
    const ehNovo = existente === null;
    const { alteracoes, algumaMudanca } = diffCampos(CAMPOS_AUDITADOS_PROPOSTA_ITEM, existente, paraDiff(data));

    if (!ehNovo && !algumaMudanca) {
      linhasSemMudanca.push(linhaDe(row));
    } else {
      linhasComMudanca.push({ row, data, ehNovo, alteracoes });
    }
  }

  const inicioEscrita = Date.now();
  const resultado = await upsertEmLote(linhasSemMudanca, {
    tabela: "propostas_itens",
    colunas: COLUNAS,
    colunasPk: ["codemp", "codpro", "seqite"],
    carimbo: inicio,
    tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
  });

  for (const { row, data, ehNovo, alteracoes } of linhasComMudanca) {
    const upsert = prisma.propostaItem.upsert({
      where: { codemp_codpro_seqite: { codemp: row.codemp, codpro: row.codpro, seqite: row.seqite } },
      update: data,
      create: data,
    });

    const correlationId = randomUUID();
    const entidadeId = entidadeIdPropostaItem(row.codemp, row.codpro, row.seqite);
    const entidadeRotulo = `Item ${row.seqite} — Proposta ${row.codemp}/${row.codpro}`;
    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      upsert,
      criarEventoAuditoria({
        origem: "integracao_senior",
        entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA_ITEM,
        entidadeId,
        entidadeRotulo,
        codemp: row.codemp,
        codpro: row.codpro,
        eventoTipo: ehNovo ? EVENTOS_AUDITORIA.PROPOSTA_ITEM_CRIADO : EVENTOS_AUDITORIA.PROPOSTA_ITEM_ALTERADO,
        alteracoes: ehNovo ? null : alteracoes,
        metadata: null,
        correlationId,
      }),
    ];

    await prisma.$transaction(operacoes);
  }
  const msEscrita = Date.now() - inicioEscrita;

  return { msFetch, msEscrita, lotes: resultado.lotes };
}

export async function runPropostaItemSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetchSoap = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codpro", "seqite"])) as PropostaItemRow[];
    const msFetchSoap = Date.now() - inicioFetchSoap;
    const { msFetch, msEscrita, lotes } = await processarLinhasPropostaItem(rows, inicio);

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva. Só aqui (não em
    // runPropostaItemSyncPorCodpro, que varre 1 proposta só).
    const varredura = await executarVarreduraDoJob<Prisma.PropostaItemWhereInput>(prisma.propostaItem, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: rows.length,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${rows.length} linhas em ${((msFetchSoap + msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${((msFetchSoap + msFetch) / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${lotes} lote(s))` +
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

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function schedulePropostaItemSync(): void {
  cron.schedule(CRON_EXPR, runPropostaItemSync);
}

// Sincroniza só os itens desta proposta — par de runPropostaSyncPorCodpro, mesmo uso (ação
// manual "Sync. ERP" da lista de Alocação) e mesma propagação de erro pro chamador. Sem
// "desvincular": diferente de RatItem (numrat/seqrat é uma identidade separada da PK),
// PropostaItem já É a chave natural (codemp+codpro+seqite) — não tem o que desvincular, só
// atualizar. Devolve quantos itens vieram do Senior.
export async function runPropostaItemSyncPorCodpro(codemp: number, codpro: number): Promise<number> {
  const query = `${QUERY} WHERE USU_CodEmp = ${codemp} AND USU_CodPro = ${codpro}`;
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codpro", "seqite"])) as PropostaItemRow[];
  await processarLinhasPropostaItem(rows);
  await prisma.syncLog.create({ data: { jobName: JOB_NAME, query, status: "success" } });
  return rows.length;
}
