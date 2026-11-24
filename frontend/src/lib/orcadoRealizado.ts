// Orçado x Realizado (Resultado Analítico): as contas da coluna de variação. Funções puras, com teste; a aba só chama.

/** Como a coluna de variação é mostrada: em reais (realizado − orçado) ou em percentual sobre o orçado. */
export type FormatoVariacao = "valor" | "pct";

/** Lê o `?variacao=` da URL: só "pct" muda o padrão (R$). */
export const formatoVariacaoDaUrl = (v: string | null): FormatoVariacao => (v === "pct" ? "pct" : "valor");

/** Variação em reais: realizado − orçado (mesma convenção de sinal dos dois: receita positiva, despesa negativa). */
export function variacaoValor(realizado: number, orcado: number): number {
  return realizado - orcado;
}

/** Variação em % sobre o |orçado|. Sem orçado (zero) não há percentual: `null` (a tela mostra "—"). */
export function variacaoPercentual(realizado: number, orcado: number): number | null {
  return orcado !== 0 ? ((realizado - orcado) / Math.abs(orcado)) * 100 : null;
}

/** A variação no formato escolhido. */
export function variacao(realizado: number, orcado: number, formato: FormatoVariacao): number | null {
  return formato === "pct" ? variacaoPercentual(realizado, orcado) : variacaoValor(realizado, orcado);
}

const PERCENTUAL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "12,3%" (uma casa). */
export function formatarPercentual(v: number): string {
  return `${PERCENTUAL.format(v)}%`;
}

/** Visão das colunas (23/11/2026 + 24/11/2026): um mês por coluna, ou um ano por coluna (o ano todo). Vai pra URL como `periodo=ano`. */
export type Periodo = "mes" | "ano";

/** Lê o `?periodo=` da URL: só "ano" muda o padrão (mês). */
export const periodoDaUrl = (v: string | null): Periodo => (v === "ano" ? "ano" : "mes");

/** Os números de uma linha (ou do total geral): um valor por mês (ou por ano, depois de agrupar) e os totais do período. */
export interface SerieOrcadoRealizado {
  valoresRealizado: number[];
  valoresOrcado: number[];
  totalRealizado: number;
  totalOrcado: number;
}

const soma = (valores: number[]): number => valores.reduce((s, v) => s + v, 0);

/** Anos presentes nos meses ('AAAA-MM'), na ordem em que aparecem. */
export function anosDosMeses(meses: string[]): string[] {
  return [...new Set(meses.map((m) => m.slice(0, 4)))];
}

/**
 * Visão anual: cada ano vira uma coluna, com a soma dos meses dele (orçado e realizado). Os totais do período não mudam — são os mesmos da
 * visão mensal. A variação sai das subcolunas, calculada sobre essas somas.
 */
export function agruparPorAno<T extends SerieOrcadoRealizado, S extends SerieOrcadoRealizado>(
  meses: string[],
  linhas: T[],
  totalGeral: S
): { meses: string[]; linhas: T[]; totalGeral: S } {
  const anos = anosDosMeses(meses);
  const somaDoAno = (valores: number[], ano: string) =>
    meses.reduce((s, m, i) => (m.startsWith(ano) ? s + (valores[i] ?? 0) : s), 0);
  const agrupa = <X extends SerieOrcadoRealizado>(s: X): X => ({
    ...s,
    valoresRealizado: anos.map((a) => somaDoAno(s.valoresRealizado, a)),
    valoresOrcado: anos.map((a) => somaDoAno(s.valoresOrcado, a)),
  });
  return { meses: anos, linhas: linhas.map(agrupa), totalGeral: agrupa(totalGeral) };
}

/**
 * Modal de um ano (visão Ano): só os meses dele, com os totais refeitos para o ano. Linha sem valor no ano sai, a não ser que tenha filho
 * que fica (senão a árvore ficaria com pasta vazia). `linhas` vêm em pré-ordem (pai antes dos filhos), por isso a passada vai de trás pra frente.
 */
export function recortarAno<T extends SerieOrcadoRealizado & { chave: string; chavePai: string | null }, S extends SerieOrcadoRealizado>(
  ano: string,
  meses: string[],
  linhas: T[],
  totalGeral: S
): { meses: string[]; linhas: T[]; totalGeral: S } {
  const indices = meses.flatMap((m, i) => (m.startsWith(ano) ? [i] : []));
  const corta = <S extends SerieOrcadoRealizado>(s: S): S => {
    const valoresRealizado = indices.map((i) => s.valoresRealizado[i] ?? 0);
    const valoresOrcado = indices.map((i) => s.valoresOrcado[i] ?? 0);
    return { ...s, valoresRealizado, valoresOrcado, totalRealizado: soma(valoresRealizado), totalOrcado: soma(valoresOrcado) };
  };
  const cortadas = linhas.map(corta);
  const temValor = (s: SerieOrcadoRealizado) => s.valoresRealizado.some((v) => v !== 0) || s.valoresOrcado.some((v) => v !== 0);
  const comFilhoMantido = new Set<string>();
  const mantidas = new Set<string>();
  for (let k = cortadas.length - 1; k >= 0; k--) {
    const l = cortadas[k];
    if (temValor(l) || comFilhoMantido.has(l.chave)) {
      mantidas.add(l.chave);
      if (l.chavePai) comFilhoMantido.add(l.chavePai);
    }
  }
  return {
    meses: indices.map((i) => meses[i]),
    linhas: cortadas.filter((l) => mantidas.has(l.chave)),
    totalGeral: corta(totalGeral),
  };
}
