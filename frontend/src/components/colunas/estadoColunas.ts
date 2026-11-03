import type { FiltroColuna, OperadorColuna } from "./FiltroColunaServidor";

// Estado de filtro e ordenação por coluna das tabelas (24/10/2026): como ele vai e volta pela URL (`?f=` filtros em JSON, `?o=` ordem em
// `coluna:desc,outra`) e como o clique no cabeçalho muda a ordem. Funções PURAS, com teste. A mesma regra vale no servidor
// (backend/src/sync/ordemColuna.ts), que revalida tudo: o que vem da URL nunca é confiado.

export type Direcao = "asc" | "desc";

export interface OrdemColuna {
  coluna: string;
  direcao: Direcao;
}

export const MAX_ORDEM = 4;

/** Lê `?f=`: lista de filtros. Texto inválido vira "sem filtro" (a URL pode ter sido editada à mão). */
export function lerFiltros(bruto: string | null): FiltroColuna[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (f): f is FiltroColuna => !!f && typeof f.coluna === "string" && typeof f.operador === "string" && Array.isArray(f.valores) && f.valores.every((x: unknown) => typeof x === "string"),
    );
  } catch {
    return [];
  }
}

/** Lê `?o=`: ordem. Parte inválida, coluna repetida e excesso são descartados em silêncio. */
export function lerOrdem(bruto: string | null): OrdemColuna[] {
  if (!bruto) return [];
  const vistas = new Set<string>();
  const ordem: OrdemColuna[] = [];
  for (const parte of bruto.split(",")) {
    const [coluna, dir = "asc", resto] = parte.trim().split(":");
    if (!coluna || resto !== undefined || (dir !== "asc" && dir !== "desc") || vistas.has(coluna)) continue;
    vistas.add(coluna);
    ordem.push({ coluna, direcao: dir });
    if (ordem.length === MAX_ORDEM) break;
  }
  return ordem;
}

export function ordemParaTexto(ordem: OrdemColuna[]): string {
  return ordem.map((o) => `${o.coluna}:${o.direcao}`).join(",");
}

/**
 * O que o clique no cabeçalho de `coluna` faz. Sem Shift: a coluna vira o ÚNICO critério, alternando crescente → decrescente → sem
 * ordem. Com Shift: soma a coluna aos critérios existentes (ou alterna a direção dela, e a tira depois do decrescente), até MAX_ORDEM.
 */
export function proximaOrdem(ordem: OrdemColuna[], coluna: string, aditivo: boolean): OrdemColuna[] {
  const atual = ordem.find((o) => o.coluna === coluna);
  if (!aditivo) {
    if (!atual || ordem.length > 1) return [{ coluna, direcao: "asc" }];
    return atual.direcao === "asc" ? [{ coluna, direcao: "desc" }] : [];
  }
  if (!atual) return ordem.length >= MAX_ORDEM ? ordem : [...ordem, { coluna, direcao: "asc" }];
  if (atual.direcao === "asc") return ordem.map((o) => (o.coluna === coluna ? { ...o, direcao: "desc" as const } : o));
  return ordem.filter((o) => o.coluna !== coluna);
}

/** Direção e prioridade (1, 2...) de uma coluna na ordem atual; null se ela não está na ordem. */
export function posicaoNaOrdem(ordem: OrdemColuna[], coluna: string): { direcao: Direcao; prioridade: number } | null {
  const i = ordem.findIndex((o) => o.coluna === coluna);
  return i < 0 ? null : { direcao: ordem[i].direcao, prioridade: i + 1 };
}

/** Valor de `aria-sort` do `<th>`. */
export function ariaSort(ordem: OrdemColuna[], coluna: string): "ascending" | "descending" | "none" {
  const p = posicaoNaOrdem(ordem, coluna);
  return !p ? "none" : p.direcao === "asc" ? "ascending" : "descending";
}

// ---- chip de um filtro ativo ---------------------------------------------------------------------------------------------------

const ROTULO_CHIP: Record<OperadorColuna, string> = {
  "=": "=",
  "≠": "≠",
  IN: "em",
  "≥": "≥",
  "≤": "≤",
  entre: "entre",
  contém: "contém",
  "começa com": "começa com",
  vazio: "vazio",
  "não vazio": "não vazio",
};

/** O mínimo que o chip precisa saber da coluna (rótulo do domínio, formato da data e do booleano). */
export interface ColunaDoChip {
  tipo: string;
  dominio?: { valor: string; rotulo: string }[];
  /** Nome mostrado no lugar do nome técnico, se a tela tem outro (ex.: "Cód. ERP"). */
  titulo?: string;
}

/** Texto do chip: "datlct entre 01/01/2026 e 31/03/2026". */
export function textoDoChip(f: FiltroColuna, coluna: ColunaDoChip | undefined): string {
  const fmt = (v: string) => {
    const op = coluna?.dominio?.find((o) => o.valor === v);
    if (op) return `${op.valor} · ${op.rotulo}`;
    if (coluna?.tipo === "data" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
    if (coluna?.tipo === "booleano") return v === "true" ? "sim" : "não";
    return v;
  };
  const vals =
    f.operador === "entre"
      ? `${fmt(f.valores[0])} e ${fmt(f.valores[1])}`
      : f.operador === "IN"
        ? f.valores.length > 3
          ? `${f.valores.slice(0, 3).map(fmt).join(", ")} +${f.valores.length - 3}`
          : f.valores.map(fmt).join(", ")
        : f.valores.map(fmt).join("");
  return `${coluna?.titulo ?? f.coluna} ${ROTULO_CHIP[f.operador]}${vals ? ` ${vals}` : ""}`;
}
