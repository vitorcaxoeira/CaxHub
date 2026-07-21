import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "tipos_titulo-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT codtpt AS codtpt, destpt AS destpt, abrtpt AS abrtpt, recsom AS recsom, pagsom AS pagsom, apltpt AS apltpt, sittpt AS sittpt FROM e002tpt`;

interface TipoTituloRow {
  codtpt: string;
  destpt: string;
  abrtpt: string;
  recsom: string;
  pagsom: string;
  apltpt?: string;
  sittpt?: string;
}

export async function runTipoTituloSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoap(QUERY)) as TipoTituloRow[];

    for (const row of rows) {
      const data = { codtpt: row.codtpt, destpt: row.destpt, abrtpt: row.abrtpt, recsom: row.recsom, pagsom: row.pagsom, apltpt: row.apltpt, sittpt: row.sittpt };
      await prisma.tipoTitulo.upsert({
        where: { codtpt: row.codtpt },
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
export function scheduleTipoTituloSync(): void {
  cron.schedule(CRON_EXPR, runTipoTituloSync);
}
