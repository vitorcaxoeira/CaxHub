// Resumo por coluna no rodapé das listas (28/10/2026, pedido do Vitor): soma, média, contagem... com as funções que fazem sentido para o
// tipo da coluna, sobre TODAS as linhas do filtro (não só a página). Mesma lista de funções da tela (frontend/src/components/colunas/
// resumo.ts) e a mesma regra: vazio não conta. O SQL de cada função recebe a expressão da coluna já calculada na subconsulta da lista.
import { Prisma } from "@prisma/client";
import type { TipoColuna } from "./filtroColunaLocal";

export type FuncaoResumo = "soma" | "media" | "minimo" | "maximo" | "mediana" | "contagem" | "distintos" | "vazios" | "sim" | "nao" | "pctSim";

const POR_TIPO: Record<TipoColuna, FuncaoResumo[]> = {
  inteiro: ["soma", "media", "minimo", "maximo", "mediana", "contagem", "distintos"],
  decimal: ["soma", "media", "minimo", "maximo", "mediana", "contagem", "distintos"],
  texto: ["contagem", "distintos", "vazios"],
  data: ["minimo", "maximo", "contagem"],
  booleano: ["sim", "nao", "pctSim"],
  json: [],
};

export const FUNCOES_RESUMO = new Set<FuncaoResumo>(["soma", "media", "minimo", "maximo", "mediana", "contagem", "distintos", "vazios", "sim", "nao", "pctSim"]);
export const MAX_PEDIDOS_RESUMO = 40;

export interface PedidoResumo {
  coluna: string;
  funcao: FuncaoResumo;
}

/** Pedidos de resumo da tela (`[{coluna, funcao}]`), conferidos contra as colunas da lista e o tipo de cada uma. Lança Error em português. */
export function validarPedidosResumo(colunas: { nome: string; tipo: TipoColuna }[], bruto: unknown): PedidoResumo[] {
  if (bruto === undefined || bruto === null || bruto === "") return [];
  if (!Array.isArray(bruto)) throw new Error("Resumo inválido.");
  if (bruto.length > MAX_PEDIDOS_RESUMO) throw new Error("Resumos demais.");
  const porNome = new Map(colunas.map((c) => [c.nome, c]));
  const vistos = new Set<string>();
  return bruto.map((p) => {
    if (!p || typeof p !== "object") throw new Error("Resumo inválido.");
    const { coluna, funcao } = p as Record<string, unknown>;
    const c = typeof coluna === "string" ? porNome.get(coluna) : undefined;
    if (!c) throw new Error(`Coluna ${String(coluna)} não existe nesta lista.`);
    if (typeof funcao !== "string" || !FUNCOES_RESUMO.has(funcao as FuncaoResumo) || !POR_TIPO[c.tipo].includes(funcao as FuncaoResumo))
      throw new Error(`Resumo ${String(funcao)} não vale para a coluna ${c.nome}.`);
    const chave = `${c.nome}:${funcao}`;
    if (vistos.has(chave)) throw new Error("Resumo repetido.");
    vistos.add(chave);
    return { coluna: c.nome, funcao: funcao as FuncaoResumo };
  });
}

/** SQL agregado de uma função sobre `alvo` (a coluna já calculada na subconsulta). Vazio não conta, como na tela. */
export function sqlDoResumo(funcao: FuncaoResumo, alvo: Prisma.Sql, tipo: TipoColuna): Prisma.Sql {
  const texto = tipo === "texto";
  const preenchido = texto ? Prisma.sql`NULLIF(trim(${alvo}), '')` : alvo;
  switch (funcao) {
    case "soma":
      return Prisma.sql`sum(${alvo})`;
    case "media":
      return Prisma.sql`avg(${alvo})`;
    case "minimo":
      return Prisma.sql`min(${alvo})`;
    case "maximo":
      return Prisma.sql`max(${alvo})`;
    case "mediana":
      return Prisma.sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${alvo})`;
    case "contagem":
      return Prisma.sql`count(${preenchido})`;
    case "distintos":
      return texto ? Prisma.sql`count(DISTINCT lower(${preenchido}))` : Prisma.sql`count(DISTINCT ${alvo})`;
    case "vazios":
      return Prisma.sql`(count(*) - count(${preenchido}))`;
    case "sim":
      return Prisma.sql`count(*) FILTER (WHERE ${alvo})`;
    case "nao":
      return Prisma.sql`count(*) FILTER (WHERE NOT ${alvo})`;
    case "pctSim":
      return Prisma.sql`(100.0 * count(*) FILTER (WHERE ${alvo}) / NULLIF(count(${alvo}), 0))`;
  }
}

/** Valor do banco → o que vai para a tela: número, texto ISO (datas) ou null. */
export function valorDoResumo(v: unknown): number | string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && v !== null && "toNumber" in v) return (v as { toNumber: () => number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : String(v);
}
