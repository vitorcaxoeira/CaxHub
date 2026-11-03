import axios from "axios";
import { useEffect, useState } from "react";
import { AgingDashboard } from "../../components/financeiro/AgingDashboard";
import { FiltrosBar, Filtros, FiltroOpcoes } from "../../components/financeiro/FiltrosBar";
import { SituacaoFilter } from "../../components/financeiro/SituacaoFilter";
import { TitulosTable } from "../../components/financeiro/TitulosTable";
import { SincronizacaoStatus } from "../../components/financeiro/SincronizacaoStatus";
import { camposTitulos } from "../../components/financeiro/padroesTitulos";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";

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

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtDias = (v: number) => `${v.toFixed(0)} dias`;

function toneByThreshold(value: number, good: number, warn: number): "success" | "warning" | "destructive" {
  if (value <= good) return "success";
  if (value <= warn) return "warning";
  return "destructive";
}

export function ContasReceber() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [opcoes, setOpcoes] = useState<FiltroOpcoes | null>(null);
  const [filtros, setFiltros] = useState<Filtros>({
    clientes: [],
    empresasFiliais: [],
    situacao: [],
    portadores: [],
    vctproInicio: null,
    vctproFim: null,
    datemiInicio: null,
    datemiFim: null,
  });
  const [faixa, setFaixa] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingResumo, setLoadingResumo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta.
  const p = usePadroesTela({
    tela: "financeiro.contas-a-receber",
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    campos: camposTitulos(filtros, setFiltros, opcoes, { campo: "clientes", rotulo: "Cliente", chave: "codcli" }),
  });

  const clienteIds = filtros.clientes.map((c) => c.codcli).join(",") || undefined;
  const situacaoIds = filtros.situacao.join(",") || undefined;
  const portadorIds = filtros.portadores.join(",") || undefined;
  const empFilIds = filtros.empresasFiliais.join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => {
        setOpcoesFalharam(true);
        setErro(err.response?.data?.error ?? "Falha ao carregar empresas/filiais");
      });
  }, []);

  useEffect(() => {
    if (!p.pronto) return;
    setLoadingResumo(true);
    const params = {
      empFil: empFilIds,
      clientes: clienteIds,
      portadores: portadorIds,
      vctproInicio: filtros.vctproInicio ?? undefined,
      vctproFim: filtros.vctproFim ?? undefined,
      datemiInicio: filtros.datemiInicio ?? undefined,
      datemiFim: filtros.datemiFim ?? undefined,
    };
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
  }, [
    empFilIds,
    clienteIds,
    portadorIds,
    filtros.vctproInicio,
    filtros.vctproFim,
    filtros.datemiInicio,
    filtros.datemiFim,
    refreshKey,
    p.pronto,
  ]);

  function handleFiltrosChange(novos: Filtros) {
    setFiltros(novos);
  }

  function handleSincronizado() {
    setRefreshKey((k) => k + 1);
  }

  function handleBucketClick(key: string) {
    setFaixa((atual) => (atual === key ? null : key));
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
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
          Financeiro · Contas a Receber
        </p>
        <SincronizacaoStatus onAtualizado={handleSincronizado} />
      </div>

      <FiltrosBar opcoes={opcoes} filtros={filtros} onChange={handleFiltrosChange} estrela={p.estrela} />

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <AgingDashboard
        dataLabel="Aging da carteira (clique numa faixa para filtrar a lista abaixo)"
        kpis={kpiCards}
        buckets={loadingResumo ? [] : bucketCards}
        activeBucket={faixa}
        onBucketClick={handleBucketClick}
        loading={loadingResumo}
      />

      <div className="mt-6">
        <SituacaoFilter
          selecionados={filtros.situacao}
          onChange={(situacao) => handleFiltrosChange({ ...filtros, situacao })}
          acessorio={p.estrela("situacao")}
        />
      </div>

      <div className="mt-3">
        {p.pronto && <TitulosTable url={`${API_BASE}/titulos`} recarga={refreshKey} params={{ empFil: empFilIds, situacao: situacaoIds, clientes: clienteIds, portadores: portadorIds, vctproInicio: filtros.vctproInicio ?? undefined, vctproFim: filtros.vctproFim ?? undefined, datemiInicio: filtros.datemiInicio ?? undefined, datemiFim: filtros.datemiFim ?? undefined, faixa: faixa ?? undefined }} />}
      </div>
    </div>
  );
}
