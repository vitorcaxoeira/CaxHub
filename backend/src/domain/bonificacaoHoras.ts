import { Prisma } from "@prisma/client";
import { percentualDe } from "./bonificacao";

// Horas do mês de um atendente (regra do Vitor em 27/11/2026), usada pela tela Horas Kyria x Trabalhadas e pelo indicador "% do ponto apontado":
//   saldo do banco no mês = créditos − débitos dos lançamentos do banco de horas (HCM, R011LAN) DATADOS no mês, sem o saldo anterior
//   extras                = o saldo, só quando positivo (negativo é mostrado, mas não entra no cálculo)
//   total do mês          = horas trabalhadas do ponto + extras
//   ocioso                = total do mês − horas apontadas no Kyria
//   %                     = horas do Kyria ÷ total do mês
// Lançamento apagado no Senior só fica de fora depois de marcado como removido (detecção de excluídos do job do HCM em "Marcar").
// Conferido com o relatório "Banco de Horas Analítico" do colaborador 62 em 10/2026: -02:53 (saldo final 02:28 - saldo inicial 05:21).

/** Saldo (em minutos, com sinal) dos lançamentos do mês; nulo quando não há lançamento. Os parâmetros aceitam valor ou coluna (Prisma.sql). */
export function saldoBancoDoMesSql(numemp: unknown, tipcol: unknown, numcad: unknown, ini: string, fim: string): Prisma.Sql {
  return Prisma.sql`
    SELECT sum(CASE btrim(bh.sinlan) WHEN '+' THEN bh.qtdhor WHEN '-' THEN -bh.qtdhor ELSE 0 END)::float8 AS minutos
    FROM hcm_lancamentos_bh bh
    WHERE bh.numemp = ${numemp} AND bh.tipcol = ${tipcol} AND bh.numcad = ${numcad} AND bh.removido_em_senior IS NULL
      AND bh.datlan >= ${ini}::date AND bh.datlan < ${fim}::date`;
}

export interface HorasDoMes {
  minutosExtras: number;
  minutosTotal: number;
  /** Negativo quando o Kyria tem mais horas que o total do mês. */
  minutosOcioso: number;
  percentual: number | null;
}

export function horasDoMes({ trabalhadas, saldoBanco, kyria }: { trabalhadas: number; saldoBanco: number | null; kyria: number }): HorasDoMes {
  const minutosExtras = Math.max(saldoBanco ?? 0, 0);
  const minutosTotal = trabalhadas + minutosExtras;
  return {
    minutosExtras,
    minutosTotal,
    minutosOcioso: Math.round((minutosTotal - kyria) * 100) / 100,
    percentual: percentualDe(kyria, minutosTotal),
  };
}
