import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "portadores-sync";
export const CRON_EXPR = "0 4 * * *";
// Único campo de data é "DatPal" (alteração pro Palmtop, não do registro em si).
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codemp AS codemp, codpor AS codpor, despor AS despor, abrpor AS abrpor, codban AS codban, codage AS codage, numcco AS numcco FROM e039por`;

interface PortadorRow {
  codemp: number;
  codpor: string;
  despor: string;
  abrpor: string;
  codban?: string;
  codage?: string;
  numcco?: string;
}

export async function runPortadorSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codpor"])) as PortadorRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codpor: row.codpor, despor: row.despor, abrpor: row.abrpor, codban: row.codban, codage: row.codage, numcco: row.numcco };
      await prisma.portador.upsert({
        where: { codemp_codpor: { codemp: row.codemp, codpor: row.codpor } },
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

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function schedulePortadorSync(): void {
  cron.schedule(CRON_EXPR, runPortadorSync);
}
