import cron from "node-cron";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "../sync/upsertEmLote";
import { jobAtivo } from "./jobAtivo";
import { runKyriaTicketsSync } from "./ticketsSync";
import { LIMITE_MAXIMO_KYRIA, listTimeEntryChanges, KyriaTimeEntryChange, KyriaTimeEntrySnapshot } from "./client";
import { abrirLeitura, LeituraKyria } from "./registroLeitura";

export const JOB_NAME = "kyria-time-entries-sync";
// Depois de tickets (5:30) e de membros (FKs de kyria_time_entries) e depois dos relatórios de
// horas (5:45 e 6:00) — o feed é a fonte detalhada, os relatórios continuam sendo a conferência.
export const CRON_EXPR = "15 6 * * *";

const TAMANHO_PAGINA = LIMITE_MAXIMO_KYRIA;
// Quantas páginas juntar antes de gravar e guardar o cursor. 3 × 750 = 2.250 mudanças por bloco:
// uma falha no meio da carga inicial (~75 mil mudanças) só perde o bloco em andamento,
// e o job retoma do último cursor salvo.
//
// Apontamento de ticket que ainda não existe localmente (ticket criado depois do último sync de
// tickets) fica PENDENTE; no fim da execução o job sincroniza os tickets e regrava só os
// pendentes — o cursor já passou por eles, então sem isso se perderiam (achado na carga inicial de
// 17/11/2026: 1 apontamento). O que sobrar sem ticket aparece no log.
const PAGINAS_POR_BLOCO = 3;

const COLUNAS: ColunaUpsert[] = [
  { nome: "id", cast: "text" },
  { nome: "ticket_id", cast: "text" },
  { nome: "user_id", cast: "text" },
  { nome: "team_id", cast: "text" },
  { nome: "origem", cast: '"KyriaOrigemApontamento"' },
  { nome: "is_open", cast: "boolean" },
  { nome: "started_at", cast: "timestamptz" },
  { nome: "ended_at", cast: "timestamptz" },
  { nome: "minutes", cast: "numeric" },
  { nome: "effective_at", cast: "timestamptz" },
  { nome: "reason", cast: "text" },
  { nome: "criado_em_kyria", cast: "timestamptz" },
  { nome: "alterado_em_kyria", cast: "timestamptz" },
  { nome: "sincronizado_em", cast: "timestamptz" },
];

export interface ResultadoBloco {
  gravadas: number;
  apagadas: number;
  puladasSemTicket: number;
}

/**
 * Reduz as mudanças do bloco a UMA por apontamento: a última na ordem do feed. Conferido nos
 * dados reais (17/11/2026): dentro de cada apontamento a ordem do feed é sempre a da revisão
 * (`syncRevision` crescente) e a exclusão é sempre a última — então "a última vence" é exato.
 */
export function ultimaMudancaPorApontamento(mudancas: KyriaTimeEntryChange[]): KyriaTimeEntryChange[] {
  const porId = new Map<string, KyriaTimeEntryChange>();
  for (const mudanca of mudancas) porId.set(mudanca.entryId, mudanca);
  return [...porId.values()];
}

function isoOuNull(epoch: number | null): string | null {
  return epoch != null ? new Date(epoch).toISOString() : null;
}

export function valoresDoApontamento(
  entryId: string,
  e: KyriaTimeEntrySnapshot,
  userId: string | null,
  sincronizadoEm: string
): (string | null)[] {
  return [
    entryId,
    e.ticketId,
    userId,
    e.teamId,
    e.source,
    e.isOpen ? "true" : "false",
    new Date(e.startedAt).toISOString(),
    isoOuNull(e.endedAt),
    // Aberto (cronômetro rodando) não tem duração ainda: fica NULL em vez de 0, pra não
    // se confundir com um apontamento fechado de zero minuto.
    e.elapsedMinutes != null ? String(e.elapsedMinutes) : null,
    new Date(e.effectiveAt).toISOString(),
    e.reason,
    new Date(e.createdAt).toISOString(),
    new Date(e.updatedAt).toISOString(),
    sincronizadoEm,
  ];
}

type MudancaUpsert = Extract<KyriaTimeEntryChange, { kind: "upsert" }>;

/**
 * Grava um bloco de mudanças. `pendentes` (apontamento → última mudança que não pôde ser gravada
 * porque o ticket ainda não existe localmente) é atualizado aqui: toda entrada do bloco sai dele
 * (uma versão mais nova substitui a pendente — nunca gravar a antiga por cima) e as puladas entram.
 */
