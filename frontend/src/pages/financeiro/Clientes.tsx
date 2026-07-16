import axios from "axios";
import { useEffect, useState } from "react";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";

const API_BASE = "/api/financeiro/clientes";

interface Kpis {
  qtdClientesComTituloAberto: number;
  qtdNovos: number;
  qtdPerdidos: number;
}

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;

function dateInputClass() {
  return "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

function mapRows(rows: { codcli: number; nomcli: string; qtd: number; valor: number }[]): RankingItem[] {
  return rows.map((r) => ({ chave: r.codcli, nome: `${r.codcli} - ${r.nomcli}`, quantidade: r.qtd, valor: r.valor }));
}

export function Clientes() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [periodoInicio, setPeriodoInicio] = useState<string | null>(null);
  const [periodoFim, setPeriodoFim] = useState<string | null>(null);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [maiores, setMaiores] = useState<RankingItem[]>([]);
  const [novos, setNovos] = useState<RankingItem[]>([]);
  const [perdidos, setPerdidos] = useState<RankingItem[]>([]);

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
    const params = {
      empFil: empFilIds,
      periodoInicio: periodoInicio ?? undefined,
      periodoFim: periodoFim ?? undefined,
    };
    Promise.all([
      axios.get(`${API_BASE}/kpis`, { params }),
      axios.get(`${API_BASE}/maiores`, { params }),
      axios.get(`${API_BASE}/novos`, { params }),
      axios.get(`${API_BASE}/perdidos`, { params }),
    ])
      .then(([kpisRes, maioresRes, novosRes, perdidosRes]) => {
        setKpis(kpisRes.data);
        setMaiores(mapRows(maioresRes.data.rows));
        setNovos(mapRows(novosRes.data.rows));
        setPerdidos(mapRows(perdidosRes.data.rows));
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoading(false));
  }, [empFilIds, periodoInicio, periodoFim]);

  const kpiCards = kpis
    ? [
        { label: "Clientes com Título em Aberto", value: kpis.qtdClientesComTituloAberto.toLocaleString("pt-BR"), sub: "carteira ativa hoje" },
        { label: "Clientes Novos", value: kpis.qtdNovos.toLocaleString("pt-BR"), sub: "primeiro título no período" },
        { label: "Clientes Perdidos", value: kpis.qtdPerdidos.toLocaleString("pt-BR"), sub: "sem título nos últimos 3 meses (tinham nos últimos 12)" },
      ]
    : [];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Financeiro · Clientes
      </p>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <EmpresaFilialFilter
            empresas={opcoes?.empresas ?? []}
            filiais={opcoes?.filiais ?? []}
            selecionados={empresasFiliais}
            onChange={setEmpresasFiliais}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Período (base p/ novos):</span>
            <input
              type="date"
              className={dateInputClass()}
              value={periodoInicio ?? ""}
              onChange={(e) => setPeriodoInicio(e.target.value || null)}
            />
            <span className="text-sm text-muted">até</span>
            <input
              type="date"
              className={dateInputClass()}
              value={periodoFim ?? ""}
              onChange={(e) => setPeriodoFim(e.target.value || null)}
            />
          </div>
        </div>
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

            <div className="mb-6">
              <RankingBarra titulo="Maiores clientes (valor em aberto)" itens={maiores} formatarValor={fmtMoney} unidade="títulos" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankingBarra titulo="Clientes novos (no período)" itens={novos} formatarValor={fmtMoney} unidade="títulos" />
              <RankingBarra titulo="Clientes perdidos" itens={perdidos} formatarValor={fmtMoney} unidade="títulos" />
            </div>
          </>
        )
      )}
    </div>
  );
}
