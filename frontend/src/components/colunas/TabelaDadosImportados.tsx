import axios from "axios";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "../ui/Pagination";
import { usePorPagina } from "../ui/padroesFiltros/usePorPagina";
import { Skeleton } from "../ui/Skeleton";
import { ChipOrdem, ChipsFiltros } from "./ChipsFiltros";
import type { ColunaComFiltro, RespostaValores } from "./FiltroColunaServidor";
import { type DefColuna, useColunasConfiguraveis } from "./useColunasConfiguraveis";
import { useFiltroOrdemNaUrl } from "./useFiltroOrdemNaUrl";
import type { FuncaoResumo } from "./resumo";
import { useResumoServidor } from "./useResumoServidor";

// Tabela das telas "Ver dados" (ERP, HCM e Plannix), 24/10/2026: tudo no SERVIDOR, para qualquer tamanho de tabela. Busca de texto (com
// debounce), funil por coluna com as abas Condição e Valores (FiltroColunaServidor), ordenação por até 4 colunas (Shift+clique), chips dos
// filtros ativos, paginação e rodapé de totais. Filtro e ordem ficam na URL (`?f=`, `?o=`), então F5, "voltar" e link mantêm o recorte.
// Trazido de volta do CaxHub_Dash em 03/11/2026 (lá unificou DadosErp e DadosPlannix).

export interface ColunaDados extends ColunaComFiltro {
  ehChave: boolean;
  ehControle: boolean;
}

export interface RespostaDadosBase {
  colunas: ColunaDados[];
  total: number;
  itens: Record<string, unknown>[];
}

const PAGE_SIZE = 30;
// O servidor aceita até 1.000 por página (PAGE_SIZE_MAXIMO em sync/dadosSincronizados.ts).
const OPCOES_POR_PAGINA = [30, 50, 100, 200, 500];

// Resumos do rodapé que a rota `<endpoint>/resumo` calcula (agregação do Prisma: sem mediana nem distintos; ver
// backend/src/sync/dadosSincronizados.ts, FUNCOES_RESUMO_DADOS). Coluna com domínio é código: só contagem/vazios.
const RESUMOS_DADOS: FuncaoResumo[] = ["soma", "media", "minimo", "maximo", "contagem", "vazios", "sim", "nao", "pctSim"];
const RESUMOS_CODIGO: FuncaoResumo[] = ["contagem", "vazios"];

