import { useMemo, useState, type ReactNode } from "react";
import { normalizarPorPagina, opcoesDePorPagina, POR_PAGINA_PADRAO } from "../../../lib/porPagina";
import { regras } from "./regras";
import { usePadroesTela } from "./usePadroesTela";

// A lista de tamanhos é única (lib/porPagina.ts): 5, 10, 15, 25, 50, 100 e 200. Reexportada aqui para quem já importava deste arquivo.
export { POR_PAGINA_PADRAO, normalizarPorPagina, opcoesDePorPagina };

/**
 * "Por página" de uma lista com a estrela de padrão (12/11/2026): o tamanho da página fica no estado daqui, a estrela grava o valor atual como padrão
 * do usuário (`preferencias_filtros`, tela = `tela`, campo "porPagina": o mesmo mecanismo das estrelas dos filtros) e o padrão salvo é aplicado UMA
 * vez ao abrir a tela. Quem busca no servidor deve esperar `pronto` antes da 1ª consulta (senão busca com o tamanho de fábrica e de novo com o salvo).
 * Padrão salvo que não está mais entre as opções não é forçado (avisa, e a lista abre no tamanho inicial). `ativo` falso: nada é lido nem aplicado
 * (a tela controla o tamanho por fora). As opções são sempre as de `POR_PAGINA_PADRAO`; a tela só informa o `inicial` (fora da lista, vira o maior que cabe).
 *
 *   const pp = usePorPagina({ tela: "financeiro.titulos", inicial: 25 });
 *   <Pagination pageSize={pp.porPagina} onPageSizeChange={pp.mudar} acessorioPorPagina={pp.estrela} .../>
 */
export function usePorPagina({
  tela,
  inicial,
  ativo = true,
}: {
  /** Chave estável da tela nas preferências (ex.: a chave da arrumação das colunas). */
  tela: string;
  inicial: number;
  ativo?: boolean;
}) {
  const [porPagina, setPorPagina] = useState(() => normalizarPorPagina(inicial));
  const lista = useMemo(() => [...POR_PAGINA_PADRAO], []);
  const padroes = usePadroesTela({
    tela,
    soEstrela: !ativo,
    campos: {
      porPagina: { rotulo: "Por página", atual: porPagina, aplicar: setPorPagina, validar: regras.valorUnico("number", lista), semOpcoes: true },
    },
  });
  const estrela: ReactNode = ativo ? padroes.estrela("porPagina") : null;
  return { porPagina, mudar: setPorPagina, opcoes: lista, estrela, pronto: !ativo || padroes.pronto };
}
