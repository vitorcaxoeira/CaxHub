// Regras de apresentação da tela Administração › Vínculo de Consultores (custo-hora real, bloco C da Rentabilidade, 18/11/2026). Funções PURAS (com
// teste): a tela só chama. O que é regra de negócio (sugestão, unicidade, "só attendant, admin e manager") mora no servidor — aqui só o que se vê.

export type Regime = "pj" | "folha" | "ambos" | "indefinido";
export type Confianca = "alta" | "media";

export const ROTULO_REGIME: Record<Regime, string> = {
  pj: "PJ (contrato)",
  folha: "Folha (HCM)",
  ambos: "Contrato + HCM — conferir",
  indefinido: "Sem custo definido",
};

export interface OpcaoVinculo {
  value: string;
  label: string;
  /** codusu do consultor que já usa este atendente/funcionário (`null` = livre). */
  vinculadoA: number | null;
}

export interface OpcaoAgrupada {
  value: string;
  grupo: string;
  rotulo: string;
}

export const GRUPO_LIVRES = "Livres";
export const GRUPO_OCUPADOS = "Já vinculados a outro consultor";

/**
 * Opções do seletor de uma linha: LIVRES primeiro (o que se quer na maioria das vezes) e por último os que já pertencem a outro consultor. Quem
 * pertence a ESTE consultor (`codusu`) fica em "Livres" — é a própria escolha dele. Ordem interna preservada. O funcionário DEMITIDO não tem grupo
 * próprio: aparece na lista como os demais (dado histórico), com "DEMITIDO em dd/mm/aaaa" no rótulo, que o servidor monta.
 */
export function agruparOpcoesVinculo(opcoes: OpcaoVinculo[], codusu: number): OpcaoAgrupada[] {
  const ordem = [GRUPO_LIVRES, GRUPO_OCUPADOS];
  const grupoDe = (o: OpcaoVinculo) => (o.vinculadoA != null && o.vinculadoA !== codusu ? GRUPO_OCUPADOS : GRUPO_LIVRES);
  return opcoes
    .map((o) => ({ value: o.value, grupo: grupoDe(o), rotulo: o.label }))
    .sort((a, b) => ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo));
}

export interface SugestaoVinculo {
  valor: string;
  confianca: Confianca;
  motivo: string;
}

/**
 * Quantas sugestões o botão "aceitar seguras" aplicaria: só confiança ALTA e que NÃO disputem o mesmo atendente/funcionário com outra linha
 * (o servidor aplica a mesma regra; aqui é só para o número no botão não prometer demais).
 */
export function contarSugestoesSeguras(sugestoes: (SugestaoVinculo | null)[]): number {
  const altas = sugestoes.filter((s): s is SugestaoVinculo => !!s && s.confianca === "alta");
  const usos = new Map<string, number>();
  for (const s of altas) usos.set(s.valor, (usos.get(s.valor) ?? 0) + 1);
  return altas.filter((s) => usos.get(s.valor) === 1).length;
}

/** "2026-06-01" → "01/06/2026". Sem `new Date` (desloca o dia pelo fuso). */
export function formatarDia(dia: string | null | undefined): string {
  if (!dia) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dia;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatarReais(valor: number | null | undefined): string {
  return valor == null ? "—" : BRL.format(valor);
}
