import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "moedas-sync";
export const CRON_EXPR = "0 4 * * *";
// DatEmi/DatVct nessa tabela são "data de emissão/vencimento do título público" (usado
// pra taxas de conversão históricas), não uma data de geração/alteração do cadastro
// da moeda em si.
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT codmoe AS codmoe, desmoe AS desmoe, sigmoe AS sigmoe, tipmoe AS tipmoe FROM e031moe`;

interface MoedaRow {
  codmoe: string;
  desmoe: string;
  sigmoe: string;
  tipmoe: string;
}

export async function runMoedaSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codmoe"])) as MoedaRow[];

    for (const row of rows) {
      const data = { codmoe: row.codmoe, desmoe: row.desmoe, sigmoe: row.sigmoe, tipmoe: row.tipmoe };
      await prisma.moeda.upsert({
        where: { codmoe: row.codmoe },
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
export function scheduleMoedaSync(): void {
  cron.schedule(CRON_EXPR, runMoedaSync);
}
