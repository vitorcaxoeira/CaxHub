// Painel de Eficiência — exclusão de apontamento do cálculo DO PAINEL (funções puras, sem Prisma).
//
// A exclusão vale só no painel: não altera RAT, o teto/realizado da Alocação, o Senior nem o relatório de
// produtividade. Quem decide é o gestor do item (ou admin), com motivo obrigatório; restaurar devolve a hora à conta.
// O efeito no SQL está em domain/eficienciaDados.ts (RAT_ITEM_CONTA_NO_PAINEL); aqui ficam as regras que se testam sem banco.

export const MOTIVOS_EXCLUSAO = [
  { chave: "treinamento", rotulo: "Treinamento / shadowing" },
  { chave: "retrabalho", rotulo: "Retrabalho interno (não cobrar)" },
  { chave: "indevido", rotulo: "Apontamento indevido" },
  { chave: "outro", rotulo: "Outro" },
] as const;

export type MotivoExclusao = (typeof MOTIVOS_EXCLUSAO)[number]["chave"];

export const OBSERVACAO_EXCLUSAO_MAX = 300;

export function rotuloMotivoExclusao(chave: string): string {
  return MOTIVOS_EXCLUSAO.find((m) => m.chave === chave)?.rotulo ?? chave;
}

export type ValidacaoExclusao = { ok: true; motivo: MotivoExclusao; observacao: string | null } | { ok: false; erro: string };

// Motivo precisa estar na lista fechada; "Outro" exige observação (é o único em que o motivo sozinho não explica nada).
export function validarExclusao(corpo: unknown): ValidacaoExclusao {
  const c = (corpo ?? {}) as { motivo?: unknown; observacao?: unknown };
  const motivo = MOTIVOS_EXCLUSAO.find((m) => m.chave === c.motivo)?.chave;
  if (!motivo) return { ok: false, erro: "Informe o motivo da exclusão." };
  if (c.observacao != null && typeof c.observacao !== "string") return { ok: false, erro: "Observação inválida." };
  const observacao = typeof c.observacao === "string" ? c.observacao.trim() : "";
  if (observacao.length > OBSERVACAO_EXCLUSAO_MAX) {
    return { ok: false, erro: `A observação passa de ${OBSERVACAO_EXCLUSAO_MAX} caracteres.` };
  }
  if (motivo === "outro" && observacao.length === 0) return { ok: false, erro: 'Para o motivo "Outro", descreva na observação.' };
  return { ok: true, motivo, observacao: observacao || null };
}

// O "realizado" de uma alocação (domain/tetoAtividade.ts) é compartilhado e não conhece a exclusão do painel.
// Depois dele, desconta-se o que foi excluído, nunca abaixo de zero.
export function descontarExcluido(realizado: number, excluido: number): number {
  return Math.max(0, realizado - Math.max(0, excluido));
}
