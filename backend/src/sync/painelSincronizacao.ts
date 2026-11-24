import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { suportaMarcarRemovido } from "./recorteRetroativo";
import type { SyncJobDescriptor } from "./registry";

// Leituras da tela Importados do ERP/HCM (routes/syncErp.ts, GET /). A tela repete essa chamada a cada
// 10 s, então ela precisa custar pouco e NÃO crescer com o histórico: antes lia o SyncLog inteiro (com a
// coluna `query`, que é o SQL completo de cada execução) só para ficar com a última linha de cada job, e
// fazia dois COUNT(*) por tabela, um round-trip cada, disputando o pool de conexões do Prisma.

export interface ResumoLog {
  jobName: string;
  status: string;
  message: string | null;
  runAt: Date;
  duracaoMs: number | null;
  varreduraModo: string | null;
  varreduraDetectados: number | null;
}

const COLUNAS_LOG = Prisma.sql`"jobName", status, message, "runAt", "duracaoMs", "varreduraModo", "varreduraDetectados"`;

/** Última execução de cada job e, separadamente, a última que REALMENTE varreu (sync incremental nunca
 * varre, então as duas podem ser linhas diferentes). Uma linha por job em cada lista, sem a coluna `query`. */
export async function ultimosLogsPorJob(jobNames: string[]): Promise<{ ultimo: Map<string, ResumoLog>; varredura: Map<string, ResumoLog> }> {
  if (jobNames.length === 0) return { ultimo: new Map(), varredura: new Map() };
  const nomes = Prisma.join(jobNames);
  const [ultimos, varreduras] = await Promise.all([
    prisma.$queryRaw<ResumoLog[]>(Prisma.sql`
      SELECT DISTINCT ON ("jobName") ${COLUNAS_LOG} FROM "SyncLog"
      WHERE "jobName" IN (${nomes}) ORDER BY "jobName", "runAt" DESC`),
    prisma.$queryRaw<ResumoLog[]>(Prisma.sql`
      SELECT DISTINCT ON ("jobName") ${COLUNAS_LOG} FROM "SyncLog"
      WHERE "jobName" IN (${nomes}) AND "varreduraModo" IS NOT NULL ORDER BY "jobName", "runAt" DESC`),
  ]);
  return {
    ultimo: new Map(ultimos.map((l) => [l.jobName, l])),
    varredura: new Map(varreduras.map((l) => [l.jobName, l])),
  };
}

const NOME_TABELA = /^[a-z0-9_]+$/;

/** Total de registros e de removidos de todos os jobs numa consulta só (UNION ALL), em vez de dois COUNT(*)
 * por job. `removidos` é null quando o job não tem detecção de exclusão (a tela não mostra a coluna). */
export async function contagensPorJob(jobs: SyncJobDescriptor[]): Promise<Map<string, { total: number; removidos: number | null }>> {
  if (jobs.length === 0) return new Map();
  const partes = jobs.map((job) => {
    if (!NOME_TABELA.test(job.tabelaLocal)) throw new Error(`Nome de tabela local inesperado: "${job.tabelaLocal}"`);
    const tabela = Prisma.raw(`"${job.tabelaLocal}"`);
    const comRemovidos = job.contarRemovidos != null && suportaMarcarRemovido(job);
    const removidos = comRemovidos
      ? Prisma.sql`count(*) FILTER (WHERE removido_em_senior IS NOT NULL)::int`
      : Prisma.sql`NULL::int`;
    return Prisma.sql`SELECT ${job.jobName}::text AS job, count(*)::int AS total, ${removidos} AS removidos FROM ${tabela}`;
  });
  const linhas = await prisma.$queryRaw<{ job: string; total: number; removidos: number | null }[]>(Prisma.join(partes, " UNION ALL "));
  return new Map(linhas.map((l) => [l.job, { total: l.total, removidos: l.removidos }]));
}

// A tela repete a chamada a cada 10s e pode haver mais de um admin com ela aberta; os COUNT(*) das tabelas
// grandes são o que sobra de custo. Cache curto por sistema, com a chamada em andamento compartilhada: um
// total até 8s defasado não muda nada para quem olha uma tela de acompanhamento.
const TTL_CONTAGENS_MS = 8_000;
const cacheContagens = new Map<string, { em: number; promessa: Promise<Map<string, { total: number; removidos: number | null }>> }>();

export function contagensPorJobComCache(chave: string, jobs: SyncJobDescriptor[]): ReturnType<typeof contagensPorJob> {
  const agora = Date.now();
  const existente = cacheContagens.get(chave);
  if (existente && agora - existente.em < TTL_CONTAGENS_MS) return existente.promessa;
  const promessa = contagensPorJob(jobs);
  cacheContagens.set(chave, { em: agora, promessa });
  // Falha não fica em cache: a próxima chamada tenta de novo.
  promessa.catch(() => {
    if (cacheContagens.get(chave)?.promessa === promessa) cacheContagens.delete(chave);
  });
  return promessa;
}
