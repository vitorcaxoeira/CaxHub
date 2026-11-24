import cron from "node-cron";
import { prisma } from "../db/prisma";
import type { ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { dataOuNula, executarSyncContrato, inteiroOuNulo, numeroOuNulo, textoOuNulo } from "./contratoCompraComum";

export const JOB_NAME = "contratos-compra-sync";
export const CRON_EXPR = "10 5 * * *";
// Sem corte por data: ~280 contratos, sempre completo.
export const CAMPO_DATA: string | null = null;
// E460CTR (Compras - Contratos - Dados Gerais), só o essencial pro custo do consultor PJ: identificação, fornecedor (= consultores.codfor), situação,
// vigência e reajuste. Ficaram de fora as ~85 colunas de geração de título, juros/multa, NF, aprovação e fluxo de caixa.
export const QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumCtr AS numctr, TipCtr AS tipctr, NumOfi AS numofi, ObjCtr AS objctr, CodFor AS codfor, DatEmi AS datemi, SitCtr AS sitctr, CodMot AS codmot, IniVig AS inivig, FimVig AS fimvig, UltRea AS ultrea, PrdRea AS prdrea, PerRea AS perrea, IniRea AS inirea, DatCan AS datcan, USU_CliFat AS clifat FROM e460ctr`;

interface ContratoCompraRow {
  codemp: number;
  codfil: number;
  numctr: number;
  tipctr: number;
  numofi?: string | null;
  objctr?: string | null;
  codfor: number;
  datemi?: string | null;
  sitctr: string;
  codmot?: number | null;
  inivig?: string | null;
  fimvig?: string | null;
  ultrea?: string | null;
  prdrea?: number | null;
  perrea?: number | null;
  inirea?: string | null;
  datcan?: string | null;
  clifat?: number | null;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "tipctr", cast: "int" },
  { nome: "numofi", cast: "text" },
  { nome: "objctr", cast: "text" },
  { nome: "codfor", cast: "int" },
  { nome: "datemi", cast: "date" },
  { nome: "sitctr", cast: "text" },
  { nome: "codmot", cast: "int" },
  { nome: "inivig", cast: "date" },
  { nome: "fimvig", cast: "date" },
  { nome: "ultrea", cast: "date" },
  { nome: "prdrea", cast: "int" },
  { nome: "perrea", cast: "numeric" },
  { nome: "inirea", cast: "date" },
  { nome: "datcan", cast: "date" },
  { nome: "clifat", cast: "int" },
];

export function linhaDe(row: ContratoCompraRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numctr}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numctr),
      String(row.tipctr),
      textoOuNulo(row.numofi),
      textoOuNulo(row.objctr),
      String(row.codfor),
      dataOuNula(row.datemi),
      row.sitctr,
      inteiroOuNulo(row.codmot),
      dataOuNula(row.inivig),
      dataOuNula(row.fimvig),
      dataOuNula(row.ultrea),
      inteiroOuNulo(row.prdrea),
      numeroOuNulo(row.perrea),
      dataOuNula(row.inirea),
      dataOuNula(row.datcan),
      inteiroOuNulo(row.clifat),
    ],
  };
}

export function runContratoCompraSync(): Promise<void> {
  return executarSyncContrato<ContratoCompraRow>({
    jobName: JOB_NAME,
    query: QUERY,
    chavePaginacao: ["codemp", "codfil", "numctr"],
    tabela: "contratos_compra",
    colunas: COLUNAS,
    colunasPk: ["codemp", "codfil", "numctr"],
    linhaDe,
    delegate: prisma.contratoCompra,
  });
}

// Contrato muda pouco — 1x por dia às 5h10 (depois de projetos 5h05).
export function scheduleContratoCompraSync(): void {
  cron.schedule(CRON_EXPR, runContratoCompraSync);
}
