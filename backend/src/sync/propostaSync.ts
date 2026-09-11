import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { diffCampos, criarEventoAuditoria, paraDiff } from "../audit/registrarEvento";
import { CAMPOS_AUDITADOS_PROPOSTA } from "../audit/camposAuditados";
import { EVENTOS_AUDITORIA, ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdProposta } from "../audit/identidadeEntidade";
import { sitproLabel } from "../domain/propostasDominio";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "propostas-sync";
export const CRON_EXPR = "0 4 * * *";
// USU_TE077PRO só tem datas de marco de negócio (DatPro/DatEnv/DatRet/DatVal), sem
// campo de geração/alteração do registro em si — e a proposta muda de situação com
// frequência sem nenhuma dessas datas ser atualizada.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT USU_CodEmp AS codemp, USU_CodPro AS codpro, USU_CodCli AS codcli, USU_QtdHor AS qtdhor, USU_DatPro AS datpro, USU_UsuGer AS usuger, USU_ForAte AS forate, USU_SitPro AS sitpro, USU_HorPro AS horpro, USU_TipPro AS tippro, USU_DesSol AS dessol, USU_ConSol AS consol, USU_PraRea AS prarea, USU_DatEnv AS datenv, USU_DatRet AS datret, USU_NumPrj AS numprj, USU_DatVal AS datval, USU_CodFpj AS codfpj, USU_SisPro AS sispro, USU_DesPro AS despro, usu_Numero AS numero, USU_ObrFas AS obrfas, USU_Executor AS executor, USU_ObsSit AS obssit, USU_LiqBru AS liqbru, USU_CodCcu AS codccu, USU_CtaFin AS ctafin, USU_ClaPro AS clapro, USU_AreExe AS areexe, USU_IdCom AS idcom, USU_CodRep AS codrep, USU_ForFat AS forfat, USU_DscFpg AS dscfpg, USU_HisPro AS hispro, USU_ObsPro AS obspro, USU_PreEnt AS preent, USU_PriPro AS pripro, USU_StaPro AS stapro, USU_TipVen AS tipven, USU_OrdemCns AS ordemcns, USU_SitMot AS sitmot, USU_TipPrj AS tipprj, USU_FrmPrj AS frmprj, USU_CodLev2 AS codlev2, USU_CliFat AS clifat, USU_ExiPedCli AS exipedcli, USU_PedCli AS pedcli, USU_ForFatRdv AS forfatrdv, USU_ModPro AS modpro, USU_ForFatLev AS forfatlev, USU_NumPed AS numped, USU_IdBpm AS idbpm, USU_DepExe AS depexe, USU_FatHrsDes AS fathrsdes FROM USU_TE077PRO`;

export interface PropostaRow {
  codemp: number;
  codpro: number;
  codcli: number;
  qtdhor?: number;
  datpro?: string;
  usuger?: number;
  forate?: string;
  sitpro?: number;
  horpro?: number;
  tippro?: number;
  dessol?: string;
  consol?: string;
  prarea?: string;
  datenv?: string;
  datret?: string;
  numprj: number;
  datval?: string;
  codfpj: number;
  sispro?: number;
  despro?: string;
  numero?: number;
  obrfas?: string;
  executor?: number;
  obssit?: string;
  liqbru?: string;
  codccu?: string;
  ctafin?: number;
  clapro?: number;
  areexe?: number;
  idcom: number;
  codrep: number;
  forfat?: number;
  dscfpg?: string;
  hispro?: string;
  obspro?: string;
  preent?: string;
  pripro?: number;
  stapro?: number;
  tipven?: number;
  ordemcns?: number;
  sitmot?: number;
  tipprj?: number;
  frmprj?: number;
  codlev2?: number;
  clifat?: number;
  exipedcli?: string;
  pedcli?: string;
  forfatrdv?: number;
  modpro?: number;
  forfatlev?: number;
  numped: number;
  idbpm?: number;
  depexe?: number;
  fathrsdes?: string;
}

