import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "centros_custo-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatAlt";
const BASE_QUERY = `SELECT codemp AS codemp, codccu AS codccu, desccu AS desccu, abrccu AS abrccu, tipccu AS tipccu, ccupai AS ccupai, anasin AS anasin FROM e044ccu`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface CentroCustoRow {
  codemp: number;
  codccu: string;
  desccu: string;
  abrccu: string;
  tipccu: number;
  ccupai?: string;
  anasin?: string;
}

export async function runCentroCustoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codccu"])) as CentroCustoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codccu: row.codccu, desccu: row.desccu, abrccu: row.abrccu, tipccu: row.tipccu, ccupai: row.ccupai, anasin: row.anasin };
      await prisma.centroCusto.upsert({
        where: { codemp_codccu: { codemp: row.codemp, codccu: row.codccu } },
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
export function scheduleCentroCustoSync(): void {
  cron.schedule(CRON_EXPR, () => runCentroCustoSync());
}
