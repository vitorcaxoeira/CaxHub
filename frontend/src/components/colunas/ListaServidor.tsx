import axios from "axios";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { Pagination } from "../ui/Pagination";
import { SkeletonLinhas } from "../ui/Skeleton";
import { ChipOrdem, ChipsFiltros } from "./ChipsFiltros";
import { valoresDoServidor, type ColunaApi } from "./ThColuna";
import { type DefColuna, titulosDe, useColunasConfiguraveis } from "./useColunasConfiguraveis";
import { useCalculadasServidor } from "./useCalculadasServidor";
import { useFiltroOrdemLocal } from "./useFiltroOrdemLocal";
import { useResumoServidor } from "./useResumoServidor";

/**
 * Lista paginada do SERVIDOR com colunas configuráveis, filtro e ordem por coluna, resumo no rodapé e colunas calculadas por fórmula
 * (29/10/2026). É o par de `registrarListaConsultavel` (backend/src/routes/listaConsultavel.ts): a rota atende `url`, `url/resumo` e
 * `url/valores`. A tela passa só os filtros do topo em `params`; página, filtro e ordem por coluna ficam aqui (estado local, a tela pode
 * ter vários na mesma página). `defs` precisa ser estável (constante do módulo ou useMemo).
 */
export interface Resposta<T> {
  colunas: ColunaApi[];
  calculadasComProblema?: Record<string, string>;
  itens: T[];
  total: number;
  totais?: Record<string, number>;
  page: number;
  pageSize: number;
}

interface Props<T, C> {
  /** Chave da arrumação das colunas e das calculadas (ex.: "financeiro.recebimentos"). */
  chave: string;
  url: string;
  /** Filtros do topo da tela (mudou, volta à página 1). */
  params: Record<string, unknown>;
  defs: DefColuna<T, C>[];
  /** Contexto que as colunas recebem em `render` (ex.: ação por linha, estado da tela). */
  ctx?: C;
  chaveLinha: (linha: T, indice: number) => string;
  /** Pagination.label e o texto de "nada encontrado" (ex.: "recebimentos"). */
  rotulo: string;
  vazio: string;
  pageSize?: number;
  /** Tamanhos de página que a pessoa pode escolher (Pagination); sem isso, fixo em `pageSize`. */
  opcoesPorPagina?: number[];
  /** Muda para buscar de novo sem mudar os filtros (ex.: depois de uma ação). */
  recarga?: unknown;
  onLinha?: (linha: T) => void;
  /** Linha que abre ao clicar (uma por vez), com este conteúdo logo abaixo dela. Vale em lugar de `onLinha`. */
  detalhe?: (linha: T) => ReactNode;
  classeLinha?: (linha: T) => string | undefined;
  /** Mostrado acima da tabela, ao lado dos chips (ex.: totais da lista). */
  topo?: (dados: Resposta<T> | null) => ReactNode;
  /** Mostrado entre a tabela e a paginação (ex.: totais do filtro, que vêm em `dados.totais`). */
  rodape?: (dados: Resposta<T> | null) => ReactNode;
  /** Avisa a tela quando a resposta chega (ex.: total de registros em outro lugar). */
  aoCarregar?: (dados: Resposta<T>) => void;
  /** Altura máxima da área rolável. */
  alturaMax?: string;
}