// Objeto tipado (datas como Date, numero como BigInt) usado só pro diff de auditoria — mesma
// forma que `prisma.proposta.upsert` recebia antes da conversão pra lote. Casts de data
// String(...).slice(0,10) (nunca `new Date(v)`) só existem na versão STRING pro upsertEmLote
// (ver linhaDe), não aqui: o diff compara contra o valor já tipado que o Prisma devolve.
function dataTipada(row: PropostaRow, inicio: Date) {
  return {
    codemp: row.codemp, codpro: row.codpro, codcli: row.codcli, qtdhor: row.qtdhor,
    datpro: row.datpro != null ? new Date(row.datpro) : null, usuger: row.usuger, forate: row.forate,
    sitpro: row.sitpro, horpro: row.horpro, tippro: row.tippro, dessol: row.dessol, consol: row.consol,
    prarea: row.prarea, datenv: row.datenv != null ? new Date(row.datenv) : null,
    datret: row.datret != null ? new Date(row.datret) : null, numprj: row.numprj,
    datval: row.datval != null ? new Date(row.datval) : null, codfpj: row.codfpj, sispro: row.sispro,
    despro: row.despro, numero: row.numero != null ? BigInt(row.numero) : null, obrfas: row.obrfas,
    executor: row.executor, obssit: row.obssit, liqbru: row.liqbru, codccu: row.codccu, ctafin: row.ctafin,
    clapro: row.clapro, areexe: row.areexe, idcom: row.idcom, codrep: row.codrep, forfat: row.forfat,
    dscfpg: row.dscfpg, hispro: row.hispro, obspro: row.obspro,
    preent: row.preent != null ? new Date(row.preent) : null, pripro: row.pripro, stapro: row.stapro,
    tipven: row.tipven, ordemcns: row.ordemcns, sitmot: row.sitmot, tipprj: row.tipprj, frmprj: row.frmprj,
    codlev2: row.codlev2, clifat: row.clifat, exipedcli: row.exipedcli, pedcli: row.pedcli,
    forfatrdv: row.forfatrdv, modpro: row.modpro, forfatlev: row.forfatlev, numped: row.numped,
    idbpm: row.idbpm, depexe: row.depexe, fathrsdes: row.fathrsdes,
    vistoEmSync: inicio, removidoEmSenior: null as Date | null,
  };
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" }, { nome: "codpro", cast: "int" }, { nome: "codcli", cast: "int" },
  { nome: "qtdhor", cast: "int" }, { nome: "datpro", cast: "date" }, { nome: "usuger", cast: "int" },
  { nome: "forate", cast: "text" }, { nome: "sitpro", cast: "int" }, { nome: "horpro", cast: "int" },
  { nome: "tippro", cast: "int" }, { nome: "dessol", cast: "text" }, { nome: "consol", cast: "text" },
  { nome: "prarea", cast: "text" }, { nome: "datenv", cast: "date" }, { nome: "datret", cast: "date" },
  { nome: "numprj", cast: "int" }, { nome: "datval", cast: "date" }, { nome: "codfpj", cast: "int" },
  { nome: "sispro", cast: "int" }, { nome: "despro", cast: "text" }, { nome: "numero", cast: "bigint" },
  { nome: "obrfas", cast: "text" }, { nome: "executor", cast: "int" }, { nome: "obssit", cast: "text" },
  { nome: "liqbru", cast: "text" }, { nome: "codccu", cast: "text" }, { nome: "ctafin", cast: "int" },
  { nome: "clapro", cast: "int" }, { nome: "areexe", cast: "int" }, { nome: "idcom", cast: "int" },
  { nome: "codrep", cast: "int" }, { nome: "forfat", cast: "int" }, { nome: "dscfpg", cast: "text" },
  { nome: "hispro", cast: "text" }, { nome: "obspro", cast: "text" }, { nome: "preent", cast: "date" },
  { nome: "pripro", cast: "int" }, { nome: "stapro", cast: "int" }, { nome: "tipven", cast: "int" },
  { nome: "ordemcns", cast: "int" }, { nome: "sitmot", cast: "int" }, { nome: "tipprj", cast: "int" },
  { nome: "frmprj", cast: "int" }, { nome: "codlev2", cast: "int" }, { nome: "clifat", cast: "int" },
  { nome: "exipedcli", cast: "text" }, { nome: "pedcli", cast: "text" }, { nome: "forfatrdv", cast: "int" },
  { nome: "modpro", cast: "int" }, { nome: "forfatlev", cast: "int" }, { nome: "numped", cast: "int" },
  { nome: "idbpm", cast: "int" }, { nome: "depexe", cast: "int" }, { nome: "fathrsdes", cast: "text" },
];

