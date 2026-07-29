import axios from "axios";
import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MultiSelectDropdown, MultiSelectOption } from "../../components/ui/MultiSelectDropdown";
import { Pagination } from "../../components/ui/Pagination";
import { Skeleton } from "../../components/ui/Skeleton";
import { toneBadge, type Tone } from "../../components/ui/badges";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useToast } from "../../components/ui/Toast";
import { PedidosDashboard, PedidosIndicadoresData } from "../../components/mercado/PedidosDashboard";

type Visao = "lista" | "cliente" | "dash";

interface PedidoRow {
  codemp: number;
  codfil: number;
  numped: number;
  cliente: string;
  datemi: string;
  datprv: string | null;
  obsped: string | null;
  obsmot: string | null;
  vlrliq: number | null;
  pedcli: string | null;
  sitped: number;
  sitpedLabel: string;
  sitpedTone: Tone;
  numrat: string | null;
  // Id local da RAT vinculada (PK de Rat) — usado pra linkar pra RatVisualizacao, não
  // confundir com numrat acima (o número dela lá no Senior).
  ratId: number | null;
  // Resolvidos a partir da RAT vinculada (Pedido.numrat -> Rat -> Proposta) — nulos
  // quando o pedido não tem RAT vinculada ou a RAT ainda não tem proposta associada.
  consultorNome: string | null;
  propostaCodpro: number | null;
  propostaCodlev2: number | null;
  propostaModproLabel: string | null;
  propostaModproTone: Tone | null;
  propostaSitproLabel: string | null;
  propostaSitproTone: Tone | null;
  faturamentoLabel: string | null;
  formaPagamentoLabel: string | null;
  condicaoPagamentoLabel: string | null;
}

interface ClienteGrupo {
  codcli: number;
  nome: string;
  quantidade: number;
  valorLiquido: number;
}

const SITPED_OPCOES: MultiSelectOption<number>[] = [
  { value: 1, label: "Aberto Total" },
  { value: 2, label: "Aberto Parcial" },
  { value: 3, label: "Suspenso" },
  { value: 4, label: "Liquidado" },
  { value: 5, label: "Cancelado" },
  { value: 6, label: "Aguardando Integração WMS" },
  { value: 7, label: "Em Transmissão" },
  { value: 8, label: "Preparação Análise ou NF" },
  { value: 9, label: "Não Fechado" },
];

// Domínio "USU_ModPro" do Senior (modalidade da proposta) — mesmos valores de
// backend/src/domain/propostasDominio.ts (MODPRO_LABELS).
const MODPRO_OPCOES: MultiSelectOption<number>[] = [
  { value: 0, label: "Serviço" },
  { value: 1, label: "Levantamento" },
  { value: 2, label: "DRM" },
];

const PAGE_SIZE = 30;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (v: number) => `R$ ${currencyFormatter.format(v)}`;

// Padding das células reduzido 30% em relação ao padrão do resto do app
// (px-2.5/py-3/py-3.5 -> ~7/8/10px) — tela com muitas colunas, densidade maior aqui de
// propósito. Todo campo de texto variável trunca com "…" e mostra o valor completo no
// title ao passar o mouse, em vez de quebrar linha.
const TH_CLASS = "bg-surface-2 px-[7px] py-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const TH_CLASS_RIGHT = "bg-surface-2 px-[7px] py-[8px] text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
const TD_CLASS = "whitespace-nowrap px-[7px] py-[10px]";