export function ListaServidor<T extends object, C = undefined>({
  chave,
  url,
  params,
  defs: base,
  ctx,
  chaveLinha,
  rotulo,
  vazio,
  pageSize: pageSizeInicial = 50,
  opcoesPorPagina,
  recarga,
  onLinha,
  detalhe,
  classeLinha,
  topo,
  rodape,
  aoCarregar,
  alturaMax = "max-h-[70vh]",
}: Props<T, C>) {
  const titulosBase = useMemo(() => titulosDe(base), [base]);
  const estado = useFiltroOrdemLocal();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeInicial);
  const [dados, setDados] = useState<Resposta<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  const calc = useCalculadasServidor(chave, titulosBase, dados?.colunas, dados?.itens, dados?.calculadasComProblema);
  const defs = useMemo(() => [...base, ...calc.defs] as DefColuna<T, C>[], [base, calc.defs]);
  const tc = useColunasConfiguraveis(chave, defs, { calculadas: calc.painel });

  const paramsFixos = { ...params, calculadas: calc.param };
  const chaveParams = JSON.stringify(paramsFixos);
  const valores = (coluna: string) => valoresDoServidor(`${url}/valores`, paramsFixos, estado.filtrosParam, coluna);
  const resumo = useResumoServidor(`${url}/resumo`, { ...paramsFixos, filtros: estado.filtrosParam }, tc.pedidosResumo, recarga);

  useEffect(() => {
    setPage(1);
    setAberta(null);
  }, [chaveParams, estado.chave]);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    axios
      .get<Resposta<T>>(url, { params: { ...paramsFixos, filtros: estado.filtrosParam, ordem: estado.ordemParam, page, pageSize } })
      .then(({ data }) => {
        if (cancelado) return;
        setDados(data);
        setErro(null);
        aoCarregar?.(data);
      })
      .catch((err) => !cancelado && setErro(err.response?.data?.error ?? "Falha ao carregar a lista"))
      .finally(() => !cancelado && setLoading(false));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveParams, estado.chave, page, pageSize, recarga]);

  const filtrando = estado.filtros.length > 0;
  const cabecalhoExtra = topo?.(dados);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {(filtrando || estado.ordem.length > 0 || cabecalhoExtra) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <ChipsFiltros
            filtros={estado.filtros}
            coluna={(n) => {
              const c = dados?.colunas.find((x) => x.nome === n);
              return c ? { tipo: c.tipo, dominio: c.dominio, titulo: calc.titulos[n] } : undefined;
            }}
            onRemover={(n) => estado.aplicarFiltro(n, null)}
            onLimpar={estado.limparFiltros}
          />
          <ChipOrdem ordem={estado.ordem} titulos={calc.titulos} onLimpar={estado.limparOrdem} />
          {cabecalhoExtra}
        </div>
      )}
      {erro && <p className="px-3 py-2 text-sm text-destructive">{erro}</p>}
      <div className={cn("overflow-auto", alturaMax)}>
        <table className={tc.classeTabela} style={tc.estiloTabela} aria-busy={loading}>
          {tc.colgroup}
          <thead className="sticky top-0 z-10">{tc.cabecalho({ colunas: dados?.colunas, estado, valores })}</thead>
          <tbody>
            {loading && <SkeletonLinhas linhas={6} colunas={tc.nColunas} />}
            {!loading &&
              dados?.itens.map((l, i) => {
                const chaveL = chaveLinha(l, i);
                const clicavel = !!(onLinha || detalhe);
                const aoClicar = detalhe ? () => setAberta((a) => (a === chaveL ? null : chaveL)) : onLinha ? () => onLinha(l) : undefined;
                return (
                  <Fragment key={chaveL}>
                    <tr
                      className={cn("border-t border-border/60", clicavel && "cursor-pointer hover:bg-surface-2", aberta === chaveL && "bg-surface-2", classeLinha?.(l))}
                      onClick={aoClicar}
                    >
                      {tc.celulas(l, ctx as C)}
                    </tr>
                    {detalhe && aberta === chaveL && (
                      <tr className="border-t border-border/60 bg-surface-2/40">
                        <td colSpan={tc.nColunas} className="px-5 py-3">
                          {detalhe(l)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            {!loading && dados?.itens.length === 0 && (
              <tr>
                <td colSpan={tc.nColunas} className="px-5 py-8 text-center text-sm text-muted">
                  {filtrando ? "Nada encontrado com esses filtros." : vazio}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">{tc.rodape({ colunas: dados?.colunas, ...resumo })}</tfoot>
        </table>
      </div>
      {rodape?.(dados)}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={dados?.total ?? 0}
        loading={loading}
        onPageChange={setPage}
        label={rotulo}
        opcoesPorPagina={opcoesPorPagina}
        onPageSizeChange={opcoesPorPagina ? (n) => { setPageSize(n); setPage(1); } : undefined}
      />
    </div>
  );
}
