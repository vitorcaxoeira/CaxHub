// Excluir um apontamento que tem pedido de ajuste de horário aguardando o gestor (04/11/2026, pedido do Vitor): a exclusão leva o pedido
// junto, mas só depois de a pessoa ser avisada. Sem isso o apontamento sumia (exclusão lógica) e o pedido continuava "pendente" na fila
// de Aprovações do gestor, apontando para um apontamento que não existe mais.
//
// O aviso é garantido pelo servidor: sem a confirmação explícita (`?excluirAjuste=1`), DELETE /apontamentos/:id responde 409 com
// `codigo: "ajuste_pendente"` e não exclui nada (cobre a tela desatualizada, ex.: pedido feito depois de a lista carregar).

export const CODIGO_AJUSTE_PENDENTE = "ajuste_pendente";

export const MENSAGEM_AJUSTE_PENDENTE =
  "Este apontamento tem uma solicitação de ajuste de horário aguardando o gestor. Ela será excluída junto com o apontamento.";

export interface AjusteDaSessao {
  id: number;
  status: string;
}

export type DecisaoExclusao =
  | { ok: true; ajustesAExcluir: number[] }
  | { ok: false; status: 409; body: { codigo: typeof CODIGO_AJUSTE_PENDENTE; error: string; solicitacaoId: number } };

/** Só o pedido PENDENTE vai junto; aprovado e reprovado ficam como histórico da sessão. */
export function decidirExclusaoComAjuste(ajustes: AjusteDaSessao[], confirmouExcluirAjuste: boolean): DecisaoExclusao {
  const pendentes = ajustes.filter((a) => a.status === "pendente").map((a) => a.id);
  if (pendentes.length > 0 && !confirmouExcluirAjuste) {
    return { ok: false, status: 409, body: { codigo: CODIGO_AJUSTE_PENDENTE, error: MENSAGEM_AJUSTE_PENDENTE, solicitacaoId: pendentes[0] } };
  }
  return { ok: true, ajustesAExcluir: pendentes };
}

/** `?excluirAjuste=1` (ou `true`): a pessoa já viu o aviso e confirmou. */
export function confirmouExcluirAjuste(valor: unknown): boolean {
  return valor === "1" || valor === "true";
}
