import axios from "axios";
import { useEffect, useState } from "react";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { PortadorFilter, PortadorOption } from "../../components/financeiro/PortadorFilter";
import { ContaFilter, ContaOption } from "../../components/financeiro/ContaFilter";
import { ClienteFilter, ClienteOption } from "../../components/financeiro/ClienteFilter";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { RecebidoPorDiaChart, PontoRecebidoDia } from "../../components/financeiro/RecebidoPorDiaChart";
import { RecebimentosTable, RecebimentoRow } from "../../components/financeiro/RecebimentosTable";

const API_BASE = "/api/financeiro/recebimentos";

interface Kpis {
  totalRecebido: number;
  qtdRecebimentos: number;
  ticketMedio: number;
  pctNoPrazo: number;
}

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
  portadores: PortadorOption[];
  contas: ContaOption[];
}

interface ListaResponse {
  rows: RecebimentoRow[];
  page: number;
  pageSize: number;
  total: number;
}

const LISTA_VAZIA: ListaResponse = { rows: [], page: 1, pageSize: 50, total: 0 };

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

function dateInputClass() {
  return "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

export function Recebimentos() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [portadores, setPortadores] = useState<string[]>([]);
  const [contas, setContas] = useState<string[]>([]);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [datpgtInicio, setDatpgtInicio] = useState<string | null>(null);
  const [datpgtFim, setDatpgtFim] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [porDia, setPorDia] = useState<PontoRecebidoDia[]>([]);
  const [porPortador, setPorPortador] = useState<RankingItem[]>([]);
  const [porConta, setPorConta] = useState<RankingItem[]>([]);
  const [lista, setLista] = useState<ListaResponse>(LISTA_VAZIA);

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [loadingTabela, setLoadingTabela] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const empFilIds = empresasFiliais.join(",") || undefined;
  const portadorIds = portadores.join(",") || undefined;
  const contaIds = contas.join(",") || undefined;
  const clienteIds = clientes.map((c) => c.codcli).join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro"));
  }, []);

  useEffect(() => {
    setLoadingResumo(true);
    const params = {
      empFil: empFilIds,
      portadores: portadorIds,
      contas: contaIds,
      clientes: clienteIds,
      datpgtInicio: datpgtInicio ?? undefined,
      datpgtFim: datpgtFim ?? undefined,
    };
    Promise.all([
      axios.get(`${API_BASE}/kpis`, { params }),
      axios.get(`${API_BASE}/por-dia`, { params }),
      axios.get(`${API_BASE}/por-portador`, { params }),
      axios.get(`${API_BASE}/por-conta`, { params }),
    ])
      .then(([kpisRes, porDiaRes, porPortadorRes, porContaRes]) => {
        setKpis(kpisRes.data);
        setPorDia(porDiaRes.data.serie);
        setPorPortador(
          porPortadorRes.data.rows.map((r: { codpor: string; despor: string; qtd: number; valor: number }) => ({
            chave: r.codpor,
            nome: r.despor,
            quantidade: r.qtd,
            valor: r.valor,
          }))
        );
        setPorConta(
          porContaRes.data.rows.map((r: { numcco: string; descco: string; qtd: number; valor: number }) => ({
            chave: r.numcco,
            nome: r.descco,
            quantidade: r.qtd,
            valor: r.valor,
          }))
        );
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoadingResumo(false));
  }, [empFilIds, portadorIds, contaIds, clienteIds, datpgtInicio, datpgtFim]);

  useEffect(() => {
    setLoadingTabela(true);
    axios
      .get(API_BASE, {
        params: {
          empFil: empFilIds,
          portadores: portadorIds,
          contas: contaIds,
          clientes: clienteIds,
          datpgtInicio: datpgtInicio ?? undefined,
          datpgtFim: datpgtFim ?? undefined,
          page,
          pageSize: 50,
        },
      })
      .then(({ data }) => setLista(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a lista de recebimentos"))
      .finally(() => setLoadingTabela(false));
  }, [empFilIds, portadorIds, contaIds, clienteIds, datpgtInicio, datpgtFim, page]);

  function handleEmpFilChange(v: string[]) {
    setEmpresasFiliais(v);
    setPage(1);
  }
  function handlePortadoresChange(v: string[]) {
    setPortadores(v);
    setPage(1);
  }
  function handleContasChange(v: string[]) {
    setContas(v);
    setPage(1);
  }
  function handleClientesChange(v: ClienteOption[]) {
    setClientes(v);
    setPage(1);
  }

  const kpiCards = kpis
    ? [
        { label: "Total Recebido", value: fmtMoney(kpis.totalRecebido), sub: "no período (últimos 30d por padrão)" },
        { label: "Nº de Recebimentos", value: kpis.qtdRecebimentos.toLocaleString("pt-BR"), sub: "movimentos com baixa PG" },
        { label: "Ticket Médio", value: fmtMoney(kpis.ticketMedio), sub: "por recebimento" },
        { label: "% Recebido no Prazo", value: fmtPct(kpis.pctNoPrazo), sub: "sem dias de atraso" },
      ]
    : [];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Financeiro · Recebimentos
      </p>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ClienteFilter selecionados={clientes} onChange={handleClientesChange} />
          <EmpresaFilialFilter
            empresas={opcoes?.empresas ?? []}
            filiais={opcoes?.filiais ?? []}
            selecionados={empresasFiliais}
            onChange={handleEmpFilChange}
          />
          <PortadorFilter opcoes={opcoes?.portadores ?? []} selecionados={portadores} onChange={handlePortadoresChange} />
          <ContaFilter opcoes={opcoes?.contas ?? []} selecionados={contas} onChange={handleContasChange} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Recebido entre:</span>
            <input
              type="date"
              className={dateInputClass()}
              value={datpgtInicio ?? ""}
              onChange={(e) => {
                setDatpgtInicio(e.target.value || null);
                setPage(1);
              }}
            />
            <span className="text-sm text-muted">até</span>
            <input
              type="date"
              className={dateInputClass()}
              value={datpgtFim ?? ""}
              onChange={(e) => {
                setDatpgtFim(e.target.value || null);
                setPage(1);
              }}
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
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpiCards.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border border-border bg-surface p-5">
                  <p className="mb-2 text-[11.5px] text-muted">{kpi.label}</p>
                  <span className="block font-mono text-2xl font-semibold tabular-nums text-foreground">{kpi.value}</span>
                  <p className="mt-1.5 text-[11px] text-muted">{kpi.sub}</p>
                </div>
              ))}
            </div>

            <div className="mb-6">
              <RecebidoPorDiaChart titulo="Recebido por dia" pontos={porDia} />
            </div>

            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankingBarra titulo="Recebido por portador" itens={porPortador} unidade="recebimentos" />
              <RankingBarra titulo="Recebido por conta (contas ativas)" itens={porConta} unidade="recebimentos" />
            </div>
          </>
        )
      )}

      <div className="mt-6">
        <RecebimentosTable
          rows={lista.rows}
          page={lista.page}
          pageSize={lista.pageSize}
          total={lista.total}
          loading={loadingTabela}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
