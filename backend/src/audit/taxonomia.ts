export const ORIGENS_AUDITORIA = ["tela", "api", "job", "integracao_senior"] as const;
export type OrigemAuditoria = (typeof ORIGENS_AUDITORIA)[number];

export const ENTIDADES_AUDITORIA = {
  PROPOSTA: "proposta",
  PROPOSTA_ITEM: "proposta_item",
  ATIVIDADE: "atividade",
  ALOCACAO: "alocacao",
  KANBAN_CARD: "kanban_card",
} as const;
export type EntidadeAuditoriaTipo = (typeof ENTIDADES_AUDITORIA)[keyof typeof ENTIDADES_AUDITORIA];

export const EVENTOS_AUDITORIA = {
  PROPOSTA_CRIADA: "PROPOSTA_CRIADA",
  PROPOSTA_ALTERADA: "PROPOSTA_ALTERADA",
  PROPOSTA_STATUS_ALTERADO: "PROPOSTA_STATUS_ALTERADO",
  PROPOSTA_ITEM_CRIADO: "PROPOSTA_ITEM_CRIADO",
  PROPOSTA_ITEM_ALTERADO: "PROPOSTA_ITEM_ALTERADO",

  // Fase 2 — Alocação (AtividadeConsultor: consultor x atividade). ALOCACAO_ALTERADA
  // cobre hoje só o diff de qtdhor (a distribuição de horas em si) — é o único campo
  // editável por PATCH /alocacao/alocacoes/:id além das datas (ver DATA_*).
  ALOCACAO_CRIADA: "ALOCACAO_CRIADA",
  ALOCACAO_ALTERADA: "ALOCACAO_ALTERADA",
  ALOCACAO_REMOVIDA: "ALOCACAO_REMOVIDA",

  // Datas previstas (dataPrevistaInicio/dataPrevistaFim) de uma atividade — campo null
  // vira valor = DATA_INCLUIDA; valor muda pra outro valor = DATA_ALTERADA. Emitido em
  // qualquer rota que escreva essas duas colunas (alocacao.ts e atividades.ts).
  DATA_INCLUIDA: "DATA_INCLUIDA",
  DATA_ALTERADA: "DATA_ALTERADA",

  KANBAN_RAIA_ALTERADA: "KANBAN_RAIA_ALTERADA",

  // Ciclo de vida de execução — nascem de PATCH /atividades/:id/mover, a partir de
  // QuadroColuna.contaComoExecucao (abre/fecha AtividadeSessaoExecucao).
  ATIVIDADE_INICIADA: "ATIVIDADE_INICIADA",
  ATIVIDADE_PARADA: "ATIVIDADE_PARADA",
  // Reservado: não há hoje uma rota de "ajustar escopo" da atividade distinta de
  // ALOCACAO_ALTERADA (horas) e DATA_* (datas) — ver nota em camposAuditados.ts.
  ATIVIDADE_AJUSTADA: "ATIVIDADE_AJUSTADA",
  // Nasce no processamento assíncrono da fila outbox (outboxSenior.ts), não no clique
  // do usuário — ver correlationId próprio por item processado.
  ATIVIDADE_ENVIADA_SENIOR: "ATIVIDADE_ENVIADA_SENIOR",
} as const;
export type EventoAuditoriaTipo = (typeof EVENTOS_AUDITORIA)[keyof typeof EVENTOS_AUDITORIA];
