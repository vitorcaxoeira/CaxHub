import cron from "node-cron";
import { prisma } from "../db/prisma";
import type { ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { dataDaChave, executarSyncContrato, inteiroOuNulo, numeroOuNulo, textoOuNulo } from "./contratoCompraComum";

export const JOB_NAME = "contratos-compra-servicos-sync";
export const CRON_EXPR = "12 5 * * *";
// Sem corte por data: ~2.100 itens, sempre completo.
export const CAMPO_DATA: string | null = null;
// E460CCS (Compras - Contratos - Itens de Serviço): o item do contrato do consultor, onde está o PREÇO UNITÁRIO (= valor-hora, `preuni`). Só o
// essencial: serviço, quantidade, preço, descontos, retenções (informativas), situação e a apropriação (projeto/CC/conta). Ficaram de fora a
// tributação detalhada, a ordem de compra/NF gerada e o câmbio.
export const QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumCtr AS numctr, DatCpt AS datcpt, SeqCcs AS seqccs, CodSer AS codser, CplCcs AS cplccs, QtdCtr AS qtdctr, QtdCcs AS qtdccs, UniMed AS unimed, PreUni AS preuni, USU_PreUni AS usupreuni, PerDsc AS perdsc, VlrDsc AS vlrdsc, PerIss AS periss, PerIrf AS perirf, PerIns AS perins, PerPit AS perpit, PerCsl AS percsl, PerCrt AS percrt, PerOur AS perour, SitCcs AS sitccs, CodMot AS codmot, NumPrj AS numprj, CodCcu AS codccu, CtaRed AS ctared FROM e460ccs`;

interface ContratoCompraServicoRow {
  codemp: number;
  codfil: number;
  numctr: number;
  datcpt: string;
  seqccs: number;
  codser?: string | null;
  cplccs?: string | null;
  qtdctr?: number | null;
  qtdccs: number;
  unimed?: string | null;
  preuni: number;
  usupreuni?: number | null;
  perdsc?: number | null;
  vlrdsc?: number | null;
  periss?: number | null;
  perirf?: number | null;
  perins?: number | null;
  perpit?: number | null;
  percsl?: number | null;
  percrt?: number | null;
  perour?: number | null;
  sitccs: string;
  codmot?: number | null;
  numprj?: number | null;
  codccu?: string | null;
  ctared?: number | null;
}

// "usupreuni" no SELECT (alias sem sublinhado, como o resto do projeto); na tabela a coluna é usu_preuni.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "datcpt", cast: "date" },
  { nome: "seqccs", cast: "int" },
  { nome: "codser", cast: "text" },
  { nome: "cplccs", cast: "text" },
  { nome: "qtdctr", cast: "numeric" },
  { nome: "qtdccs", cast: "numeric" },
  { nome: "unimed", cast: "text" },
  { nome: "preuni", cast: "numeric" },
  { nome: "usu_preuni", cast: "numeric" },
  { nome: "perdsc", cast: "numeric" },
  { nome: "vlrdsc", cast: "numeric" },
  { nome: "periss", cast: "numeric" },
  { nome: "perirf", cast: "numeric" },
  { nome: "perins", cast: "numeric" },
  { nome: "perpit", cast: "numeric" },
  { nome: "percsl", cast: "numeric" },
  { nome: "percrt", cast: "numeric" },
  { nome: "perour", cast: "numeric" },
  { nome: "sitccs", cast: "text" },
  { nome: "codmot", cast: "int" },
  { nome: "numprj", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "ctared", cast: "int" },
];

export function linhaDe(row: ContratoCompraServicoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numctr}-${dataDaChave(row.datcpt)}-${row.seqccs}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numctr),
      dataDaChave(row.datcpt),
      String(row.seqccs),
      textoOuNulo(row.codser),
      textoOuNulo(row.cplccs),
      numeroOuNulo(row.qtdctr),
      String(row.qtdccs),
      textoOuNulo(row.unimed),
      String(row.preuni),
      numeroOuNulo(row.usupreuni),
      numeroOuNulo(row.perdsc),
      numeroOuNulo(row.vlrdsc),
      numeroOuNulo(row.periss),
      numeroOuNulo(row.perirf),
      numeroOuNulo(row.perins),
      numeroOuNulo(row.perpit),
      numeroOuNulo(row.percsl),
      numeroOuNulo(row.percrt),
      numeroOuNulo(row.perour),
      row.sitccs,
      inteiroOuNulo(row.codmot),
      inteiroOuNulo(row.numprj),
      textoOuNulo(row.codccu),
      inteiroOuNulo(row.ctared),
    ],
  };
}

export function runContratoCompraServicoSync(): Promise<void> {
  return executarSyncContrato<ContratoCompraServicoRow>({
    jobName: JOB_NAME,
    query: QUERY,
    chavePaginacao: ["codemp", "codfil", "numctr", "datcpt", "seqccs"],
    tabela: "contratos_compra_servicos",
    colunas: COLUNAS,
    colunasPk: ["codemp", "codfil", "numctr", "datcpt", "seqccs"],
    linhaDe,
    delegate: prisma.contratoCompraServico,
  });
}

// Itens mudam só quando o contrato muda — 1x por dia às 5h12, logo depois do cabeçalho.
export function scheduleContratoCompraServicoSync(): void {
  cron.schedule(CRON_EXPR, runContratoCompraServicoSync);
}
