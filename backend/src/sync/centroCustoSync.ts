import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "centros_custo-sync";
const QUERY = `SELECT codemp AS codemp, codccu AS codccu, desccu AS desccu, abrccu AS abrccu, tipccu AS tipccu, ccupai AS ccupai, anasin AS anasin FROM e044ccu`;

interface CentroCustoRow {
  codemp: number;
  codccu: string;
  desccu: string;
  abrccu: string;
  tipccu: number;
  ccupai?: string;
  anasin?: string;
}

export async function runCentroCustoSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codccu"])) as CentroCustoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codccu: row.codccu, desccu: row.desccu, abrccu: row.abrccu, tipccu: row.tipccu, ccupai: row.ccupai, anasin: row.anasin };
      await prisma.centroCusto.upsert({
        where: { codemp_codccu: { codemp: row.codemp, codccu: row.codccu } },
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
export function scheduleCentroCustoSync(): void {
  cron.schedule("0 4 * * *", runCentroCustoSync);
}
