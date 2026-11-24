import type { FiltroColuna, OperadorColuna, RespostaValores } from "./FiltroColunaServidor";
import type { OrdemColuna } from "./estadoColunas";

// Filtro e ordenação por coluna APLICADOS NO NAVEGADOR (24/10/2026), para as tabelas pequenas que já vêm inteiras na tela (Evolução, detalhe
// da obra e da peça, Explorador). Mesmos operadores e mesma semântica do servidor (backend/src/sync/filtroColunaLocal.ts e
// plannix/consultaColunas.ts): texto sem diferenciar maiúsculas, data pelo DIA inteiro, nulo por último. Funções PURAS, com teste.

export type TipoLocal = "texto" | "inteiro" | "decimal" | "data" | "booleano";

export interface ColunaLocal {
  nome: string;
  tipo: TipoLocal;
  /** Não aceita nulo: o funil não oferece "vazio" nem "não vazio". */
  obrigatoria?: boolean;
  /** Data pura em UTC (coluna @db.Date): o dia é o da própria data. Padrão: carimbo com hora, cujo dia é o de Brasília (UTC-3). */
  utc?: boolean;
}

/** Operadores que o funil oferece por tipo: a MESMA tabela de backend/src/sync/filtroColunaLocal.ts (operadoresDaColuna). */
const OPERADORES: Record<TipoLocal, OperadorColuna[]> = {
  texto: ["=", "≠", "IN", "contém", "começa com"],
  inteiro: ["=", "≠", "IN", "≥", "≤", "entre"],
  decimal: ["=", "≠", "≥", "≤", "entre"],
  data: ["=", "≥", "≤", "entre"],
  booleano: ["="],
};

export function operadoresPorTipo(tipo: TipoLocal, obrigatoria = false): OperadorColuna[] {
  const base = OPERADORES[tipo];
  return obrigatoria ? base : [...base, "vazio", "não vazio"];
}

type Valor = unknown;
/** Como ler o valor de uma coluna numa linha (padrão: `linha[coluna]`). */
export type LeitorDeValor<T> = (linha: T, coluna: string) => Valor;

const lerPadrao = <T,>(linha: T, coluna: string): Valor => (linha as Record<string, unknown>)[coluna];

const vazio = (v: Valor) => v === null || v === undefined || v === "";

const BRT_MS = 3 * 3_600_000;

/** Dia (AAAA-MM-DD) de um valor de data: ISO da API, Date ou texto já no formato. Carimbo com hora conta o dia de Brasília (UTC-3). */
function dia(v: Valor, utc: boolean): string | null {
  const data = v instanceof Date ? v : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null;
  if (data === null) return null;
  if (typeof data === "string" && (utc || /^\d{4}-\d{2}-\d{2}$/.test(data))) return data.slice(0, 10);
  const instante = new Date(data).getTime();
  if (Number.isNaN(instante)) return null;
  return new Date(utc ? instante : instante - BRT_MS).toISOString().slice(0, 10);
}

