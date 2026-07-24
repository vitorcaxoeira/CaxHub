// entidade_id é String genérico porque as PKs reais variam de formato (compostas em
// Proposta/PropostaItem, simples em AtividadeConsultor na Fase 2) — centraliza o encoding
// pra todo chamador usar o mesmo formato de string.
export function entidadeIdProposta(codemp: number, codpro: number): string {
  return `${codemp}:${codpro}`;
}

export function entidadeIdPropostaItem(codemp: number, codpro: number, seqite: number): string {
  return `${codemp}:${codpro}:${seqite}`;
}

// AtividadeConsultor tem PK própria simples (id autoincrement) — usada como entidadeId
// tanto pra entidadeTipo "atividade" quanto "alocacao"/"kanban_card" (mesma linha,
// vista por três lentes diferentes conforme a rota que gerou o evento).
export function entidadeIdAtividade(id: number): string {
  return String(id);
}

export function entidadeIdUsuario(id: number): string {
  return String(id);
}
