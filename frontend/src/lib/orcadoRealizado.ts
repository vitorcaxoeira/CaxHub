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
