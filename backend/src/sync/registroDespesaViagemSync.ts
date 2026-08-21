import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

export const JOB_NAME = "registros_despesa_viagem-sync";
export const CRON_EXPR = "20 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela — só sincroniza no modo
// completo (mesma lógica conservadora do DatPal em empresaSync.ts).
export const CAMPO_DATA: string | null = null;
const BASE_QUERY = `SELECT USU_CODEMP AS codemp, USU_NUMRAT AS numrat, USU_SEQRDV AS seqrdv, USU_DATEMI AS datemi, USU_DESRDV AS desrdv, USU_TIPDES AS tipdes, USU_MODDES AS moddes, USU_QTDRDV AS qtdrdv, USU_VLRUNT AS vlrunt, USU_VLRTOT AS vlrtot, USU_FATRDV AS fatrdv, USU_REERDV AS reerdv, USU_ROTID AS rotid, USU_HORDES AS hordes, USU_NIDPSO AS nidpso FROM USU_TE777RDV`;

interface RegistroDespesaViagemRow {
  codemp: number;
  numrat: number;
  seqrdv: number;
  datemi?: string;
  desrdv?: string;
  tipdes?: number;
  moddes?: string;
  qtdrdv?: number;
  vlrunt?: number;
  vlrtot?: number;
  fatrdv?: string;
  reerdv?: string;
  rotid?: number;
  hordes?: number;
  nidpso?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (RegistroDespesaViagem): vlrunt/vlrtot Decimal(9,2). Sem carimbo — esta
// tabela não tem vistoEmSync/removidoEmSenior. `id` (autoincrement) e `origemCaxHub`/
// `enviadoEmSenior` (nunca tocados por este sync, nem no upsert antigo — origemCaxHub
// protege despesa lançada pelo consultor no CaxHub) ficam de fora de propósito: uma
// coluna ausente do lote não é tocada pelo DO UPDATE e, no INSERT, recebe o DEFAULT do
// schema — mesmo comportamento que o upsert linha-a-linha já tinha.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "numrat", cast: "int" },
  { nome: "seqrdv", cast: "int" },
  { nome: "datemi", cast: "date" },
  { nome: "desrdv", cast: "text" },
  { nome: "tipdes", cast: "int" },
  { nome: "moddes", cast: "text" },
  { nome: "qtdrdv", cast: "int" },
  { nome: "vlrunt", cast: "numeric" },
  { nome: "vlrtot", cast: "numeric" },
  { nome: "fatrdv", cast: "text" },
  { nome: "reerdv", cast: "text" },
  { nome: "rotid", cast: "int" },
  { nome: "hordes", cast: "int" },
  { nome: "nidpso", cast: "int" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma.
function linhaDe(row: RegistroDespesaViagemRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numrat}-${row.seqrdv}`,
    valores: [
      String(row.codemp),
      String(row.numrat),
      String(row.seqrdv),
      row.datemi ? String(row.datemi).slice(0, 10) : null,
      row.desrdv != null ? row.desrdv : null,
      row.tipdes != null ? String(row.tipdes) : null,
      row.moddes != null ? row.moddes : null,
      row.qtdrdv != null ? String(row.qtdrdv) : null,
      row.vlrunt != null ? row.vlrunt.toFixed(2) : null,
      row.vlrtot != null ? row.vlrtot.toFixed(2) : null,
      row.fatrdv != null ? row.fatrdv : null,
      row.reerdv != null ? row.reerdv : null,
      row.rotid != null ? String(row.rotid) : null,
      row.hordes != null ? String(row.hordes) : null,
      row.nidpso != null ? String(row.nidpso) : null,
    ],
  };
}

// Despesa de viagem lançada numa RAT — 15.034 linhas em 13/08/2026 (paginado por segurança,
// mesmo abaixo do limite de ~30 mil onde o Senior costuma truncar a resposta).
export async function runRegistroDespesaViagemSync(): Promise<void> {
  const inicio = new Date();
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(BASE_QUERY, ["codemp", "numrat", "seqrdv"])) as RegistroDespesaViagemRow[];
    const msFetch = Date.now() - inicioFetch;

    // Casa pela chave natural DO SENIOR (@@unique), não pela PK local `id` — mesma lógica
    // de ratItemSync. Despesa criada no CaxHub tem seqrdv nulo, então nunca entra neste
    // upsert: é isso que a impede de ser sobrescrita por uma despesa do ERP que tenha
    // calhado de receber o mesmo número.
    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "registros_despesa_viagem",
      colunas: COLUNAS,
      colunasPk: ["codemp", "numrat", "seqrdv"],
    });
    const msEscrita = Date.now() - inicioEscrita;

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: BASE_QUERY,
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
      data: { jobName: JOB_NAME, query: BASE_QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Despesa de viagem muda pouco depois de lançada — roda 1x por dia às 5h20.
export function scheduleRegistroDespesaViagemSync(): void {
  cron.schedule(CRON_EXPR, runRegistroDespesaViagemSync);
}
