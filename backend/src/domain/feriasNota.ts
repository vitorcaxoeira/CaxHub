import { prisma } from "../db/prisma";
import { chaveDia } from "./calendarioTrabalho";

// Valor das férias que entra na NOTA do consultor (13/11/2026): o gozo de um período aquisitivo REMUNERADO tem um "mês de pagamento" (competenciaPagamento, sempre dia 1);
// quando a competência da nota é esse mês, o valor das férias soma ao que o consultor emite. Férias canceladas e de período não remunerado nunca entram.

const centavos = (n: number) => Math.round(n * 100) / 100;

export interface FeriasNoMes {
  gozoId: number;
  inicio: string;
  fim: string;
  /** Mês da nota, YYYY-MM-01. */
  competencia: string;
  valor: number;
}

export interface FeriasPagasNaCompetencia {
  total: number;
  itens: FeriasNoMes[];
}

/** Soma o valor dos gozos de uma lista, arredondado a centavos (separada do banco para o teste). */
export function totalDasFerias(itens: { valor: number }[]): number {
  return centavos(itens.reduce((soma, i) => soma + i.valor, 0));
}

/**
 * Férias a pagar nas competências `competencias` (qualquer dia do mês serve) do consultor. Devolve por mês ("YYYY-MM") e também o total geral, para a Home somar
 * ao ganho/projeção e o fechamento somar à nota.
 */
export async function feriasPagasNasCompetencias(
  codemp: number,
  codfor: number,
  competencias: Date[]
): Promise<{ porMes: Map<string, FeriasPagasNaCompetencia>; total: number; itens: FeriasNoMes[] }> {
  const meses = [...new Set(competencias.map((c) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1)).getTime()))].map((t) => new Date(t));
  const porMes = new Map<string, FeriasPagasNaCompetencia>();
  if (meses.length === 0) return { porMes, total: 0, itens: [] };

  const gozos = await prisma.feriasGozo.findMany({
    where: {
      situacao: { not: "cancelada" },
      competenciaPagamento: { in: meses },
      valorFerias: { not: null },
      aquisitivo: { codemp, codfor, remunerado: true },
    },
    select: { id: true, inicio: true, fim: true, competenciaPagamento: true, valorFerias: true },
    orderBy: { inicio: "asc" },
  });

  const itens: FeriasNoMes[] = gozos.map((g) => ({
    gozoId: g.id,
    inicio: chaveDia(g.inicio),
    fim: chaveDia(g.fim),
    competencia: chaveDia(g.competenciaPagamento as Date),
    valor: centavos(Number(g.valorFerias)),
  }));
  for (const item of itens) {
    const chave = item.competencia.slice(0, 7);
    const atual = porMes.get(chave) ?? { total: 0, itens: [] };
    atual.itens.push(item);
    atual.total = totalDasFerias(atual.itens);
    porMes.set(chave, atual);
  }
  return { porMes, total: totalDasFerias(itens), itens };
}
