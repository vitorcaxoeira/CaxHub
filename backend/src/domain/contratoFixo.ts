// Contrato de VALOR FIXO do consultor (13/11/2026): na view USU_VBI01CTRCS, `codmot = 12` marca o contrato fixo e `qtdctr` é a quantidade fixa (em horas) que
// multiplica o valor-hora para dar o valor da nota do mês: nota = vlrhor × qtdctr. Conferido no ERP em 13/11 nos 7 contratos com codmot 12
// (ex.: codfor 464 = 93,897 × 150 = 14.084,55). Funções puras (sem banco), com teste.

/** `codmot` do contrato de valor fixo. Fonte única da regra. */
export const CODMOT_CONTRATO_FIXO = 12;

const centavos = (n: number) => Math.round(n * 100) / 100;

export interface ContratoFixo {
  /** Quantidade fixa do contrato (qtdctr). */
  qtd: number;
  /** vlrhor × qtd, em reais, arredondado a centavos: o que o contrato rende por mês. */
  valorMensal: number;
}

/** O contrato é de valor fixo e tem quantidade? Devolve o fixo, ou null (contrato por hora, ou fixo sem quantidade preenchida). */
export function contratoFixoDe(contrato: { codmot: number | null; vlrhor: number; qtdctr: number | null }): ContratoFixo | null {
  if (contrato.codmot !== CODMOT_CONTRATO_FIXO) return null;
  if (contrato.qtdctr == null || !Number.isFinite(contrato.qtdctr) || contrato.qtdctr <= 0) return null;
  return { qtd: contrato.qtdctr, valorMensal: centavos(contrato.vlrhor * contrato.qtdctr) };
}

export interface TotalContratoFixo {
  qtd: number;
  valorMensal: number;
  /** Meses do período (cada mês rende o valor fixo). */
  meses: number;
  /** Deslocamento do período, somado em cima do fixo (metade do valor-hora, a regra do card). */
  deslocamento: number;
  /** valorMensal × meses + deslocamento. */
  total: number;
}

/** Total do período: o fixo de cada mês do período mais o deslocamento lançado. Os descontos e as férias NÃO entram aqui (a tela deduz e soma ao líquido, como no resto do card). */
export function totalDoContratoFixo(fixo: ContratoFixo, meses: number, deslocamento: number): TotalContratoFixo {
  const mesesValidos = Math.max(0, Math.floor(meses));
  const desloc = centavos(Math.max(0, deslocamento));
  return { qtd: fixo.qtd, valorMensal: fixo.valorMensal, meses: mesesValidos, deslocamento: desloc, total: centavos(fixo.valorMensal * mesesValidos + desloc) };
}
