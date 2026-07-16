import axios from "axios";
import { useEffect, useState } from "react";
import { ClienteFilter, ClienteOption } from "../../components/financeiro/ClienteFilter";
import { MultiSelectDropdown } from "../../components/ui/MultiSelectDropdown";
import { FunilSituacao, FunilItem } from "../../components/projetos/FunilSituacao";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { SerieTemporalPropostas, SeriePonto } from "../../components/projetos/SerieTemporalPropostas";
import { PropostasTable, PropostaRow } from "../../components/projetos/PropostasTable";
import { formatHoras } from "../../utils/horas";

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
  const [serieTemporal, setSerieTemporal] = useState<SeriePonto[]>([]);
  const [propostas, setPropostas] = useState<PropostasResponse>(PROPOSTAS_VAZIO);

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [loadingTabela, setLoadingTabela] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

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
      axios.get(`${API_BASE}/serie-temporal`, { params }),
    ])
      .then(([kpisRes, funilRes, clientesRes, clientesHorasRes, serieRes]) => {
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
        setSerieTemporal(serieRes.data.serie);
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
        },
      })
      .then(({ data }) => setPropostas(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a lista de propostas"))
      .finally(() => setLoadingTabela(false));
  }, [situacaoIds, clienteIds, representanteIds, tipvenIds, modproIds, filtros.datproInicio, filtros.datproFim, page]);

  function atualizarFiltros(parcial: Partial<Filtros>) {
    setFiltros((atual) => ({ ...atual, ...parcial }));
    setPage(1);
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

      {loadingResumo && !kpis ? (
        <p className="text-sm text-muted">Carregando indicadores...</p>
      ) : (
        kpis && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              {kpiCards.map((kpi) => (
                <div key={kpi.label} className="bg-surface p-5">
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

            <div className="mb-6">
              <SerieTemporalPropostas serie={serieTemporal} />
            </div>
          </>
        )
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