// Linha de um pedido — reaproveitada na tabela da aba Lista e na tabela aninhada de
// cada cliente expandido na aba Por Cliente (que omite a coluna Cliente, já que é o
// cabeçalho do próprio grupo, e mantém Cond. Pgto — removida só da aba Lista).
function LinhaPedido({
  p,
  mostrarCliente = true,
  mostrarCondPgto = true,
}: {
  p: PedidoRow;
  mostrarCliente?: boolean;
  mostrarCondPgto?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <tr className="border-t border-border/60">
      <td className={TD_CLASS}>
        <button
          onClick={() => navigate(`/mercado/pedido/${p.codemp}/${p.codfil}/${p.numped}`)}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {p.numped}
        </button>
      </td>
      {mostrarCliente && (
        <td className="max-w-[200px] truncate whitespace-nowrap px-[7px] py-[10px] text-sm text-foreground" title={p.cliente}>
          {p.cliente}
        </td>
      )}
      <td className={TD_CLASS}>
        <span
          className={`inline-block max-w-[160px] truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[p.sitpedTone]}`}
          title={p.obsmot?.trim() || p.sitpedLabel}
        >
          {p.sitpedLabel}
        </span>
      </td>
      <td className={`hidden ${TD_CLASS} lg:table-cell`}>
        {p.ratId != null ? (
          <button
            onClick={() => navigate(`/projetos/rat/${p.ratId}`)}
            className="font-mono text-sm text-primary hover:underline"
          >
            {p.numrat}
          </button>
        ) : (
          <span className="font-mono text-sm text-muted">{p.numrat ?? "—"}</span>
        )}
      </td>
      <td className={`hidden ${TD_CLASS} lg:table-cell`}>
        <span className="block max-w-[140px] truncate text-sm text-muted" title={p.consultorNome ?? undefined}>
          {p.consultorNome ?? "—"}
        </span>
      </td>
      <td className={`hidden ${TD_CLASS} lg:table-cell`}>
        {p.propostaCodpro != null ? (
          <span className="inline-flex items-center gap-1">
            <button
              onClick={() => navigate(`/projetos/proposta/${p.codemp}/${p.propostaCodpro}`)}
              className="font-mono text-sm text-primary hover:underline"
            >
              {p.propostaCodpro}
            </button>
            {p.propostaCodlev2 != null && p.propostaCodlev2 !== 0 && (
              <>
                <span className="text-sm text-muted">→</span>
                <button
                  onClick={() => navigate(`/projetos/proposta/${p.codemp}/${p.propostaCodlev2}`)}
                  className="font-mono text-sm text-primary hover:underline"
                >
                  {p.propostaCodlev2}
                </button>
              </>
            )}
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className={`hidden ${TD_CLASS} lg:table-cell`}>
        {p.propostaModproLabel != null && p.propostaModproTone != null ? (
          <span
            className={`inline-block max-w-[140px] truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[p.propostaModproTone]}`}
            title={p.propostaModproLabel}
          >
            {p.propostaModproLabel}
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className={`hidden ${TD_CLASS} lg:table-cell`}>
        {p.propostaSitproLabel != null && p.propostaSitproTone != null ? (
          <span
            className={`inline-block max-w-[140px] truncate whitespace-nowrap align-bottom rounded-full px-2 py-0.5 text-[11.5px] font-medium ${toneBadge[p.propostaSitproTone]}`}
            title={p.propostaSitproLabel}
          >
            {p.propostaSitproLabel}
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className={`hidden ${TD_CLASS} xl:table-cell`}>
        <span className="block max-w-[130px] truncate text-sm text-muted" title={p.faturamentoLabel ?? undefined}>
          {p.faturamentoLabel ?? "—"}
        </span>
      </td>
      {mostrarCondPgto && (
        <td className={`hidden ${TD_CLASS} xl:table-cell`}>
          <span className="block max-w-[130px] truncate text-sm text-muted" title={p.condicaoPagamentoLabel ?? undefined}>
            {p.condicaoPagamentoLabel ?? "—"}
          </span>
        </td>
      )}
      <td className={`${TD_CLASS} text-right font-mono text-sm tabular-nums text-foreground`}>
        {p.vlrliq != null ? formatMoney(p.vlrliq) : "—"}
      </td>
      <td className={`hidden ${TD_CLASS} xl:table-cell`}>
        <span className="block max-w-[160px] truncate text-sm text-muted" title={p.obsmot?.trim() || undefined}>
          {p.obsmot?.trim() || "—"}
        </span>
      </td>
      <td className={`${TD_CLASS} font-mono text-sm text-muted`}>{dateFormatter.format(new Date(p.datemi))}</td>
      <td className={`hidden ${TD_CLASS} xl:table-cell`}>
        <span className="block max-w-[110px] truncate text-sm text-muted" title={p.formaPagamentoLabel ?? undefined}>
          {p.formaPagamentoLabel ?? "—"}
        </span>
      </td>
    </tr>
  );
}

export function ListarPedidos() {
  const toast = useToast();
  const [visao, setVisao] = useState<Visao>("lista");
  const [indicadores, setIndicadores] = useState<PedidosIndicadoresData | null>(null);
  const [loadingIndicadores, setLoadingIndicadores] = useState(true);

  const [clienteInput, setClienteInput] = useState("");
  const clienteDebounced = useDebouncedValue(clienteInput, 350);
  const [numpedInput, setNumpedInput] = useState("");
  const numpedDebounced = useDebouncedValue(numpedInput, 350);
  const [numratInput, setNumratInput] = useState("");
  const numratDebounced = useDebouncedValue(numratInput, 350);
  const [codproInput, setCodproInput] = useState("");
  const codproDebounced = useDebouncedValue(codproInput, 350);
  // Pré-marcado com "Aberto Total" (1), "Aberto Parcial" (2) e "Não Fechado" (9) —
  // decisão do usuário, não existe valor "Digitado" no domínio real LSitPed.
  const [sitpedFiltro, setSitpedFiltro] = useState<number[]>([1, 2, 9]);
  const [modproFiltro, setModproFiltro] = useState<number[]>([]);

  const [page, setPage] = useState(1);
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [pageCliente, setPageCliente] = useState(1);
  const [clientes, setClientes] = useState<ClienteGrupo[]>([]);
  const [totalClientes, setTotalClientes] = useState(0);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [clientesExpandidos, setClientesExpandidos] = useState<Set<number>>(new Set());
  const [itensPorCliente, setItensPorCliente] = useState<Record<number, PedidoRow[] | "carregando" | "erro">>({});
  // Clientes com "Sinc. ERP" rodando agora — Set (e não um único codcli) porque dá pra
  // disparar a sincronização de vários clientes da lista sem esperar o anterior acabar.
  const [sincronizandoClientes, setSincronizandoClientes] = useState<Set<number>>(new Set());
  // Sincronização do filtro inteiro: o POST só dispara (202) e o resultado chega por
  // polling em /sincronizar/status — o lote pode passar de minutos, muito além do
  // timeout do nginx (ver comentário na rota, backend/src/routes/pedidos.ts).
  const [sincronizandoFiltro, setSincronizandoFiltro] = useState(false);
  const pollingRef = useRef<number | null>(null);

  const [erro, setErro] = useState<string | null>(null);

  // Filtros mandados pras rotas de listagem e pro disparo da sincronização do filtro —
  // centralizado pra "o que a tela mostra" e "o que a sincronização vai buscar" nunca
  // divergirem. (A rota de itens de um cliente ignora `cliente`, já escopada pelo path.)
  function paramsFiltros() {
    return {
      cliente: clienteDebounced || undefined,
      numped: numpedDebounced || undefined,
      numrat: numratDebounced || undefined,
      codpro: codproDebounced || undefined,
      sitped: sitpedFiltro.length > 0 ? sitpedFiltro.join(",") : undefined,
      modpro: modproFiltro.length > 0 ? modproFiltro.join(",") : undefined,
    };
  }

  function carregar() {
    setLoading(true);
    axios
      .get("/api/pedidos", {
        params: { ...paramsFiltros(), page, pageSize: PAGE_SIZE },
      })
      .then(({ data }) => {
        setPedidos(data.pedidos);
        setTotal(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar pedidos"))
      .finally(() => setLoading(false));
  }

  function carregarPorCliente() {
    setLoadingClientes(true);
    axios
      .get("/api/pedidos/por-cliente", {
        params: { ...paramsFiltros(), page: pageCliente, pageSize: PAGE_SIZE },
      })
      .then(({ data }) => {
        setClientes(data.clientes);
        setTotalClientes(data.total);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar clientes"))
      .finally(() => setLoadingClientes(false));
  }

  function carregarIndicadores() {
    setLoadingIndicadores(true);
    axios
      .get("/api/pedidos/indicadores")
      .then(({ data }) => setIndicadores(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar indicadores"))
      .finally(() => setLoadingIndicadores(false));
  }

  // Indicadores do "Dash" refletem sempre a base inteira, não os filtros das outras
  // abas (mesmo comportamento de /atividades/indicadores em relação à lista de
  // Atividades) — por isso carrega só uma vez ao montar, fora dos effects de filtro.
  useEffect(() => {
    carregarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cada aba só busca o próprio dado quando está ativa — evita bater nos dois
  // endpoints (Lista e Por Cliente) toda vez que um filtro muda, independente de qual
  // aba a pessoa está olhando.
  useEffect(() => {
    if (visao === "lista") carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao, clienteDebounced, numpedDebounced, numratDebounced, codproDebounced, sitpedFiltro, modproFiltro, page]);

  useEffect(() => {
    if (visao === "cliente") carregarPorCliente();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao, clienteDebounced, numpedDebounced, numratDebounced, codproDebounced, sitpedFiltro, modproFiltro, pageCliente]);

  // Digitar ou trocar filtro reseta as duas paginações pra página 1 (senão a busca pode
  // "sumir" numa página que não existe mais) e colapsa qualquer cliente expandido — o
  // cache de itens dele reflete o filtro antigo, ficaria inconsistente com a contagem
  // nova do grupo.
  useEffect(() => {
    setPage(1);
    setPageCliente(1);
    setClientesExpandidos(new Set());
    setItensPorCliente({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteDebounced, numpedDebounced, numratDebounced, codproDebounced, sitpedFiltro, modproFiltro]);

  function carregarItensCliente(codcli: number) {
    setItensPorCliente((i) => ({ ...i, [codcli]: "carregando" }));
    axios
      .get(`/api/pedidos/por-cliente/${codcli}/itens`, { params: paramsFiltros() })
      .then(({ data }) => setItensPorCliente((i) => ({ ...i, [codcli]: data.itens })))
      .catch(() => setItensPorCliente((i) => ({ ...i, [codcli]: "erro" })));
  }

  function toggleExpandirCliente(cliente: ClienteGrupo) {
    setClientesExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(cliente.codcli)) {
        proximo.delete(cliente.codcli);
      } else {
        proximo.add(cliente.codcli);
        if (!itensPorCliente[cliente.codcli]) carregarItensCliente(cliente.codcli);
      }
      return proximo;
    });
  }

  // Puxa do Senior, na hora, todos os pedidos deste cliente (POST .../sincronizar) e
  // recarrega a tela com o resultado. O cache de itens do cliente é sempre invalidado —
  // se estiver expandido recarrega na hora, se não, na próxima vez que expandir.
  async function sincronizarCliente(cliente: ClienteGrupo) {
    if (sincronizandoClientes.has(cliente.codcli)) return;
    setSincronizandoClientes((s) => new Set(s).add(cliente.codcli));
    try {
      const { data } = await axios.post(`/api/pedidos/por-cliente/${cliente.codcli}/sincronizar`);
      toast.mostrar(
        `${cliente.nome}: ${data.total} pedido(s) no Senior — ${data.criados} novo(s), ${data.atualizados} atualizado(s).`,
        "success"
      );
      carregarPorCliente();
      if (clientesExpandidos.has(cliente.codcli)) {
        carregarItensCliente(cliente.codcli);
      } else {
        setItensPorCliente((i) => {
          const proximo = { ...i };
          delete proximo[cliente.codcli];
          return proximo;
        });
      }
    } catch (err) {
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Falha ao sincronizar os pedidos deste cliente com o ERP", "destructive");
    } finally {
      setSincronizandoClientes((s) => {
        const proximo = new Set(s);
        proximo.delete(cliente.codcli);
        return proximo;
      });
    }
  }

  function pararPolling() {
    if (pollingRef.current != null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  // Acompanha a sincronização do filtro até acabar. Chamado tanto logo após o disparo
  // quanto ao entrar na aba com um lote já rodando (outra aba do navegador, F5 no meio,
  // ou outro admin) — por isso é idempotente.
  function acompanharSincronizacaoFiltro() {
    if (pollingRef.current != null) return;
    pollingRef.current = window.setInterval(() => {
      axios
        .get("/api/pedidos/sincronizar/status")
        .then(({ data }) => {
          if (data.emAndamento) return;
          pararPolling();
          setSincronizandoFiltro(false);

          if (data.erro) {
            toast.mostrar(`Falha na sincronização do filtro: ${data.erro}`, "destructive");
          } else if (data.resultado) {
            toast.mostrar(
              `${data.totalClientes} cliente(s) sincronizado(s): ${data.resultado.total} pedido(s) — ` +
                `${data.resultado.criados} novo(s), ${data.resultado.atualizados} atualizado(s).`,
              "success"
            );
          }

          // Toda a listagem pode ter mudado (pedidos novos entram em grupos, valores
          // somados mudam), então recarrega o agrupamento e joga fora o cache de itens.
          // Colapsa os grupos abertos junto — mesmo comportamento de quando um filtro
          // muda, e evita reabrir tudo com dado velho.
          carregarPorCliente();
          setClientesExpandidos(new Set());
          setItensPorCliente({});
        })
        // Erro no polling é transitório (rede/deploy): não derruba o acompanhamento,
        // tenta de novo no próximo tick.
        .catch(() => {});
    }, 3000);
  }

  // Dispara a sincronização de TODOS os clientes do filtro atual (todas as páginas, não
  // só a visível) — os mesmos params que a listagem usa vão pro backend, que resolve a
  // lista de clientes do jeito idêntico.
  async function sincronizarFiltro() {
    if (sincronizandoFiltro) return;
    setSincronizandoFiltro(true);
    try {
      const { data } = await axios.post("/api/pedidos/sincronizar", null, { params: paramsFiltros() });
      toast.mostrar(`Sincronizando ${data.totalClientes} cliente(s) com o Senior — rodando em segundo plano.`, "neutral");
      acompanharSincronizacaoFiltro();
    } catch (err) {
      setSincronizandoFiltro(false);
      const mensagem = axios.isAxiosError(err) ? err.response?.data?.error : null;
      toast.mostrar(mensagem ?? "Falha ao disparar a sincronização do filtro", "destructive");
    }
  }

  // Ao abrir a aba Por Cliente, verifica se já existe lote rodando (outra aba, F5 no
  // meio, ou outro admin) pra tela refletir isso em vez de oferecer um disparo que o
  // backend recusaria com 409.
  useEffect(() => {
    if (visao !== "cliente" || sincronizandoFiltro) return;
    axios
      .get("/api/pedidos/sincronizar/status")
      .then(({ data }) => {
        if (!data.emAndamento) return;
        setSincronizandoFiltro(true);
        acompanharSincronizacaoFiltro();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visao]);

  useEffect(() => pararPolling, []);

  const tabClass = (ativa: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      ativa ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Mercado · Listar Pedidos</p>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Listar Pedidos</h1>
          <p className="mt-1 text-sm text-muted">Pedidos importados do Senior (E120PED).</p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-md border border-border p-1">
          <button onClick={() => setVisao("lista")} className={tabClass(visao === "lista")}>
            Lista
          </button>
          <button onClick={() => setVisao("cliente")} className={tabClass(visao === "cliente")}>
            Por Cliente
          </button>
          <button onClick={() => setVisao("dash")} className={tabClass(visao === "dash")}>
            Dash
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erro}
        </div>
      )}

      {visao !== "dash" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={clienteInput}
            onChange={(e) => setClienteInput(e.target.value)}
            placeholder="Buscar cliente..."
            className="w-56 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={numpedInput}
            onChange={(e) => setNumpedInput(e.target.value)}
            placeholder="Nro. do pedido... (separe por vírgula)"
            className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={numratInput}
            onChange={(e) => setNumratInput(e.target.value)}
            placeholder="Nro. da RAT... (separe por vírgula)"
            className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={codproInput}
            onChange={(e) => setCodproInput(e.target.value)}
            placeholder="Nro. da proposta... (separe por vírgula)"
            className="w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <MultiSelectDropdown
            opcoes={SITPED_OPCOES}
            selecionados={sitpedFiltro}
            onChange={setSitpedFiltro}
            labelTodos="Todas as situações"
            labelSufixo="situações"
          />
          <MultiSelectDropdown
            opcoes={MODPRO_OPCOES}
            selecionados={modproFiltro}
            onChange={setModproFiltro}
            labelTodos="Todas as modalidades"
            labelSufixo="modalidades"
          />
          {/* Ação global da aba Por Cliente: alcança TODOS os clientes do filtro (as
              outras páginas também), por isso o contador vem de totalClientes e não do
              tamanho da página. */}
          {visao === "cliente" && (
            <button
              onClick={sincronizarFiltro}
              disabled={sincronizandoFiltro || loadingClientes || totalClientes === 0}
              title="Puxa do Senior os pedidos de todos os clientes que batem com os filtros atuais, incluindo os das próximas páginas"
              className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sincronizandoFiltro
                ? "Sincronizando com o ERP..."
                : `Sinc. ERP — ${totalClientes} cliente${totalClientes === 1 ? "" : "s"} do filtro`}
            </button>
          )}
        </div>
      )}

      {visao === "dash" && <PedidosDashboard dados={indicadores} loading={loadingIndicadores} />}

      {visao === "lista" && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Pedido</th>
                  <th className={TH_CLASS}>Cliente</th>
                  <th className={TH_CLASS}>Situação</th>
                  <th className={`hidden ${TH_CLASS} lg:table-cell`}>Rat</th>
                  <th className={`hidden ${TH_CLASS} lg:table-cell`}>Consultor</th>
                  <th className={`hidden ${TH_CLASS} lg:table-cell`}>Proposta</th>
                  <th className={`hidden ${TH_CLASS} lg:table-cell`}>Mod. Prop.</th>
                  <th className={`hidden ${TH_CLASS} lg:table-cell`}>Sit. Prop.</th>
                  <th className={`hidden ${TH_CLASS} xl:table-cell`}>Faturamento</th>
                  <th className={TH_CLASS_RIGHT}>Valor Líquido</th>
                  <th className={`hidden ${TH_CLASS} xl:table-cell`}>Obs. Mot.</th>
                  <th className={TH_CLASS}>Emissão</th>
                  <th className={`hidden ${TH_CLASS} xl:table-cell`}>Forma Pgto</th>
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-[7px] py-[10px]">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="px-[7px] py-[10px]">
                        <Skeleton className="h-4 w-40" />
                      </td>
                      <td className="px-[7px] py-[10px]">
                        <Skeleton className="h-5 w-24 rounded-full" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] lg:table-cell">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] lg:table-cell">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] lg:table-cell">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] lg:table-cell">
                        <Skeleton className="h-4 w-20" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] lg:table-cell">
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] xl:table-cell">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="px-[7px] py-[10px] text-right">
                        <Skeleton className="ml-auto h-4 w-20" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] xl:table-cell">
                        <Skeleton className="h-4 w-32" />
                      </td>
                      <td className="px-[7px] py-[10px]">
                        <Skeleton className="h-4 w-20" />
                      </td>
                      <td className="hidden px-[7px] py-[10px] xl:table-cell">
                        <Skeleton className="h-4 w-24" />
                      </td>
                    </tr>
                  ))}
                {!loading &&
                  pedidos.map((p) => (
                    <LinhaPedido key={`${p.codemp}-${p.codfil}-${p.numped}`} p={p} mostrarCondPgto={false} />
                  ))}
                {!loading && pedidos.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-[7px] py-8 text-center text-sm text-muted">
                      Nenhum pedido encontrado com esses filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} label="pedidos" />
        </div>
      )}

      {visao === "cliente" && (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Cliente</th>
                  <th className={TH_CLASS_RIGHT}>Qtd. Pedidos</th>
                  <th className={TH_CLASS_RIGHT}>Valor Líquido</th>
                  <th className={TH_CLASS_RIGHT}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loadingClientes &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-[7px] py-[10px]" colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </td>
                    </tr>
                  ))}
                {!loadingClientes &&
                  clientes.map((c) => {
                    const expandida = clientesExpandidos.has(c.codcli);
                    const itens = itensPorCliente[c.codcli];
                    const sincronizando = sincronizandoClientes.has(c.codcli);
                    return (
                      <Fragment key={c.codcli}>
                        <tr
                          onClick={() => toggleExpandirCliente(c)}
                          className={`cursor-pointer transition ${
                            expandida ? "border-t border-primary bg-primary/5" : "border-t border-border/60 hover:bg-surface-2"
                          }`}
                        >
                          <td className={`max-w-0 px-[7px] py-[10px] ${expandida ? "border-l border-primary" : ""}`}>
                            <p className="flex items-center gap-2 truncate whitespace-nowrap text-sm font-semibold text-foreground" title={c.nome}>
                              <span className="shrink-0 text-muted">{expandida ? "▾" : "▸"}</span>
                              <span className="truncate">{c.nome}</span>
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-[7px] py-[10px] text-right font-mono text-sm tabular-nums text-muted">
                            {c.quantidade}
                          </td>
                          <td className="whitespace-nowrap px-[7px] py-[10px] text-right font-mono text-sm tabular-nums text-foreground">
                            {formatMoney(c.valorLiquido)}
                          </td>
                          {/* stopPropagation: a linha inteira é o toggle de expandir — sem isso,
                              sincronizar também abriria/fecharia o grupo. */}
                          <td
                            className={`whitespace-nowrap px-[7px] py-[10px] text-right ${expandida ? "border-r border-primary" : ""}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => sincronizarCliente(c)}
                              disabled={sincronizando || sincronizandoFiltro}
                              title="Puxa do Senior todos os pedidos deste cliente, sem esperar a sincronização diária"
                              className="text-sm text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {sincronizando ? "Sincronizando..." : "Sinc. ERP"}
                            </button>
                          </td>
                        </tr>
                        {expandida && (
                          <tr className="border-t border-border/60 bg-surface-2/40">
                            <td colSpan={4} className="border-b border-l border-r border-primary px-[7px] py-3">
                              {itens === "carregando" && <p className="py-2 text-sm text-muted">Carregando pedidos...</p>}
                              {itens === "erro" && (
                                <p className="py-2 text-sm text-destructive">Falha ao carregar os pedidos deste cliente.</p>
                              )}
                              {Array.isArray(itens) && itens.length === 0 && (
                                <p className="py-2 text-sm text-muted">Nenhum pedido deste cliente com os filtros atuais.</p>
                              )}
                              {Array.isArray(itens) && itens.length > 0 && (
                                <div className="overflow-x-auto">
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr>
                                        <th className="py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Pedido
                                        </th>
                                        <th className="py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Situação
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                                          Rat
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                                          Consultor
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                                          Proposta
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                                          Mod. Prop.
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                                          Sit. Prop.
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                                          Faturamento
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                                          Cond. Pgto
                                        </th>
                                        <th className="py-[4px] pr-[8px] text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Valor Líquido
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                                          Obs. Mot.
                                        </th>
                                        <th className="py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                                          Emissão
                                        </th>
                                        <th className="hidden py-[4px] pr-[8px] text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted xl:table-cell">
                                          Forma Pgto
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {itens.map((p) => (
                                        <LinhaPedido key={`${p.codemp}-${p.codfil}-${p.numped}`} p={p} mostrarCliente={false} />
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                {!loadingClientes && clientes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-[7px] py-8 text-center text-sm text-muted">
                      Nenhum cliente encontrado com esses filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pageCliente}
            pageSize={PAGE_SIZE}
            total={totalClientes}
            loading={loadingClientes}
            onPageChange={setPageCliente}
            label="clientes"
          />
        </div>
      )}
    </div>
  );
}
