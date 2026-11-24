// "Por página" único em TODAS as listas do CaxHub (24/11/2026, pedido do Vitor; mesmo desenho do Dash, 23/11): 5, 10, 15, 25, 50, 100 e 200. Pura, com teste.
// A lista mora aqui e em mais nenhum lugar: tela nova só informa o tamanho INICIAL, nunca as opções.

export const POR_PAGINA_PADRAO: readonly number[] = [5, 10, 15, 25, 50, 100, 200];

/** O tamanho inicial pedido por uma tela, ajustado à lista: o maior que cabe (30 → 25, 20 → 15, 500 → 200); abaixo do menor, o menor. */
export function normalizarPorPagina(n: number): number {
  if (!Number.isFinite(n)) return 25;
  const cabem = POR_PAGINA_PADRAO.filter((o) => o <= n);
  return cabem.length > 0 ? cabem[cabem.length - 1] : POR_PAGINA_PADRAO[0];
}

/** As opções do seletor, garantindo a atual (um `<select>` nunca fica sem a opção selecionada). */
export function opcoesDePorPagina(atual?: number): number[] {
  return atual === undefined || POR_PAGINA_PADRAO.includes(atual) ? [...POR_PAGINA_PADRAO] : [...POR_PAGINA_PADRAO, atual].sort((a, b) => a - b);
}
