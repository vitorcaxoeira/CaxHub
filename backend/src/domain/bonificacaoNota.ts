import { prisma } from "../db/prisma";

// Bonificação que entra na NOTA do consultor (25/11/2026), no molde de feriasNota.ts: o valor de cada consultor numa competência FECHADA de um processo
// que "compõe a nota" soma ao que ele emite naquela competência (Relatório de Produtividade, base dos descontos e Home). Só entra fechamento
// `fechado` com `compoe_nota` ligado NO FECHAMENTO (a flag é copiada do processo ao fechar: mudar o processo depois não mexe em nota passada) e
// resultado já com valor (indicador pendente não soma). Reabrir o fechamento tira o valor da nota até fechar de novo.
// Módulo leve (só o Prisma): a produtividade o importa sem puxar a apuração do Kyria.

const centavos = (n: number) => Math.round(n * 100) / 100;

export interface BonificacaoNoMes {
  resultadoId: number;
  /** Mês da nota, YYYY-MM-01. */
  competencia: string;
  processoId: number;
  processo: string;
  indicador: string;
  unidade: string;
  /** Valor lançado ou apurado (o que gerou os pontos), na unidade do indicador. */
  resultado: number | null;
  pontos: number | null;
  valorBase: number | null;
  valor: number;
}

export interface BonificacaoNaCompetencia {
  total: number;
  itens: BonificacaoNoMes[];
}

/** Soma o valor de uma lista de itens, arredondado a centavos (separada do banco para o teste). */
export function totalDaBonificacao(itens: { valor: number }[]): number {
  return centavos(itens.reduce((soma, i) => soma + i.valor, 0));
}

const chaveMes = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Bonificação a somar à nota nas competências `competencias` (qualquer dia do mês serve) do consultor. Devolve por mês ("YYYY-MM") e também o total e os
 * itens do período, para a Home somar ao líquido e a produtividade somar à nota.
 */
export async function bonificacoesNasCompetencias(
  codemp: number,
  codfor: number,
  competencias: Date[]
): Promise<{ porMes: Map<string, BonificacaoNaCompetencia>; total: number; itens: BonificacaoNoMes[] }> {
  const meses = [...new Set(competencias.map((c) => new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1)).getTime()))].map((t) => new Date(t));
  const porMes = new Map<string, BonificacaoNaCompetencia>();
  if (meses.length === 0) return { porMes, total: 0, itens: [] };

  const resultados = await prisma.bonificacaoResultado.findMany({
    where: { codemp, codfor, valor: { not: null }, fechamento: { situacao: "fechado", compoeNota: true, competencia: { in: meses } } },
    select: {
      id: true,
      valorApurado: true,
      valorInformado: true,
      pontos: true,
      valorBase: true,
      valor: true,
      fechamento: { select: { competencia: true, processo: { select: { id: true, nome: true } } } },
      indicador: { select: { nome: true, unidade: true, ordem: true } },
    },
  });

  const itens: (BonificacaoNoMes & { ordem: number })[] = resultados.map((r) => ({
    resultadoId: r.id,
    competencia: `${chaveMes(r.fechamento.competencia)}-01`,
    processoId: r.fechamento.processo.id,
    processo: r.fechamento.processo.nome,
    indicador: r.indicador.nome,
    unidade: r.indicador.unidade,
    resultado: r.valorInformado != null ? Number(r.valorInformado) : r.valorApurado != null ? Number(r.valorApurado) : null,
    pontos: r.pontos == null ? null : Number(r.pontos),
    valorBase: r.valorBase == null ? null : Number(r.valorBase),
    valor: centavos(Number(r.valor)),
    ordem: r.indicador.ordem,
  }));
  itens.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.processo.localeCompare(b.processo, "pt-BR") || a.ordem - b.ordem || a.resultadoId - b.resultadoId);

  const limpos: BonificacaoNoMes[] = itens.map(({ ordem: _ordem, ...item }) => item);
  for (const item of limpos) {
    const chave = item.competencia.slice(0, 7);
    const atual = porMes.get(chave) ?? { total: 0, itens: [] };
    atual.itens.push(item);
    atual.total = totalDaBonificacao(atual.itens);
    porMes.set(chave, atual);
  }
  return { porMes, total: totalDaBonificacao(limpos), itens: limpos };
}
