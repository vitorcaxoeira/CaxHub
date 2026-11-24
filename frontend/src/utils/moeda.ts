// Moeda em pt-BR num lugar só. Até 09/11/2026 eram 61 arquivos declarando o próprio Intl.NumberFormat (e as variantes brl/rs/brlCompacto de
// lib/eficiencia.ts). Telas novas nascem usando isto; a migração dos 61 é faxina separada, fora da entrega da tela Gestão Propostas.
const BRL = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.234,56" (para coluna cujo título já diz R$). Nulo vira "—". */
export function formatMoeda(valor: number | null | undefined): string {
  return valor == null ? "—" : BRL.format(valor);
}

/** "R$ 1.234,56". Nulo vira "—". */
export function formatMoedaComSimbolo(valor: number | null | undefined): string {
  return valor == null ? "—" : `R$ ${BRL.format(valor)}`;
}
