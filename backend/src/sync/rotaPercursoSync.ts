import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "rotas_percursos-sync";
export const CRON_EXPR = "35 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT USU_ID AS id, USU_ROTID AS rotid, USU_PERID AS perid, USU_ORDSEQ AS ordseq FROM USU_TRDVROTPER`;

interface RotaPercursoRow {
  id: number;
  rotid: number;
  perid: number;
  ordseq: number;
}

// Junção rota x percurso, com a ordem de cada trecho dentro da rota — 294 linhas em
// 13/08/2026. Roda depois de RotaViagem/PercursoViagem na fila de "Sincronizar tudo" (ver
// sync/registry.ts) só por organização; sem FK formal, então a ordem não é obrigatória.
export async function runRotaPercursoSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const rows = (await runSqlViaSoapPaginated(query, ["id"])) as RotaPercursoRow[];

    for (const row of rows) {
      const data = { id: row.id, rotid: row.rotid, perid: row.perid, ordseq: row.ordseq, ...carimbo(inicio) };
      await prisma.rotaPercurso.upsert({
        where: { id: row.id },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.RotaPercursoWhereInput>(prisma.rotaPercurso, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: rows.length,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: varredura ? varredura.resumo : undefined,
        varreduraModo: varredura?.modo ?? null,
        varreduraDetectados: varredura?.candidatos ?? null,
        varreduraInicio: varredura ? inicio : null,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Catálogo muda pouco — roda 1x por dia às 5h35.
export function scheduleRotaPercursoSync(): void {
  cron.schedule(CRON_EXPR, runRotaPercursoSync);
}
