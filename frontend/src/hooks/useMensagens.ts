import { useCallback, useMemo, useRef } from "react";
import { useToast } from "../components/ui/Toast";

/**
 * As mensagens de uma tela como aviso no canto inferior (o Toast do CaxHub), em vez de caixas dentro da página (24/11/2026, pedido do Vitor). As funções
 * são ESTÁVEIS (o contexto do toast muda a cada aviso; o `ref` evita que um `useCallback`/`useEffect` da tela refaça a busca a cada mensagem), então
 * podem entrar nas dependências sem efeito colateral. `erro(null)` não faz nada: dá para trocar o antigo `setErro(...)` direto.
 *
 *   const msg = useMensagens();
 *   msg.erro("Falha ao carregar");   msg.sucesso("Salvo");   msg.atencao("Falta importar X");
 */
export function useMensagens() {
  const toast = useToast();
  const ref = useRef(toast);
  ref.current = toast;
  const erro = useCallback((texto: string | null | undefined): void => {
    if (texto) ref.current.mostrar(texto, "destructive");
  }, []);
  const sucesso = useCallback((texto: string | null | undefined): void => {
    if (texto) ref.current.mostrar(texto, "success");
  }, []);
  const atencao = useCallback((texto: string | null | undefined): void => {
    if (texto) ref.current.mostrar(texto, "warning");
  }, []);
  return useMemo(() => ({ erro, sucesso, atencao }), [erro, sucesso, atencao]);
}
