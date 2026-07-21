import axios from "axios";
import { useEffect, useState } from "react";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { SerieTemporalBarra, SeriePonto } from "../../components/ui/SerieTemporalBarra";

const API_BASE = "/api/financeiro/historico";

interface Kpis {
  emitido: number;
  recebido: number;
  ticketMedio: number;
}

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

export function Historico() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [meses, setMeses] = useState<12 | 24 | 36>(12);

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
    const params = { empFil: empFilIds, meses };
    Promise.all([axios.get(`${API_BASE}/kpis`, { params }), axios.get(`${API_BASE}/serie`, { params })])
      .then(([kpisRes, serieRes]) => {
        setKpis(kpisRes.data);
        setSerie(
          serieRes.data.serie.map((p: { mes: string; emitido: number; recebido: number }) => ({
            label: p.mes,
            valores: [p.emitido, p.recebido],
          }))
        );
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoading(false));
  }, [empFilIds, meses]);

  const kpiCards = kpis
    ? [
        { label: `Emitido (${meses}m)`, value: fmtMoney(kpis.emitido), sub: "soma de vlrori por data de emissão" },
        { label: `Recebido (${meses}m)`, value: fmtMoney(kpis.recebido), sub: "pagamentos confirmados (PG)" },
        { label: "Ticket Médio Histórico", value: fmtMoney(kpis.ticketMedio), sub: "por recebimento no período" },
      ]
    : [];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Financeiro · Histórico
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <EmpresaFilialFilter
          empresas={opcoes?.empresas ?? []}
          filiais={opcoes?.filiais ?? []}
          selecionados={empresasFiliais}
          onChange={setEmpresasFiliais}
        />
        <select
          value={meses}
          onChange={(e) => setMeses(Number(e.target.value) as 12 | 24 | 36)}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value={12}>Últimos 12 meses</option>
          <option value={24}>Últimos 24 meses</option>
          <option value={36}>Últimos 36 meses</option>
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
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {kpiCards.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border border-border bg-surface p-5">
                  <p className="mb-2 text-[11.5px] text-muted">{kpi.label}</p>
                  <span className="block font-mono text-2xl font-semibold tabular-nums text-foreground">{kpi.value}</span>
                  <p className="mt-1.5 text-[11px] text-muted">{kpi.sub}</p>
                </div>
              ))}
            </div>

            <SerieTemporalBarra
              titulo={`Emitido × Recebido (${meses} meses)`}
              pontos={serie}
              series={[
                { nome: "Emitido", cor: "muted" },
                { nome: "Recebido", cor: "success" },
              ]}
              formatarValor={fmtMoney}
            />

            <p className="mt-4 text-[11px] text-muted">
              Nota: inadimplência/aging histórico não são reconstruíveis com precisão — o sistema não guarda
              snapshots do saldo em aberto de meses passados, só o saldo atual. Este painel mostra emitido e
              recebido, que são fatos históricos seguros.
            </p>
          </>
        )
      )}
    </div>
  );
}
