// Domínio "USU_LSITRAT" do Senior (situação da RAT — Registro de Atividade Técnica).
// Valores confirmados via getFieldDomainValues("USU_LSITRAT") direto no dicionário do
// Senior (não é suposição).
export const SITRAT_LABELS: Record<number, string> = {
  9: "Digitado",
  8: "Impresso",
  6: "Aprovado",
  5: "Cancelado",
  4: "Faturado",
  2: "Faturado Parcial",
  1: "Fechado",
};

// Ordem de exibição do filtro (28/08/2026) — mesmo espírito de fluxo de trabalho já usado
// pra priorizar sitrat=9 (Digitado, precisa de ação) primeiro na listagem de GET /rats;
// não dá pra confiar em Object.keys(SITRAT_LABELS) pra isso (chaves numéricas em objeto JS
// são enumeradas em ordem crescente, não na ordem de inserção do literal acima).
export const SITRAT_ORDER = [9, 8, 6, 5, 4, 2, 1];

// RAT cancelada no Senior — usado por quem SOMA horas (domain/resumoConsultor.ts) pra excluir
// da conta; a listagem (routes/rats.ts) continua mostrando a linha normalmente, só com o tom
// "destructive" (ver sitratTone abaixo). Uma RAT cancelada não vira trabalho realizado.
export const SITRAT_CANCELADO = 5;

export function sitratLabel(sitrat: number | null): string {
  if (sitrat === null) return "—";
  return SITRAT_LABELS[sitrat] ?? `Situação ${sitrat}`;
}

export function sitratTone(sitrat: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (sitrat === 5) return "destructive";
  if (sitrat === 9) return "warning"; // ainda digitado/rascunho, não confirmado
  if (sitrat === null) return "neutral";
  return "success"; // impresso/aprovado/faturado/fechado
}

// Status agregado de integração da RAT com o Senior (28/08/2026) — construído em cima da fila
// já existente (backend/src/sync/outboxSenior.ts, SincronizacaoPendente), sem inventar um novo
// conceito de status. Mesma classificação visual já usada por item em AcaoIntegracao
// (frontend/src/pages/projetos/MeusApontamentos.tsx): confirmado (numrat preenchido) vence
// tudo; senão, pendência com erro = falha; pendência sem erro (em voo ou recém-enfileirada) =
// enviando; sem pendência nenhuma (nunca enfileirado, ou desvinculado) = pendente.
export type IntegracaoErpStatus = "sincronizado" | "enviando" | "falha" | "pendente";

export const INTEGRACAO_ERP_LABELS: Record<IntegracaoErpStatus, string> = {
  sincronizado: "Sincronizado",
  enviando: "Enviando",
  falha: "Falha no envio",
  pendente: "Pendente",
};

export function integracaoErpLabel(status: IntegracaoErpStatus): string {
  return INTEGRACAO_ERP_LABELS[status];
}

export function integracaoErpTone(status: IntegracaoErpStatus): "success" | "warning" | "destructive" | "neutral" {
  if (status === "falha") return "destructive";
  if (status === "enviando") return "warning";
  if (status === "pendente") return "neutral";
  return "success";
}

function classificarItemIntegracao(
  numrat: number | null,
  pendencia?: { status: string; ultimoErro: string | null }
): IntegracaoErpStatus {
  if (numrat != null) return "sincronizado";
  if (!pendencia) return "pendente";
  if (pendencia.ultimoErro) return "falha";
  return "enviando"; // "enviando" de verdade, ou "pendente" na fila mas sem erro ainda
}

// Agregado por RAT: pior caso vence (falha > enviando > pendente > sincronizado). RAT sem
// nenhum item cai em "pendente" por default. IMPORTANTE: quem monta `itens` precisa já ter
// filtrado a pendência por `tipo: "criar_apontamento"` — toda RAT aprovada também enfileira uma
// pendência `aprovar_rat` sem canal publicado no Senior, que fica "pendente" pra sempre e
// contaminaria esse agregado se não for excluída antes (ver GET /rats em routes/rats.ts).
export function calcularIntegracaoErp(
  itens: { numrat: number | null; pendencia?: { status: string; ultimoErro: string | null } }[]
): IntegracaoErpStatus {
  if (itens.length === 0) return "pendente";
  const classificados = itens.map((i) => classificarItemIntegracao(i.numrat, i.pendencia));
  if (classificados.includes("falha")) return "falha";
  if (classificados.includes("enviando")) return "enviando";
  if (classificados.includes("pendente")) return "pendente";
  return "sincronizado";
}
