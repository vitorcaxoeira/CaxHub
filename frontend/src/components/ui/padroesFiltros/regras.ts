// Regras puras do "padrão de cada filtro" (estrela no canto do campo, 03/11/2026): comparar o valor atual com o salvo e validar o salvo
// contra as opções de hoje antes de aplicar. Um item que sumiu ou perdeu permissão NÃO é forçado (a lista inteira é recusada: metade
// de uma escolha pode não fazer sentido). Cada tela monta os validadores com as opções que ela tem; o servidor só confere o formato.

/** Estado da estrela: sem padrão, valor atual = padrão, ou padrão salvo com outro valor na tela. */
export type EstadoPadrao = "nenhum" | "igual" | "diferente";

const chaveItem = (x: unknown): string | number =>
  typeof x === "number"
    ? x
    : typeof x === "object" && x !== null
      ? JSON.stringify(x, Object.keys(x).sort())
      : String(x);

const normalizar = (v: unknown, ordem: boolean): unknown => {
  if (Array.isArray(v)) {
    const itens = v.map(chaveItem);
    return ordem ? itens : itens.sort((a, b) => String(a).localeCompare(String(b)));
  }
  return typeof v === "string" ? v.trim() : v;
};

/** Mesmo valor de filtro? Por padrão a ordem da lista não importa; `ordem` para pares/tuplas (ex.: [de, ate]). Texto sem espaços nas pontas. */
export function mesmoValorFiltro(a: unknown, b: unknown, ordem = false): boolean {
  return JSON.stringify(normalizar(a, ordem)) === JSON.stringify(normalizar(b, ordem));
}

export function estadoPadrao(padrao: unknown, atual: unknown, ordem = false): EstadoPadrao {
  if (padrao === undefined) return "nenhum";
  return mesmoValorFiltro(padrao, atual, ordem) ? "igual" : "diferente";
}

export type Validacao<T = unknown> = { ok: true; valor: T } | { ok: false };
export type Validador<T = unknown> = (valor: unknown) => Validacao<T>;

const ok = <T,>(valor: T): Validacao<T> => ({ ok: true, valor });
const falha: Validacao<never> = { ok: false };

type Tipo = "string" | "number";
const doTipo = (tipo: Tipo) => (x: unknown): x is string | number => typeof x === tipo && (tipo === "string" || Number.isFinite(x as number));

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ehData = (x: unknown): x is string => typeof x === "string" && DATA.test(x);

export const regras = {
  /**
   * Lista de valores. Com `existentes`, cada item precisa estar entre eles; sem (undefined), só o formato (opções que vêm da própria
   * consulta, ou buscadas no servidor). `vazioOk: false` recusa a lista vazia (ex.: o Ano, que exige um valor).
   */
  lista<T extends string | number>(tipo: Tipo, existentes?: readonly T[], opcoes: { vazioOk?: boolean } = {}): Validador<T[]> {
    const { vazioOk = true } = opcoes;
    return (v) => {
      if (!Array.isArray(v) || !v.every(doTipo(tipo))) return falha;
      if (v.length === 0) return vazioOk ? ok([]) : falha;
      if (existentes && !v.every((x) => existentes.includes(x as T))) return falha;
      return ok(v as T[]);
    };
  },

  /** Lista de objetos planos que têm `chave` (ex.: clientes escolhidos numa busca do servidor: {cod, nome}). */
  listaObjetos<T extends Record<string, unknown>>(chave: string): Validador<T[]> {
    return (v) =>
      Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x) && chave in x) ? ok(v as T[]) : falha;
  },

  /** Um objeto plano com `chave` escolhido numa busca do servidor (ex.: o cliente de um autocomplete), ou null ("Todos"). */
  objeto<T extends Record<string, unknown>>(chave: string): Validador<T | null> {
    return (v) => (v === null ? ok(null) : typeof v === "object" && !Array.isArray(v) && chave in (v as object) ? ok(v as T) : falha);
  },

  /** Select de valor único: um dos `existentes` (se informados); `nuloOk` aceita null ("Todas"). */
  valorUnico<T extends string | number>(tipo: Tipo, existentes?: readonly T[], opcoes: { nuloOk?: boolean } = {}): Validador<T | null> {
    return (v) => {
      if (v === null) return opcoes.nuloOk ? ok(null) : falha;
      if (!doTipo(tipo)(v)) return falha;
      if (existentes && !existentes.includes(v as T)) return falha;
      return ok(v as T);
    };
  },

  texto(): Validador<string> {
    return (v) => (typeof v === "string" ? ok(v.trim()) : falha);
  },

  numero(opcoes: { min?: number; max?: number } = {}): Validador<number> {
    return (v) => (typeof v === "number" && Number.isFinite(v) && v >= (opcoes.min ?? -Infinity) && v <= (opcoes.max ?? Infinity) ? ok(v) : falha);
  },

  booleano(): Validador<boolean> {
    return (v) => (typeof v === "boolean" ? ok(v) : falha);
  },

  /** Uma data AAAA-MM-DD, ou null (sem data). */
  data(): Validador<string | null> {
    return (v) => (v === null || ehData(v) ? ok(v) : falha);
  },

  /** Par [de, ate] de datas AAAA-MM-DD ("" = sem data). Com as duas, o início não passa do fim. */
  parDatas(): Validador<[string, string]> {
    return (v) => {
      if (!Array.isArray(v) || v.length !== 2) return falha;
      const [de, ate] = v;
      const valida = (d: unknown) => d === "" || ehData(d);
      if (!valida(de) || !valida(ate)) return falha;
      if (de !== "" && ate !== "" && (de as string) > (ate as string)) return falha;
      return ok([de, ate] as [string, string]);
    };
  },

  /**
   * Período: ["3m"] (preset relativo, recalculado a cada abertura) ou ["personalizado", de, ate] (datas fixas).
   * Devolve o que `usePeriodo.definir` recebe.
   */
  periodo(presets: readonly string[], personalizado = "personalizado"): Validador<{ preset: string; de?: string; ate?: string }> {
    return (v) => {
      if (!Array.isArray(v) || typeof v[0] !== "string" || !presets.includes(v[0])) return falha;
      if (v[0] !== personalizado) return v.length === 1 ? ok({ preset: v[0] }) : falha;
      if (v.length !== 3 || !ehData(v[1]) || !ehData(v[2]) || v[1] > v[2]) return falha;
      return ok({ preset: personalizado, de: v[1], ate: v[2] });
    };
  },
};

/** Valor que a estrela grava para um período (inverso de `regras.periodo`). */
export function valorDoPeriodo(p: { preset: string; de: string; ate: string }): string[] {
  return p.preset === "personalizado" ? ["personalizado", p.de, p.ate] : [p.preset];
}
