import axios from "axios";

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
  /** 1–100, default 50 (definido pelo serviço). */
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
  const { baseUrl, token } = kyriaConfig();

  for (let tentativa = 1; ; tentativa++) {
    try {
      const response = await axios.get(`${baseUrl}/teams`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: options.limit, cursor: options.cursor, status: options.status },
        timeout: 20000,
      });
      return response.data;
    } catch (erro) {
      const status = axios.isAxiosError(erro) ? erro.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS_RATE_LIMIT) {
        const retryAfter = Number(axios.isAxiosError(erro) && erro.response?.headers["retry-after"]) || 5;
        await esperar(retryAfter * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, "listTeams"));
    }
  }
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
  const { baseUrl, token } = kyriaConfig();

  for (let tentativa = 1; ; tentativa++) {
    try {
      const response = await axios.get(`${baseUrl}/members`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: options.limit, cursor: options.cursor, status: options.status },
        timeout: 20000,
      });
      return response.data;
    } catch (erro) {
      const status = axios.isAxiosError(erro) ? erro.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS_RATE_LIMIT) {
        const retryAfter = Number(axios.isAxiosError(erro) && erro.response?.headers["retry-after"]) || 5;
        await esperar(retryAfter * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, "listMembers"));
    }
  }
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
  const { baseUrl, token } = kyriaConfig();

  for (let tentativa = 1; ; tentativa++) {
    try {
      const response = await axios.get(`${baseUrl}/customers`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: options.limit, cursor: options.cursor, status: options.status },
        timeout: 20000,
      });
      return response.data;
    } catch (erro) {
      const status = axios.isAxiosError(erro) ? erro.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS_RATE_LIMIT) {
        const retryAfter = Number(axios.isAxiosError(erro) && erro.response?.headers["retry-after"]) || 5;
        await esperar(retryAfter * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, "listCustomers"));
    }
  }
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
  limit?: number;
  cursor?: string;
}

export interface ListTicketsResult {
  data: KyriaTicket[];
  page: KyriaPage;
  requestId: string;
}

export async function listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
  const { baseUrl, token } = kyriaConfig();

  for (let tentativa = 1; ; tentativa++) {
    try {
      const response = await axios.get(`${baseUrl}/tickets`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: options.limit, cursor: options.cursor },
        timeout: 20000,
      });
      return response.data;
    } catch (erro) {
      const status = axios.isAxiosError(erro) ? erro.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS_RATE_LIMIT) {
        const retryAfter = Number(axios.isAxiosError(erro) && erro.response?.headers["retry-after"]) || 5;
        await esperar(retryAfter * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, "listTickets"));
    }
  }
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
  limit?: number;
  cursor?: string;
}

export interface ListTicketStatusesResult {
  data: KyriaTicketStatus[];
  page: KyriaPage;
  requestId: string;
}

export async function listTicketStatuses(options: ListTicketStatusesOptions = {}): Promise<ListTicketStatusesResult> {
  const { baseUrl, token } = kyriaConfig();

  for (let tentativa = 1; ; tentativa++) {
    try {
      const response = await axios.get(`${baseUrl}/ticket-statuses`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: options.limit, cursor: options.cursor },
        timeout: 20000,
      });
      return response.data;
    } catch (erro) {
      const status = axios.isAxiosError(erro) ? erro.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS_RATE_LIMIT) {
        const retryAfter = Number(axios.isAxiosError(erro) && erro.response?.headers["retry-after"]) || 5;
        await esperar(retryAfter * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, "listTicketStatuses"));
    }
  }
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
  const { baseUrl, token } = kyriaConfig();

  for (let tentativa = 1; ; tentativa++) {
    try {
      const response = await axios.get(`${baseUrl}/reports/hours`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { from: options.from, to: options.to, groupBy: options.groupBy },
        timeout: 20000,
      });
      return response.data;
    } catch (erro) {
      const status = axios.isAxiosError(erro) ? erro.response?.status : undefined;
      if (status === 429 && tentativa < TENTATIVAS_RATE_LIMIT) {
        const retryAfter = Number(axios.isAxiosError(erro) && erro.response?.headers["retry-after"]) || 5;
        await esperar(retryAfter * 1000);
        continue;
      }
      throw new Error(mensagemDeFalhaKyria(erro, "getHoursReport"));
    }
  }
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
