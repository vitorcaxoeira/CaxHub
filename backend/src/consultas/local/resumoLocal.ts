// Cópia fiel de frontend/src/components/colunas/resumo.ts (03/11/2026): o resumo do rodapé calculado em memória no servidor (listaEmMemoria.ts).
// Resumo por coluna no rodapé das listas (28/10/2026, pedido do Vitor): soma, média, contagem... com as funções que fazem sentido para o
// tipo da coluna. Sempre sobre TODAS as linhas do filtro, não só a página: nas listas do servidor quem calcula é a rota `/resumo`
// (backend/src/plannix/consultaColunas.ts, resumoSql — mesma lista de funções); nas do navegador, `calcularResumo` aqui. Funções puras.

export type TipoResumo = "texto" | "inteiro" | "decimal" | "data" | "booleano" | "json";
export type FuncaoResumo = "soma" | "media" | "minimo" | "maximo" | "mediana" | "contagem" | "distintos" | "vazios" | "sim" | "nao" | "pctSim";

export const ROTULO_RESUMO: Record<FuncaoResumo, string> = {
  soma: "Soma",
  media: "Média",
  minimo: "Mínimo",
  maximo: "Máximo",
  mediana: "Mediana",
  contagem: "Contagem",
  distintos: "Distintos",
  vazios: "Vazios",
  sim: "Qtd. sim",
  nao: "Qtd. não",
  pctSim: "% sim",
};

const POR_TIPO: Record<TipoResumo, FuncaoResumo[]> = {
  inteiro: ["soma", "media", "minimo", "maximo", "mediana", "contagem", "distintos"],
  decimal: ["soma", "media", "minimo", "maximo", "mediana", "contagem", "distintos"],
  texto: ["contagem", "distintos", "vazios"],
  data: ["minimo", "maximo", "contagem"],
  booleano: ["sim", "nao", "pctSim"],
  json: [],
};

/** Funções que a coluna oferece: as do tipo, limitadas pela coluna quando ela declara as suas (ex.: Δ % sem Soma). */
export function funcoesDaColuna(tipo: TipoResumo | undefined, permitidas?: FuncaoResumo[]): FuncaoResumo[] {
  const doTipo = tipo ? POR_TIPO[tipo] : [];
  return permitidas ? doTipo.filter((f) => permitidas.includes(f)) : doTipo;
}

/** Funções cujo resultado está na unidade da própria coluna (formatadas como ela); as outras são contagens ou percentual. */
export const NA_UNIDADE_DA_COLUNA = new Set<FuncaoResumo>(["soma", "media", "minimo", "maximo", "mediana"]);

const vazio = (v: unknown) => v === null || v === undefined || v === "";
const numero = (v: unknown): number | null => {
  if (vazio(v)) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Resumo de uma coluna sobre os valores de todas as linhas (navegador). Vazio não conta (como no SQL: sum/avg/count ignoram NULL); sem
 * nenhum valor, soma/média/mínimo… dão null. Datas voltam como texto ISO (mínimo/máximo).
 */
export function calcularResumo(valores: unknown[], funcao: FuncaoResumo, tipo: TipoResumo): number | string | null {
  const preenchidos = valores.filter((v) => !vazio(v));
  switch (funcao) {
    case "contagem":
      return preenchidos.length;
    case "vazios":
      return valores.length - preenchidos.length;
    case "distintos":
      return new Set(preenchidos.map((v) => (tipo === "texto" ? String(v).trim().toLowerCase() : String(v)))).size;
    case "sim":
      return valores.filter((v) => v === true || v === "true").length;
    case "nao":
      return valores.filter((v) => v === false || v === "false").length;
    case "pctSim": {
      const respondidos = valores.filter((v) => v === true || v === false || v === "true" || v === "false");
      return respondidos.length ? (respondidos.filter((v) => v === true || v === "true").length / respondidos.length) * 100 : null;
    }
  }
  if (tipo === "data") {
    const datas = preenchidos.map((v) => String(v)).sort();
    if (!datas.length) return null;
    return funcao === "minimo" ? datas[0] : funcao === "maximo" ? datas[datas.length - 1] : null;
  }
  const ns = preenchidos.map(numero).filter((n): n is number => n !== null);
  if (!ns.length) return null;
  switch (funcao) {
    case "soma":
      return ns.reduce((s, n) => s + n, 0);
    case "media":
      return ns.reduce((s, n) => s + n, 0) / ns.length;
    case "minimo":
      return Math.min(...ns);
    case "maximo":
      return Math.max(...ns);
    case "mediana": {
      // Mesma regra do percentile_cont(0.5) do Postgres: com quantidade par, a média dos dois do meio.
      const o = [...ns].sort((a, b) => a - b);
      const meio = Math.floor(o.length / 2);
      return o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2;
    }
  }
  return null;
}

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Texto do resumo. `formatarNaUnidade` = o formato da própria coluna (R$, kg, 3 casas…) para soma/média/mínimo/máximo/mediana; sem ele,
 * inteiro sem casas e decimal com 2. Contagens sem casas; % sim com 1 casa; datas dd/mm/aaaa.
 */
export function formatarResumo(valor: number | string | null, funcao: FuncaoResumo, tipo: TipoResumo, formatarNaUnidade?: (v: number) => string): string {
  if (valor === null) return "—";
  if (typeof valor === "string") {
    // Data pura (@db.Date) chega como meia-noite UTC: dd/mm/aaaa direto do texto, sem passar por fuso (senão vira o dia anterior em
    // America/Sao_Paulo).
    const dia = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(valor);
    if (dia) return `${dia[3]}/${dia[2]}/${dia[1]}`;
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }
  if (funcao === "pctSim") return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (!NA_UNIDADE_DA_COLUNA.has(funcao)) return inteiro.format(valor);
  if (formatarNaUnidade) return formatarNaUnidade(valor);
  return tipo === "inteiro" && funcao !== "media" ? inteiro.format(valor) : decimal.format(valor);
}

/** O que a tela pede ao servidor (rota `/resumo`): coluna e função, só das colunas visíveis com resumo escolhido. */
export interface PedidoResumo {
  coluna: string;
  funcao: FuncaoResumo;
}

/** Resposta do resumo: quantas linhas entraram e o valor de cada pedido, pela chave "coluna:funcao". Igual à da rota `/resumo`. */
export interface ResultadoResumo {
  linhas: number;
  valores: Record<string, number | string | null>;
}

export const chaveDoResumo = (p: PedidoResumo) => `${p.coluna}:${p.funcao}`;

/** Resumo das listas do navegador: sobre todas as linhas que passaram no filtro (não só as visíveis na rolagem). */
export function resumirLinhas<T>(linhas: T[], pedidos: PedidoResumo[], ler: (linha: T, coluna: string) => unknown, tipos: Map<string, TipoResumo>): ResultadoResumo {
  return {
    linhas: linhas.length,
    valores: Object.fromEntries(
      pedidos.map((p) => [chaveDoResumo(p), calcularResumo(linhas.map((l) => ler(l, p.coluna)), p.funcao, tipos.get(p.coluna) ?? "decimal")]),
    ),
  };
}
