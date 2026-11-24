import { jobAtivo } from "./jobAtivo";
import cron from "node-cron";
import { prisma } from "../db/prisma";
import { listAllTickets } from "./client";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "../sync/upsertEmLote";

export const JOB_NAME = "kyria-tickets-sync";
// Depois de customers (5:00) e ticket-statuses (5:15) — tickets antes de horas por ticket
// (5:45, ver ticketHoursSync.ts): a FK de KyriaTicketHours.id pra KyriaTicket.id exige que o
// ticket já exista localmente, e as 4 FKs deste model (team/responsavel/customer/status, ver
// comentário grande em schema.prisma) exigem que ESSAS tabelas já existam localmente primeiro.
export const CRON_EXPR = "30 5 * * *";

// Upsert em lote via SQL puro (mesmo `upsertEmLote` já usado nos syncs do Senior) — não o
// `$transaction(array.map(prisma.kyriaTicket.upsert))` que os outros 3 jobs Kyria usam. Achado
// ao vivo (22/09/2026): /tickets tem 2300+ registros (bem mais que o catálogo pequeno de teams/
// members/customers), e um upsert individual por linha dentro de uma única `$transaction`
// levou ~2 minutos só pra FALHAR (estourou um VarChar que a amostra de 1 registro não previu —
// corrigido no schema, ver comentário de KyriaTicket). Sem `carimbo` (Kyria não tem
// visto_em_sync/removido_em_senior) — `sincronizado_em` entra como coluna normal.
const COLUNAS: ColunaUpsert[] = [
  { nome: "id", cast: "text" },
  { nome: "code", cast: "text" },
  { nome: "title", cast: "text" },
  { nome: "description", cast: "text" },
  { nome: "status_key", cast: "text" },
  { nome: "priority", cast: '"KyriaTicketPrioridade"' },
  { nome: "team_id", cast: "text" },
  { nome: "responsible_user_id", cast: "text" },
  { nome: "requester_user_id", cast: "text" },
  { nome: "project_id", cast: "text" },
  { nome: "customer_id", cast: "text" },
  { nome: "opened_at", cast: "timestamptz" },
  { nome: "updated_at", cast: "timestamptz" },
  { nome: "closed_at", cast: "timestamptz" },
  { nome: "parent_ticket_id", cast: "text" },
  { nome: "revision", cast: "int" },
  { nome: "sincronizado_em", cast: "timestamptz" },
];

function distintos(valores: (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => v != null))];
}

export async function runKyriaTicketsSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  const inicio = new Date();
  try {
    const tickets = await listAllTickets();
    const sincronizadoEm = inicio.toISOString();

    // Pré-filtro ANTES do upsert — 4 FKs reais em cima de upsert em lote: se uma linha do lote
    // violar uma FK, o `upsertEmLote` inteiro falha (ver diagnosticarFalha em upsertEmLote.ts,
    // que para no primeiro erro e propaga — não é "pula só a linha ruim"). Checa quais
    // customer_id/team_id/responsible_user_id/status_key referenciados por ESTA rodada já
    // existem localmente, ANTES de montar `linhas`. team/responsavel/customer (nullable) viram
    // `null` quando a referência ainda não sincronizou — o ticket é gravado mesmo assim, só essa
    // relação fica pendente pro próximo sync. status (NOT NULL) não tem como virar `null` — o
    // ticket inteiro é pulado nesse caso (raro: só 12 status no total, e o registry sempre
    // sincroniza ticket-statuses antes de tickets).
    const [customersExistentes, teamsExistentes, membersExistentes, statusesExistentes] = await Promise.all([
      prisma.kyriaCustomer.findMany({ where: { id: { in: distintos(tickets.map((t) => t.customerId)) } }, select: { id: true } }),
      prisma.kyriaTeam.findMany({ where: { id: { in: distintos(tickets.map((t) => t.teamId)) } }, select: { id: true } }),
      prisma.kyriaMember.findMany({ where: { id: { in: distintos(tickets.map((t) => t.responsibleUserId)) } }, select: { id: true } }),
      prisma.kyriaTicketStatus.findMany({ where: { key: { in: distintos(tickets.map((t) => t.statusKey)) } }, select: { key: true } }),
    ]);
    const customerIds = new Set(customersExistentes.map((c) => c.id));
    const teamIds = new Set(teamsExistentes.map((t) => t.id));
    const memberIds = new Set(membersExistentes.map((m) => m.id));
    const statusKeys = new Set(statusesExistentes.map((s) => s.key));

    let puladosSemStatus = 0;
    const linhas: LinhaUpsert[] = [];
    for (const ticket of tickets) {
      if (!statusKeys.has(ticket.statusKey)) {
        puladosSemStatus++;
        continue;
      }
      linhas.push({
        chave: ticket.id,
        valores: [
          ticket.id,
          ticket.code,
          ticket.title,
          ticket.description,
          ticket.statusKey,
          ticket.priority,
          ticket.teamId != null && teamIds.has(ticket.teamId) ? ticket.teamId : null,
          ticket.responsibleUserId != null && memberIds.has(ticket.responsibleUserId) ? ticket.responsibleUserId : null,
          ticket.requesterUserId,
          ticket.projectId,
          ticket.customerId != null && customerIds.has(ticket.customerId) ? ticket.customerId : null,
          new Date(ticket.openedAt).toISOString(),
          new Date(ticket.updatedAt).toISOString(),
          ticket.closedAt != null ? new Date(ticket.closedAt).toISOString() : null,
          ticket.parentTicketId,
          String(ticket.revision),
          sincronizadoEm,
        ],
      });
    }

    const resultado = await upsertEmLote(linhas, { tabela: "kyria_tickets", colunas: COLUNAS, colunasPk: ["id"] });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "GET /tickets",
        status: "success",
        message:
          `${resultado.linhasProcessadas} tickets em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s (${resultado.lotes} lotes)` +
          (puladosSemStatus > 0 ? ` — ${puladosSemStatus} pulados (status ainda não sincronizado localmente)` : ""),
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: "GET /tickets", status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function scheduleKyriaTicketsSync(): void {
  cron.schedule(CRON_EXPR, runKyriaTicketsSync);
}
