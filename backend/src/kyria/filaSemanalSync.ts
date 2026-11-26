import cron from "node-cron";
import { prisma } from "../db/prisma";
import { capturarFilaDoDia } from "../domain/bonificacaoApuracao";
import { hojeBrasil } from "../domain/descontosDados";
import { jobAtivo } from "./jobAtivo";
import { runKyriaTicketsSync } from "./ticketsSync";

// Foto semanal da fila do Kyria (Gestão de Bonificação, 25/11/2026): toda sexta, por time, quantos chamados estão em fila e aguardando retorno.
// O Kyria só guarda o status ATUAL do chamado; sem esta foto não dá para saber quantos chamados havia na sexta depois que ela passou (a
// "capacidade operacional" dos líderes é avaliada na sexta). Antes de contar, atualiza os tickets (o sync diário roda às 05:30) para a foto
// refletir o fim do expediente. Não é um espelho da API (não está no registry/Ver dados): é um dado derivado, do próprio CaxHub.
export const JOB_NAME = "bonificacao-fila-semanal";
// Sexta-feira às 18:00 (hora de São Paulo).
export const CRON_EXPR = "0 18 * * 5";

let emExecucao = false;

export async function runFilaSemanalSync(): Promise<void> {
  if (emExecucao) return;
  emExecucao = true;
  const inicio = Date.now();
  const data = hojeBrasil();
  try {
    if (!(await jobAtivo(JOB_NAME))) return;
    await runKyriaTicketsSync();
    const { times } = await capturarFilaDoDia(data);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: `foto da fila ${data.toISOString().slice(0, 10)}`, status: "success", message: `${times} times fotografados`, duracaoMs: Date.now() - inicio },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({ data: { jobName: JOB_NAME, query: "foto da fila", status: "error", message, duracaoMs: Date.now() - inicio } });
    console.error(`[${JOB_NAME}] falhou:`, message);
  } finally {
    emExecucao = false;
  }
}

export function scheduleFilaSemanalSync(): void {
  cron.schedule(CRON_EXPR, () => void runFilaSemanalSync(), { timezone: "America/Sao_Paulo" });
}
