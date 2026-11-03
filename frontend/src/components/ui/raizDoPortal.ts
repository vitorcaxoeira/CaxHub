/**
 * Onde um popover flutuante (funil, painel de colunas) deve ser montado. Um `<dialog>` aberto com showModal() fica na camada superior do
 * navegador, acima de qualquer coisa fora dele (nem z-index vence): o popover aberto de dentro de um modal precisa morar dentro do modal.
 * Fora de modal devolve undefined e o FloatingPortal usa o body.
 */
export function raizDoPortal(referencia: Element | null | undefined): HTMLElement | undefined {
  return (referencia?.closest("dialog") as HTMLElement | null) ?? undefined;
}
