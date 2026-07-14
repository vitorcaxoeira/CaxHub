import axios from "axios";
import { useEffect, useState } from "react";
import { AgingDashboard } from "../../components/financeiro/AgingDashboard";
import { FiltrosBar, Filtros, FiltroOpcoes } from "../../components/financeiro/FiltrosBar";
import { TitulosTable, TituloRow } from "../../components/financeiro/TitulosTable";

const API_BASE = "/api/financeiro/contas-a-receber";

interface Kpis {
  totalAberto: number;
  totalVencido: number;
  totalAVencer: number;
  titulosAbertosQtd: number;
  agingMedioDias: number;
  recebidoHoje: number;
  recebidoSemana: number;
  recebidoMes: number;
  recebidoAno: number;
  prazoMedioDias: number;
  inadimplenciaPct: number;
  ticketMedio: number;
  crescimentoMensalPct: number;
  dsoAproximado: number;
}

interface Bucket {
  key: string;
  label: string;
  valor: number;
  quantidade: number;
  pct: number;
  tone: "success" | "warning" | "destructive";
}

interface TitulosResponse {
  rows: TituloRow[];
  page: number;
  pageSize: number;
  total: number;
  totalVencido: number;
  totalAVencer: number;
  totalPago: number;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtDias = (v: number) => `${v.toFixed(0)} dias`;

function toneByThreshold(value: number, good: number, warn: number): "success" | "warning" | "destructive" {
  if (value <= good) return "success";
  if (value <= warn) return "warning";
  return "destructive";
}

const TITULOS_VAZIO: TitulosResponse = {
  rows: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalVencido: 0,
  totalAVencer: 0,
  totalPago: 0,
};

export function ContasReceber() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [opcoes, setOpcoes] = useState<FiltroOpcoes | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({ clientes: [], codemp: null, codfil: null, situacao: null });
  const [vencimento, setVencimento] = useState<"vencido" | "a_vencer" | null>(null);
  const [faixa, setFaixa] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [titulos, setTitulos] = useState<TitulosResponse>(TITULOS_VAZIO);
  const [loadingResumo, setLoadingResumo] = useState(true);
  const [loadingTabela, setLoadingTabela] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const clienteIds = filtros.clientes.map((c) => c.codcli).join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar empresas/filiais"));
  }, []);

  useEffect(() => {
    setLoadingResumo(true);
    const params = { codemp: filtros.codemp ?? undefined, codfil: filtros.codfil ?? undefined, clientes: clienteIds };
    Promise.all([
      axios.get(`${API_BASE}/kpis`, { params }),
      axios.get(`${API_BASE}/aging-buckets`, { params }),
    ])
      .then(([kpisRes, bucketsRes]) => {
        setKpis(kpisRes.data);
        setBuckets(bucketsRes.data.buckets);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoadingResumo(false));
  }, [filtros.codemp, filtros.codfil, clienteIds]);

  useEffect(() => {
    setLoadingTabela(true);
    axios
      .get(`${API_BASE}/titulos`, {
        params: {
          codemp: filtros.codemp ?? undefined,
          codfil: filtros.codfil ?? undefined,
          situacao: filtros.situacao ?? undefined,
          clientes: clienteIds,
          vencimento: vencimento ?? undefined,
          faixa: faixa ?? undefined,
          page,
          pageSize: 50,
        },
      })
      .then(({ data }) => setTitulos(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a lista de títulos"))
      .finally(() => setLoadingTabela(false));
  }, [filtros, clienteIds, vencimento, faixa, page]);

  function handleFiltrosChange(novos: Filtros) {
    setFiltros(novos);
    setPage(1);
  }

  function handleVencimentoChange(valor: "vencido" | "a_vencer" | null) {
    setVencimento(valor);
    setPage(1);
  }

  function handleBucketClick(key: string) {
    setFaixa((atual) => (atual === key ? null : key));
    setPage(1);
  }

  const kpiCards = kpis
    ? [
        { label: "Total em Aberto", value: fmtMoney(kpis.totalAberto), sub: `${kpis.titulosAbertosQtd} títulos abertos`, tone: "neutral" as const },
        { label: "Valor Vencido", value: fmtMoney(kpis.totalVencido), sub: "vencidos até hoje", tone: "destructive" as const },
        { label: "Valor a Vencer", value: fmtMoney(kpis.totalAVencer), sub: "ainda dentro do prazo", tone: "success" as const },
        { label: "Recebido Hoje", value: fmtMoney(kpis.recebidoHoje), sub: "caixa de hoje", tone: "success" as const },
        { label: "Recebido na Semana", value: fmtMoney(kpis.recebidoSemana), sub: "semana atual", tone: "success" as const },
        { label: "Recebido no Mês", value: fmtMoney(kpis.recebidoMes), sub: "mês atual", tone: "success" as const },
        { label: "Recebido no Ano", value: fmtMoney(kpis.recebidoAno), sub: "ano corrente", tone: "success" as const },
        {
          label: "Inadimplência",
          value: fmtPct(kpis.inadimplenciaPct),
          sub: "vencido / total em aberto",
          tone: toneByThreshold(kpis.inadimplenciaPct, 10, 25),
        },
        { label: "Ticket Médio", value: fmtMoney(kpis.ticketMedio), sub: "por título em aberto", tone: "neutral" as const },
        {
          label: "Prazo Médio de Recebimento",
          value: fmtDias(kpis.prazoMedioDias),
          sub: "emissão até pagamento (90d)",
          tone: "neutral" as const,
        },
        {
          label: "Aging Médio",
          value: fmtDias(kpis.agingMedioDias),
          sub: "ponderado por valor vencido",
          tone: toneByThreshold(kpis.agingMedioDias, 30, 90),
        },
        {
          label: "DSO Aproximado",
          value: fmtDias(kpis.dsoAproximado),
          sub: "baseado em títulos emitidos (90d)",
          tone: toneByThreshold(kpis.dsoAproximado, 30, 60),
        },
        {
          label: "Crescimento Mensal",
          value: fmtPct(kpis.crescimentoMensalPct),
          sub: "recebido vs. mês anterior",
          tone: kpis.crescimentoMensalPct > 0 ? ("success" as const) : kpis.crescimentoMensalPct < 0 ? ("destructive" as const) : ("neutral" as const),
        },
      ]
    : [];

  const bucketCards = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    valor: currency.format(b.valor),
    pct: b.pct,
    tone: b.tone,
  }));

  return (
    <div>
      <FiltrosBar opcoes={opcoes} filtros={filtros} onChange={handleFiltrosChange} />

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loadingResumo && !kpis ? (
        <p className="text-sm text-muted">Carregando indicadores...</p>
      ) : (
        kpis && (
          <AgingDashboard
            eyebrow="Financeiro · Contas a Receber"
            title="Carteira em aberto"
            subtitle="Dados reais sincronizados do Senior ERP (E301TCR/E301MCR). DSO é uma aproximação baseada em títulos emitidos, não em faturamento fiscal."
            dataLabel="Aging da carteira (clique numa faixa para filtrar a lista abaixo)"
            kpis={kpiCards}
            buckets={bucketCards}
            activeBucket={faixa}
            onBucketClick={handleBucketClick}
          />
        )
      )}

      <div className="mt-6 flex items-center justify-end">
        <select
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={vencimento ?? ""}
          onChange={(e) => handleVencimentoChange((e.target.value || null) as typeof vencimento)}
        >
          <option value="">Vencido e a vencer</option>
          <option value="vencido">Somente vencidos</option>
          <option value="a_vencer">Somente a vencer</option>
        </select>
      </div>

      <div className="mt-3">
        <TitulosTable
          rows={titulos.rows}
          page={titulos.page}
          pageSize={titulos.pageSize}
          total={titulos.total}
          totalVencido={titulos.totalVencido}
          totalAVencer={titulos.totalAVencer}
          totalPago={titulos.totalPago}
          loading={loadingTabela}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
