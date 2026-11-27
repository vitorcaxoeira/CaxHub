import axios from "axios";
import type { LeituraKyria } from "./registroLeitura";
import { kbDaResposta, linhasDaResposta } from "./registroLeitura";

// ---------------------------------------------------------------------------
// Cliente REST do Kyria — segunda origem de dados do CaxHub, ao lado do Senior (SOAP,
// ver src/soap/client.ts). Objetivo inicial: compor a visão de rentabilidade (ERP + Kyria).
//
// Contrato confirmado em três fontes, nenhuma delas a doc em docx.soelx.com.br (SPA renderizada
// em JS, WebFetch/curl só devolvem a casca HTML vazia):
//   1. OpenAPI: https://elegant-llama-879.convex.site/api/v1/openapi.json — schema completo,
//      44 paths (inclui escrita), sem exigir auth. Reconferido byte a byte no mesmo dia (17/09/2026)
//      depois do Vitor mandar um link novo apontando pro mesmo schema — sem diferença nenhuma, o
//      schema não muda sozinho, então "documentação atualizada" do Kyria pode só significar link
//      novo, não conteúdo novo.
//   2. Doc interativa (Scalar): https://elegant-llama-879.convex.site/api/v1/docs — SPA, mesmo
//      problema da doc em docx.soelx.com.br: WebFetch/curl só pegam a casca (`<script
//      data-url="/api/v1/openapi.json">`), sem o conteúdo renderizado. É só um visualizador do
//      MESMO JSON acima — pedido do Vitor (17/09/2026): usar só essa URL (a família
//      elegant-llama-879.convex.site/api/v1/*, ou seja, o próprio serviço) como fonte da
//      varredura da API, não mais o link da SPA em docx.soelx.com.br nem o SharePoint — na
//      prática isso quer dizer usar o `openapi.json` (item 1), que é o único dos dois fetchable.
//   3. Doc oficial "API de integração Kyria v1" — achada via SharePoint em 17/09/2026 (busca por
//      conteúdo + read_resource do M365) — MVP descrito como só 10 GETs (tickets, tickets/{id},
//      customers, projects, ticket-statuses, ticket-fields, label-groups, labels, teams, members).
//
// O schema completo (44 paths) vai muito além dos 10 da doc oficial: quase todo recurso tem
// escrita (POST/PATCH/DELETE), e Ticket tem uma família inteira de sub-recursos não citados na
// doc — messages, history, labels, participants, field-values, attachments e **time-entries**
// (`GET/POST /tickets/{id}/time-entries`, schema `ManualTimeEntry`: minutes/effectiveDate/
// targetUserId/reason — dado de apontamento de hora de verdade, ao contrário do que a ausência de
// um `/time-entries` de topo sugeria). Não confirmado se a `KYRIA_API_TOKEN` atual tem escopo pra
// qualquer coisa além dos 10 GETs oficiais (ver "scopes" no `info.description` do OpenAPI e o 403
// de `attachments/download` citando `attachments:write`) — não implementar sem testar isolado
// primeiro. Ver [[api-kyria]] no segundo cérebro pro inventário completo dos 44 endpoints.
//
// Autenticação: `Authorization: Bearer <KYRIA_API_TOKEN>` (token com prefixo `kyria_live_`).
// Erros vêm sempre no mesmo envelope: `{ error: { code, message }, requestId }`, com code em
// UNAUTHORIZED | INVALID_REQUEST | NOT_FOUND | RATE_LIMITED | INTERNAL_ERROR.
// Rate limit: janela fixa de 60 requisições/minuto POR CHAVE, consumida ANTES de validar a
// rota/parâmetros — 429 traz `Retry-After` (segundos). `listTeams` espera e tenta de novo
// automaticamente quando isso acontece (única regra de rate-limit que faz sentido aplicar
// agora, com um único job rodando 1x/dia — nada de fila/controle de concorrência entre jobs
// ainda, não há dois jobs Kyria disputando o limite pra justificar isso hoje).
// ---------------------------------------------------------------------------

