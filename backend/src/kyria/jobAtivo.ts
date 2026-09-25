import { prisma } from "../db/prisma";

// Sem linha em kyria_sync_config = ativo. Chamado no início de cada run*Sync, então vale
// tanto pro cron quanto pro disparo manual e pro "Sincronizar Todas".
export async function jobAtivo(jobName: string): Promise<boolean> {
  const config = await prisma.kyriaSyncConfig.findUnique({ where: { jobName } });
  return config?.ativo ?? true;
}
