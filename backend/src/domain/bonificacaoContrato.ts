import { valorHoraVigente } from "./resumoConsultor";

// Quem pode receber a bonificação NA NOTA (decisão do Vitor, 25/11/2026): só o consultor com contrato de valor — Fixo (codmot 12, valor mensal) ou Hora (valor-hora). Sem contrato
// vigente com valor não há nota (o Valor Nota fica nulo) e, portanto, a bonificação não incide. A fonte é a mesma da Home e do fechamento dos descontos: `valorHoraVigente`.

export type TipoContrato = "fixo" | "hora";
export const TIPO_CONTRATO_ROTULO: Record<TipoContrato, string> = { fixo: "Contrato Fixo", hora: "Contrato Hora" };

/** Tipo do contrato vigente do consultor: "fixo", "hora" ou null (sem contrato com valor). */
export async function tipoDeContrato(codemp: number, codfor: number): Promise<TipoContrato | null> {
  const v = await valorHoraVigente(codemp, codfor);
  if (!v) return null;
  return v.fixo ? "fixo" : "hora";
}

export interface IndicacaoNota {
  /** O valor deste consultor vai para a nota fiscal dele. */
  vaiParaNota: boolean;
  contrato: TipoContrato | null;
  /** Quando não vai: o porquê (para a tela explicar). */
  motivo: string | null;
}

/** Regra pura (testável): vai para a nota quando o processo compõe a nota E o consultor tem contrato Fixo/Hora. */
export function indicacaoDaNota(compoeNota: boolean, contrato: TipoContrato | null): IndicacaoNota {
  if (!compoeNota) return { vaiParaNota: false, contrato, motivo: "O processo não compõe o valor da nota fiscal" };
  if (contrato == null) return { vaiParaNota: false, contrato, motivo: "Sem contrato Fixo/Hora vigente: não incide na nota" };
  return { vaiParaNota: true, contrato, motivo: null };
}
