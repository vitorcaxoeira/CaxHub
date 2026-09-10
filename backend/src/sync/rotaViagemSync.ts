import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "rotas_viagem-sync";
export const CRON_EXPR = "25 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT USU_ID AS id, USU_CODCLI AS codcli, USU_DESROT AS desrot, USU_KMTROT AS kmtrot, USU_HORROT AS horrot, USU_SITREG AS sitreg, USU_IDAGP AS idagp, USU_TOLHRS AS tolhrs, USU_TOLKM AS tolkm FROM USU_TRDVROTAS`;

interface RotaViagemRow {
  id: number;
  codcli?: number;
  desrot?: string;
  kmtrot?: number;
  horrot?: number;
  sitreg?: string;
  idagp?: number;
  tolhrs?: number;
  tolkm?: number;
}

// Rota de viagem pré-cadastrada por cliente — 168 linhas em 13/08/2026, catálogo quase
// estático.
export async function runRotaViagemSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária, mesmo em tabelas pequenas como esta.
    const rows = (await runSqlViaSoapPaginated(query, ["id"])) as RotaViagemRow[];

    for (const row of rows) {
      const data = {
        id: row.id,
        codcli: row.codcli,
        desrot: row.desrot,
        kmtrot: row.kmtrot,
        horrot: row.horrot,
        sitreg: row.sitreg,
        idagp: row.idagp,
        tolhrs: row.tolhrs,
        tolkm: row.tolkm,
        ...carimbo(inicio),
      };
      await prisma.rotaViagem.upsert({
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
    const varredura = await executarVarreduraDoJob<Prisma.RotaViagemWhereInput>(prisma.rotaViagem, {
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

// Catálogo muda pouco — roda 1x por dia às 5h25.
export function scheduleRotaViagemSync(): void {
  cron.schedule(CRON_EXPR, runRotaViagemSync);
}
