// Whitelist de campos monitorados por entidade — só o que está aqui entra em `diffCampos`.
// codemp/codpro/seqite nunca entram: são chave, não "conteúdo" mutável. Ajustar esta
// lista não exige migration nem mudança de schema.
export const CAMPOS_AUDITADOS_PROPOSTA: Record<string, string> = {
  sitpro: "Situação",
  stapro: "Status",
  qtdhor: "Horas Contratadas",
  datenv: "Data de Envio ao Cliente",
  datret: "Data de Retorno do Cliente",
  datval: "Data de Validade",
  preent: "Previsão de Entrega",
  pripro: "Prioridade",
  executor: "Executor",
  forfat: "Forma de Faturamento",
  obssit: "Observação de Situação",
  codrep: "Representante",
};

export const CAMPOS_AUDITADOS_PROPOSTA_ITEM: Record<string, string> = {
  qtdhor: "Horas do Item",
  valhor: "Valor/Hora",
  despro: "Descrição",
  entpro: "Entrega",
  sitmot: "Situação/Motivo",
  forfat: "Forma de Faturamento",
  sitprz: "Situação de Prazo",
  depexe: "Departamento Executor",
};

// Único campo hoje editável em PATCH /alocacao/alocacoes/:id além das datas (ver
// CAMPOS_AUDITADOS_ATIVIDADE_DATAS) — dispara ALOCACAO_ALTERADA quando muda.
export const CAMPOS_AUDITADOS_ALOCACAO: Record<string, string> = {
  qtdhor: "Horas Alocadas",
};

// dataPrevistaInicio/dataPrevistaFim de AtividadeConsultor — diferente de diffCampos
// genérico: cada campo é classificado individualmente como DATA_INCLUIDA (null -> valor)
// ou DATA_ALTERADA (valor -> outro valor), não um único evento agregando os dois — ver
// classificarMudancaData em registrarEvento.ts.
export const CAMPOS_AUDITADOS_ATIVIDADE_DATAS: Record<string, string> = {
  dataPrevistaInicio: "Data Prevista de Início",
  dataPrevistaFim: "Data Prevista de Fim",
};

// NOTA (Fase 2): ATIVIDADE_AJUSTADA está na taxonomia (taxonomia.ts) mas não tem
// gatilho próprio hoje — as únicas escritas em AtividadeConsultor após a criação são
// qtdhor (-> ALOCACAO_ALTERADA acima) e as datas (-> DATA_INCLUIDA/DATA_ALTERADA).
// Não existe rota de "ajustar escopo" (fasid/estruturaAtividadeId são fixados só na
// criação). Fica reservado pra quando essa rota existir.