function n(v: number | undefined | null): string | null {
  return v != null ? String(v) : null;
}
function t(v: string | undefined | null): string | null {
  return v != null ? v : null;
}
function d(v: string | undefined | null): string | null {
  // `String(...).slice(0,10)` pra data, nunca `new Date(v)` — mesmo cuidado de
  // rateioLancamentoSync.ts.
  return v != null ? String(v).slice(0, 10) : null;
}

function linhaDe(row: PropostaRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codpro}`,
    valores: [
      String(row.codemp), String(row.codpro), String(row.codcli), n(row.qtdhor), d(row.datpro), n(row.usuger),
      t(row.forate), n(row.sitpro), n(row.horpro), n(row.tippro), t(row.dessol), t(row.consol), t(row.prarea),
      d(row.datenv), d(row.datret), String(row.numprj), d(row.datval), String(row.codfpj), n(row.sispro),
      t(row.despro), row.numero != null ? String(row.numero) : null, t(row.obrfas), n(row.executor), t(row.obssit),
      t(row.liqbru), t(row.codccu), n(row.ctafin), n(row.clapro), n(row.areexe), String(row.idcom), String(row.codrep),
      n(row.forfat), t(row.dscfpg), t(row.hispro), t(row.obspro), d(row.preent), n(row.pripro), n(row.stapro),
      n(row.tipven), n(row.ordemcns), n(row.sitmot), n(row.tipprj), n(row.frmprj), n(row.codlev2), n(row.clifat),
      t(row.exipedcli), t(row.pedcli), n(row.forfatrdv), n(row.modpro), n(row.forfatlev), String(row.numped),
      n(row.idbpm), n(row.depexe), t(row.fathrsdes),
    ],
  };
}

// Corpo do processamento extraído à parte de runPropostaSync() para poder ser exercitado
// com linhas sintéticas (ver backend/prisma/verificarAceiteAuditoria.ts) sem depender do
// webservice SOAP real — mesma lógica, sem mudança de comportamento. `inicio` tem default
// pra não quebrar chamadas existentes que não passam (o script de verificação, e
// runPropostaSyncPorCodpro abaixo, que roda fora do fluxo de varredura) — nesses casos o
// carimbo só documenta quando a linha foi vista, sem afetar nada além dela mesma.
//
// HÍBRIDO (11/09/2026, porte do upsert em lote do CaxHub_Atlas): diferente dos jobs de
// espelho puro, esta tabela gera evento de auditoria por linha ALTERADA (ver
// audit/registrarEvento.ts) — não dá pra virar 100% lote sem perder a atomicidade
// upsert+evento (um crash entre o lote e os eventos deixaria proposta gravada sem o evento
// correspondente). Por isso: pré-busca os existentes de UMA vez (elimina o N+1 de
// `findUnique` por linha, mesmo achado de rat-item-sync), calcula o diff em memória, e separa
// em dois caminhos — linhas SEM mudança de campo auditado vão pro upsertEmLote (é a maioria
// numa sync incremental, "caminho quente" já documentado abaixo); linhas NOVAS ou com
// alteração continuam upsert+evento na MESMA transação, exatamente como antes, preservando a
// garantia de atomicidade só onde ela importa.
export async function processarLinhasProposta(rows: PropostaRow[], inicio: Date = new Date()): Promise<{ msFetch: number; msEscrita: number; lotes: number }> {
  if (rows.length === 0) return { msFetch: 0, msEscrita: 0, lotes: 0 };

  const inicioFetch = Date.now();
  const existentes = await prisma.proposta.findMany({
    where: { OR: rows.map((r) => ({ codemp: r.codemp, codpro: r.codpro })) },
  });
  const msFetch = Date.now() - inicioFetch;
  const existentePorChave = new Map(existentes.map((e) => [`${e.codemp}-${e.codpro}`, e]));

  const linhasSemMudanca: LinhaUpsert[] = [];
  const linhasComMudanca: { row: PropostaRow; data: ReturnType<typeof dataTipada>; ehNova: boolean; alteracoes: ReturnType<typeof diffCampos>["alteracoes"] }[] = [];

  for (const row of rows) {
    const existente = existentePorChave.get(`${row.codemp}-${row.codpro}`) ?? null;
    const data = dataTipada(row, inicio);
    const ehNova = existente === null;
    const { alteracoes, algumaMudanca } = diffCampos(CAMPOS_AUDITADOS_PROPOSTA, existente, paraDiff(data));

    if (!ehNova && !algumaMudanca) {
      linhasSemMudanca.push(linhaDe(row));
    } else {
      linhasComMudanca.push({ row, data, ehNova, alteracoes });
    }
  }

  const inicioEscrita = Date.now();
  const resultado = await upsertEmLote(linhasSemMudanca, {
    tabela: "propostas",
    colunas: COLUNAS,
    colunasPk: ["codemp", "codpro"],
    carimbo: inicio,
    tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
  });

  for (const { row, data, ehNova, alteracoes } of linhasComMudanca) {
    const upsert = prisma.proposta.upsert({
      where: { codemp_codpro: { codemp: row.codemp, codpro: row.codpro } },
      update: data,
      create: data,
    });

    const correlationId = randomUUID(); // um UUID por linha alterada, não por execução da sync
    const entidadeId = entidadeIdProposta(row.codemp, row.codpro);
    const entidadeRotulo = `Proposta ${row.codemp}/${row.codpro}`;
    const operacoes: Prisma.PrismaPromise<unknown>[] = [upsert];

    if (ehNova) {
      operacoes.push(
        criarEventoAuditoria({
          origem: "integracao_senior",
          entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
          entidadeId,
          entidadeRotulo,
          codemp: row.codemp,
          codpro: row.codpro,
          eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_CRIADA,
          alteracoes: null,
          metadata: null,
          correlationId,
        })
      );
    } else {
      const { sitpro, ...outrasAlteracoes } = alteracoes;
      if (sitpro) {
        operacoes.push(
          criarEventoAuditoria({
            origem: "integracao_senior",
            entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
            entidadeId,
            entidadeRotulo,
            codemp: row.codemp,
            codpro: row.codpro,
            eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_STATUS_ALTERADO,
            alteracoes: { sitpro },
            metadata: {
              status_de: sitproLabel(sitpro.de as number | null),
              status_para: sitproLabel(sitpro.para as number | null),
            },
            correlationId,
          })
        );
      }
      if (Object.keys(outrasAlteracoes).length > 0) {
        operacoes.push(
          criarEventoAuditoria({
            origem: "integracao_senior",
            entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
            entidadeId,
            entidadeRotulo,
            codemp: row.codemp,
            codpro: row.codpro,
            eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_ALTERADA,
            alteracoes: outrasAlteracoes,
            metadata: null,
            correlationId,
          })
        );
      }
    }

    await prisma.$transaction(operacoes);
  }
  const msEscrita = Date.now() - inicioEscrita;

  return { msFetch, msEscrita, lotes: resultado.lotes };
}

export async function runPropostaSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetchSoap = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codpro"])) as PropostaRow[];
    const msFetchSoap = Date.now() - inicioFetchSoap;
    const { msFetch, msEscrita, lotes } = await processarLinhasProposta(rows, inicio);

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva. Só aqui (não em runPropostaSyncPorCodpro, que
    // varre 1 proposta só — rodar a varredura ali marcaria a tabela inteira como suspeita).
    const varredura = await executarVarreduraDoJob<Prisma.PropostaWhereInput>(prisma.proposta, {
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
export function schedulePropostaSync(): void {
  cron.schedule(CRON_EXPR, runPropostaSync);
}

// Sincroniza só esta proposta — usado pela ação manual "Sync. ERP" na lista de Alocação
// (ver POST /alocacao/propostas/:codemp/:codpro/sincronizar). Diferente de runPropostaSync
// (job agendado, engole erro e só loga em SyncLog), propaga erro pro chamador: é uma ação
// síncrona disparada por clique, a rota HTTP precisa saber se falhou pra avisar o usuário.
// `codemp`/`codpro` vêm da própria Proposta já gravada localmente (nunca input direto do
// usuário), interpolados como number — mesmo padrão de runRatSyncPorNumrat.
//
// Devolve se a proposta ainda existe no Senior (rows.length > 0) — o chamador decide o que
// fazer (hoje, só avisa; não desvincula/apaga nada, mesmo espírito conservador do resto da
// base).
export async function runPropostaSyncPorCodpro(codemp: number, codpro: number): Promise<boolean> {
  const query = `${QUERY} WHERE USU_CodEmp = ${codemp} AND USU_CodPro = ${codpro}`;
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codpro"])) as PropostaRow[];
  await processarLinhasProposta(rows);
  await prisma.syncLog.create({ data: { jobName: JOB_NAME, query, status: "success" } });
  return rows.length > 0;
}
