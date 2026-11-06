import axios from "axios";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { baixarPdfDoServidor } from "../relatorio/relatorioComum";
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
  /**
   * Linhas abertas controladas pela tela (04/11/2026, RATs de Meus Apontamentos): várias ao mesmo tempo, e a tela pode abrir uma sozinha
   * (ex.: depois de confirmar um apontamento). Com isto, o clique chama `onAlternarAberta` em vez de abrir uma por vez, e trocar filtro
   * ou página não fecha nada (quem decide é a tela).
   */
  abertas?: ReadonlySet<string>;
  onAlternarAberta?: (linha: T, chave: string) => void;
  /** Ajuste da linha feito pela tela sem recarregar a lista (ex.: número da RAT que o Senior acabou de devolver). */
  ajustarLinha?: (linha: T) => T;
  /** Avisa a tela quando os filtros de coluna (ou as calculadas) mudam, no formato dos parâmetros da API (ex.: ação em lote que respeita o filtro). */
  aoMudarConsulta?: (consulta: { filtros?: string; calculadas?: string }) => void;
  classeLinha?: (linha: T) => string | undefined;
  /** Mostrado acima da tabela, ao lado dos chips (ex.: totais da lista). */
  topo?: (dados: Resposta<T> | null) => ReactNode;
  /** Mostrado entre a tabela e a paginação (ex.: totais do filtro, que vêm em `dados.totais`). */
  rodape?: (dados: Resposta<T> | null) => ReactNode;
  /** Avisa a tela quando a resposta chega (ex.: total de registros em outro lugar). */
  aoCarregar?: (dados: Resposta<T>) => void;
  /** Avisa a tela quando a lista falha (ex.: 403 vira a mensagem de "sem acesso" da própria tela). */
  aoErro?: (status: number | undefined, mensagem: string) => void;
  /** Altura máxima da área rolável (com rolagem vertical própria). Sem ela, a tabela cresce com a página, como antes do kit de colunas. */
  alturaMax?: string;
  /**
   * Mostra "Exportar CSV" (05/11/2026): baixa TODAS as linhas do filtro atual (não só a página), na ordem escolhida e só com as colunas visíveis,
   * pelo GET `<url>/csv` que `registrarListaConsultavel` registra. O valor é o nome base do arquivo (ex.: "descontos-parcelas").
   */
  exportavel?: string;
  /** Texto do botão de exportação (padrão "Exportar CSV"; o arquivo abre direto no Excel, ex.: "Exportar Excel"). */
  rotuloExportar?: string;
  /**
   * Mostra "Imprimir" (06/11/2026): abre em aba nova o relatório impresso (/relatorio/lista) com TODAS as linhas do filtro atual, na ordem
   * escolhida e só com as colunas visíveis, pelo GET `<url>/impressao` que `registrarListaConsultavel` registra.
   */
  imprimir?: { titulo: string };
  /**
   * Mostra "Exportar PDF" (06/11/2026): o mesmo relatório do "Imprimir", gerado no servidor, com TODAS as linhas do filtro (sem o corte de 5.000 do
   * relatório de tela) e texto inteiro nas células. `arquivo` é o nome base do PDF.
   */
  pdf?: { titulo: string; arquivo: string };
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
  abertas,
  onAlternarAberta,
  ajustarLinha,
  aoMudarConsulta,
  classeLinha,
  topo,
  rodape,
  aoCarregar,
  aoErro,
  alturaMax,
  exportavel,
  rotuloExportar = "Exportar CSV",
  imprimir,
  pdf,
}: Props<T, C>) {
  const titulosBase = useMemo(() => titulosDe(base), [base]);
  const estado = useFiltroOrdemLocal();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizeInicial);
  const [dados, setDados] = useState<Resposta<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

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
    aoMudarConsulta?.({ filtros: estado.filtrosParam, calculadas: calc.param });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.filtrosParam, calc.param]);

  const controladas = abertas != null;
  const estaAberta = (chaveL: string) => (controladas ? abertas.has(chaveL) : aberta === chaveL);

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
      .catch((err) => {
        if (cancelado) return;
        const mensagem = err.response?.data?.error ?? "Falha ao carregar a lista";
        setErro(mensagem);
        aoErro?.(err.response?.status, mensagem);
      })
      .finally(() => !cancelado && setLoading(false));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveParams, estado.chave, page, pageSize, recarga]);

  // Parâmetros de exportação/impressão: os da lista + filtros e ordem por coluna + colunas visíveis (na ordem da tela) com os títulos da tela.
  function parametrosDeExportacao() {
    const cabecalhos = Object.fromEntries(tc.layout.visiveis.map((n) => [n, calc.titulos[n] ?? n]));
    return { ...paramsFixos, filtros: estado.filtrosParam, ordem: estado.ordemParam, colunasCsv: tc.layout.visiveis.join(","), cabecalhos: JSON.stringify(cabecalhos) };
  }

  async function exportarPdf() {
    if (!pdf) return;
    setGerandoPdf(true);
    try {
      await baixarPdfDoServidor(`${url}/pdf`, { titulo: pdf.titulo, params: parametrosDeExportacao(), orientacao: "paisagem", tema: "claro" }, `${pdf.arquivo}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o PDF");
    } finally {
      setGerandoPdf(false);
    }
  }

  function abrirImpressao() {
    if (!imprimir) return;
    // A aba nova lê a especificação do relatório no localStorage (mesma origem); a chave vai na URL.
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      localStorage.setItem(`caxhub-relatorio-lista:${id}`, JSON.stringify({ titulo: imprimir.titulo, url, params: parametrosDeExportacao(), criadoEm: Date.now() }));
    } catch {
      setErro("Não foi possível preparar a impressão neste navegador");
      return;
    }
    window.open(`/relatorio/lista/${id}`, "_blank");
  }

  async function exportarCsv() {
    if (!exportavel) return;
    setExportando(true);
    try {
      const { data } = await axios.get<Blob>(`${url}/csv`, { params: parametrosDeExportacao(), responseType: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(data);
      link.download = `${exportavel}_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setErro("Não foi possível exportar");
    } finally {
      setExportando(false);
    }
  }

  const filtrando = estado.filtros.length > 0;
  const cabecalhoExtra = topo?.(dados);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {(filtrando || estado.ordem.length > 0 || cabecalhoExtra || exportavel || imprimir || pdf) && (
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
          {(exportavel || imprimir || pdf) && (
            <div className="ml-auto flex items-center gap-2">
              {exportavel && (
                <button
                  type="button"
                  onClick={exportarCsv}
                  disabled={exportando || loading || (dados?.total ?? 0) === 0}
                  title="Baixa todas as linhas do filtro atual, com as colunas visíveis (abre no Excel)"
                  className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportando ? "Exportando…" : rotuloExportar}
                </button>
              )}
              {pdf && (
                <button
                  type="button"
                  onClick={exportarPdf}
                  disabled={gerandoPdf || loading || (dados?.total ?? 0) === 0}
                  title="Gera um PDF com todas as linhas do filtro atual e as colunas visíveis, sem cortar nada (listas grandes podem levar alguns segundos)"
                  className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {gerandoPdf ? "Gerando PDF…" : "Exportar PDF"}
                </button>
              )}
              {imprimir && (
                <button
                  type="button"
                  onClick={abrirImpressao}
                  disabled={loading || (dados?.total ?? 0) === 0}
                  title="Abre o relatório para imprimir (ou salvar em PDF) com todas as linhas do filtro atual e as colunas visíveis"
                  className="rounded-md border border-border px-2.5 py-1 text-[12.5px] text-muted transition hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Imprimir
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {erro && <p className="px-3 py-2 text-sm text-destructive">{erro}</p>}
      <div className={cn(alturaMax ? "overflow-auto" : "overflow-x-auto", alturaMax)}>
        <table className={tc.classeTabela} style={tc.estiloTabela} aria-busy={loading}>
          {tc.colgroup}
          <thead className="sticky top-0 z-10">{tc.cabecalho({ colunas: dados?.colunas, estado, valores })}</thead>
          <tbody>
            {loading && <SkeletonLinhas linhas={6} colunas={tc.nColunas} />}
            {!loading &&
              dados?.itens.map((original, i) => {
                const l = ajustarLinha ? ajustarLinha(original) : original;
                const chaveL = chaveLinha(l, i);
                const clicavel = !!(onLinha || detalhe);
                const aoClicar = detalhe
                  ? controladas
                    ? () => onAlternarAberta?.(l, chaveL)
                    : () => setAberta((a) => (a === chaveL ? null : chaveL))
                  : onLinha
                    ? () => onLinha(l)
                    : undefined;
                const abertaAqui = detalhe != null && estaAberta(chaveL);
                return (
                  <Fragment key={chaveL}>
                    <tr
                      className={cn("border-t border-border/60", clicavel && "cursor-pointer hover:bg-surface-2", abertaAqui && "bg-surface-2", classeLinha?.(l))}
                      onClick={aoClicar}
                    >
                      {tc.celulas(l, ctx as C)}
                    </tr>
                    {detalhe && abertaAqui && (
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
