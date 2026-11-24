import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { fotografarCarteiraSemFalhar } from "../domain/metasComercial/carteira";

export const JOB_NAME = "contratos_venda_reajustes-sync";
export const CRON_EXPR = "30 6 * * *";
// Histórico de reajustes e de upgrades (USU_VlrUpg) dos itens de contrato: base da reconstrução da carteira de mensalidades dos meses
// anteriores à primeira foto (domain/metasComercial/carteira.ts). Sem DatAlt; ~17 mil linhas: sempre completa.
export const CAMPO_DATA: string | null = null;
export const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumCtr AS numctr, DatCpt AS datcpt, SeqCvs AS seqcvs, SeqCvp AS seqcvp, UltRea AS ultrea, VlrRea AS vlrrea, VlrAtu AS vlratu, PerRea AS perrea, TipRea AS tiprea, USU_VlrUpg AS usu_vlrupg FROM E160REA`;

function montarQuery(desde?: Date): string {
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  return montarQuerySenior(BASE_QUERY, [...filtro.predicadosSql]);
}

interface ContratoVendaReajusteRow {
  codemp: number;
  codfil: number;
  numctr: number;
  datcpt: string;
  seqcvs: number;
  seqcvp: number;
  ultrea: string;
  vlrrea?: number;
  vlratu?: number;
  perrea?: number;
  tiprea?: string;
  usu_vlrupg?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "datcpt", cast: "date" },
  { nome: "seqcvs", cast: "int" },
  { nome: "seqcvp", cast: "int" },
  { nome: "ultrea", cast: "date" },
  { nome: "vlrrea", cast: "numeric" },
  { nome: "vlratu", cast: "numeric" },
  { nome: "perrea", cast: "numeric" },
  { nome: "tiprea", cast: "text" },
  { nome: "usu_vlrupg", cast: "numeric" },
];

function linhaDe(row: ContratoVendaReajusteRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numctr}-${row.datcpt}-${row.seqcvs}-${row.seqcvp}-${row.ultrea}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numctr),
      String(row.datcpt).slice(0, 10),
      String(row.seqcvs),
      String(row.seqcvp),
      String(row.ultrea).slice(0, 10),
      row.vlrrea != null ? row.vlrrea.toFixed(5) : null,
      row.vlratu != null ? row.vlratu.toFixed(5) : null,
      row.perrea != null ? row.perrea.toFixed(4) : null,
      row.tiprea != null ? row.tiprea : null,
      row.usu_vlrupg != null ? row.usu_vlrupg.toFixed(5) : null,
    ],
  };
}

export async function runContratoVendaReajusteSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "numctr", "datcpt", "seqcvs", "seqcvp", "ultrea"])) as ContratoVendaReajusteRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "contratos_venda_reajustes",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numctr", "datcpt", "seqcvs", "seqcvp", "ultrea"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — já ligada: toda tabela
    // espelho do Senior nasce com o controle completo (schema + carimbo + varredura +
    // registry), nunca só o schema — convenção do projeto desde 10/09/2026 (ver
    // sempre-criar-controle-de-removidos-tabela-senior no segundo cérebro). A tabela só
    // COMEÇA em "desligada" (default do model ConfiguracaoVarredura, sem linha salva) — não
    // marca nada sozinha até alguém promover pela tela (Administração > Sincronização ERP).
    //
    // Se esta tabela for de MÃO DUPLA (o CaxHub também escreve nela, não só lê do Senior):
    // trocar esta chamada por `varrerRemovidos()` direto (não este wrapper) com um escopo
    // que exclua o registro nascido localmente e ainda não confirmado lá (ex.:
    // `{ origemCaxHub: false }`) — ver atividadeConsultorSync.ts/ratSync.ts pro padrão.
    const varredura = await executarVarreduraDoJob<Prisma.ContratoVendaReajusteWhereInput>(prisma.contratoVendaReajuste, {
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
    // Gestão de Metas do Comercial: reajustes mudam a carteira reconstruída dos meses passados; refaz foto e reconstrução.
    await fotografarCarteiraSemFalhar(JOB_NAME);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// 6h30: depois dos contratos (6h20) e dos itens (6h25).
export function scheduleContratoVendaReajusteSync(): void {
  cron.schedule(CRON_EXPR, () => runContratoVendaReajusteSync());
}
