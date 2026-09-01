import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "historicos_padrao-sync";
export const CRON_EXPR = "10 5 * * *";
export const CAMPO_DATA: string | null = null;
// SEM CodEmp — E046HPD é catálogo GLOBAL do Senior (PK só CodHpd, confirmado ao vivo contra o
// dicionário de dados), diferente da maioria das tabelas espelhadas neste projeto.
export const QUERY = `SELECT CodHpd AS codhpd, TitHpd AS tithpd, DesHpd AS deshpd, TipHpd AS tiphpd, IntAgr AS intagr FROM E046HPD`;

interface HistoricoPadraoRow {
  codhpd: number;
  tithpd?: string;
  deshpd: string;
  tiphpd: string;
  intagr?: string;
}

// Catálogo de configuração (templates de texto do "Complemento Hist."), não dado transacional
// — upsert simples, sem varredura de exclusão (decisão confirmada com o Vitor, mesmo espírito
// de formaPagamentoSync.ts).
export async function runHistoricoPadraoSync(): Promise<void> {
  const inicio = new Date();
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver uma resposta
    // vazia/truncada — por isso sempre paginamos com ORDER BY pela chave primária, mesmo esta
    // tabela sendo pequena (é o padrão de todo job neste projeto).
    const rows = (await runSqlViaSoapPaginated(query, ["codhpd"])) as HistoricoPadraoRow[];

    for (const row of rows) {
      const data = {
        codhpd: row.codhpd,
        tithpd: row.tithpd != null ? row.tithpd : null,
        deshpd: row.deshpd,
        tiphpd: row.tiphpd,
        intagr: row.intagr != null ? row.intagr : null,
      };
      await prisma.historicoPadrao.upsert({
        where: { codhpd: row.codhpd },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success", message: `${rows.length} linhas`, duracaoMs: Date.now() - inicio.getTime() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleHistoricoPadraoSync(): void {
  cron.schedule(CRON_EXPR, runHistoricoPadraoSync);
}
