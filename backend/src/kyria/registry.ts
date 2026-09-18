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
  run: () => Promise<void>;
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
];
