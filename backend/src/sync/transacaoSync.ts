import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "transacoes-sync";
const QUERY = `SELECT codemp AS codemp, codtns AS codtns, destns AS destns, rectpb AS rectpb FROM e001tns`;

interface TransacaoRow {
  codemp: number;
  codtns: string;
  destns: string;
  rectpb?: string;
}

export async function runTransacaoSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codtns"])) as TransacaoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codtns: row.codtns, destns: row.destns, rectpb: row.rectpb };
      await prisma.transacao.upsert({
        where: { codemp_codtns: { codemp: row.codemp, codtns: row.codtns } },
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
export function scheduleTransacaoSync(): void {
  cron.schedule("0 4 * * *", runTransacaoSync);
}
