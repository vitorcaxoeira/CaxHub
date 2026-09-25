import { jobAtivo } from "./jobAtivo";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllCustomers } from "./client";

export const JOB_NAME = "kyria-customers-sync";
// Depois do horário de kyria-members-sync (4:45) — catálogo muda pouco.
export const CRON_EXPR = "0 5 * * *";

export async function runKyriaCustomersSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  try {
    const customers = await listAllCustomers();

    await prisma.$transaction(
      customers.map((cliente) =>
        prisma.kyriaCustomer.upsert({
          where: { id: cliente.id },
          create: {
            id: cliente.id,
            name: cliente.name,
            slug: cliente.slug,
            status: cliente.status,
            domainUrl: cliente.domainUrl,
            createdAt: new Date(cliente.createdAt),
            updatedAt: new Date(cliente.updatedAt),
          },
          update: {
            name: cliente.name,
            slug: cliente.slug,
            status: cliente.status,
            domainUrl: cliente.domainUrl,
            createdAt: new Date(cliente.createdAt),
            updatedAt: new Date(cliente.updatedAt),
          },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /customers",
        status: "success",
        message: `${customers.length} clientes em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /customers", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaCustomersSync(): void {
  cron.schedule(CRON_EXPR, runKyriaCustomersSync);
}
