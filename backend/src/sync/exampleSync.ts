import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "example-sync";

// Query placeholder — substituir pela consulta real do primeiro relatório/tela.
const EXAMPLE_QUERY = "SELECT 1 AS exemplo";

export async function runExampleSync(): Promise<void> {
  try {
    const data = await runSqlViaSoap(EXAMPLE_QUERY);

    // TODO: fazer upsert do "data" nas tabelas de negócio correspondentes
    // assim que o schema Prisma dessas tabelas for definido.
    console.log(`[${JOB_NAME}] dados recebidos:`, data);

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: EXAMPLE_QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: EXAMPLE_QUERY, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Agenda o job para rodar a cada hora. Ajustar frequência conforme a
// necessidade real de cada fonte de dados.
export function scheduleExampleSync(): void {
  cron.schedule("0 * * * *", runExampleSync);
}
