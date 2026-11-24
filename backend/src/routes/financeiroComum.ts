import { Prisma } from "@prisma/client";

// Peças comuns das listas de títulos a receber (Contas a Receber e Fluxo de Caixa operacional).

// Descrições do domínio "LSitTit" do Senior (situação do título a receber).
export const SITTIT_LABELS: Record<string, string> = {
  AO: "Aberto ao Órgão de Proteção ao Crédito",
  AN: "Aberto Negociação",
  AA: "Aberto Advogado",
  AB: "Aberto Normal",
  AC: "Aberto Cartório",
  AE: "Aberto Encontro de Contas",
  AI: "Aberto Impostos",
  AJ: "Aberto Retorno Jurídico",
  AP: "Aberto Protestado",
  AR: "Aberto Representante",
  AS: "Aberto Suspenso",
  AV: "Aberto Gestão de Pessoas",
  AX: "Aberto Externo",
  CA: "Cancelado",
  CE: "Aberto CE (Preparação Cobrança Escritural)",
  CO: "Aberto Cobrança",
  LQ: "Liquidado Normal",
  LC: "Liquidado Cartório",
  LI: "Liquidado Impostos",
  LM: "Liquidado Compensado",
  LO: "Liquidado Cobrança",
  LP: "Liquidado Protestado",
  LS: "Liquidado Substituído",
  LV: "Liquidado Gestão de Pessoas",
  LX: "Liquidado Externo",
  PE: "Aberto PE (Pagamento Eletrônico)",
};

// Rótulo e tom da situação em SQL (a lista filtra e ordena pela situação no servidor). Mesma regra do CaxHub_Dash (pagarComum.ts).
export const situacaoSql = {
  rotulo: Prisma.sql`(CASE WHEN t.sittit = 'AB' THEN (CASE WHEN t.vctpro < CURRENT_DATE THEN 'Vencido' ELSE 'A Vencer' END)
    ${Prisma.join(Object.entries(SITTIT_LABELS).map(([k, v]) => Prisma.sql`WHEN t.sittit = ${k} THEN ${v}`), " ")} ELSE t.sittit END)`,
  tom: Prisma.sql`(CASE WHEN t.sittit = 'AB' THEN (CASE WHEN t.vctpro < CURRENT_DATE THEN 'destructive' ELSE 'success' END)
    WHEN t.sittit LIKE 'L%' THEN 'success' WHEN t.sittit = 'CA' THEN 'destructive' ELSE 'warning' END)`,
};
