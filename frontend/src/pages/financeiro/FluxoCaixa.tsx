import axios from "axios";
import { useEffect, useState } from "react";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { SerieTemporalBarra, SeriePonto } from "../../components/ui/SerieTemporalBarra";

const API_BASE = "/api/financeiro/fluxo-caixa";

interface Kpis {
  previsto: number;
  realizado: number;
}

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

export function FluxoCaixa() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [granularidade, setGranularidade] = useState<"semana" | "mes">("semana");

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [serie, setSerie] = useState<SeriePonto[]>([]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const empFilIds = empresasFiliais.join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro"));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = { empFil: empFilIds, granularidade };
    Promise.all([axios.get(`${API_BASE}/kpis`, { params }), axios.get(`${API_BASE}/serie`, { params })])
      .then(([kpisRes, serieRes]) => {
        setKpis(kpisRes.data);
        setSerie(
          serieRes.data.serie.map((p: { periodo: string; previsto: number; realizado: number }) => ({
            label: p.periodo,
            valores: [p.previsto, p.realizado],
          }))
        );
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoading(false));
  }, [empFilIds, granularidade]);

  const diferencaPct = kpis && kpis.previsto > 0 ? ((kpis.realizado - kpis.previsto) / kpis.previsto) * 100 : 0;

  const kpiCards = kpis
    ? [
        { label: "Previsto (próximas 8 janelas)", value: fmtMoney(kpis.previsto), sub: "títulos abertos por vencimento" },
        { label: "Realizado (últimas 8 janelas)", value: fmtMoney(kpis.realizado), sub: "pagamentos confirmados (PG)" },
        { label: "Diferença", value: fmtPct(diferencaPct), sub: "realizado vs. previsto" },
      ]
    : [];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Financeiro · Fluxo de Caixa
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <EmpresaFilialFilter
          empresas={opcoes?.empresas ?? []}
          filiais={opcoes?.filiais ?? []}
          selecionados={empresasFiliais}
          onChange={setEmpresasFiliais}
        />
        <select
          value={granularidade}
          onChange={(e) => setGranularidade(e.target.value as "semana" | "mes")}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="semana">Por semana</option>
          <option value="mes">Por mês</option>
        </select>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loading && !kpis ? (
        <p className="text-sm text-muted">Carregando indicadores...</p>
      ) : (
        kpis && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
              {kpiCards.map((kpi) => (
                <div key={kpi.label} className="bg-surface p-5">
                  <p className="mb-2 text-[11.5px] text-muted">{kpi.label}</p>
                  <span className="block font-mono text-2xl font-semibold tabular-nums text-foreground">{kpi.value}</span>
                  <p className="mt-1.5 text-[11px] text-muted">{kpi.sub}</p>
                </div>
              ))}
            </div>

            <SerieTemporalBarra
              titulo={`Previsto × Realizado (por ${granularidade})`}
              pontos={serie}
              series={[
                { nome: "Previsto", cor: "muted" },
                { nome: "Realizado", cor: "success" },
              ]}
              formatarValor={fmtMoney}
            />
          </>
        )
      )}
    </div>
  );
}