const TENTATIVAS_RATE_LIMIT = 3;
const TENTATIVAS_RATE_LIMIT_FEED = 6;
// Máximo de itens por página que o OpenAPI do Kyria declara em TODA listagem GET (`limit`: 1 a 750, padrão 50; 751 é recusado com 400 — conferido
// ao vivo em 25/11/2026). Como a chave tem 60 requisições por minuto, página cheia é o que menos gasta dessa cota (tickets: de ~170 para 12 chamadas
// por sync). Quem não passa `limit` pega este valor; a amostra do Mapeamento de Campos continua pedindo `limit=1` de propósito (fieldPreview.ts).
export const LIMITE_MAXIMO_KYRIA = 750;
/** Timeout de cada chamada à API (ms): o mesmo que o registro das leituras mostra. */
export const TIMEOUT_KYRIA_MS = 20000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function kyriaConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.KYRIA_BASE_URL;
  const token = process.env.KYRIA_API_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("KYRIA_BASE_URL e KYRIA_API_TOKEN precisam estar definidos no .env");
  }

  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

/** Base da API (inclui /api/v1). Diferente de kyriaConfig(), nao lanca se a variavel faltar: serve pra montar URL informativa pra tela. */
export function kyriaBaseUrl(): string {
  return (process.env.KYRIA_BASE_URL ?? "").replace(/\/$/, "");
}

/** URL completa de um caminho do Kyria (base + caminho), exatamente a que getKyriaSample e os jobs chamam. */
export function kyriaFullUrl(path: string): string {
  return `${kyriaBaseUrl()}${path}`;
}

export interface KyriaErrorBody {
  error: { code: string; message: string };
  requestId: string;
}

/** Traduz a falha de uma chamada ao Kyria na mensagem mais informativa disponível. */
export function mensagemDeFalhaKyria(erro: unknown, operacao: string): string {
  if (axios.isAxiosError(erro)) {
    const corpo = erro.response?.data as KyriaErrorBody | undefined;
    if (corpo?.error) {
      return `Kyria recusou "${operacao}" (HTTP ${erro.response?.status}, ${corpo.error.code}): ${corpo.error.message}`;
    }
    if (erro.response) {
      return `Kyria recusou "${operacao}" (HTTP ${erro.response.status}) — sem corpo de erro reconhecido`;
    }
  }
  return erro instanceof Error ? erro.message : String(erro);
}

interface OpcoesGetKyria {
  /** Nome da operação nas mensagens de erro. */
  operacao: string;
  /** Total de tentativas (a primeira conta) quando a API responde 429. */
  tentativasMax: number;
  /** Espera, em segundos, quando o 429 não traz `Retry-After`. */
  esperaPadraoS: number;
  /** Se informada, cada tentativa (inclusive a que levou 429 ou falhou) é gravada nela. */
  leitura?: LeituraKyria | null;
}

/**
 * GET autenticado com a regra de rate limit do Kyria (60 req/min por chave): em 429 espera o `Retry-After` e tenta de novo até `tentativasMax`.
 * É o único lugar que fala HTTP com a API nas listagens e nos relatórios, então também é onde cada tentativa vira uma linha do registro de
 * leituras (cursor enviado e devolvido, linhas, KB, tempo de ida e volta, status HTTP, espera do 429 e `requestId` do Kyria).
 */
