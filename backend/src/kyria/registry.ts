// Catálogo dos jobs de sincronização Kyria -> CaxHub, pra alimentar a tela de administração
// (Administração > Integração Kyria) — mesmo espírito de sync/registry.ts (Senior), mas bem
// mais simples: a API do Kyria é só-leitura, cursor-paginada e sem conceito de "sumiu" (usa
// `status: active/inactive` no próprio registro, não remoção física) — nada de filtro SQL,
// varredura de removidos ou tamanho de lote configurável faz sentido aqui ainda. Cada endpoint
// novo (tickets, customers, projects, ...) vira só mais uma entrada nesta lista quando for
// implementado.
import { prisma } from "../db/prisma";
import { JOB_NAME as KYRIA_TEAMS_JOB, CRON_EXPR as KYRIA_TEAMS_CRON, runKyriaTeamsSync } from "./teamsSync";
import { JOB_NAME as KYRIA_MEMBERS_JOB, CRON_EXPR as KYRIA_MEMBERS_CRON, runKyriaMembersSync } from "./membersSync";
import { JOB_NAME as KYRIA_CUSTOMERS_JOB, CRON_EXPR as KYRIA_CUSTOMERS_CRON, runKyriaCustomersSync } from "./customersSync";
import { JOB_NAME as KYRIA_TICKET_STATUSES_JOB, CRON_EXPR as KYRIA_TICKET_STATUSES_CRON, runKyriaTicketStatusesSync } from "./ticketStatusesSync";
import { JOB_NAME as KYRIA_TICKETS_JOB, CRON_EXPR as KYRIA_TICKETS_CRON, runKyriaTicketsSync } from "./ticketsSync";
import {
  JOB_NAME as KYRIA_CUSTOMER_HOURS_JOB,
  CRON_EXPR as KYRIA_CUSTOMER_HOURS_CRON,
  runKyriaCustomerHoursSync,
  mesesDoFiltro,
} from "./customerHoursSync";
import { JOB_NAME as KYRIA_TICKET_HOURS_JOB, CRON_EXPR as KYRIA_TICKET_HOURS_CRON, runKyriaTicketHoursSync } from "./ticketHoursSync";

export interface KyriaSyncJobDescriptor {
  jobName: string;
  displayName: string;
  cronExpr: string;
  // Caminho do endpoint, sem a base URL (ex.: "/teams") — a rota admin (syncKyria.ts) junta
  // com KYRIA_BASE_URL pra mostrar a URL completa na tela, sem duplicar a base aqui.
  path: string;
  // Tabela LOCAL (Postgres, `@@map` do model Prisma) — mesmo campo/propósito que
  // sync/registry.ts (Senior) já tem, usado por kyria/dadosSincronizados.ts pra resolver o
  // model Prisma certo em runtime na tela "Ver dados".
  tabelaLocal: string;
  // `filtros` só é passado no disparo manual "Sinc. Filtros" (from/to); cron e "Sincronizar
  // Todas" chamam sem argumento e o job monta o filtro sozinho (data da última sync).
  run: (filtros?: { from?: string; to?: string }) => Promise<void>;
  // Presente só nos jobs que aceitam filtro from/to — habilita o modal "Sinc. Filtros" e valida
  // os valores ANTES de disparar (lança Error com a mensagem pra tela).
  validarFiltros?: (filtros: { from?: string; to?: string }) => void;
  contarRegistros: () => Promise<number>;
}

export const KYRIA_SYNC_JOBS: KyriaSyncJobDescriptor[] = [
  {
    jobName: KYRIA_TEAMS_JOB,
    displayName: "Times",
    cronExpr: KYRIA_TEAMS_CRON,
    path: "/teams",
    tabelaLocal: "kyria_teams",
    run: runKyriaTeamsSync,
    contarRegistros: () => prisma.kyriaTeam.count(),
  },
  {
    jobName: KYRIA_MEMBERS_JOB,
    displayName: "Membros",
    cronExpr: KYRIA_MEMBERS_CRON,
    path: "/members",
    tabelaLocal: "kyria_members",
    run: runKyriaMembersSync,
    contarRegistros: () => prisma.kyriaMember.count(),
  },
  {
    jobName: KYRIA_CUSTOMERS_JOB,
    displayName: "Clientes",
    cronExpr: KYRIA_CUSTOMERS_CRON,
    path: "/customers",
    tabelaLocal: "kyria_customers",
    run: runKyriaCustomersSync,
    contarRegistros: () => prisma.kyriaCustomer.count(),
  },
  // SEMPRE antes de Tickets nesta lista (pedido do Vitor, 22/09/2026): a FK de
  // KyriaTicket.statusKey pra KyriaTicketStatus.key exige o status já sincronizado.
  {
    jobName: KYRIA_TICKET_STATUSES_JOB,
    displayName: "Status de Ticket",
    cronExpr: KYRIA_TICKET_STATUSES_CRON,
    path: "/ticket-statuses",
    tabelaLocal: "kyria_ticket_statuses",
    run: runKyriaTicketStatusesSync,
    contarRegistros: () => prisma.kyriaTicketStatus.count(),
  },
  {
    jobName: KYRIA_TICKETS_JOB,
    displayName: "Tickets",
    cronExpr: KYRIA_TICKETS_CRON,
    path: "/tickets",
    tabelaLocal: "kyria_tickets",
    run: runKyriaTicketsSync,
    contarRegistros: () => prisma.kyriaTicket.count(),
  },
  // SEMPRE depois de Tickets nesta lista (pedido do Vitor, 22/09/2026): a FK de
  // KyriaTicketHours.id pra KyriaTicket.id exige o ticket já sincronizado, e POST /run-all
  // (syncKyria.ts) roda os jobs sequencialmente na ordem deste array.
  {
    jobName: KYRIA_TICKET_HOURS_JOB,
    displayName: "Horas por ticket (relatório)",
    cronExpr: KYRIA_TICKET_HOURS_CRON,
    path: "/reports/hours",
    tabelaLocal: "kyria_ticket_hours",
    run: runKyriaTicketHoursSync,
    contarRegistros: () => prisma.kyriaTicketHours.count(),
  },
  // Depois de Clientes (FK pra kyria_customers) — mapeamento #17. Aceita "Sinc. Filtros".
  {
    jobName: KYRIA_CUSTOMER_HOURS_JOB,
    displayName: "Horas por cliente (relatório)",
    cronExpr: KYRIA_CUSTOMER_HOURS_CRON,
    path: "/reports/hours?groupBy=customer",
    tabelaLocal: "kyria_customer_hours",
    run: runKyriaCustomerHoursSync,
    validarFiltros: (filtros) => {
      mesesDoFiltro(filtros);
    },
    contarRegistros: () => prisma.kyriaCustomerHours.count(),
  },
];
