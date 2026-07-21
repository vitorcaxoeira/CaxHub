import axios from "axios";
import { useEffect, useState } from "react";
import { PrevistoRealizadoAcumuladoChart, PontoAcumulado } from "../../../components/financeiro/PrevistoRealizadoAcumuladoChart";
import { CurvaProjetadaChart, PontoProjecao } from "../../../components/financeiro/CurvaProjetadaChart";

const API_BASE = "/api/financeiro/fluxo-caixa";

interface Kpis {
  previsto: { valor: number; qtd: number };
  realizado: { valor: number; qtd: number };
  acuracidadePct: number | null;
  inadimplencia: { pct: number; variacaoPP: number | null };
  dso: { prazoMedioDias: number; prazoConcedidoDias: number };
}

interface ExecutivaTabProps {
  empFilIds?: string;
  periodoParams: { periodo: string; periodoInicio?: string; periodoFim?: string };
  refreshKey: number;
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtDias = (v: number) => `${Math.round(v)} dias`;

const toneText: Record<string, string> = { success: "text-success", warning: "text-warning", destructive: "text-destructive", neutral: "text-foreground" };
const toneBg: Record<string, string> = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", neutral: "bg-muted" };

function toneAcuracidade(pct: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 90) return "success";
  if (pct >= 70) return "warning";
  return "destructive";
}

export function ExecutivaTab({ empFilIds, periodoParams, refreshKey }: ExecutivaTabProps) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [erroKpis, setErroKpis] = useState<string | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);

  const [granularidade, setGranularidade] = useState<"semana" | "mes">("semana");
  const [serieAcumulada, setSerieAcumulada] = useState<PontoAcumulado[]>([]);
  const [erroSerie, setErroSerie] = useState<string | null>(null);
  const [loadingSerie, setLoadingSerie] = useState(true);

  const [curvaProjetada, setCurvaProjetada] = useState<PontoProjecao[]>([]);
  const [limiarCaixaMin, setLimiarCaixaMin] = useState(0);
  const [erroCurva, setErroCurva] = useState<string | null>(null);
  const [loadingCurva, setLoadingCurva] = useState(true);

  useEffect(() => {
    setLoadingKpis(true);
    axios
      .get(`${API_BASE}/kpis`, { params: { empFil: empFilIds, ...periodoParams } })
      .then(({ data }) => {
        setKpis(data);
        setErroKpis(null);
      })
      .catch((err) => setErroKpis(err.response?.data?.error ?? "Falha ao carregar os KPIs"))
      .finally(() => setLoadingKpis(false));
  }, [empFilIds, periodoParams.periodo, periodoParams.periodoInicio, periodoParams.periodoFim, refreshKey]);

  useEffect(() => {
    setLoadingSerie(true);
    axios
      .get(`${API_BASE}/serie-acumulada`, { params: { empFil: empFilIds, granularidade, ...periodoParams } })
      .then(({ data }) => {
        setSerieAcumulada(data.serie);
        setErroSerie(null);
      })
      .catch((err) => setErroSerie(err.response?.data?.error ?? "Falha ao carregar a série acumulada"))
      .finally(() => setLoadingSerie(false));
  }, [empFilIds, granularidade, periodoParams.periodo, periodoParams.periodoInicio, periodoParams.periodoFim, refreshKey]);

  useEffect(() => {
    setLoadingCurva(true);
    Promise.all([
      axios.get(`${API_BASE}/curva-projetada`, { params: { empFil: empFilIds, ...periodoParams } }),
      axios.get(`${API_BASE}/preferencias`),
    ])
      .then(([curvaRes, prefRes]) => {
        setCurvaProjetada(curvaRes.data.serie);
        setLimiarCaixaMin(prefRes.data.limiarCaixaMin);
        setErroCurva(null);
      })
      .catch((err) => setErroCurva(err.response?.data?.error ?? "Falha ao carregar a curva projetada"))
      .finally(() => setLoadingCurva(false));
  }, [empFilIds, periodoParams.periodo, periodoParams.periodoInicio, periodoParams.periodoFim, refreshKey]);

  async function handleSalvarLimiar(valor: number) {
    const { data } = await axios.put(`${API_BASE}/preferencias`, { limiarCaixaMin: valor });
    setLimiarCaixaMin(data.limiarCaixaMin);
  }

  const kpiCards = kpis
    ? [
        {
          label: "Previsto no Período",
          value: fmtMoney(kpis.previsto.valor),
          sub: `${kpis.previsto.qtd.toLocaleString("pt-BR")} títulos por vencimento`,
          tone: "neutral" as const,
        },
        {
          label: "Realizado no Período",
          value: fmtMoney(kpis.realizado.valor),
          sub: `${kpis.realizado.qtd.toLocaleString("pt-BR")} baixas confirmadas`,
          tone: "neutral" as const,
        },
        {
          label: "Acuracidade da Previsão",
          value: kpis.acuracidadePct === null ? "—" : fmtPct(kpis.acuracidadePct),
          sub: kpis.acuracidadePct === null ? "sem janela passada no período" : "realizado ÷ previsto do mesmo passado",
          tone: toneAcuracidade(kpis.acuracidadePct),
        },
        {
          label: "Índice de Inadimplência",
          value: fmtPct(kpis.inadimplencia.pct),
          sub: "vencido ÷ carteira aberta",
          tone: "neutral" as const,
        },
        {
          label: "DSO",
          value: fmtDias(kpis.dso.prazoMedioDias),
          sub: `prazo concedido: ${fmtDias(kpis.dso.prazoConcedidoDias)}`,
          tone: "neutral" as const,
        },
      ]
    : [];

  return (
    <div>
      {erroKpis && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {erroKpis}
        </div>
      )}
      {loadingKpis && !kpis ? (
        <p className="mb-6 text-sm text-muted">Carregando indicadores...</p>
      ) : (
        kpis && (
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {kpiCards.map((kpi) => (
              <div key={kpi.label} className="rounded-lg border border-border bg-surface p-5">
                <p className="mb-2 text-[11.5px] text-muted">{kpi.label}</p>
                <span className={`block font-mono text-2xl font-semibold tabular-nums ${toneText[kpi.tone]}`}>{kpi.value}</span>
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[kpi.tone]}`} />
                  {kpi.sub}
                </p>
              </div>
            ))}
          </div>
        )
      )}

      <div className="mb-6">
        {erroSerie ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
            {erroSerie}
          </div>
        ) : loadingSerie && serieAcumulada.length === 0 ? (
          <p className="text-sm text-muted">Carregando série...</p>
        ) : (
          <PrevistoRealizadoAcumuladoChart
            pontos={serieAcumulada}
            granularidade={granularidade}
            onGranularidadeChange={setGranularidade}
            formatarValor={fmtMoney}
          />
        )}
      </div>

      <div>
        {erroCurva ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
            {erroCurva}
          </div>
        ) : loadingCurva && curvaProjetada.length === 0 ? (
          <p className="text-sm text-muted">Carregando curva projetada...</p>
        ) : (
          <CurvaProjetadaChart
            pontos={curvaProjetada}
            limiar={limiarCaixaMin}
            onSalvarLimiar={handleSalvarLimiar}
            formatarValor={fmtMoney}
          />
        )}
      </div>
    </div>
  );
}