export async function gravarBloco(
  mudancas: KyriaTimeEntryChange[],
  sincronizadoEm: string,
  pendentes: Map<string, MudancaUpsert> = new Map()
): Promise<ResultadoBloco> {
  const finais = ultimaMudancaPorApontamento(mudancas);
  for (const m of finais) pendentes.delete(m.entryId);

  const idsApagar = finais.filter((m) => m.kind === "deleted").map((m) => m.entryId);
  const upserts = finais.filter((m): m is Extract<KyriaTimeEntryChange, { kind: "upsert" }> => m.kind === "upsert");

  // FKs reais: ticket é obrigatório (apontamento de ticket ainda não sincronizado é pulado e
  // contado no log — o `upsertEmLote` inteiro falharia com uma FK violada); usuário é opcional
  // (vira NULL se o membro ainda não sincronizou).
  const ticketIds = [...new Set(upserts.map((m) => m.entry.ticketId))];
  const userIds = [...new Set(upserts.map((m) => m.entry.targetUserId).filter((v): v is string => v != null))];
  const [tickets, membros] = await Promise.all([
    ticketIds.length ? prisma.kyriaTicket.findMany({ where: { id: { in: ticketIds } }, select: { id: true } }) : [],
    userIds.length ? prisma.kyriaMember.findMany({ where: { id: { in: userIds } }, select: { id: true } }) : [],
  ]);
  const ticketsExistentes = new Set(tickets.map((t) => t.id));
  const membrosExistentes = new Set(membros.map((m) => m.id));

  let puladasSemTicket = 0;
  const linhas: LinhaUpsert[] = [];
  for (const mudanca of upserts) {
    if (!ticketsExistentes.has(mudanca.entry.ticketId)) {
      puladasSemTicket++;
      pendentes.set(mudanca.entryId, mudanca);
      continue;
    }
    const userId = mudanca.entry.targetUserId != null && membrosExistentes.has(mudanca.entry.targetUserId) ? mudanca.entry.targetUserId : null;
    linhas.push({ chave: mudanca.entryId, valores: valoresDoApontamento(mudanca.entryId, mudanca.entry, userId, sincronizadoEm) });
  }

  const resultado = await upsertEmLote(linhas, { tabela: "kyria_time_entries", colunas: COLUNAS, colunasPk: ["id"] });
  let apagadas = 0;
  if (idsApagar.length > 0) {
    apagadas = (await prisma.kyriaTimeEntry.deleteMany({ where: { id: { in: idsApagar } } })).count;
  }
  return { gravadas: resultado.linhasProcessadas, apagadas, puladasSemTicket };
}

// Trava de reentrada: a carga inicial leva ~8 min — um "Sincronizar agora" no meio dela (ou o
// cron batendo na carga ainda em andamento) leria o mesmo feed em paralelo e disputaria o
// limite de 60 req/min da chave.
let emExecucao = false;

export async function runKyriaTimeEntriesSync(): Promise<void> {
  if (!(await jobAtivo(JOB_NAME))) return;
  if (emExecucao) return;
  emExecucao = true;

  const inicio = new Date();
  let query = "GET /time-entries";
  let leitura: LeituraKyria | null = null;
  try {
    const salvo = await prisma.kyriaSyncCursor.findUnique({ where: { jobName: JOB_NAME } });
    let cursor: string | undefined = salvo?.cursor;
    const cargaInicial = cursor === undefined;
    query = `GET /time-entries${cursor ? " (incremental)" : " (carga inicial)"}`;
    leitura = await abrirLeitura({ jobName: JOB_NAME, recurso: "/time-entries", limite: TAMANHO_PAGINA });

    const sincronizadoEm = inicio.toISOString();
    const total: ResultadoBloco & { mudancas: number } = { mudancas: 0, gravadas: 0, apagadas: 0, puladasSemTicket: 0 };
    const pendentes = new Map<string, MudancaUpsert>();

    let temMais = true;
    while (temMais) {
      const bloco: KyriaTimeEntryChange[] = [];
      let ultimoCursor = cursor;
      for (let pagina = 0; pagina < PAGINAS_POR_BLOCO && temMais; pagina++) {
        const resposta = await listTimeEntryChanges({ limit: TAMANHO_PAGINA, cursor, leitura });
        bloco.push(...resposta.data);
        cursor = resposta.page.nextCursor ?? cursor;
        ultimoCursor = cursor;
        temMais = resposta.page.hasMore && !!resposta.page.nextCursor;
      }

      const r = await gravarBloco(bloco, sincronizadoEm, pendentes);
      total.mudancas += bloco.length;
      total.gravadas += r.gravadas;
      total.apagadas += r.apagadas;

      // Só depois de gravar o bloco: se cair antes, o próximo disparo relê este bloco (idempotente).
      if (ultimoCursor) {
        await prisma.kyriaSyncCursor.upsert({
          where: { jobName: JOB_NAME },
          create: { jobName: JOB_NAME, cursor: ultimoCursor },
          update: { cursor: ultimoCursor },
        });
      }
    }

    // Apontamento de ticket criado depois do último sync de tickets: o cursor já passou por ele,
    // então sem isto ele se perderia. Sincroniza os tickets agora (só quando há pendência) e
    // regrava só os pendentes; o que ainda assim não tiver ticket fica contado no log.
    let recuperados = 0;
    if (pendentes.size > 0) {
      await runKyriaTicketsSync();
      const aindaPendentes = new Map<string, MudancaUpsert>();
      const r = await gravarBloco([...pendentes.values()], sincronizadoEm, aindaPendentes);
      recuperados = r.gravadas;
      total.gravadas += r.gravadas;
      total.puladasSemTicket = aindaPendentes.size;
    }

    await leitura.finalizar("concluida");
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${total.mudancas} mudanças lidas → ${total.gravadas} apontamentos gravados, ${total.apagadas} apagados` +
          ` em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s${cargaInicial ? " (carga inicial)" : ""}` +
          (recuperados > 0 ? ` — ${recuperados} de ticket novo recuperados após novo sync de tickets` : "") +
          (total.puladasSemTicket > 0 ? ` — ${total.puladasSemTicket} pulados (ticket não existe no Kyria/localmente)` : ""),
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await leitura?.finalizar("falhou", error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  } finally {
    emExecucao = false;
  }
}

export function scheduleKyriaTimeEntriesSync(): void {
  cron.schedule(CRON_EXPR, runKyriaTimeEntriesSync);
}
