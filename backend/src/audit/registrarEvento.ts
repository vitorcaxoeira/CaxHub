import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { EntidadeAuditoriaTipo, EVENTOS_AUDITORIA, EventoAuditoriaTipo, OrigemAuditoria } from "./taxonomia";

export interface DiffEntry {
  de: unknown;
  para: unknown;
}

export interface DiffResultado {
  alteracoes: Record<string, DiffEntry>;
  algumaMudanca: boolean;
}

// Serializa Decimal/BigInt/Date/null pra string comparável — usado só pra decidir "mudou
// ou não", nunca como o valor gravado (esse continua sendo o valor original em `alteracoes`).
function normalizar(valor: unknown): string {
  if (valor === null || valor === undefined) return "null";
  if (valor instanceof Date) return valor.toISOString();
  return String(valor); // cobre BigInt, Decimal (toString customizado), number, string
}

// Normaliza `undefined` para `null` só para fins de comparação em `diffCampos` — usar
// no objeto de entrada do diff, nunca no objeto passado pro Prisma: pro Prisma,
// `undefined` num `update` significa "não mexer nesse campo", enquanto `null` significa
// "limpar o campo" — são coisas diferentes, e diffCampos não deve mudar esse contrato.
export function paraDiff<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([chave, valor]) => [chave, valor === undefined ? null : valor]));
}

// Compara `antes` (null = registro novo) com `depois`, campo a campo, só pra chaves
// presentes na whitelist. Datas/BigInt/Decimal são comparados por valor, não por
// referência (comparar com `===` direto dá falso-positivo de "mudou" nesses tipos).
export function diffCampos<T extends Record<string, unknown>>(
  whitelist: Record<string, string>,
  antes: T | null,
  depois: T
): DiffResultado {
  const alteracoes: Record<string, DiffEntry> = {};
  for (const campo of Object.keys(whitelist)) {
    const valorAntes = antes ? (antes[campo] ?? null) : null;
    const valorDepois = depois[campo] ?? null;
    if (normalizar(valorAntes) !== normalizar(valorDepois)) {
      alteracoes[campo] = { de: valorAntes, para: valorDepois };
    }
  }
  return { alteracoes, algumaMudanca: Object.keys(alteracoes).length > 0 };
}

// Classifica a mudança de UM campo de data: sem mudança, "incluida" (null -> valor) ou
// "alterada" (valor -> outro valor) — usado pelos eventos DATA_INCLUIDA/DATA_ALTERADA,
// que são por campo, diferente de diffCampos (que agrega vários campos num evento só).
export type MudancaData = "sem_mudanca" | "incluida" | "alterada";
export function classificarMudancaData(antes: Date | null, depois: Date | null): MudancaData {
  const antesStr = antes ? antes.toISOString() : null;
  const depoisStr = depois ? depois.toISOString() : null;
  if (antesStr === depoisStr) return "sem_mudanca";
  if (antesStr === null) return "incluida";
  return "alterada";
}

export interface NovoEventoAuditoria {
  origem: OrigemAuditoria;
  usuarioId?: number | null;
  codemp?: number | null;
  codpro?: number | null;
  entidadeTipo: EntidadeAuditoriaTipo;
  entidadeId: string;
  entidadeRotulo?: string | null;
  eventoTipo: EventoAuditoriaTipo;
  alteracoes?: Record<string, DiffEntry> | null;
  metadata?: Record<string, unknown> | null;
  correlationId: string;
}

// Client aceito por criarEventoAuditoria: o `prisma` global (default, pro padrão de
// "array de operações" já usado no projeto — ver atividades.ts PATCH /:id/mover) ou um
// `tx` de transação interativa (`prisma.$transaction(async (tx) => {...})`) — só
// necessário quando o evento depende de um id gerado por OUTRA operação da mesma
// transação (ex.: criar uma alocação nova, cujo id só existe depois do insert).
type PrismaOuTx = Pick<typeof prisma, "auditEvento">;

// Por padrão NÃO executa nada — só monta a operação Prisma pronta pra entrar num array
// de `prisma.$transaction([...])`. Quando chamado com um `tx` (transação interativa),
// executa e resolve imediatamente dentro dela.
export function criarEventoAuditoria(evento: NovoEventoAuditoria, client: PrismaOuTx = prisma): Prisma.PrismaPromise<unknown> {
  return client.auditEvento.create({
    data: {
      origem: evento.origem,
      usuarioId: evento.usuarioId ?? null,
      codemp: evento.codemp ?? null,
      codpro: evento.codpro ?? null,
      entidadeTipo: evento.entidadeTipo,
      entidadeId: evento.entidadeId,
      entidadeRotulo: evento.entidadeRotulo ?? null,
      eventoTipo: evento.eventoTipo,
      alteracoes: evento.alteracoes ? (evento.alteracoes as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      metadata: evento.metadata ? (evento.metadata as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      correlationId: evento.correlationId,
    },
  });
}

export type ContextoEventoData = Omit<NovoEventoAuditoria, "eventoTipo" | "alteracoes" | "metadata">;

// Gera 0..N operações de DATA_INCLUIDA/DATA_ALTERADA, uma por campo de `campos` que
// realmente mudou entre `antes` e `depois` — cada campo é avaliado (e vira evento)
// individualmente, ao contrário de diffCampos (que agrega tudo num único evento).
// Usado por qualquer rota que escreva dataPrevistaInicio/dataPrevistaFim de uma
// atividade (alocacao.ts e atividades.ts) — evita duplicar essa lógica nos dois lugares.
export function criarEventosDeData(
  campos: Record<string, string>,
  antes: Record<string, Date | null>,
  depois: Record<string, Date | null>,
  ctx: ContextoEventoData,
  client: PrismaOuTx = prisma
): Prisma.PrismaPromise<unknown>[] {
  const operacoes: Prisma.PrismaPromise<unknown>[] = [];
  for (const [campo, rotulo] of Object.entries(campos)) {
    const valorAntes = antes[campo] ?? null;
    const valorDepois = depois[campo] ?? null;
    const mudanca = classificarMudancaData(valorAntes, valorDepois);
    if (mudanca === "sem_mudanca") continue;
    operacoes.push(
      criarEventoAuditoria(
        {
          ...ctx,
          eventoTipo: mudanca === "incluida" ? EVENTOS_AUDITORIA.DATA_INCLUIDA : EVENTOS_AUDITORIA.DATA_ALTERADA,
          alteracoes: { [campo]: { de: valorAntes, para: valorDepois } },
          metadata: { campo: rotulo },
        },
        client
      )
    );
  }
  return operacoes;
}
