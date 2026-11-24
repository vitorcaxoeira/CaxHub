import { useCallback, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { FiltroColuna } from "./FiltroColunaServidor";
import { lerFiltros, lerOrdem, ordemParaTexto, proximaOrdem, type OrdemColuna } from "./estadoColunas";

/**
 * Filtros e ordem por coluna guardados na URL (`?f=` e `?o=`, ou com `prefixo` quando a tela tem duas tabelas: `?rf=`, `?ro=`), para F5,
 * "voltar" e link manterem o recorte. A URL é trocada com `replace` e REPASSANDO o `state` da navegação (é nele que mora a origem do
 * "Voltar para a tela de origem"; sem repassá-lo, trocar um filtro a apagaria). Qualquer mudança de filtro ou de ordem muda `chave`:
 * a tela usa isso para voltar à página 1.
 */
export function useFiltroOrdemNaUrl(prefixo = "") {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const chaveF = `${prefixo}f`;
  const chaveO = `${prefixo}o`;
  const fTexto = params.get(chaveF);
  const oTexto = params.get(chaveO);
  const filtros = useMemo(() => lerFiltros(fTexto), [fTexto]);
  const ordem = useMemo(() => lerOrdem(oTexto), [oTexto]);

  const atualizar = useCallback(
    (mudar: (n: URLSearchParams) => void) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          mudar(n);
          return n;
        },
        { replace: true, state },
      );
    },
    [setParams, state],
  );

  const definirFiltros = useCallback(
    (novos: FiltroColuna[]) => atualizar((n) => (novos.length > 0 ? n.set(chaveF, JSON.stringify(novos)) : n.delete(chaveF))),
    [atualizar, chaveF],
  );
  const aplicarFiltro = useCallback(
    (coluna: string, filtro: FiltroColuna | null) => definirFiltros(filtro ? [...filtros.filter((f) => f.coluna !== coluna), filtro] : filtros.filter((f) => f.coluna !== coluna)),
    [definirFiltros, filtros],
  );
  const definirOrdem = useCallback(
    (nova: OrdemColuna[]) => atualizar((n) => (nova.length > 0 ? n.set(chaveO, ordemParaTexto(nova)) : n.delete(chaveO))),
    [atualizar, chaveO],
  );
  const ordenar = useCallback((coluna: string, aditivo: boolean) => definirOrdem(proximaOrdem(ordem, coluna, aditivo)), [definirOrdem, ordem]);

  return {
    filtros,
    ordem,
    /** Para a query da API (`filtros=` e `ordem=`); undefined quando vazio, para o axios nem mandar. */
    filtrosParam: filtros.length > 0 ? JSON.stringify(filtros) : undefined,
    ordemParam: ordem.length > 0 ? ordemParaTexto(ordem) : undefined,
    aplicarFiltro,
    limparFiltros: () => definirFiltros([]),
    limparOrdem: () => definirOrdem([]),
    /** Tira filtros e ordem de uma vez (troca de tabela). */
    limparTudo: () =>
      atualizar((n) => {
        n.delete(chaveF);
        n.delete(chaveO);
      }),
    ordenar,
    /** Muda quando o filtro ou a ordem mudam: a tela zera a página. */
    chave: `${fTexto ?? ""}|${oTexto ?? ""}`,
  };
}
