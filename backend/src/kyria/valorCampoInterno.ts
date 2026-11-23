// Valor de um campo INTERNO que NÃO é vínculo com outra tabela (ex.: kyria_label_groups.fitro_dep_time, Boolean), digitado na tela "Ver dados"
// (18/11/2026, pedido do Vitor). O campo de vínculo continua sendo validado contra a tabela relacionada (kyria/dadosSincronizados.ts); aqui
// só se confere o TIPO da coluna, pra um valor de tipo errado nunca chegar ao Prisma (que responderia com um 500 ilegível). Puro, com teste.

export class ErroValorInterno extends Error {}

const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;
const TEXTO_MAXIMO = 2000;

/** Tipos Prisma que a tela sabe editar. Os demais (DateTime, Json, enum, BigInt, Decimal) ainda não. */
export const TIPOS_EDITAVEIS = ["Boolean", "String", "Int", "Float"] as const;

export function tipoEhEditavel(tipoPrisma: string): boolean {
  return (TIPOS_EDITAVEIS as readonly string[]).includes(tipoPrisma);
}

/**
 * Confere (e normaliza) o valor para o tipo Prisma da coluna. `null` = limpar o campo e passa direto (quem chama confere se a coluna aceita
 * nulo). Lança ErroValorInterno com a mensagem do que está errado.
 */
export function converterValorInterno(tipoPrisma: string, valor: unknown): boolean | string | number | null {
  if (valor === null) return null;
  switch (tipoPrisma) {
    case "Boolean":
      if (typeof valor !== "boolean") throw new ErroValorInterno("Este campo aceita só verdadeiro (Sim) ou falso (Não).");
      return valor;
    case "String": {
      if (typeof valor !== "string") throw new ErroValorInterno("Este campo aceita texto.");
      const texto = valor.trim();
      if (texto === "") throw new ErroValorInterno("Texto vazio: use a opção de limpar o campo.");
      if (texto.length > TEXTO_MAXIMO) throw new ErroValorInterno(`Texto longo demais (máximo de ${TEXTO_MAXIMO} caracteres).`);
      return texto;
    }
    case "Int":
      if (typeof valor !== "number" || !Number.isInteger(valor)) throw new ErroValorInterno("Este campo aceita um número inteiro.");
      if (valor < INT4_MIN || valor > INT4_MAX) throw new ErroValorInterno("Número fora do limite do campo.");
      return valor;
    case "Float":
      if (typeof valor !== "number" || !Number.isFinite(valor)) throw new ErroValorInterno("Este campo aceita um número.");
      return valor;
    default:
      throw new ErroValorInterno(`Campos do tipo ${tipoPrisma} ainda não são editáveis por esta tela.`);
  }
}
