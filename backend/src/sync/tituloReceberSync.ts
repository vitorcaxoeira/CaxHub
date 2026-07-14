import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "titulos_receber-sync";
const QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, codcli AS codcli, sittit AS sittit, datemi AS datemi, vctori AS vctori, vctpro AS vctpro, vlrori AS vlrori, vlrabe AS vlrabe FROM e301tcr`;

interface TituloReceberRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codcli: number;
  sittit: string;
  datemi: string;
  vctori: string;
  vctpro: string;
  vlrori: number;
  vlrabe?: number;
}

export async function runTituloReceberSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoapPaginated(QUERY, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
    ])) as TituloReceberRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt, codcli: row.codcli, sittit: row.sittit, datemi: new Date(row.datemi), vctori: new Date(row.vctori), vctpro: new Date(row.vctpro), vlrori: row.vlrori, vlrabe: row.vlrabe };
      await prisma.tituloReceber.upsert({
        where: { codemp_codfil_numtit_codtpt: { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt } },
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
export function scheduleTituloReceberSync(): void {
  cron.schedule("0 4 * * *", runTituloReceberSync);
}
