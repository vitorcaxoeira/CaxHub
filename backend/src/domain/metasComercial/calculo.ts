// Gestão de Metas do Comercial: cálculo puro (sem banco), testado contra os números da planilha META 2026.xlsx.
// A meta mensal EFETIVA é a gravada em MetaComercialLancamento; as funções de distribuição abaixo só preenchem os meses (assistentes).

export type Acumulacao = "SOMA" | "SALDO";

/** Peso de cada mês no ano, em % (planilha: Jan–Mar 6,667%, Abr–Set 10%, Out–Dez 6,667%). Soma 100,000002; os cálculos normalizam. */
export const PESOS_PADRAO: number[] = [
  6.666667, 6.666667, 6.666667, 10, 10, 10, 10, 10, 10, 6.666667, 6.666667, 6.666667,
];

export const arredonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const mesesDe = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);
const TODOS = mesesDe(1, 12);

/** "ano" | "s1" | "s2" | "t1".."t4" | "mes-N" | "ate-N" (acumulado de janeiro até N). Inválido = null. */
export function mesesDoPeriodo(periodo: string): number[] | null {
  if (periodo === "ano") return TODOS;
  if (periodo === "s1") return mesesDe(1, 6);
  if (periodo === "s2") return mesesDe(7, 12);
  const t = /^t([1-4])$/.exec(periodo);
  if (t) return mesesDe((Number(t[1]) - 1) * 3 + 1, Number(t[1]) * 3);
  const m = /^(mes|ate)-(\d{1,2})$/.exec(periodo);
  if (m) {
    const n = Number(m[2]);
    if (n < 1 || n > 12) return null;
    return m[1] === "mes" ? [n] : mesesDe(1, n);
  }
  return null;
}

/** Valida os 12 pesos: números não negativos, soma ≈ 100 (tolerância 0,01). Devolve a mensagem de erro ou null. */
export function validarPesos(pesos: unknown): string | null {
  if (!Array.isArray(pesos) || pesos.length !== 12) return "Informe os 12 pesos mensais";
  if (pesos.some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0)) return "Os pesos devem ser números não negativos";
  const soma = (pesos as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(soma - 100) > 0.01) return `Os pesos devem somar 100% (somam ${soma.toFixed(4)}%)`;
  return null;
}

/**
 * Reparte `valor` entre os meses escolhidos (1–12; padrão: todos) na proporção dos pesos desses meses. Devolve 12 posições
 * (índice 0 = janeiro; meses fora da escolha = 0). Cada mês é arredondado em centavos e a diferença de arredondamento vai para o
 * último mês escolhido, de modo que a soma seja exatamente `valor`. Ex.: 43.200 de Jul–Dez com os pesos do ano = 8.640 nos
 * meses de 10% e 5.760 nos de 6,667% (a meta semestral da Cati).
 */
export function distribuirPorPesos(valor: number, pesos: number[], meses: number[] = TODOS): number[] {
  const escolhidos = [...new Set(meses)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  const saida = new Array<number>(12).fill(0);
  if (escolhidos.length === 0) return saida;
  const soma = escolhidos.reduce((a, m) => a + (pesos[m - 1] ?? 0), 0);
  // Sem peso nenhum nos meses escolhidos: divide em partes iguais (melhor que dividir por zero).
  const fracao = (m: number) => (soma > 0 ? (pesos[m - 1] ?? 0) / soma : 1 / escolhidos.length);
  let acumulado = 0;
  escolhidos.forEach((m, i) => {
    const v = i === escolhidos.length - 1 ? arredonda2(valor - acumulado) : arredonda2(valor * fracao(m));
    saida[m - 1] = v;
    acumulado = arredonda2(acumulado + v);
  });
  return saida;
}

export interface LinhaMes {
  mes: number;
  meta: number | null;
  realizado: number | null;
}

export interface Consolidado {
  meta: number;
  realizado: number;
  /** realizado ÷ meta (0,5936 = 59,36%). Nulo sem meta. Não é limitado a 100%, como na planilha. */
  atingimento: number | null;
  /** meta − realizado (a coluna DESAFIO da planilha). Negativo = superou a meta. */
  saldo: number;
}

/**
 * Consolida os meses de um indicador no período. SOMA soma metas e realizados. SALDO (posição, ex.: carteira de mensalidade) usa o
 * ÚLTIMO mês do período que tem realizado (meta e realizado desse mês); sem realizado, a meta do último mês com meta.
 */
export function consolidar(linhas: LinhaMes[], acumulacao: Acumulacao, meses: number[]): Consolidado {
  const doPeriodo = linhas.filter((l) => meses.includes(l.mes)).sort((a, b) => a.mes - b.mes);
  let meta = 0;
  let realizado = 0;
  if (acumulacao === "SOMA") {
    for (const l of doPeriodo) {
      meta += l.meta ?? 0;
      realizado += l.realizado ?? 0;
    }
  } else {
    const ultimoComRealizado = [...doPeriodo].reverse().find((l) => l.realizado != null);
    const ultimoComMeta = [...doPeriodo].reverse().find((l) => l.meta != null);
    realizado = ultimoComRealizado?.realizado ?? 0;
    meta = (ultimoComRealizado?.meta ?? ultimoComMeta?.meta) ?? 0;
  }
  meta = arredonda2(meta);
  realizado = arredonda2(realizado);
  return { meta, realizado, atingimento: atingimento(realizado, meta), saldo: arredonda2(meta - realizado) };
}

export const atingimento = (realizado: number, meta: number): number | null => (meta > 0 ? realizado / meta : null);

/** Média simples dos atingimentos conhecidos (a "REALIZADO GERAL" da planilha). Nulo sem nenhum. */
export function atingimentoGeral(percentuais: Array<number | null>): number | null {
  const validos = percentuais.filter((p): p is number => p != null);
  return validos.length === 0 ? null : validos.reduce((a, b) => a + b, 0) / validos.length;
}
