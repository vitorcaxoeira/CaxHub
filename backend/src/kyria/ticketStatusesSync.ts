import { jobAtivo } from "./jobAtivo";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllTicketStatuses } from "./client";

export const JOB_NAME = "kyria-ticket-statuses-sync";
// Depois de customers (5:00), antes de tickets (5:15 -> 5:30, ver ticketsSync.ts): a FK de
// KyriaTicket.statusKey pra KyriaTicketStatus.key exige que o status já exista localmente.
export const CRON_EXPR = "15 5 * * *";

export async function runKyriaTicketStatusesSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  try {
    const statuses = await listAllTicketStatuses();

    await prisma.$transaction(
      statuses.map((s) =>
        prisma.kyriaTicketStatus.upsert({
          where: { id: s.id },
          create: {
            id: s.id,
            teamId: s.teamId,
            key: s.key,
            name: s.name,
            color: s.color,
            category: s.category,
            status: s.status,
            sortOrder: s.sortOrder,
          },
          update: {
            teamId: s.teamId,
            key: s.key,
            name: s.name,
            color: s.color,
            category: s.category,
            status: s.status,
            sortOrder: s.sortOrder,
          },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /ticket-statuses",
        status: "success",
        message: `${statuses.length} status em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /ticket-statuses", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaTicketStatusesSync(): void {
  cron.schedule(CRON_EXPR, runKyriaTicketStatusesSync);
}
