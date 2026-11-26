// Resumo das sessões pendentes de confirmação por Forma de Faturamento da proposta (25/11/2026, pedido da Jéssica). FATURADA x NÃO FATURADA vem do
// `fatser` do ITEM da proposta (S ou A; o backend já manda `faturavel` pela mesma régua da Gestão Propostas) e o VALOR é horas × valor-hora do item
// (venda), como o "Valor Faturado" de lá. Conta pura: sem React e sem rede, para o teste.

export const SEM_FORMA = "Sem forma de faturamento";

export interface SessaoParaResumo {
  /** Código da forma de faturamento da PROPOSTA (ordena as linhas); nulo quando a proposta não tem forma. */
  forfat: number | null;
  forfatLabel: string | null;
  /** Item com fatser S ou A. */
  faturavel: boolean;
  duracaoMinutos: number;
  /** Valor-hora de venda do item; só vem para quem pode ver valores. */
  valorHoraItem?: number | null;
  /** Proposta interna (cliente = a própria empresa); null/ausente = sem cliente. */
  interna?: boolean | null;
}

/** Filtro "Propostas", o mesmo da Gestão Propostas: de clientes, internas ou todas. */
export type TipoDeProposta = "all" | "cli" | "int";
export const TIPOS_DE_PROPOSTA: TipoDeProposta[] = ["all", "cli", "int"];

/** Mesma regra do SQL da Gestão Propostas: "cli" = cliente diferente da própria empresa, "int" = a própria; proposta sem cliente só aparece em "all". */
export function filtrarPorTipoDeProposta<T extends { interna?: boolean | null }>(sessoes: T[], tipo: TipoDeProposta): T[] {
  if (tipo === "all") return sessoes;
  return sessoes.filter((s) => s.interna === (tipo === "int"));
}

/** A sessão com o que o detalhe (modal aberto pelas horas) precisa mostrar. */
export interface SessaoDetalhe extends SessaoParaResumo {
  id: number;
  codemp: number;
  codpro: number;
  cliente: string | null;
  seqite: number | null;
  itemDescricao: string | null;
  consultorNome: string | null;
  inicio: string;
  fim: string;
  observacao: string | null;
}

export interface LinhaResumoFaturamento {
  forma: string;
  /** Ordem das linhas: o código da forma; "sem forma" fica por último. */
  ordem: number;
  minutosFaturados: number;
  valorFaturado: number;
  /** Valor médio da hora faturada (valor ÷ horas); null sem horas. */
  valorHoraMedioFaturado: number | null;
  minutosNaoFaturados: number;
  valorNaoFaturado: number;
  /** Valor médio da hora não faturada (valor ÷ horas); null sem horas. */
  valorHoraMedioNaoFaturado: number | null;
}

const ORDEM_SEM_FORMA = Number.MAX_SAFE_INTEGER;
const centavos = (n: number) => Math.round(n * 100) / 100;

const vazia = (forma: string, ordem: number): LinhaResumoFaturamento => ({
  forma,
  ordem,
  minutosFaturados: 0,
  valorFaturado: 0,
  valorHoraMedioFaturado: null,
  minutosNaoFaturados: 0,
  valorNaoFaturado: 0,
  valorHoraMedioNaoFaturado: null,
});

/** Nome da forma de uma sessão, a MESMA chave de agrupamento do resumo. */
export const formaDaSessao = (s: SessaoParaResumo): string => s.forfatLabel ?? SEM_FORMA;

/** Valor (R$, sem arredondar) de uma sessão: horas × valor-hora de venda do item. */
export const valorDaSessao = (s: SessaoParaResumo): number => (s.duracaoMinutos / 60) * (s.valorHoraItem ?? 0);

/**
 * As sessões que formam uma célula de horas do resumo: as da `forma` (null = linha de Total, todas as formas) com `faturavel` igual ao pedido. Usa a mesma chave de
 * agrupamento do resumo, então a soma delas é exatamente a célula. Mais recentes primeiro.
 */
export function sessoesDaCelula<T extends SessaoParaResumo & { inicio: string }>(sessoes: T[], forma: string | null, faturavel: boolean): T[] {
  return sessoes
    .filter((s) => s.faturavel === faturavel && (forma === null || formaDaSessao(s) === forma))
    .sort((a, b) => b.inicio.localeCompare(a.inicio));
}

/** Total de minutos e de valor (arredondado no fim) de uma lista de sessões: a mesma conta das células. */
export function totaisDasSessoes(sessoes: SessaoParaResumo[]): { minutos: number; valor: number } {
  return {
    minutos: sessoes.reduce((s, x) => s + x.duracaoMinutos, 0),
    valor: centavos(sessoes.reduce((s, x) => s + valorDaSessao(x), 0)),
  };
}

/**
 * Soma horas e valores por forma de faturamento. Os valores somam SEM arredondar e só o resultado vai para centavos (mesma conta do SQL da Gestão Propostas:
 * SUM(minutos / 60 × valor-hora)); o total é calculado sobre as sessões, não somando as linhas já arredondadas.
 */
export function resumoPorFormaDeFaturamento(sessoes: SessaoParaResumo[]): { linhas: LinhaResumoFaturamento[]; total: LinhaResumoFaturamento } {
  const porForma = new Map<string, LinhaResumoFaturamento>();
  const total = vazia("Total", ORDEM_SEM_FORMA);
  for (const s of sessoes) {
    const forma = formaDaSessao(s);
    let linha = porForma.get(forma);
    if (!linha) {
      linha = vazia(forma, s.forfatLabel != null && s.forfat != null ? s.forfat : ORDEM_SEM_FORMA);
      porForma.set(forma, linha);
    }
    const valor = valorDaSessao(s);
    for (const alvo of [linha, total]) {
      if (s.faturavel) {
        alvo.minutosFaturados += s.duracaoMinutos;
        alvo.valorFaturado += valor;
      } else {
        alvo.minutosNaoFaturados += s.duracaoMinutos;
        alvo.valorNaoFaturado += valor;
      }
    }
  }
  // Média ponderada: valor ÷ horas da própria linha (a do Total é a de todas as horas, não a média das médias). Sai do valor ainda SEM arredondar.
  const mediaPorHora = (valor: number, minutos: number) => (minutos > 0 ? centavos(valor / (minutos / 60)) : null);
  const arredondar = (l: LinhaResumoFaturamento): LinhaResumoFaturamento => ({
    ...l,
    valorFaturado: centavos(l.valorFaturado),
    valorNaoFaturado: centavos(l.valorNaoFaturado),
    valorHoraMedioFaturado: mediaPorHora(l.valorFaturado, l.minutosFaturados),
    valorHoraMedioNaoFaturado: mediaPorHora(l.valorNaoFaturado, l.minutosNaoFaturados),
  });
  const linhas = [...porForma.values()].map(arredondar).sort((a, b) => a.ordem - b.ordem || a.forma.localeCompare(b.forma, "pt-BR"));
  return { linhas, total: arredondar(total) };
}
