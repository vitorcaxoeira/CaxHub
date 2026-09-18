import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllTeams } from "./client";

export const JOB_NAME = "kyria-teams-sync";
// Catálogo de times muda raramente — 1x por dia, fora do horário dos jobs do Senior (3h/4h
// já ocupados por empresa-sync/filial-sync e outros).
export const CRON_EXPR = "30 4 * * *";

export async function runKyriaTeamsSync(): Promise<void> {
  const inicio = new Date();
  try {
    const times = await listAllTeams();

    await prisma.$transaction(
      times.map((time) =>
        prisma.kyriaTeam.upsert({
          where: { id: time.id },
          create: {
            id: time.id,
            key: time.key,
            name: time.name,
            description: time.description,
            appearance: time.appearance ?? undefined,
            parentTeamId: time.parentTeamId,
            status: time.status,
          },
          update: {
            key: time.key,
            name: time.name,
            description: time.description,
            appearance: time.appearance ?? undefined,
            parentTeamId: time.parentTeamId,
            status: time.status,
          },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /teams",
        status: "success",
        message: `${times.length} times em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /teams", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaTeamsSync(): void {
  cron.schedule(CRON_EXPR, runKyriaTeamsSync);
}
