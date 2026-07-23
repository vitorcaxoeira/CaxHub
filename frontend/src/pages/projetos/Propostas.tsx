import axios from "axios";
import { useEffect, useState } from "react";
import { ClienteFilter, ClienteOption } from "../../components/financeiro/ClienteFilter";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { FunilSituacao, FunilItem } from "../../components/projetos/FunilSituacao";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { PropostasTable, PropostaRow } from "../../components/projetos/PropostasTable";
import { formatHoras } from "../../utils/horas";
import { EficienciaComercialCards, EficienciaComercial } from "../../components/projetos/EficienciaComercialCards";
import { AlertasComerciais, AlertasComerciaisDados } from "../../components/projetos/AlertasComerciais";
import { ComposicaoPipeline, ComposicaoTipoVenda, ComposicaoProduto, ComposicaoClassificacao } from "../../components/projetos/ComposicaoPipeline";
import { RankingRepresentantes, RepresentanteRow } from "../../components/projetos/RankingRepresentantes";
import { TendenciaMensalPropostas, PontoTendenciaMensal } from "../../components/projetos/TendenciaMensalPropostas";
import { AgingPipelineChart, AgingBucketPropostas } from "../../components/projetos/AgingPipelineChart";
import { Skeleton } from "../../components/ui/Skeleton";

const API_BASE = "/api/projetos/propostas";

interface Kpis {
  totalPropostas: number;
  totalHoras: number;
  propostasAbertas: number;
  valorPipeline: number;
  ticketMedio: number;
  taxaConversaoPct: number;
  aVencer7d: number;
  aVencer30d: number;
}

interface OpcoesFiltro {
  situacoes: { sitpro: number; label: string }[];
  tiposVenda: { tipven: number; label: string }[];
  modalidades: { modpro: number; label: string }[];
  representantes: { codrep: number; nomrep: string }[];
}

interface Filtros {
  clientes: ClienteOption[];
  situacao: number[];
  representantes: number[];
  tipven: number[];
  modpro: number[];
  datproInicio: string | null;
  datproFim: string | null;
}

interface PropostasResponse {
  rows: PropostaRow[];
  page: number;
  pageSize: number;
  total: number;
}

