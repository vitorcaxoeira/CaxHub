import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "percursos_viagem-sync";
export const CRON_EXPR = "30 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT USU_ID AS id, USU_PERORI AS perori, USU_PERDES AS perdes, USU_DESPER AS desper, USU_KMTPER AS kmtper, USU_HORPER AS horper, USU_MODTRA AS modtra, USU_HORPAG AS horpag FROM USU_TRDVPER`;

interface PercursoViagemRow {
  id: number;
  perori?: string;
  perdes?: string;
  desper?: string;
  kmtper?: number;
  horper?: number;
  modtra?: string;
  horpag?: number;
}

// Trecho (origem/destino) reutilizável entre rotas — 143 linhas em 13/08/2026, catálogo
// quase estático.
export async function runPercursoViagemSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const rows = (await runSqlViaSoapPaginated(query, ["id"])) as PercursoViagemRow[];

    for (const row of rows) {
      const data = {
        id: row.id,
        perori: row.perori,
        perdes: row.perdes,
        desper: row.desper,
        kmtper: row.kmtper,
        horper: row.horper,
        modtra: row.modtra,
        horpag: row.horpag,
      };
      await prisma.percursoViagem.upsert({
        where: { id: row.id },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success", duracaoMs: Date.now() - inicio.getTime() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Catálogo muda pouco — roda 1x por dia às 5h30.
export function schedulePercursoViagemSync(): void {
  cron.schedule(CRON_EXPR, runPercursoViagemSync);
}
