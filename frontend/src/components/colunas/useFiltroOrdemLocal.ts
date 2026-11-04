import { useCallback, useState } from "react";
import type { FiltroColuna } from "./FiltroColunaServidor";
import { proximaOrdem, type OrdemColuna } from "./estadoColunas";

/**
 * Filtros e ordem por coluna em `useState` (24/10/2026), para tabelas que NÃO ficam na URL: as pequenas que já vêm inteiras na tela e
 * as que moram dentro de outra (detalhe de um material, fases da obra...), onde um `?f=` só da página seria ambíguo. Mesma forma do
 * useFiltroOrdemNaUrl, então as tabelas trocam de um para o outro sem mudar o resto.
 */
export function useFiltroOrdemLocal() {
  const [filtros, setFiltros] = useState<FiltroColuna[]>([]);
  const [ordem, setOrdem] = useState<OrdemColuna[]>([]);

  const aplicarFiltro = useCallback((coluna: string, filtro: FiltroColuna | null) => {
    setFiltros((atual) => (filtro ? [...atual.filter((f) => f.coluna !== coluna), filtro] : atual.filter((f) => f.coluna !== coluna)));
  }, []);
  const ordenar = useCallback((coluna: string, aditivo: boolean) => setOrdem((atual) => proximaOrdem(atual, coluna, aditivo)), []);

  const limparFiltros = useCallback(() => setFiltros([]), []);
  const limparOrdem = useCallback(() => setOrdem([]), []);
  const limparTudo = useCallback(() => {
    setFiltros([]);
    setOrdem([]);
  }, []);

  return {
    filtros,
    ordem,
    filtrosParam: filtros.length > 0 ? JSON.stringify(filtros) : undefined,
    ordemParam: ordem.length > 0 ? ordem.map((o) => `${o.coluna}:${o.direcao}`).join(",") : undefined,
    aplicarFiltro,
    limparFiltros,
    limparOrdem,
    limparTudo,
    ordenar,
    chave: `${JSON.stringify(filtros)}|${JSON.stringify(ordem)}`,
  };
}