async function getKyria(rota: string, params: Record<string, unknown>, o: OpcoesGetKyria): Promise<any> {
  const { baseUrl, token } = kyriaConfig();
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const limite = typeof params.limit === "number" ? params.limit : null;

  for (let tentativa = 1; ; tentativa++) {
    const disparadaEm = new Date();
    const t0 = Date.now();
    try {
      const response = await axios.get(`${baseUrl}${rota}`, { headers: { Authorization: `Bearer ${token}` }, params, timeout: TIMEOUT_KYRIA_MS });
      if (o.leitura) {
        await o.leitura.registrarChamada({
          disparadaEm,
          cursor,
          proximoCursor: (response.data?.page?.nextCursor as string | null | undefined) ?? null,
          limite,
          linhas: linhasDaResposta(response.data),
          kb: kbDaResposta(response.data, response.headers?.["content-length"]),
          msKyria: Date.now() - t0,
          tentativa,
          httpStatus: response.status,
          esperaS: null,
          status: "ok",
          requestId: (response.data?.requestId as string | undefined) ?? null,
          erro: null,
        });
      }
      return response.data;
    } catch (erro) {
      const resposta = axios.isAxiosError(erro) ? erro.response : undefined;
      const status = resposta?.status;
      const vaTentarDeNovo = status === 429 && tentativa < o.tentativasMax;
      const esperaS = vaTentarDeNovo ? Number(resposta?.headers?.["retry-after"]) || o.esperaPadraoS : null;
      if (o.leitura) {
        await o.leitura.registrarChamada({
          disparadaEm,
          cursor,
          proximoCursor: null,
          limite,
          linhas: 0,
          kb: 0,
          msKyria: Date.now() - t0,
          tentativa,
          httpStatus: status ?? null,
          esperaS,
          status: "erro",
          requestId: ((resposta?.data as { requestId?: string } | undefined)?.requestId as string | undefined) ?? null,
          erro: mensagemDeFalhaKyria(erro, o.operacao),
        });
      }
      if (vaTentarDeNovo && esperaS != null) {
        await esperar(esperaS * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, o.operacao));
    }
  }
}

// ---------------------------------------------------------------------------
// GET /teams
// ---------------------------------------------------------------------------

export interface KyriaTeam {
  /** Identificador opaco do Convex — tratar como string imutável, sem estrutura interna. */
  id: string;
  key: string;
  name: string;
  description: string | null;
  appearance: { iconKey: string; colorKey: string } | null;
  parentTeamId: string | null;
  status: "active" | "inactive";
}

export interface KyriaPage {
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ListTeamsOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  /** 1–750 (padrão do serviço: 50). Sem informar, o client usa o máximo: LIMITE_MAXIMO_KYRIA. */
  limit?: number;
  cursor?: string;
  status?: "active" | "inactive";
}

export interface ListTeamsResult {
  data: KyriaTeam[];
  page: KyriaPage;
  requestId: string;
}

