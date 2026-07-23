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
