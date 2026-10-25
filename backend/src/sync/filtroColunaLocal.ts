// Filtro por coluna das telas "Ver dados" e "Removidos" (Administração > Importados do ERP/HCM), 21/10/2026, pedido do Vitor: funil em
// cada coluna com operador e valor, aplicado NO SERVIDOR, para qualquer tamanho de tabela. Diferente do filtro da sincronização
// (filtroSenior.ts), que valida contra o dicionário do Senior e vira SQL da origem: aqui o filtro é sobre as colunas do ESPELHO LOCAL
// e vira `where` do Prisma. Funções puras (sem banco), para o teste cobrir validação e montagem.

export type OperadorColuna = "=" | "≠" | "IN" | "≥" | "≤" | "entre" | "contém" | "começa com" | "vazio" | "não vazio";

export type TipoColuna = "texto" | "inteiro" | "decimal" | "data" | "booleano" | "json";

/** O que a validação precisa saber de uma coluna. `prisma` é o tipo do schema (Int, BigInt, Decimal, DateTime, String, Boolean...). */
export interface ColunaFiltravel {
  nome: string;
  tipo: TipoColuna;
  obrigatoria: boolean;
  prisma: string;
}

export interface FiltroColuna {
  coluna: string;
  operador: OperadorColuna;
  valores: string[];
}

const OPERADORES_POR_TIPO: Record<TipoColuna, OperadorColuna[]> = {
  texto: ["=", "≠", "IN", "contém", "começa com"],
  inteiro: ["=", "≠", "IN", "≥", "≤", "entre"],
  decimal: ["=", "≠", "≥", "≤", "entre"],
  data: ["=", "≥", "≤", "entre"],
  booleano: ["="],
  json: [],
};

/** Operadores que a coluna aceita (com "vazio"/"não vazio" quando ela aceita nulo). Também usado pela tela, via resposta da API. */
export function operadoresDaColuna(c: Pick<ColunaFiltravel, "tipo" | "obrigatoria">): OperadorColuna[] {
  const base = OPERADORES_POR_TIPO[c.tipo] ?? [];
  if (base.length === 0) return [];
  return c.obrigatoria ? base : [...base, "vazio", "não vazio"];
}

const MAX_VALORES_IN = 500;
const MAX_FILTROS = 20;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function quantosValores(operador: OperadorColuna): number | "lista" {
  if (operador === "vazio" || operador === "não vazio") return 0;
  if (operador === "entre") return 2;
  if (operador === "IN") return "lista";
  return 1;
}

function valorValido(c: ColunaFiltravel, v: string): boolean {
  switch (c.tipo) {
    case "inteiro":
      return c.prisma === "BigInt" ? /^-?\d{1,18}$/.test(v) : /^-?\d{1,9}$/.test(v);
    case "decimal":
      return /^-?\d+(\.\d+)?$/.test(v);
    case "data":
      return DATA_ISO.test(v) && !Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime());
    case "booleano":
      return v === "true" || v === "false";
    default:
      return v.length > 0 && v.length <= 200;
  }
}

/**
 * Valida o que veio da tela. Lança Error com mensagem em português no primeiro problema (a rota devolve 400). Valores chegam como
 * texto: número com ponto decimal, data AAAA-MM-DD, booleano "true"/"false".
 */
export function validarFiltrosColuna(colunas: ColunaFiltravel[], bruto: unknown): FiltroColuna[] {
  if (bruto == null || bruto === "") return [];
  const lista = Array.isArray(bruto) ? bruto : null;
  if (!lista) throw new Error("Filtros inválidos.");
  if (lista.length > MAX_FILTROS) throw new Error(`No máximo ${MAX_FILTROS} filtros por vez.`);
  return lista.map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    const coluna = colunas.find((c) => c.nome === f.coluna);
    if (!coluna) throw new Error(`Coluna "${String(f.coluna)}" não existe nesta tabela.`);
    const operadores = operadoresDaColuna(coluna);
    if (operadores.length === 0) throw new Error(`A coluna "${coluna.nome}" não tem filtro.`);
    const operador = f.operador as OperadorColuna;
    if (!operadores.includes(operador)) throw new Error(`O operador "${String(f.operador)}" não vale para a coluna "${coluna.nome}".`);
    const valores = Array.isArray(f.valores) ? f.valores.map((v) => String(v).trim()) : [];
    const esperado = quantosValores(operador);
    if (esperado === "lista") {
      if (valores.length === 0) throw new Error(`Informe ao menos um valor para "${coluna.nome}".`);
      if (valores.length > MAX_VALORES_IN) throw new Error(`No máximo ${MAX_VALORES_IN} valores em "${coluna.nome}".`);
    } else if (valores.length !== esperado) {
      throw new Error(esperado === 2 ? `"${coluna.nome}": informe o início e o fim.` : `"${coluna.nome}": informe o valor.`);
    }
    const invalido = valores.find((v) => !valorValido(coluna, v));
    if (invalido !== undefined) {
      const formato = coluna.tipo === "data" ? " (use AAAA-MM-DD)" : coluna.tipo === "inteiro" || coluna.tipo === "decimal" ? " (use número)" : "";
      throw new Error(`Valor "${invalido}" inválido para "${coluna.nome}"${formato}.`);
    }
    return { coluna: coluna.nome, operador, valores };
  });
}

function converter(c: ColunaFiltravel, v: string): unknown {
  switch (c.prisma) {
    case "Int":
      return Number(v);
    case "BigInt":
      return BigInt(v);
    case "Float":
      return Number(v);
    case "Boolean":
      return v === "true";
    case "DateTime":
      return new Date(`${v}T00:00:00.000Z`);
    default:
      return v; // String e Decimal (o Prisma aceita Decimal como texto, sem perder precisão)
  }
}

const diaSeguinte = (v: string) => new Date(new Date(`${v}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);

function condicao(c: ColunaFiltravel, f: FiltroColuna): unknown {
  const [v1, v2] = f.valores;
  const data = c.tipo === "data";
  switch (f.operador) {
    case "vazio":
      return null;
    case "não vazio":
      return { not: null };
    // Data com "=": o dia inteiro, para servir a @db.Date e a carimbo com hora (vistoEmSync); "≤" e "entre" vão até o fim do dia.
    case "=":
      return data ? { gte: converter(c, v1), lt: diaSeguinte(v1) } : c.tipo === "texto" ? { equals: v1, mode: "insensitive" } : converter(c, v1);
    case "≠":
      return c.tipo === "texto" ? { not: { equals: v1, mode: "insensitive" } } : { not: converter(c, v1) };
    case "IN":
      return { in: f.valores.map((v) => converter(c, v)) };
    case "≥":
      return { gte: converter(c, v1) };
    case "≤":
      return data ? { lt: diaSeguinte(v1) } : { lte: converter(c, v1) };
    case "entre":
      return data ? { gte: converter(c, v1), lt: diaSeguinte(v2) } : { gte: converter(c, v1), lte: converter(c, v2) };
    case "contém":
      return { contains: v1, mode: "insensitive" };
    case "começa com":
      return { startsWith: v1, mode: "insensitive" };
  }
}

/** `where` do Prisma com todos os filtros em E. `undefined` quando não há filtro. */
export function whereDosFiltros(colunas: ColunaFiltravel[], filtros: FiltroColuna[]): Record<string, unknown> | undefined {
  if (filtros.length === 0) return undefined;
  return {
    AND: filtros.map((f) => {
      const c = colunas.find((x) => x.nome === f.coluna)!;
      return { [c.nome]: condicao(c, f) };
    }),
  };
}
