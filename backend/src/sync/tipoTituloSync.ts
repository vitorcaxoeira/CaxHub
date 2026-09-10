import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "tipos_titulo-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codtpt AS codtpt, destpt AS destpt, abrtpt AS abrtpt, recsom AS recsom, pagsom AS pagsom, apltpt AS apltpt, sittpt AS sittpt FROM e002tpt`;

interface TipoTituloRow {
  codtpt: string;
  destpt: string;
  abrtpt: string;
  recsom: string;
  pagsom: string;
  apltpt?: string;
  sittpt?: string;
}

export async function runTipoTituloSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const rows = (await runSqlViaSoap(query)) as TipoTituloRow[];

    for (const row of rows) {
      const data = { codtpt: row.codtpt, destpt: row.destpt, abrtpt: row.abrtpt, recsom: row.recsom, pagsom: row.pagsom, apltpt: row.apltpt, sittpt: row.sittpt, ...carimbo(inicio) };
      await prisma.tipoTitulo.upsert({
        where: { codtpt: row.codtpt },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.TipoTituloWhereInput>(prisma.tipoTitulo, {
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

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function scheduleTipoTituloSync(): void {
  cron.schedule(CRON_EXPR, runTipoTituloSync);
}
