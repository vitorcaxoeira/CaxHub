import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { EntidadeAuditoriaTipo, EventoAuditoriaTipo, OrigemAuditoria } from "./taxonomia";

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

// NÃO executa nada — só monta a operação Prisma pronta pra entrar num array de
// `prisma.$transaction([...])`, o mesmo padrão já usado em
// backend/src/routes/atividades.ts (PATCH /:id/mover). O projeto usa "array de
// operações" (não callback `(tx) => {...}`), então quem chama monta o array e decide
// quando executar — não existe aqui uma função que "recebe a transação ativa".
export function criarEventoAuditoria(evento: NovoEventoAuditoria): Prisma.PrismaPromise<unknown> {
  return prisma.auditEvento.create({
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
