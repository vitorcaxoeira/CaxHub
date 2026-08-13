// Hierarquia de níveis dos planos do Senior (plano de contas e centro de custo).
//
// A ideia central: NÃO deduzir as larguras dos níveis olhando os dados nem chumbá-las no
// código. O Senior entrega, em cada linha de conta/centro de custo, tanto o nível
// (E045PLA.NivCta / E044CCU.NivCcu) quanto a máscara do grupo (MskGcc / MskCcu) — e é a
// máscara que diz quantos caracteres cada nível ocupa na classificação. Isso é o que faz a
// mesma lógica servir pra qualquer plano de contas (outra empresa, outro modelo, CaxHub_Hedel),
// porque as larguras passam a ser dado, não constante.
//
// Antes daqui existia `NIVEIS_CLACTA = [1, 3, 5, 7, 11, 16]` em contabilDominio.ts, medido a
// olho contra as 547 contas da SOELTECH. Coincidia com a máscara real
// ("1.22.33.44.5555.66666"), mas quebraria silenciosamente em outro plano — e as máscaras de
// fato variam por modelo E por grupo de contas (o modelo 188 do Senior usa "1.22.33.44.55" no
// Ativo/Passivo e "1.22.33.44.55.66" no grupo X).

/**
 * Larguras ACUMULADAS de cada nível, a partir da máscara do Senior.
 *
 * A máscara descreve os níveis separados por ponto, e o número de caracteres de cada trecho
 * é a largura daquele nível (o dígito repetido é só o número do nível):
 *   "1.22.33.44.5555.66666" -> larguras 1,2,2,2,4,5 -> acumulado [1, 3, 5, 7, 11, 16]
 *   "1.22.333"              -> larguras 1,2,3       -> acumulado [1, 3, 6]
 *
 * O acumulado é o que interessa: `acumulado[n-1]` é o comprimento da classificação de uma
 * conta de nível `n`. Devolve [] pra máscara ausente/vazia.
 */
export function largurasDaMascara(mascara: string | null | undefined): number[] {
  if (!mascara) return [];
  const acumulado: number[] = [];
  let soma = 0;
  for (const trecho of mascara.trim().split(".")) {
    if (trecho.length === 0) continue;
    soma += trecho.length;
    acumulado.push(soma);
  }
  return acumulado;
}

/** O que `derivarPais` precisa saber de cada conta/centro de custo. */
export interface ItemHierarquia<TCodigo extends string | number> {
  codigo: TCodigo;
  /** `clacta` (conta) ou `claccu` (centro de custo). */
  classificacao: string;
  /** `nivcta` / `nivccu` — nível vindo do Senior. */
  nivel: number | null;
  /** `mskgcc` / `mskccu` — máscara do grupo a que este item pertence. */
  mascara: string | null;
}

/**
 * Descobre o pai de cada item: a conta/CC de nível `nivel - 1` cuja classificação é o prefixo
 * desta. O comprimento do prefixo vem da máscara DO PRÓPRIO item (grupos diferentes podem ter
 * máscaras diferentes), então é um lookup direto num Map — O(n), sem comparar todos com todos.
 *
 * Nível 1 (ou nível/máscara ausente, ou pai que não existe na lista) devolve `null` = raiz.
 * Um pai faltante nunca esconde o item: ele só passa a ser tratado como raiz.
 */
export function derivarPais<TCodigo extends string | number>(
  itens: ItemHierarquia<TCodigo>[]
): Map<TCodigo, TCodigo | null> {
  const porClassificacao = new Map<string, TCodigo>();
  for (const item of itens) porClassificacao.set(item.classificacao.trim(), item.codigo);

  const pais = new Map<TCodigo, TCodigo | null>();
  for (const item of itens) {
    const nivel = item.nivel;
    if (nivel == null || nivel <= 1) {
      pais.set(item.codigo, null);
      continue;
    }
    const larguras = largurasDaMascara(item.mascara);
    const larguraDoPai = larguras[nivel - 2];
    if (larguraDoPai == null) {
      pais.set(item.codigo, null);
      continue;
    }
    const classificacaoDoPai = item.classificacao.trim().slice(0, larguraDoPai);
    pais.set(item.codigo, porClassificacao.get(classificacaoDoPai) ?? null);
  }
  return pais;
}
