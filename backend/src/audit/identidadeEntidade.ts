// entidade_id é String genérico porque as PKs reais variam de formato (compostas em
// Proposta/PropostaItem, simples em AtividadeConsultor na Fase 2) — centraliza o encoding
// pra todo chamador usar o mesmo formato de string.
export function entidadeIdProposta(codemp: number, codpro: number): string {
  return `${codemp}:${codpro}`;
}

export function entidadeIdPropostaItem(codemp: number, codpro: number, seqite: number): string {
  return `${codemp}:${codpro}:${seqite}`;
}
