export const ORIGENS_AUDITORIA = ["tela", "api", "job", "integracao_senior"] as const;
export type OrigemAuditoria = (typeof ORIGENS_AUDITORIA)[number];

export const ENTIDADES_AUDITORIA = {
  PROPOSTA: "proposta",
  PROPOSTA_ITEM: "proposta_item",
} as const;
export type EntidadeAuditoriaTipo = (typeof ENTIDADES_AUDITORIA)[keyof typeof ENTIDADES_AUDITORIA];
// Fase 2+ acrescenta aqui: atividade, alocação, kanban_card etc. — mesma constante.

export const EVENTOS_AUDITORIA = {
  PROPOSTA_CRIADA: "PROPOSTA_CRIADA",
  PROPOSTA_ALTERADA: "PROPOSTA_ALTERADA",
  PROPOSTA_STATUS_ALTERADO: "PROPOSTA_STATUS_ALTERADO",
  PROPOSTA_ITEM_CRIADO: "PROPOSTA_ITEM_CRIADO",
  PROPOSTA_ITEM_ALTERADO: "PROPOSTA_ITEM_ALTERADO",
} as const;
export type EventoAuditoriaTipo = (typeof EVENTOS_AUDITORIA)[keyof typeof EVENTOS_AUDITORIA];
