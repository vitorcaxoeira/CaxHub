import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "transacoes-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
const BASE_QUERY = `SELECT codemp AS codemp, codtns AS codtns, destns AS destns, rectpb AS rectpb FROM e001tns`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface TransacaoRow {
  codemp: number;
  codtns: string;
  destns: string;
  rectpb?: string;
}

export async function runTransacaoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codtns"])) as TransacaoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codtns: row.codtns, destns: row.destns, rectpb: row.rectpb };
      await prisma.transacao.upsert({
        where: { codemp_codtns: { codemp: row.codemp, codtns: row.codtns } },
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
export function scheduleTransacaoSync(): void {
  cron.schedule(CRON_EXPR, () => runTransacaoSync());
}