// Data-só-dia (@db.Date chega como meia-noite UTC) vira dd/mm/aaaa; data com hora vira dd/mm/aaaa hh:mm no fuso local. Texto de data é
// montado na mão, sem `new Date(...)` no caso de dia puro, pra não deslocar o dia em America/Sao_Paulo.
function formatarData(iso: string): string {
  if (iso.endsWith("T00:00:00.000Z")) {
    const [ano, mes, dia] = iso.slice(0, 10).split("-");
    return `${dia}/${mes}/${ano}`;
  }
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatarValorDado(valor: unknown, coluna: Pick<ColunaDados, "tipo" | "dominio">): string {
  if (valor === null || valor === undefined) return "—";
  // Coluna com domínio documentado no schema: "código · rótulo" (código fora do domínio fica só o código).
  if (coluna.dominio) {
    const op = coluna.dominio.find((o) => o.valor === String(valor));
    if (op) return `${op.valor} · ${op.rotulo}`;
  }
  if (coluna.tipo === "data" && typeof valor === "string") return formatarData(valor);
  if (coluna.tipo === "booleano") return valor ? "sim" : "não";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

interface Props<R extends RespostaDadosBase> {
  /** Endereço da lista (`/api/sync-erp/<job>/dados`); os valores de uma coluna vêm de `<endpoint>/valores`. */
  endpoint: string;
  /** Parâmetros fixos da tela (ex.: a tabela escolhida no Plannix). */
  paramsExtras?: Record<string, string | undefined>;
  /** Muda quando é OUTRA tabela: zera busca, página, filtros e ordem. */
  reinicia: string;
  mensagemVazio: string;
  tituloControle: string;
  /** Algo ao lado da busca (ex.: o seletor de tabela do Plannix). */
  barraExtra?: (resposta: R | null) => ReactNode;
  /** A página mostra o título e a descrição com o que a resposta traz (nome da tabela, origem...). */
  onResposta?: (resposta: R | null) => void;
}

type LinhaDados = Record<string, unknown>;

/** Chave da arrumação de colunas de uma tabela: as telas "Ver dados" têm uma tabela por job, cada uma com as suas colunas. */
const chaveDaTabela = (reinicia: string) => `admin.dados.${reinicia.toLowerCase().replace(/[^a-z0-9._-]+/g, ".")}`.slice(0, 80);

export function TabelaDadosImportados<R extends RespostaDadosBase>({ endpoint, paramsExtras, reinicia, mensagemVazio, tituloControle, barraExtra, onResposta }: Props<R>) {
  const colunasEstado = useFiltroOrdemNaUrl();
  const { filtros, ordem, filtrosParam, ordemParam, aplicarFiltro, limparFiltros, limparOrdem, limparTudo, chave } = colunasEstado;
  const [resposta, setResposta] = useState<R | null>(null);
  const [pagina, setPagina] = useState(1);
  // "Por página" com a estrela de padrão (12/11/2026): um padrão só para todas as tabelas do Ver dados; a 1ª consulta espera o padrão salvo.
  const pp = usePorPagina({ tela: "admin.ver-dados", inicial: PAGE_SIZE, opcoes: OPCOES_POR_PAGINA });
  const porPagina = pp.porPagina;
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const extras = JSON.stringify(paramsExtras ?? {});

  // Outra tabela: zera tudo (filtros e ordem falam de colunas da tabela anterior). Na montagem não mexe: a URL pode vir com recorte.
  const anterior = useRef(reinicia);
  useEffect(() => {
    if (anterior.current === reinicia) return;
    anterior.current = reinicia;
    setBusca("");
    setPagina(1);
    setResposta(null);
    setErro(null);
    limparTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reinicia]);

  // Mudou o filtro ou a ordem: volta à página 1.
  useEffect(() => setPagina(1), [chave]);

  useEffect(() => {
    if (!pp.pronto) return;
    let cancelado = false;
    const timer = window.setTimeout(
      () => {
        setCarregando(true);
        axios
          .get<R>(endpoint, { params: { ...JSON.parse(extras), busca, page: pagina, pageSize: porPagina, filtros: filtrosParam, ordem: ordemParam } })
          .then(({ data }) => {
            if (cancelado) return;
            setResposta(data);
            setErro(null);
          })
          .catch((err) => !cancelado && setErro(err.response?.data?.error ?? "Falha ao carregar os dados"))
          .finally(() => !cancelado && setCarregando(false));
      },
      busca ? 250 : 0,
    );
    return () => {
      cancelado = true;
      window.clearTimeout(timer);
    };
  }, [endpoint, extras, busca, pagina, porPagina, pp.pronto, filtrosParam, ordemParam]);

  useEffect(() => onResposta?.(resposta), [resposta]); // eslint-disable-line react-hooks/exhaustive-deps

  const colunas = useMemo(() => resposta?.colunas ?? [], [resposta]);
  const itens = resposta?.itens ?? [];
  const totalRegistros = resposta?.total ?? 0;
  const colunaPorNome = (nome: string) => colunas.find((c) => c.nome === nome);

  const carregarValores = (coluna: string) => (termo: string) =>
    axios.get<RespostaValores>(`${endpoint}/valores`, { params: { ...JSON.parse(extras), coluna, termo, busca, filtros: filtrosParam } }).then(({ data }) => data);

  // As colunas vêm da resposta (uma tabela por job). As definições só mudam quando mudam as colunas, não a cada página carregada: a chave
  // do useMemo é o "esqueleto" delas (nome, tipo, chave, controle), para o painel e a arrumação do usuário não piscarem ao paginar.
  const esqueleto = colunas.map((c) => `${c.nome}:${c.tipo}:${c.ehChave ? 1 : 0}${c.ehControle ? 1 : 0}`).join("|");
  const defs = useMemo<DefColuna<LinhaDados>[]>(
    () =>
      colunas.map(
        (c): DefColuna<LinhaDados> => {
          const numerica = (c.tipo === "inteiro" || c.tipo === "decimal") && !c.dominio;
          return {
            nome: c.nome,
            titulo: c.nome,
            cabecalho: (
              <>
                {c.nome}
                {c.ehChave ? " ★" : ""}
              </>
            ),
            dica: c.ehChave ? "Chave" : c.ehControle ? tituloControle : undefined,
            direita: numerica,
            largura: c.dominio ? 220 : numerica ? 120 : 160,
            // Domínio: "código · rótulo" alinhado à esquerda, cortado com "…" e inteiro no mouse. Número: fonte do corpo, não mono.
            classe: `${c.ehControle ? "text-muted" : "text-foreground"} ${c.dominio ? "max-w-[220px] truncate" : numerica ? "font-sans tabular-nums" : ""}`,
            title: c.dominio ? (l) => formatarValorDado(l[c.nome], c) : undefined,
            texto: (l) => formatarValorDado(l[c.nome], c),
            render: (l) => formatarValorDado(l[c.nome], c),
            formatarValor: (v) => formatarValorDado(v, c),
            semOrdenar: c.tipo === "json",
            resumos: c.dominio ? RESUMOS_CODIGO : RESUMOS_DADOS,
          };
        },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [esqueleto, tituloControle],
  );
  const tc = useColunasConfiguraveis(chaveDaTabela(reinicia), defs, { th: "px-2.5 py-2", td: "px-2.5 py-2 text-[12.5px]" });
  // Rodapé de totais (03/11/2026): sobre TODAS as linhas da busca e dos filtros, não só a página.
  const resumo = useResumoServidor(`${endpoint}/resumo`, { ...JSON.parse(extras), busca, filtros: filtrosParam }, tc.pedidosResumo);

  return (
    <>
      {erro && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{erro}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar..."
          className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {barraExtra?.(resposta)}
        <ChipsFiltros filtros={filtros} coluna={colunaPorNome} onRemover={(nome) => aplicarFiltro(nome, null)} onLimpar={limparFiltros} />
        <ChipOrdem ordem={ordem} onLimpar={limparOrdem} />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {/* Altura limitada com rolagem própria: a barra horizontal fica sempre à vista e o cabeçalho acompanha as linhas. */}
        {/* Sem altura máxima (04/11/2026): a tabela cresce com a página, como antes do kit de colunas; só rola na horizontal. */}
        <div className="relative overflow-x-auto">
          <table className={tc.classeTabela} style={tc.estiloTabela}>
            {tc.colgroup}
            <thead className="sticky top-0 z-10">
              {tc.cabecalho({ colunas, estado: colunasEstado, valores: carregarValores })}
            </thead>
            <tbody>
              {carregando &&
                !resposta &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td colSpan={tc.nColunas || 1} className="px-2.5 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))}
              {resposta && itens.length === 0 && (
                <tr>
                  <td colSpan={tc.nColunas || 1} className="px-2.5 py-4 text-center text-sm text-muted">
                    {busca || filtros.length > 0 ? "Nenhum registro bate com a busca/filtro." : mensagemVazio}
                  </td>
                </tr>
              )}
              {/* Enquanto uma nova resposta não chega, as linhas anteriores ficam na tela, esmaecidas (sem piscar o esqueleto). */}
              {itens.map((linha, i) => (
                <tr key={i} className={`border-t border-border/60 transition-opacity ${carregando ? "opacity-60" : ""}`}>
                  {tc.celulas(linha, undefined)}
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-10">{tc.rodape({ colunas, ...resumo })}</tfoot>
          </table>
        </div>
      </div>

      {totalRegistros > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
          <Pagination
            page={pagina}
            pageSize={porPagina}
            total={totalRegistros}
            loading={carregando}
            onPageChange={setPagina}
            label="registros"
            opcoesPorPagina={pp.opcoes}
            onPageSizeChange={(n) => {
              pp.mudar(n);
              setPagina(1);
            }}
            acessorioPorPagina={pp.estrela}
          />
        </div>
      )}
    </>
  );
}
