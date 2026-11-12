import { useMemo, useState, type ReactNode } from "react";
import { regras } from "./regras";
import { usePadroesTela } from "./usePadroesTela";

/** Tamanhos de página que o seletor "Por página" oferece quando a lista não define os seus. */
export const POR_PAGINA_PADRAO: readonly number[] = [10, 25, 50, 100, 200];

/** As opções da lista (ou as padrão) com o tamanho inicial garantido no meio, em ordem crescente (o <select> nunca fica sem a opção atual). */
export function opcoesDePorPagina(opcoes: readonly number[] | undefined, inicial: number): number[] {
  return [...new Set([...(opcoes ?? POR_PAGINA_PADRAO), inicial])].sort((a, b) => a - b);
}

/**
 * "Por página" de uma lista com a estrela de padrão (12/11/2026): o tamanho da página fica no estado daqui, a estrela grava o valor atual como padrão
 * do usuário (`preferencias_filtros`, tela = `tela`, campo "porPagina": o mesmo mecanismo das estrelas dos filtros) e o padrão salvo é aplicado UMA
 * vez ao abrir a tela. Quem busca no servidor deve esperar `pronto` antes da 1ª consulta (senão busca com o tamanho de fábrica e de novo com o salvo).
 * Padrão salvo que não está mais entre as opções não é forçado (avisa, e a lista abre no tamanho inicial). `ativo` falso: nada é lido nem aplicado
 * (a tela controla o tamanho por fora).
 *
 *   const pp = usePorPagina({ tela: "financeiro.titulos", inicial: 30, opcoes: [30, 50, 100] });
 *   <Pagination pageSize={pp.porPagina} opcoesPorPagina={pp.opcoes} onPageSizeChange={pp.mudar} acessorioPorPagina={pp.estrela} .../>
 */
export function usePorPagina({
  tela,
  inicial,
  opcoes,
  ativo = true,
}: {
  /** Chave estável da tela nas preferências (ex.: a chave da arrumação das colunas). */
  tela: string;
  inicial: number;
  opcoes?: readonly number[];
  ativo?: boolean;
}) {
  const [porPagina, setPorPagina] = useState(inicial);
  const lista = useMemo(() => opcoesDePorPagina(opcoes, inicial), [opcoes, inicial]);
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
