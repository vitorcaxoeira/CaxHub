// Domínio "LSitPed" do Senior (situação do Pedido — E120PED).
export const SITPED_LABELS: Record<number, string> = {
  1: "Aberto Total",
  2: "Aberto Parcial",
  3: "Suspenso",
  4: "Liquidado",
  5: "Cancelado",
  6: "Aguardando Integração WMS",
  7: "Em Transmissão",
  8: "Preparação Análise ou NF",
  9: "Não Fechado",
};

export function sitpedLabel(sitped: number | null): string {
  if (sitped === null) return "—";
  return SITPED_LABELS[sitped] ?? `Situação ${sitped}`;
}

export function sitpedTone(sitped: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (sitped === 5) return "destructive"; // Cancelado
  if (sitped === 4) return "success"; // Liquidado
  if (sitped === 1 || sitped === 2 || sitped === 7 || sitped === 9) return "warning"; // ainda em aberto/andamento
  return "neutral"; // Suspenso, Aguardando Integração WMS, Preparação Análise ou NF
}
