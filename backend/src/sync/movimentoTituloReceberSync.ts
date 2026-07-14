import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "movimentos_receber-sync";
const QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, seqmov AS seqmov, codtns AS codtns, datmov AS datmov, datpgt AS datpgt, codfpg AS codfpg, vlrmov AS vlrmov, vlrliq AS vlrliq, vlrjrs AS vlrjrs, vlrmul AS vlrmul, vlrdsc AS vlrdsc, diaatr AS diaatr, codpor AS codpor, codcrt AS codcrt, codccu AS codccu FROM e301mcr`;

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
}

export async function runMovimentoTituloReceberSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoapPaginated(QUERY, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "seqmov",
    ])) as MovimentoTituloReceberRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt, seqmov: row.seqmov, codtns: row.codtns, datmov: new Date(row.datmov), datpgt: row.datpgt != null ? new Date(row.datpgt) : null, codfpg: row.codfpg, vlrmov: row.vlrmov, vlrliq: row.vlrliq, vlrjrs: row.vlrjrs, vlrmul: row.vlrmul, vlrdsc: row.vlrdsc, diaatr: row.diaatr, codpor: row.codpor, codcrt: row.codcrt, codccu: row.codccu };
      await prisma.movimentoTituloReceber.upsert({
        where: { codemp_codfil_numtit_codtpt_seqmov: { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt, seqmov: row.seqmov } },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function scheduleMovimentoTituloReceberSync(): void {
  cron.schedule("0 4 * * *", runMovimentoTituloReceberSync);
}