export async function listTeams(options: ListTeamsOptions = {}): Promise<ListTeamsResult> {
  return getKyria("/teams", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor, status: options.status }, { operacao: "listTeams", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /teams, seguindo `page.nextCursor`. */
export async function listAllTeams(options: Omit<ListTeamsOptions, "cursor"> = {}): Promise<KyriaTeam[]> {
  const teams: KyriaTeam[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listTeams({ ...options, cursor });
    teams.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return teams;
}

// ---------------------------------------------------------------------------
// GET /members
// ---------------------------------------------------------------------------

export interface KyriaMember {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  role: "attendant" | "manager" | "requester" | "participant" | "admin" | "service_manager" | "customer_request_manager";
}

export interface ListMembersOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
  status?: "active" | "inactive";
}

export interface ListMembersResult {
  data: KyriaMember[];
  page: KyriaPage;
  requestId: string;
}

export async function listMembers(options: ListMembersOptions = {}): Promise<ListMembersResult> {
  return getKyria("/members", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor, status: options.status }, { operacao: "listMembers", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /members, seguindo `page.nextCursor`. */
export async function listAllMembers(options: Omit<ListMembersOptions, "cursor"> = {}): Promise<KyriaMember[]> {
  const members: KyriaMember[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listMembers({ ...options, cursor });
    members.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return members;
}

// ---------------------------------------------------------------------------
// GET /customers
// ---------------------------------------------------------------------------

export interface KyriaCustomer {
  id: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  domainUrl: string | null;
  /** Epoch em milissegundos — ver ListMembersOptions/client.ts, mesmo formato do Kyria em toda parte. */
  createdAt: number;
  updatedAt: number;
}

export interface ListCustomersOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
  status?: "active" | "inactive";
}

export interface ListCustomersResult {
  data: KyriaCustomer[];
  page: KyriaPage;
  requestId: string;
}

export async function listCustomers(options: ListCustomersOptions = {}): Promise<ListCustomersResult> {
  return getKyria("/customers", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor, status: options.status }, { operacao: "listCustomers", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /customers, seguindo `page.nextCursor`. */
export async function listAllCustomers(options: Omit<ListCustomersOptions, "cursor"> = {}): Promise<KyriaCustomer[]> {
  const customers: KyriaCustomer[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listCustomers({ ...options, cursor });
    customers.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return customers;
}

// ---------------------------------------------------------------------------
// GET /tickets
// ---------------------------------------------------------------------------

export interface KyriaTicket {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  statusKey: string;
  priority: "low" | "medium" | "high" | "urgent";
  teamId: string | null;
  responsibleUserId: string | null;
  requesterUserId: string;
  projectId: string | null;
  customerId: string | null;
  /** Epoch em milissegundos — mesmo formato do Kyria em toda parte. */
  openedAt: number;
  updatedAt: number;
  closedAt: number | null;
  parentTicketId: string | null;
  revision: number;
}

export interface ListTicketsOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
}

export interface ListTicketsResult {
  data: KyriaTicket[];
  page: KyriaPage;
  requestId: string;
}

export async function listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
  return getKyria("/tickets", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor }, { operacao: "listTickets", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /tickets, seguindo `page.nextCursor`. */
export async function listAllTickets(options: Omit<ListTicketsOptions, "cursor"> = {}): Promise<KyriaTicket[]> {
  const tickets: KyriaTicket[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listTickets({ ...options, cursor });
    tickets.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return tickets;
}

// ---------------------------------------------------------------------------
// GET /ticket-statuses
// ---------------------------------------------------------------------------

export interface KyriaTicketStatus {
  id: string;
  teamId: string | null;
  key: string;
  name: string;
  color: string | null;
  category: "triage" | "queue" | "awaiting_return" | "execution" | "done" | "cancelled";
  status: "active" | "inactive";
  sortOrder: number | null;
}

export interface ListTicketStatusesOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
}

export interface ListTicketStatusesResult {
  data: KyriaTicketStatus[];
  page: KyriaPage;
  requestId: string;
}

export async function listTicketStatuses(options: ListTicketStatusesOptions = {}): Promise<ListTicketStatusesResult> {
  return getKyria("/ticket-statuses", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor }, { operacao: "listTicketStatuses", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /ticket-statuses, seguindo `page.nextCursor`. */
export async function listAllTicketStatuses(options: Omit<ListTicketStatusesOptions, "cursor"> = {}): Promise<KyriaTicketStatus[]> {
  const statuses: KyriaTicketStatus[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listTicketStatuses({ ...options, cursor });
    statuses.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return statuses;
}

// ---------------------------------------------------------------------------
// GET /label-groups
// ---------------------------------------------------------------------------

export interface KyriaLabelGroup {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
}

export interface ListLabelGroupsOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
}

export interface ListLabelGroupsResult {
  data: KyriaLabelGroup[];
  page: KyriaPage;
  requestId: string;
}

export async function listLabelGroups(options: ListLabelGroupsOptions = {}): Promise<ListLabelGroupsResult> {
  return getKyria("/label-groups", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor }, { operacao: "listLabelGroups", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /label-groups, seguindo `page.nextCursor`. */
export async function listAllLabelGroups(options: Omit<ListLabelGroupsOptions, "cursor"> = {}): Promise<KyriaLabelGroup[]> {
  const grupos: KyriaLabelGroup[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listLabelGroups({ ...options, cursor });
    grupos.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return grupos;
}

// ---------------------------------------------------------------------------
// GET /labels
// ---------------------------------------------------------------------------

export interface KyriaLabel {
  id: string;
  groupId: string | null;
  teamId: string | null;
  key: string;
  name: string;
  color: string | null;
  status: "active" | "inactive";
  sortOrder: number | null;
}

export interface ListLabelsOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
}

export interface ListLabelsResult {
  data: KyriaLabel[];
  page: KyriaPage;
  requestId: string;
}

export async function listLabels(options: ListLabelsOptions = {}): Promise<ListLabelsResult> {
  return getKyria("/labels", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor }, { operacao: "listLabels", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

/** Pagina automaticamente todas as páginas de /labels, seguindo `page.nextCursor`. */
export async function listAllLabels(options: Omit<ListLabelsOptions, "cursor"> = {}): Promise<KyriaLabel[]> {
  const labels: KyriaLabel[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina = await listLabels({ ...options, cursor });
    labels.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return labels;
}

// ---------------------------------------------------------------------------
// GET /tickets/{ticketId}/labels
// ---------------------------------------------------------------------------

/** Etiqueta aplicada a um chamado. */
export interface KyriaTicketLabel {
  labelId: string;
  groupId: string | null;
  key: string;
  name: string;
  color: string | null;
  /** Epoch em milissegundos. */
  appliedAt: number | null;
}

/** Todas as etiquetas de UM chamado, seguindo `page.nextCursor`. */
export async function listAllTicketLabels(ticketId: string, o: { leitura?: LeituraKyria | null } = {}): Promise<KyriaTicketLabel[]> {
  const etiquetas: KyriaTicketLabel[] = [];
  let cursor: string | undefined;

  while (true) {
    const pagina: { data: KyriaTicketLabel[]; page: KyriaPage } = await getKyria(
      `/tickets/${encodeURIComponent(ticketId)}/labels`,
      { limit: LIMITE_MAXIMO_KYRIA, cursor },
      { operacao: "listTicketLabels", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: o.leitura }
    );
    etiquetas.push(...pagina.data);
    if (!pagina.page.hasMore || !pagina.page.nextCursor) break;
    cursor = pagina.page.nextCursor;
  }

  return etiquetas;
}

// ---------------------------------------------------------------------------
// GET /reports/hours?groupBy=ticket
// ---------------------------------------------------------------------------
//
// Diferente de /teams, /members, /customers, /tickets: NÃO é coleção cursor-paginada — é um
// relatório agregado, a resposta inteira já vem numa chamada só (`data.rows`), sem `page`. Exige
// `from`/`to`/`groupBy` (sem default). Testado ao vivo (22/09/2026): a API responde 503 "Time
// reporting data is not ready" pra boa parte do calendário fora de uma janela recente estreita —
// ver comentário de KyriaTicketHours no schema.prisma. Com retry em 429 (igual list*): job
// agendado de verdade agora, não só preview manual do getKyriaSample.

export interface KyriaHoursReportRow {
  group: { type: "ticket"; id: string; code: string | null; title: string };
  minutes: number;
}

// groupBy=customer (recurso #17): `group` traz `name` no lugar de `code`/`title`.
export interface KyriaCustomerHoursReportRow {
  // `id` null = horas de ticket sem cliente (visto ao vivo, 24/09/2026).
  group: { type: "customer"; id: string | null; name: string | null };
  minutes: number;
}

export interface GetHoursReportOptions<G extends "ticket" | "customer" = "ticket"> {
  leitura?: LeituraKyria | null;
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD */
  to: string;
  groupBy: G;
}

export interface GetHoursReportResult<Row = KyriaHoursReportRow> {
  data: { rows: Row[]; totalMinutes: number };
  meta: Record<string, unknown>;
  requestId: string;
}

export async function getHoursReport(options: GetHoursReportOptions<"ticket">): Promise<GetHoursReportResult>;
export async function getHoursReport(
  options: GetHoursReportOptions<"customer">
): Promise<GetHoursReportResult<KyriaCustomerHoursReportRow>>;
export async function getHoursReport(options: GetHoursReportOptions<"ticket" | "customer">): Promise<GetHoursReportResult<any>> {
  return getKyria("/reports/hours", { from: options.from, to: options.to, groupBy: options.groupBy }, { operacao: "getHoursReport", tentativasMax: TENTATIVAS_RATE_LIMIT, esperaPadraoS: 5, leitura: options.leitura });
}

// ---------------------------------------------------------------------------
// GET /time-entries — feed de mudanças dos apontamentos de hora do workspace inteiro
// ---------------------------------------------------------------------------
// NÃO é `GET /tickets/{id}/time-entries` (esse só devolve apontamentos MANUAIS, ~1,4% das horas —
// conferido ao vivo em 17/11/2026: 644 de 45.919 min em 1–16/11). O feed traz os dois tipos
// (`automatic` e `manual`), com início/fim reais, e funciona com o token atual (escopo
// time_entries:read, o mesmo do /reports/hours).
//
// Cada item é uma MUDANÇA, não um apontamento: a mesma `entryId` aparece várias vezes (uma por
// revisão — 75 mil mudanças pra 42 mil apontamentos na carga inicial) e uma exclusão chega como
// `kind: "deleted"` com `tombstone`. Quem consome aplica as mudanças em ordem. Ordenação e
// continuidade: `page.nextCursor` (opaco, `tef_v1.<id>.<posição>`) vale também quando
// `hasMore` é false — guardá-lo e reenviá-lo depois devolve só o que mudou desde então.
// Volume da carga inicial: ~75 mil mudanças = ~100 páginas de 750 (com 60 req/min, ~2 minutos de requisições em vez de ~8).

export interface KyriaTimeEntrySnapshot {
  ticketId: string;
  teamId: string | null;
  targetUserId: string | null;
  source: "automatic" | "manual";
  /** true = cronômetro ainda rodando; `endedAt`/`elapsedMinutes` vêm null. */
  isOpen: boolean;
  /** Epoch em milissegundos. */
  startedAt: number;
  endedAt: number | null;
  elapsedMinutes: number | null;
  effectiveAt: number;
  reason: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type KyriaTimeEntryChange =
  | { changeId: string; entryId: string; kind: "upsert"; syncRevision: number; changedAt: number; entry: KyriaTimeEntrySnapshot }
  | {
      changeId: string;
      entryId: string;
      kind: "deleted";
      syncRevision: number;
      changedAt: number;
      tombstone: { ticketId: string; deletedAt: number };
    };

export interface ListTimeEntryChangesOptions {
  /** Leitura registrada em que esta chamada acontece (ver registroLeitura.ts); sem ela, nada é gravado. */
  leitura?: LeituraKyria | null;
  limit?: number;
  cursor?: string;
}

export interface ListTimeEntryChangesResult {
  data: KyriaTimeEntryChange[];
  page: KyriaPage;
  requestId: string;
}

export async function listTimeEntryChanges(options: ListTimeEntryChangesOptions = {}): Promise<ListTimeEntryChangesResult> {
  return getKyria("/time-entries", { limit: options.limit ?? LIMITE_MAXIMO_KYRIA, cursor: options.cursor }, { operacao: "listTimeEntryChanges", tentativasMax: TENTATIVAS_RATE_LIMIT_FEED, esperaPadraoS: 10, leitura: options.leitura });
}

// ---------------------------------------------------------------------------
// Preview genérico — usado só pelo workflow de Mapeamento de Campos (kyria/fieldPreview.ts),
// nunca por um job de sync agendado.
// ---------------------------------------------------------------------------

/**
 * GET genérico contra qualquer path do Kyria, sem tipar a resposta — usado exclusivamente pra
 * pré-visualizar uma amostra antes de um endpoint virar um `listX`/`listAllX` de verdade.
 *
 * Sem retry em 429 (diferente de `listTeams`): é uma chamada isolada, disparada manualmente por
 * um admin, não um job agendado tentando terminar sozinho — se bater rate limit, o erro sobe na
 * hora e a pessoa tenta de novo quando quiser, não faz sentido travar a tela esperando.
 */
export async function getKyriaSample(path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const { baseUrl, token } = kyriaConfig();

  try {
    const response = await axios.get(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 20000,
    });
    return response.data;
  } catch (erro) {
    throw new Error(mensagemDeFalhaKyria(erro, `preview ${path}`));
  }
}
