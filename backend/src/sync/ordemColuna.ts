// Ordenação por coluna das telas de tabela (24/10/2026, pedido do Vitor): até MAX_ORDEM colunas, cada uma crescente ou decrescente
// (Shift+clique no cabeçalho soma critérios). Chega pela URL como texto `coluna:desc,outra:asc` (direção omitida = crescente). Parte PURA,
// compartilhada pelo "Ver dados" (Prisma, sync/dadosSincronizados.ts) e pelas consultas SQL do módulo Plannix (plannix/consultaColunas.ts):
// quem chama diz quais nomes de coluna valem e recebe a lista validada; o cliente nunca escolhe uma expressão SQL.

export type Direcao = "asc" | "desc";

export interface OrdemColuna {
  coluna: string;
  direcao: Direcao;
}

export const MAX_ORDEM = 4;

/** Valida o que veio da tela (texto `a:desc,b`, ou lista já separada). Lança Error em português no primeiro problema (a rota devolve 400). */
export function validarOrdem(colunasValidas: Iterable<string>, bruto: unknown): OrdemColuna[] {
  if (bruto == null || bruto === "") return [];
  const validas = new Set(colunasValidas);
  const itens = Array.isArray(bruto) ? bruto.map(String) : typeof bruto === "string" ? bruto.split(",") : null;
  if (!itens) throw new Error("Ordenação inválida.");
  const partes = itens.map((i) => i.trim()).filter(Boolean);
  if (partes.length > MAX_ORDEM) throw new Error(`No máximo ${MAX_ORDEM} colunas na ordenação.`);
  const vistas = new Set<string>();
  return partes.map((parte) => {
    const [coluna, dir = "asc", resto] = parte.split(":");
    if (resto !== undefined || (dir !== "asc" && dir !== "desc")) throw new Error(`Ordenação inválida: "${parte}".`);
    if (!validas.has(coluna)) throw new Error(`Coluna "${coluna}" não existe nesta tabela.`);
    if (vistas.has(coluna)) throw new Error(`A coluna "${coluna}" aparece duas vezes na ordenação.`);
    vistas.add(coluna);
    return { coluna, direcao: dir };
  });
}

/** Texto da URL para a lista (o inverso de validarOrdem). */
export function ordemParaTexto(ordem: OrdemColuna[]): string {
  return ordem.map((o) => `${o.coluna}:${o.direcao}`).join(",");
}
