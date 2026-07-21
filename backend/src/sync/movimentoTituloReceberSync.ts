import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "movimentos_receber-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, seqmov AS seqmov, codtns AS codtns, datmov AS datmov, datpgt AS datpgt, codfpg AS codfpg, vlrmov AS vlrmov, vlrliq AS vlrliq, vlrjrs AS vlrjrs, vlrmul AS vlrmul, vlrdsc AS vlrdsc, diaatr AS diaatr, codpor AS codpor, codcrt AS codcrt, codccu AS codccu, numcco AS numcco FROM e301mcr`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface MovimentoTituloReceberRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  seqmov: number;
  codtns: string;
  datmov: string;
  datpgt?: string;
  codfpg?: number;
  vlrmov: number;
  vlrliq?: number;
  vlrjrs?: number;
  vlrmul?: number;
  vlrdsc?: number;
  diaatr?: number;
  codpor?: string;
  codcrt?: string;
  codccu?: string;
  numcco?: string;
}

export async function runMovimentoTituloReceberSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "seqmov",
    ])) as MovimentoTituloReceberRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt, seqmov: row.seqmov, codtns: row.codtns, datmov: new Date(row.datmov), datpgt: row.datpgt != null ? new Date(row.datpgt) : null, codfpg: row.codfpg, vlrmov: row.vlrmov, vlrliq: row.vlrliq, vlrjrs: row.vlrjrs, vlrmul: row.vlrmul, vlrdsc: row.vlrdsc, diaatr: row.diaatr, codpor: row.codpor, codcrt: row.codcrt, codccu: row.codccu, numcco: row.numcco };
      await prisma.movimentoTituloReceber.upsert({
        where: { codemp_codfil_numtit_codtpt_seqmov: { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt, seqmov: row.seqmov } },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleMovimentoTituloReceberSync(): void {
  cron.schedule(CRON_EXPR, () => runMovimentoTituloReceberSync());
}
