import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllMembers } from "./client";

export const JOB_NAME = "kyria-members-sync";
// Depois do horário de kyria-teams-sync (4:30) — catálogo pequeno, muda raramente.
export const CRON_EXPR = "45 4 * * *";

export async function runKyriaMembersSync(): Promise<void> {
  const inicio = new Date();
  try {
    const members = await listAllMembers();

    await prisma.$transaction(
      members.map((membro) =>
        prisma.kyriaMember.upsert({
          where: { id: membro.id },
          create: { id: membro.id, name: membro.name, email: membro.email, status: membro.status, role: membro.role },
          update: { name: membro.name, email: membro.email, status: membro.status, role: membro.role },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /members",
        status: "success",
        message: `${members.length} membros em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /members", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaMembersSync(): void {
  cron.schedule(CRON_EXPR, runKyriaMembersSync);
}
