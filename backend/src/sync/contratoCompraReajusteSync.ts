import cron from "node-cron";
import { prisma } from "../db/prisma";
import type { ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { dataDaChave, dataOuNula, executarSyncContrato, numeroOuNulo, textoOuNulo } from "./contratoCompraComum";

export const JOB_NAME = "contratos-compra-reajustes-sync";
export const CRON_EXPR = "14 5 * * *";
// Sem corte por data: ~3.700 reajustes, sempre completo.
export const CAMPO_DATA: string | null = null;
// E460REA (Compras - Contratos - Históricos): um registro por reajuste do preço do item. `VlrAtu` = valor após o reajuste, `VlrRea` = quanto
// subiu. É o histórico do valor-hora do consultor PJ (domain/valorHoraConsultor.ts monta a linha do tempo).
export const QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumCtr AS numctr, DatCpt AS datcpt, SeqCcs AS seqccs, SeqCcp AS seqccp, UltRea AS ultrea, VlrRea AS vlrrea, VlrAtu AS vlratu, CodUsu AS codusu, DatRea AS datrea, PerRea AS perrea, ReaPre AS reapre, DesRea AS desrea FROM e460rea`;

interface ContratoCompraReajusteRow {
  codemp: number;
  codfil: number;
  numctr: number;
  datcpt: string;
  seqccs: number;
  seqccp: number;
  ultrea: string;
  vlrrea?: number | null;
  vlratu?: number | null;
  codusu: number;
  datrea?: string | null;
  perrea?: number | null;
  reapre?: number | null;
  desrea?: string | null;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "datcpt", cast: "date" },
  { nome: "seqccs", cast: "int" },
  { nome: "seqccp", cast: "int" },
  { nome: "ultrea", cast: "date" },
  { nome: "vlrrea", cast: "numeric" },
  { nome: "vlratu", cast: "numeric" },
  { nome: "codusu", cast: "int" },
  { nome: "datrea", cast: "date" },
  { nome: "perrea", cast: "numeric" },
  { nome: "reapre", cast: "numeric" },
  { nome: "desrea", cast: "text" },
];

export function linhaDe(row: ContratoCompraReajusteRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numctr}-${dataDaChave(row.datcpt)}-${row.seqccs}-${row.seqccp}-${dataDaChave(row.ultrea)}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numctr),
      dataDaChave(row.datcpt),
      String(row.seqccs),
      String(row.seqccp),
      dataDaChave(row.ultrea),
      numeroOuNulo(row.vlrrea),
      numeroOuNulo(row.vlratu),
      String(row.codusu),
      dataOuNula(row.datrea),
      numeroOuNulo(row.perrea),
      numeroOuNulo(row.reapre),
      textoOuNulo(row.desrea),
    ],
  };
}

export function runContratoCompraReajusteSync(): Promise<void> {
  return executarSyncContrato<ContratoCompraReajusteRow>({
    jobName: JOB_NAME,
    query: QUERY,
    chavePaginacao: ["codemp", "codfil", "numctr", "datcpt", "seqccs", "seqccp", "ultrea"],
    tabela: "contratos_compra_reajustes",
    colunas: COLUNAS,
    colunasPk: ["codemp", "codfil", "numctr", "datcpt", "seqccs", "seqccp", "ultrea"],
    linhaDe,
    delegate: prisma.contratoCompraReajuste,
  });
}

// Reajuste acontece no máximo 1x por ano por contrato — 1x por dia às 5h14.
export function scheduleContratoCompraReajusteSync(): void {
  cron.schedule(CRON_EXPR, runContratoCompraReajusteSync);
}
