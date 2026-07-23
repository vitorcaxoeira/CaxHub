// Domínio "USU_LSITRAT" do Senior (situação da RAT — Registro de Atividade Técnica).
// Valores confirmados via getFieldDomainValues("USU_LSITRAT") direto no dicionário do
// Senior (não é suposição).
export const SITRAT_LABELS: Record<number, string> = {
  9: "Digitado",
  8: "Impresso",
  6: "Aprovado",
  5: "Cancelado",
  4: "Faturado",
  2: "Faturado Parcial",
  1: "Fechado",
};

export function sitratLabel(sitrat: number | null): string {
  if (sitrat === null) return "—";
  return SITRAT_LABELS[sitrat] ?? `Situação ${sitrat}`;
}

export function sitratTone(sitrat: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (sitrat === 5) return "destructive";
  if (sitrat === 9) return "warning"; // ainda digitado/rascunho, não confirmado
  if (sitrat === null) return "neutral";
  return "success"; // impresso/aprovado/faturado/fechado
}