const PROPOSTAS_VAZIO: PropostasResponse = { rows: [], page: 1, pageSize: 50, total: 0 };

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function dateInputClass() {
  return "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

export function Propostas() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({
    clientes: [],
    situacao: [],
    representantes: [],
    tipven: [],
    modpro: [],
    datproInicio: null,
    datproFim: null,
  });
  const [page, setPage] = useState(1);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [funil, setFunil] = useState<FunilItem[]>([]);
  const [topClientes, setTopClientes] = useState<RankingItem[]>([]);
  const [topClientesHoras, setTopClientesHoras] = useState<RankingItem[]>([]);
  const [propostas, setPropostas] = useState<PropostasResponse>(PROPOSTAS_VAZIO);

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [loadingTabela, setLoadingTabela] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // ---------- Indicadores Comerciais (Seções 1-4) ----------
  const [alerta, setAlerta] = useState<string | null>(null);
  const [estagnadaDias, setEstagnadaDias] = useState(15);

  const [eficiencia, setEficiencia] = useState<EficienciaComercial | null>(null);
  const [loadingEficiencia, setLoadingEficiencia] = useState(true);
  const [erroEficiencia, setErroEficiencia] = useState<string | null>(null);

  const [alertasDados, setAlertasDados] = useState<AlertasComerciaisDados | null>(null);
  const [loadingAlertas, setLoadingAlertas] = useState(true);
  const [erroAlertas, setErroAlertas] = useState<string | null>(null);

  const [composicao, setComposicao] = useState<{
    porTipoVenda: ComposicaoTipoVenda[];
    porProduto: ComposicaoProduto[];
    porClassificacao: ComposicaoClassificacao[];
  } | null>(null);
  const [loadingComposicao, setLoadingComposicao] = useState(true);
  const [erroComposicao, setErroComposicao] = useState<string | null>(null);

  const [repRows, setRepRows] = useState<RepresentanteRow[]>([]);
  const [repTotal, setRepTotal] = useState(0);
  const [repPage, setRepPage] = useState(1);
  const [repSort, setRepSort] = useState("propostasAbertas");
  const [repDir, setRepDir] = useState<"asc" | "desc">("desc");
  const [loadingRep, setLoadingRep] = useState(true);
  const [erroRep, setErroRep] = useState<string | null>(null);

  const [tendenciaMensal, setTendenciaMensal] = useState<PontoTendenciaMensal[]>([]);
  const [loadingTendencia, setLoadingTendencia] = useState(true);
  const [erroTendencia, setErroTendencia] = useState<string | null>(null);

  const [agingBuckets, setAgingBuckets] = useState<AgingBucketPropostas[]>([]);
  const [loadingAging, setLoadingAging] = useState(true);
  const [erroAging, setErroAging] = useState<string | null>(null);

  const clienteIds = filtros.clientes.map((c) => c.codcli).join(",") || undefined;
  const situacaoIds = filtros.situacao.join(",") || undefined;
  const representanteIds = filtros.representantes.join(",") || undefined;
  const tipvenIds = filtros.tipven.join(",") || undefined;
  const modproIds = filtros.modpro.join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro"));
  }, []);

  useEffect(() => {
    setLoadingResumo(true);
    const params = {
      clientes: clienteIds,
      representantes: representanteIds,
      tipven: tipvenIds,
      modpro: modproIds,
      datproInicio: filtros.datproInicio ?? undefined,
      datproFim: filtros.datproFim ?? undefined,
    };
    Promise.all([
      axios.get(`${API_BASE}/kpis`, { params }),
      axios.get(`${API_BASE}/funil`, { params }),
      axios.get(`${API_BASE}/por-cliente`, { params }),
      axios.get(`${API_BASE}/por-cliente-horas`, { params }),
    ])
      .then(([kpisRes, funilRes, clientesRes, clientesHorasRes]) => {
        setKpis(kpisRes.data);
        setFunil(funilRes.data.funil);
        setTopClientes(
          clientesRes.data.rows.map((r: { codcli: number; nomcli: string; qtd: number; valor: number }) => ({
            chave: r.codcli,
            nome: `${r.codcli} - ${r.nomcli}`,
            quantidade: r.qtd,
            valor: r.valor,
          }))
        );
        setTopClientesHoras(
          clientesHorasRes.data.rows.map((r: { codcli: number; nomcli: string; qtd: number; horas: number }) => ({
            chave: r.codcli,
            nome: `${r.codcli} - ${r.nomcli}`,
            quantidade: r.qtd,
            valor: r.horas,
          }))
        );
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoadingResumo(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim]);

  useEffect(() => {
    setLoadingTabela(true);
    axios
      .get(API_BASE, {
        params: {
          situacao: situacaoIds,
          clientes: clienteIds,
          representantes: representanteIds,
          tipven: tipvenIds,
          modpro: modproIds,
          datproInicio: filtros.datproInicio ?? undefined,
          datproFim: filtros.datproFim ?? undefined,
          page,
          pageSize: 50,
          alerta: alerta ?? undefined,
          estagnadaDias: alerta === "estagnadas" ? estagnadaDias : undefined,
        },
      })
      .then(({ data }) => setPropostas(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a lista de propostas"))
      .finally(() => setLoadingTabela(false));
  }, [situacaoIds, clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim, page, alerta, estagnadaDias]);

  // Params comuns (sem representantes) usados pelo drill-down do ranking de representantes.
  const paramsComunsResumo = {
    clientes: clienteIds,
    tipven: tipvenIds,
    modpro: modproIds,
    datproInicio: filtros.datproInicio ?? undefined,
    datproFim: filtros.datproFim ?? undefined,
  };

  useEffect(() => {
    setLoadingEficiencia(true);
    axios
      .get(`${API_BASE}/eficiencia`, { params: { ...paramsComunsResumo, representantes: representanteIds } })
      .then(({ data }) => {
        setEficiencia(data);
        setErroEficiencia(null);
      })
      .catch((err) => setErroEficiencia(err.response?.data?.error ?? "Falha ao carregar a eficiência comercial"))
      .finally(() => setLoadingEficiencia(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim]);

  useEffect(() => {
    setLoadingAlertas(true);
    axios
      .get(`${API_BASE}/alertas`, { params: { ...paramsComunsResumo, representantes: representanteIds, estagnadaDias } })
      .then(({ data }) => {
        setAlertasDados(data);
        setErroAlertas(null);
      })
      .catch((err) => setErroAlertas(err.response?.data?.error ?? "Falha ao carregar os alertas"))
      .finally(() => setLoadingAlertas(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim, estagnadaDias]);

  useEffect(() => {
    setLoadingComposicao(true);
    axios
      .get(`${API_BASE}/composicao`, { params: { ...paramsComunsResumo, representantes: representanteIds } })
      .then(({ data }) => {
        setComposicao(data);
        setErroComposicao(null);
      })
      .catch((err) => setErroComposicao(err.response?.data?.error ?? "Falha ao carregar a composição do pipeline"))
      .finally(() => setLoadingComposicao(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim]);

  useEffect(() => {
    setLoadingRep(true);
    axios
      .get(`${API_BASE}/representantes-ranking`, {
        params: { ...paramsComunsResumo, representantes: representanteIds, sort: repSort, dir: repDir, page: repPage, pageSize: 20 },
      })
      .then(({ data }) => {
        setRepRows(data.rows);
        setRepTotal(data.total);
        setErroRep(null);
      })
      .catch((err) => setErroRep(err.response?.data?.error ?? "Falha ao carregar o ranking de representantes"))
      .finally(() => setLoadingRep(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim, repSort, repDir, repPage]);

  useEffect(() => {
    setLoadingTendencia(true);
    axios
      .get(`${API_BASE}/tendencia-mensal`, { params: { ...paramsComunsResumo, representantes: representanteIds } })
      .then(({ data }) => {
        setTendenciaMensal(data.serie);
        setErroTendencia(null);
      })
      .catch((err) => setErroTendencia(err.response?.data?.error ?? "Falha ao carregar a evolução mensal"))
      .finally(() => setLoadingTendencia(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim]);

  useEffect(() => {
    setLoadingAging(true);
    axios
      .get(`${API_BASE}/aging`, { params: { ...paramsComunsResumo, representantes: representanteIds } })
      .then(({ data }) => {
        setAgingBuckets(data.buckets);
        setErroAging(null);
      })
      .catch((err) => setErroAging(err.response?.data?.error ?? "Falha ao carregar o aging do pipeline"))
      .finally(() => setLoadingAging(false));
  }, [clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim]);

  function atualizarFiltros(parcial: Partial<Filtros>) {
    setFiltros((atual) => ({ ...atual, ...parcial }));
    setPage(1);
    if (parcial.situacao !== undefined) {
      setAlerta(null);
    }
  }

  function handleSelectAlerta(novoAlerta: string | null) {
    setAlerta(novoAlerta);
    setPage(1);
    if (novoAlerta !== null && filtros.situacao.length > 0) {
      setFiltros((atual) => ({ ...atual, situacao: [] }));
    }
  }

  function handleSortRepChange(sort: string, dir: "asc" | "desc") {
    setRepSort(sort);
    setRepDir(dir);
    setRepPage(1);
  }

  const kpiCards = kpis
    ? [
        { label: "Total de Propostas", value: kpis.totalPropostas.toLocaleString("pt-BR"), sub: "todas as situações", tone: "neutral" as const },
        { label: "Total de Horas das Propostas", value: formatHoras(kpis.totalHoras), sub: "soma dos itens de serviço", tone: "neutral" as const },
        { label: "Propostas Abertas", value: kpis.propostasAbertas.toLocaleString("pt-BR"), sub: "ainda em decisão", tone: "neutral" as const },
        { label: "Valor em Pipeline", value: fmtMoney(kpis.valorPipeline), sub: "propostas abertas", tone: "neutral" as const },
        { label: "Ticket Médio", value: fmtMoney(kpis.ticketMedio), sub: "por proposta com valor", tone: "neutral" as const },
        { label: "Taxa de Conversão", value: fmtPct(kpis.taxaConversaoPct), sub: "avançaram pra execução", tone: "success" as const },
        { label: "A Vencer em 7 dias", value: kpis.aVencer7d.toLocaleString("pt-BR"), sub: "validade próxima", tone: kpis.aVencer7d > 0 ? ("warning" as const) : ("neutral" as const) },
        { label: "A Vencer em 30 dias", value: kpis.aVencer30d.toLocaleString("pt-BR"), sub: "validade no mês", tone: "neutral" as const },
      ]
    : [];

  const toneText: Record<string, string> = {
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    neutral: "text-foreground",
  };
  const toneBg: Record<string, string> = {
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    neutral: "bg-muted",
  };

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Gestão de Projetos · Pipeline Comercial
      </p>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ClienteFilter selecionados={filtros.clientes} onChange={(clientes) => atualizarFiltros({ clientes })} />

          <MultiSelectDropdown
            opcoes={opcoes?.situacoes.map((s) => ({ value: s.sitpro, label: s.label })) ?? []}
            selecionados={filtros.situacao}
            onChange={(situacao) => atualizarFiltros({ situacao })}
            labelTodos="Todas as situações"
            labelSufixo="situações"
          />

          <MultiSelectDropdown
            opcoes={opcoes?.representantes.map((r) => ({ value: r.codrep, label: r.nomrep })) ?? []}
            selecionados={filtros.representantes}
            onChange={(representantes) => atualizarFiltros({ representantes })}
            labelTodos="Todos os representantes"
            labelSufixo="representantes"
          />

          <MultiSelectDropdown
            opcoes={opcoes?.tiposVenda.map((t) => ({ value: t.tipven, label: t.label })) ?? []}
            selecionados={filtros.tipven}
            onChange={(tipven) => atualizarFiltros({ tipven })}
            labelTodos="Todos os tipos de venda"
            labelSufixo="tipos"
          />

          <MultiSelectDropdown
            opcoes={opcoes?.modalidades.map((m) => ({ value: m.modpro, label: m.label })) ?? []}
            selecionados={filtros.modpro}
            onChange={(modpro) => atualizarFiltros({ modpro })}
            labelTodos="Todas as modalidades"
            labelSufixo="modalidades"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Data da proposta:</span>
            <input
              type="date"
              className={dateInputClass()}
              value={filtros.datproInicio ?? ""}
              onChange={(e) => atualizarFiltros({ datproInicio: e.target.value || null })}
            />
            <span className="text-sm text-muted">até</span>
            <input
              type="date"
              className={dateInputClass()}
              value={filtros.datproFim ?? ""}
              onChange={(e) => atualizarFiltros({ datproFim: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loadingResumo ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-5">
              <Skeleton className="mb-2 h-3.5 w-32" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : (
        kpis && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {kpiCards.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border border-border bg-surface p-5">
                  <p className="mb-2 text-[11.5px] text-muted">{kpi.label}</p>
                  <span className={`block font-mono text-2xl font-semibold tabular-nums ${toneText[kpi.tone]}`}>
                    {kpi.value}
                  </span>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                    <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[kpi.tone]}`} />
                    {kpi.sub}
                  </p>
                </div>
              ))}
            </div>

            <div className="mb-6">
              <FunilSituacao itens={funil} />
            </div>

            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankingBarra titulo="Top 10 clientes por valor" itens={topClientes} unidade="propostas" />
              <RankingBarra titulo="Top 10 clientes por horas" itens={topClientesHoras} formatarValor={formatHoras} unidade="propostas" />
            </div>
          </>
        )
      )}

      {erroEficiencia ? (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erroEficiencia}</div>
      ) : loadingEficiencia && !eficiencia ? (
        <p className="mb-6 text-sm text-muted">Carregando eficiência comercial...</p>
      ) : (
        eficiencia && <EficienciaComercialCards dados={eficiencia} />
      )}

      {erroAlertas ? (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erroAlertas}</div>
      ) : loadingAlertas && !alertasDados ? (
        <p className="mb-6 text-sm text-muted">Carregando alertas...</p>
      ) : (
        alertasDados && (
          <AlertasComerciais
            dados={alertasDados}
            alertaAtivo={alerta}
            onSelectAlerta={handleSelectAlerta}
            estagnadaDias={estagnadaDias}
            onEstagnadaDiasChange={setEstagnadaDias}
          />
        )
      )}

      {erroComposicao ? (
        <div className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erroComposicao}</div>
      ) : loadingComposicao && !composicao ? (
        <p className="mb-6 text-sm text-muted">Carregando composição do pipeline...</p>
      ) : (
        composicao && (
          <ComposicaoPipeline
            porTipoVenda={composicao.porTipoVenda}
            porProduto={composicao.porProduto}
            porClassificacao={composicao.porClassificacao}
          />
        )
      )}

      <section className="mb-6">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted">Ranking de Representantes</p>
        {erroRep && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erroRep}</div>
        )}
        <RankingRepresentantes
          rows={repRows}
          page={repPage}
          pageSize={20}
          total={repTotal}
          loading={loadingRep}
          onPageChange={setRepPage}
          sort={repSort}
          dir={repDir}
          onSortChange={handleSortRepChange}
          empFiltroParams={paramsComunsResumo}
        />
      </section>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {erroTendencia ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erroTendencia}</div>
        ) : loadingTendencia && tendenciaMensal.length === 0 ? (
          <p className="text-sm text-muted">Carregando evolução mensal...</p>
        ) : (
          <TendenciaMensalPropostas serie={tendenciaMensal} />
        )}

        {erroAging ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{erroAging}</div>
        ) : loadingAging && agingBuckets.length === 0 ? (
          <p className="text-sm text-muted">Carregando aging do pipeline...</p>
        ) : (
          <AgingPipelineChart buckets={agingBuckets} />
        )}
      </div>

      {alerta && (
        <p className="mb-3 flex items-center gap-2 text-[11.5px] text-muted">
          Alerta ativo: <span className="text-foreground">{alerta}</span>
          <button onClick={() => handleSelectAlerta(null)} className="text-muted hover:text-destructive">
            ✕
          </button>
        </p>
      )}

      <div className="mt-6">
        <PropostasTable
          rows={propostas.rows}
          page={propostas.page}
          pageSize={propostas.pageSize}
          total={propostas.total}
          loading={loadingTabela}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