function comparavel(coluna: ColunaLocal, v: Valor): string | number | null {
  if (vazio(v)) return null;
  switch (coluna.tipo) {
    case "inteiro":
    case "decimal": {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case "data":
      return dia(v, !!coluna.utc);
    case "booleano":
      return String(v);
    default:
      return String(v).toLowerCase();
  }
}

function casa(coluna: ColunaLocal, valor: Valor, f: FiltroColuna): boolean {
  if (f.operador === "vazio") return vazio(valor);
  if (f.operador === "não vazio") return !vazio(valor);
  const c = comparavel(coluna, valor);
  if (c === null) return false; // nulo nunca casa com valor (como no SQL)
  const alvo = (v: string) => comparavel(coluna, v);
  const [v1, v2] = f.valores;
  switch (f.operador) {
    case "=":
      return c === alvo(v1);
    case "≠":
      return c !== alvo(v1);
    case "IN":
      return f.valores.some((v) => c === alvo(v));
    case "≥":
      return c >= alvo(v1)!;
    case "≤":
      return c <= alvo(v1)!;
    case "entre":
      return c >= alvo(v1)! && c <= alvo(v2)!;
    case "contém":
      return typeof c === "string" && c.includes(v1.toLowerCase());
    case "começa com":
      return typeof c === "string" && c.startsWith(v1.toLowerCase());
  }
}

/** Linhas que passam em TODOS os filtros (E). Filtro de coluna desconhecida é ignorado. */
export function aplicarFiltrosLocal<T>(linhas: T[], colunas: ColunaLocal[], filtros: FiltroColuna[], ler: LeitorDeValor<T> = lerPadrao): T[] {
  const validos = filtros.flatMap((f) => {
    const coluna = colunas.find((c) => c.nome === f.coluna);
    return coluna ? [{ coluna, f }] : [];
  });
  if (validos.length === 0) return linhas;
  return linhas.filter((l) => validos.every(({ coluna, f }) => casa(coluna, ler(l, coluna.nome), f)));
}

function comparar(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true });
}

/** Ordena por até vários critérios, sem alterar o array de entrada. Nulo vai por último nas duas direções; o empate mantém a ordem original. */
export function ordenarLocal<T>(linhas: T[], colunas: ColunaLocal[], ordem: OrdemColuna[], ler: LeitorDeValor<T> = lerPadrao): T[] {
  const criterios = ordem.flatMap((o) => {
    const coluna = colunas.find((c) => c.nome === o.coluna);
    return coluna ? [{ coluna, sinal: o.direcao === "desc" ? -1 : 1 }] : [];
  });
  if (criterios.length === 0) return linhas;
  return linhas
    .map((linha, indice) => ({ linha, indice }))
    .sort((x, y) => {
      for (const { coluna, sinal } of criterios) {
        const a = comparavel(coluna, ler(x.linha, coluna.nome));
        const b = comparavel(coluna, ler(y.linha, coluna.nome));
        if (a === null && b === null) continue;
        if (a === null) return 1;
        if (b === null) return -1;
        const r = comparar(a, b);
        if (r !== 0) return r * sinal;
      }
      return x.indice - y.indice;
    })
    .map((x) => x.linha);
}

const MAX_VALORES = 200;

/**
 * Aba "Valores" do funil para tabela local: os valores distintos da coluna (nas linhas já filtradas pelas OUTRAS colunas), com a quantidade,
 * mais frequentes primeiro. `termo` restringe por texto. Mesmo formato da resposta do servidor (RespostaValores).
 */
export function valoresLocais<T>(
  linhas: T[],
  colunas: ColunaLocal[],
  filtros: FiltroColuna[],
  coluna: string,
  termo: string,
  ler: LeitorDeValor<T> = lerPadrao,
): RespostaValores {
  const base = aplicarFiltrosLocal(linhas, colunas, filtros.filter((f) => f.coluna !== coluna), ler);
  const contagem = new Map<string, { valor: Valor; quantidade: number }>();
  for (const l of base) {
    const bruto = ler(l, coluna);
    const valor = vazio(bruto) ? null : bruto;
    const chave = valor === null ? "\u0000vazio" : String(valor);
    const atual = contagem.get(chave);
    if (atual) atual.quantidade++;
    else contagem.set(chave, { valor, quantidade: 1 });
  }
  const t = termo.trim().toLowerCase();
  const todos = [...contagem.values()]
    .filter((v) => !t || (v.valor !== null && String(v.valor).toLowerCase().includes(t)))
    .sort((a, b) => b.quantidade - a.quantidade || String(a.valor ?? "").localeCompare(String(b.valor ?? ""), "pt-BR", { numeric: true }));
  return { valores: todos.slice(0, MAX_VALORES), temMais: todos.length > MAX_VALORES };
}
