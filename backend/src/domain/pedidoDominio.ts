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

// Domínio "LTipPed" do Senior (tipo do Pedido).
export const TIPPED_LABELS: Record<number, string> = {
  1: "Normal",
  2: "Automático",
  3: "Rascunho",
  4: "Orçamento",
  5: "Previsão",
  6: "Pronta Entrega",
  7: "Aproveitamento Pedido Pronta Entrega",
  8: "Assistência Técnica",
  9: "Reposição",
};

export function tippedLabel(tipped: number | null): string {
  if (tipped === null) return "—";
  return TIPPED_LABELS[tipped] ?? `Tipo ${tipped}`;
}

// Domínio "LPrcPed" do Senior (processo de geração do Pedido).
export const PRCPED_LABELS: Record<number, string> = {
  1: "Digitado - Normal",
  2: "Via Internet",
  3: "Via Importação",
  4: "Via Automação",
  5: "Digitado - Distribuição",
  6: "Via Processos Automáticos - Ordem de Compra",
  7: "Via Processos Automáticos - Gerais",
  8: "Via Contrato de Licitação",
  9: "Via Integração Varejo (Lojas)",
  10: "Via devolução com quantidade excedente",
};

export function prcpedLabel(prcped: number | null): string {
  if (prcped === null) return "—";
  return PRCPED_LABELS[prcped] ?? `Processo ${prcped}`;
}
