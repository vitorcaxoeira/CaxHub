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

export function entidadeIdRat(id: number): string {
  return String(id);
}

export function entidadeIdDespesa(id: number): string {
  return String(id);
}

export function entidadeIdSolicitacaoViagem(id: number): string {
  return String(id);
}

export function entidadeIdConsultor(codemp: number, codfor: number): string {
  return `${codemp}:${codfor}`;
}

export function entidadeIdAvaliacao5S(id: number): string {
  return String(id);
}

// Painel de Eficiência: a exclusão é identificada pelo RatItem (o apontamento), a ação pelo id dela.
export function entidadeIdEficienciaApontamento(ratItemId: number): string {
  return String(ratItemId);
}

export function entidadeIdEficienciaAcao(id: number): string {
  return String(id);
}

// Plano de Evolução: ciclo e participante pelo id da linha.
export function entidadeIdPlanoCiclo(id: number): string {
  return String(id);
}

export function entidadeIdPlanoParticipante(id: number): string {
  return String(id);
}

export function entidadeIdPlanoApuracao(id: number): string {
  return String(id);
}

// Gestão de Metas do Comercial: o ano de metas pelo próprio ano; o indicador pelo id da linha.
export function entidadeIdMetaComercialAno(ano: number): string {
  return String(ano);
}

export function entidadeIdMetaComercialIndicador(id: number): string {
  return `indicador:${id}`;
}
