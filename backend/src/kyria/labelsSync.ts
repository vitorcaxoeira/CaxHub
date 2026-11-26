import { jobAtivo } from "./jobAtivo";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllLabels } from "./client";
import { comLeitura } from "./registroLeitura";

export const JOB_NAME = "kyria-labels-sync";
// Entre status de ticket (5:15) e tickets (5:30). Etiqueta não depende de nenhuma outra tabela Kyria (sem FK), então a ordem só serve pra não
// concentrar chamadas no mesmo minuto (o limite é de 60 requisições por minuto por chave).
export const CRON_EXPR = "20 5 * * *";

// Espelho de GET /labels (mapeamento #16, 18/11/2026). Catálogo pequeno (dezenas de linhas), sempre completo: upsert por id.
export async function runKyriaLabelsSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  try {
    const labels = await comLeitura({ jobName: JOB_NAME, recurso: "/labels" }, (leitura) => listAllLabels({ leitura }));

    await prisma.$transaction(
      labels.map((l) =>
        prisma.kyriaLabel.upsert({
          where: { id: l.id },
          create: { id: l.id, groupId: l.groupId, teamId: l.teamId, key: l.key, name: l.name, color: l.color, status: l.status, sortOrder: l.sortOrder },
          update: { groupId: l.groupId, teamId: l.teamId, key: l.key, name: l.name, color: l.color, status: l.status, sortOrder: l.sortOrder },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /labels",
        status: "success",
        message: `${labels.length} etiquetas em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /labels", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaLabelsSync(): void {
  cron.schedule(CRON_EXPR, runKyriaLabelsSync);
}
