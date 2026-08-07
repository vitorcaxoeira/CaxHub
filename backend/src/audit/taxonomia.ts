export const ORIGENS_AUDITORIA = ["tela", "api", "job", "integracao_senior"] as const;
export type OrigemAuditoria = (typeof ORIGENS_AUDITORIA)[number];

export const ENTIDADES_AUDITORIA = {
  PROPOSTA: "proposta",
  PROPOSTA_ITEM: "proposta_item",
  ATIVIDADE: "atividade",
  ALOCACAO: "alocacao",
  KANBAN_CARD: "kanban_card",
  USUARIO: "usuario",
  RAT: "rat",
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

  // Pedido de horas excedentes e a decisão do gestor. Gravados sob a entidade ALOCACAO
  // (entidadeId = id da AtividadeConsultor), NÃO sob uma entidade própria: podeVerEntidade
  // em routes/auditoria.ts só libera o histórico contextual do consultor para
  // ["atividade", "alocacao", "kanban_card"], então uma entidade nova ficaria invisível
  // justamente pra quem pediu as horas.
  EXCEDENTE_SOLICITADO: "EXCEDENTE_SOLICITADO",
  EXCEDENTE_APROVADO: "EXCEDENTE_APROVADO",
  EXCEDENTE_REPROVADO: "EXCEDENTE_REPROVADO",

  // Apontamento avulso: tempo trabalhado sem mover o card, pedido pelo consultor e
  // decidido pelo gestor. Mesma escolha de entidade dos eventos de excedente, aqui sob
  // ATIVIDADE — o que se registra é execução, não distribuição de horas.
  APONTAMENTO_SOLICITADO: "APONTAMENTO_SOLICITADO",
  APONTAMENTO_APROVADO: "APONTAMENTO_APROVADO",
  APONTAMENTO_REPROVADO: "APONTAMENTO_REPROVADO",

  // Exclusão lógica do apontamento pelo próprio consultor (ação direta, sem aprovação), e
  // o pedido de correção de horário, que passa pelo gestor.
  APONTAMENTO_EXCLUIDO: "APONTAMENTO_EXCLUIDO",
  AJUSTE_SOLICITADO: "AJUSTE_SOLICITADO",
  AJUSTE_APROVADO: "AJUSTE_APROVADO",
  AJUSTE_REPROVADO: "AJUSTE_REPROVADO",

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

  // Autoatendimento de perfil (backend/src/routes/perfil.ts) — nunca carrega dado
  // sensível em `alteracoes`/`metadata` (nem hash, nem senha em texto puro).
  USUARIO_PERFIL_ALTERADO: "USUARIO_PERFIL_ALTERADO",
  USUARIO_SENHA_ALTERADA: "USUARIO_SENHA_ALTERADA",
  USUARIO_AVATAR_ALTERADO: "USUARIO_AVATAR_ALTERADO",
  USUARIO_AVATAR_REMOVIDO: "USUARIO_AVATAR_REMOVIDO",

  // Aprovação de RAT (backend/src/routes/rats.ts) — só muda sitrat dentro do CaxHub. O
  // canal de escrita pro Senior hoje só registra apontamento (`registrarAtividades`, ver
  // soap/client.ts); não há operação de aprovação de RAT, então isso não reflete lá.
  RAT_APROVADA: "RAT_APROVADA",

  // Apontamento que existia no Senior e não voltou mais na consulta (foi apagado lá): o
  // vínculo numrat/seqrat é limpo pra permitir reintegrar. Ver
  // desvincularItensAusentesNoSenior em backend/src/routes/rats.ts.
  RAT_ITEM_DESVINCULADO_SENIOR: "RAT_ITEM_DESVINCULADO_SENIOR",
} as const;
export type EventoAuditoriaTipo = (typeof EVENTOS_AUDITORIA)[keyof typeof EVENTOS_AUDITORIA];
