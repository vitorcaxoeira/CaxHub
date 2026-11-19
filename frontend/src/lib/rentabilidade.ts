// Tipos e formatação compartilhados pelas duas telas da Rentabilidade (configuração dos indicadores e resultado por centro de custo), 17/11/2026.

export type TipoIndicador = "contas" | "formula" | "sistema";
export type BaseIndicador = "realizado" | "orcado";
export type NaturezaIndicador = "ambos" | "debito" | "credito";
export type FormatoIndicador = "moeda" | "percentual" | "horas" | "numero";

export const ROTULO_TIPO: Record<TipoIndicador, string> = { contas: "Soma de contas", formula: "Fórmula", sistema: "Campo do sistema" };
export const ROTULO_FORMATO: Record<FormatoIndicador, string> = { moeda: "Moeda (R$)", percentual: "Percentual", horas: "Horas", numero: "Número" };
export const ROTULO_NATUREZA: Record<NaturezaIndicador, string> = { ambos: "Débito e crédito", debito: "Só débito", credito: "Só crédito" };
export const ROTULO_BASE: Record<BaseIndicador, string> = { realizado: "Realizado", orcado: "Orçado" };

export interface RegraConta {
  codemp: number;
  ctared: number;
  acao: "incluir" | "excluir";
}

/**
 * Alterna a regra de UMA conta numa lista de regras (incluir/excluir): sem regra para a conta → acrescenta com `acao`; já com a MESMA ação → remove
 * (clicar de novo desfaz); com a OUTRA ação → troca. Nunca duplica a conta. Usada pelo seletor de contas e pela ação "Entra no custo" do movimento da folha.
 */
export function alternarRegra(regras: RegraConta[], conta: { codemp: number; ctared: number }, acao: "incluir" | "excluir"): RegraConta[] {
  const atual = regras.find((r) => r.ctared === conta.ctared)?.acao;
  const resto = regras.filter((r) => r.ctared !== conta.ctared);
  return atual === acao ? resto : [...resto, { codemp: conta.codemp, ctared: conta.ctared, acao }];
}

export interface Indicador {
  id: number;
  codigo: string;
  rotulo: string;
  tipo: TipoIndicador;
  base: BaseIndicador;
  natureza: NaturezaIndicador;
  formato: FormatoIndicador;
  formulaTexto: string | null;
  formulaArvore: unknown | null;
  fonte: string | null;
  ordem: number;
  visivel: boolean;
  contas: RegraConta[];
}

export interface ContaDoPlano {
  codemp: number;
  ctared: number;
  clacta: string;
  descta: string;
  anasin: string | null;
  nivcta: number | null;
  paiCtared: number | null;
  despar: string | null;
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const decimal2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimal1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Valor de um indicador no formato dele. Vazio (null) vira "—". */
export function formatarValor(valor: number | null | undefined, formato: FormatoIndicador): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  switch (formato) {
    case "moeda":
      return moeda.format(valor);
    case "percentual":
      return `${decimal2.format(valor * 100)}%`;
    case "horas":
      return `${decimal1.format(valor)} h`;
    default:
      return decimal2.format(valor);
  }
}

/** Mês anterior ao de hoje, no formato AAAA-MM (o padrão dos filtros: o último mês fechado). */
export function mesAnterior(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
