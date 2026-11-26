import { jobAtivo } from "./jobAtivo";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllLabelGroups } from "./client";
import { comLeitura } from "./registroLeitura";

export const JOB_NAME = "kyria-label-groups-sync";
// Entre status de ticket (5:15) e etiquetas (5:20): a etiqueta aponta pro grupo (sem FK por enquanto, mas é a ordem natural de leitura).
export const CRON_EXPR = "17 5 * * *";

// Espelho de GET /label-groups (mapeamento #20, 18/11/2026). Catálogo de poucas linhas, sempre completo: upsert por id.
// `fitroDepTime` é campo INTERNO do CaxHub (não vem da API): fica FORA do `update` de propósito — a cada sync o valor que a pessoa gravou é
// preservado; só o `create` o deixa nulo.
export async function runKyriaLabelGroupsSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  try {
    const grupos = await comLeitura({ jobName: JOB_NAME, recurso: "/label-groups" }, (leitura) => listAllLabelGroups({ leitura }));

    await prisma.$transaction(
      grupos.map((g) =>
        prisma.kyriaLabelGroup.upsert({
          where: { id: g.id },
          create: { id: g.id, key: g.key, name: g.name, description: g.description, status: g.status },
          update: { key: g.key, name: g.name, description: g.description, status: g.status },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /label-groups",
        status: "success",
        message: `${grupos.length} grupos em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /label-groups", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaLabelGroupsSync(): void {
  cron.schedule(CRON_EXPR, runKyriaLabelGroupsSync);
}
