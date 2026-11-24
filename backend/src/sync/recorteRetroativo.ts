// Recorte retroativo — Fase 5 (última) do plano de filtros na importação
// (~/.claude/plans/se-liga-na-necessidade-resilient-lark.md, seção G). A armadilha que a
// decisão 1 (filtro vale também no cron) abre: estreitar um filtro DEPOIS que o espelho já
// tem linhas fora do novo recorte deixa essas linhas órfãs — elas nunca mais aparecem numa
// consulta ao Senior (a query já vem filtrada), e como a varredura de removidos (Fase 3/F)
// também fica escopada pelo mesmo filtro, elas ficam FORA do escopo da varredura também.
// Resultado: nunca detectadas como removidas, mas continuam vivas e visíveis em toda tela do
// CaxHub que lê aquela tabela — o pior dos dois mundos. Este módulo existe pra isso nunca
// acontecer em silêncio: quem salva um filtro (rota, não o job agendado) precisa ver quantas
// linhas locais sairiam do recorte ANTES de confirmar, e escolher o que fazer.
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import type { SyncJobDescriptor } from "./registry";

// Acesso dinâmico ao model Prisma certo a partir da tabela LOCAL (o `@@map`, já usado
// pelo catálogo de campos da Fase 2) — sem isso, precisaria de mais um mapa de 44 entradas
// mantido à mão (mesmo argumento da Fase 4 pra preferir derivar de `Prisma.dmmf` a duplicar).
// `as unknown as Record<string, ...>`: TypeScript não tem como tipar "uma propriedade cujo
// nome só existe em runtime" — o preço de generalizar pros 44 models é perder o tipo exato
// do `where` aqui (mesma troca que `varrerRemovidos<T>` evita fazendo o CALLER informar T;
// aqui o call site não sabe qual job vai chegar, então não tem T pra informar). Exportada
// (10/09/2026) porque `sync/registry.ts` passou a precisar do mesmo truque pra
// `contarRemovidos`/`listarRemovidos` genéricos — reaproveitada, não duplicada.
export function delegatePorTabelaLocal(tabelaLocal: string): {
  count: (args: { where: unknown }) => Promise<number>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
  findMany: (args: { where: unknown; orderBy?: unknown; take?: number }) => Promise<Record<string, unknown>[]>;
} {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === tabelaLocal);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${tabelaLocal}".`);
  const nomeDelegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
  const delegate = (prisma as unknown as Record<string, unknown>)[nomeDelegate];
  if (!delegate) throw new Error(`prisma.${nomeDelegate} não existe (esperado pra tabela "${tabelaLocal}").`);
  return delegate as ReturnType<typeof delegatePorTabelaLocal>;
}

/** Nomes das colunas de PK (simples ou composta) do model Prisma da tabela local, via
 * `Prisma.dmmf` — mesmo mecanismo de `delegatePorTabelaLocal`. Usado por
 * `listarRemovidosGenerico` (registry.ts) pra montar uma `chave` legível sem mapa mantido à
 * mão por tabela. */
export function pkFieldsDoModel(tabelaLocal: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === tabelaLocal);
  if (!model) throw new Error(`Model Prisma não encontrado pra tabela local "${tabelaLocal}".`);
  if (model.primaryKey?.fields?.length) return [...model.primaryKey.fields];
  return model.fields.filter((f) => f.isId).map((f) => f.name);
}

function delegateDoJob(job: SyncJobDescriptor): ReturnType<typeof delegatePorTabelaLocal> {
  return delegatePorTabelaLocal(job.tabelaLocal);
}

/** true só nos models que têm a coluna `removidoEmSenior` (carimbo de varrerRemovidos.ts) —
 * depois da leva de 10/09/2026, todas as 44 tabelas espelho do Senior. Continua exportada e
 * checada em vez de assumir "sempre true": é o que impede o seletor de modo na tela de
 * aparecer disponível numa tabela cuja coluna, por algum motivo futuro, não exista. */
export function suportaMarcarRemovido(job: SyncJobDescriptor): boolean {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === job.tabelaLocal);
  return !!model?.fields.some((f) => f.name === "removidoEmSenior");
}

export interface DiagnosticoRecorte {
  // Quantas linhas locais deixariam de bater com o filtro novo — o "órfão" que a Fase 5
  // existe pra não deixar passar em silêncio. `null` = não deu pra calcular (o filtro não é
  // escopável localmente, ver Fase 3/seção F — sem `escopoLocal` não tem contra o que contar).
  linhasQueSaem: number | null;
  suportaMarcar: boolean;
}

/**
 * Conta quantas linhas HOJE espelhadas localmente ficariam fora do recorte se `escopoLocal`
 * (o `where` do Prisma equivalente ao filtro novo, já resolvido por filtrosAtivos.ts) fosse
 * aplicado. Chamado ANTES de salvar — nunca depois, quando já seria tarde.
 */
export async function diagnosticarRecorte(
  job: SyncJobDescriptor,
  escopoLocalNovo: Record<string, unknown> | null
): Promise<DiagnosticoRecorte> {
  const suportaMarcar = suportaMarcarRemovido(job);
  if (escopoLocalNovo === null || Object.keys(escopoLocalNovo).length === 0) {
    // Sem escopo local (filtro não espelhável) ou filtro vazio (removendo o filtro, nunca
    // estreita) — não tem retroatividade pra diagnosticar.
    return { linhasQueSaem: null, suportaMarcar };
  }
  const delegate = delegateDoJob(job);
  const linhasQueSaem = await delegate.count({ where: { NOT: escopoLocalNovo } });
  return { linhasQueSaem, suportaMarcar };
}

/**
 * Marca como removidas (nunca apaga — mesma regra de sempre, ver
 * [[deteccao-exclusao-sem-apagar-sempre-simular]] no segundo cérebro) as linhas que saem do
 * recorte. `removidoEmSenior: null` no `where` evita retocar quem já estava marcado (conta
 * só o que foi marcado NESTA chamada, não o total já fora). Só chamar depois de
 * `suportaMarcarRemovido(job)` confirmar que a coluna existe.
 */
export async function marcarOrfaosDoRecorte(job: SyncJobDescriptor, escopoLocalNovo: Record<string, unknown>): Promise<number> {
  const delegate = delegateDoJob(job);
  const resultado = await delegate.updateMany({
    where: { AND: [{ NOT: escopoLocalNovo }, { removidoEmSenior: null }] },
    data: { removidoEmSenior: new Date() },
  });
  return resultado.count;
}
