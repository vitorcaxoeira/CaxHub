import { jobAtivo } from "./jobAtivo";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { getHoursReport } from "./client";

export const JOB_NAME = "kyria-ticket-hours-sync";
// Depois de tickets (5:30) — a FK de KyriaTicketHours.id pra KyriaTicket.id exige que o ticket
// já exista localmente. Ainda assim, linhas cujo ticket não for encontrado são puladas (não
// tentadas) em vez de deixar a transação falhar — ver `ticketIdsExistentes` abaixo; cobre tanto
// a primeira execução (tickets ainda vazio) quanto um "Sincronizar agora" disparado só neste job.
export const CRON_EXPR = "45 5 * * *";

// Janela FIXA, não incremental — mas com dois achados ao vivo que mudaram o desenho em cima do
// que o plano original previa (22/09/2026):
//   1. Não é uma banda ROLANTE estreita (ex.: "só os últimos 3 dias, sempre") — é um CHÃO fixo
//      de calendário. Testado exaustivamente: TODO dia de 14 a 18/09/2026 dá 503 "Time
//      reporting data is not ready", e TODO dia a partir de 19/09/2026 (19, 20, 21 — "ontem" no
//      dia do teste) funciona. Um range que cruza esse chão (ex.: 18–21) falha inteiro — não é
//      "processando, tenta de novo" (retry minutos depois no mesmo range não ajudou).
//   2. Por isso `JANELA_DIAS = 7` sozinho (proposto no plano, nunca testado contra o range real
//      resultante) QUEBROU ao vivo: "ontem" menos 6 dias caía em 15/09, dentro da zona morta.
//      Corrigido pra nunca voltar antes de `DATA_MINIMA_CONHECIDA` — na prática a janela cresce
//      sozinha conforme os dias passam (hoje são só 3 dias de dado disponível; daqui a um mês
//      serão bem mais que 7, e o clamp deixa de importar). `DATA_MINIMA_CONHECIDA` é empírica,
//      não documentada pelo Kyria — pode ser "quando o recurso de apontamento foi ligado nesta
//      conta" (permanente) ou "backfill ainda em andamento" (o chão pode recuar sozinho no
//      futuro, tornando esta constante desnecessária, não errada).
const JANELA_DIAS = 7;
const DATA_MINIMA_CONHECIDA = "2026-09-19";

function paraDataIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

function janelaAtual(): { from: string; to: string; deData: Date; ateData: Date } {
  const ontem = new Date();
  ontem.setUTCDate(ontem.getUTCDate() - 1);
  ontem.setUTCHours(0, 0, 0, 0);

  const inicioDesejado = new Date(ontem);
  inicioDesejado.setUTCDate(inicioDesejado.getUTCDate() - (JANELA_DIAS - 1));

  const minima = new Date(`${DATA_MINIMA_CONHECIDA}T00:00:00Z`);
  const inicio = inicioDesejado < minima ? minima : inicioDesejado;

  return { from: paraDataIso(inicio), to: paraDataIso(ontem), deData: inicio, ateData: ontem };
}

export async function runKyriaTicketHoursSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  const { from, to, deData, ateData } = janelaAtual();
  const query = `GET /reports/hours?from=${from}&to=${to}&groupBy=ticket`;
  try {
    const relatorio = await getHoursReport({ from, to, groupBy: "ticket" });
    const linhas = relatorio.data.rows;

    // Só upserta linhas cujo ticket já existe localmente — a FK barraria um insert órfão de
    // qualquer jeito, mas checar antes evita falhar a transação inteira por causa de 1 linha e
    // deixa claro no log quantas foram puladas (mesmo espírito de "RatItem órfão... linha
    // ignorada" em sync/ratItemSync.ts, adaptado: lá é Rat ainda não sincronizado, aqui é
    // Ticket ainda não sincronizado).
    const idsDoRelatorio = [...new Set(linhas.map((l) => l.group.id))];
    const ticketsExistentes =
      idsDoRelatorio.length > 0
        ? await prisma.kyriaTicket.findMany({ where: { id: { in: idsDoRelatorio } }, select: { id: true } })
        : [];
    const idsExistentes = new Set(ticketsExistentes.map((t) => t.id));
    const linhasValidas = linhas.filter((l) => idsExistentes.has(l.group.id));
    const puladas = linhas.length - linhasValidas.length;

    await prisma.$transaction(
      linhasValidas.map((linha) =>
        prisma.kyriaTicketHours.upsert({
          where: { id: linha.group.id },
          create: {
            id: linha.group.id,
            groupType: linha.group.type,
            code: linha.group.code,
            title: linha.group.title,
            minutes: linha.minutes,
            janelaDe: deData,
            janelaAte: ateData,
          },
          update: {
            groupType: linha.group.type,
            code: linha.group.code,
            title: linha.group.title,
            minutes: linha.minutes,
            janelaDe: deData,
            janelaAte: ateData,
          },
        })
      )
    );

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${linhasValidas.length} tickets (janela ${from} a ${to}) em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s` +
          (puladas > 0 ? ` — ${puladas} pulados (ticket ainda não sincronizado localmente)` : ""),
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

export function scheduleKyriaTicketHoursSync(): void {
  cron.schedule(CRON_EXPR, runKyriaTicketHoursSync);
}
