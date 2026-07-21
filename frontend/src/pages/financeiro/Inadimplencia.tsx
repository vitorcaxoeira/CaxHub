import axios from "axios";
import { useEffect, useState } from "react";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { CurvaABC, ClasseABC } from "../../components/financeiro/CurvaABC";
import { InadimplenciaTable, InadimplenciaRow } from "../../components/financeiro/InadimplenciaTable";

const API_BASE = "/api/financeiro/inadimplencia";

interface Kpis {
  totalVencido: number;
  qtdClientesInadimplentes: number;
  pctCarteiraVencida: number;
  vencidoMais90d: number;
}

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
}

interface ListaResponse {
  rows: InadimplenciaRow[];
  page: number;
  pageSize: number;
  total: number;
}

const LISTA_VAZIA: ListaResponse = { rows: [], page: 1, pageSize: 50, total: 0 };

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const FAIXAS = [
  { value: "", label: "Todas as faixas" },
  { value: "d1_30", label: "1–30 dias" },
  { value: "d31_60", label: "31–60 dias" },
  { value: "d61_90", label: "61–90 dias" },
  { value: "d91_180", label: "91–180 dias" },
  { value: "d180_mais", label: "180+ dias" },
];

export function Inadimplencia() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [faixa, setFaixa] = useState("");
  const [page, setPage] = useState(1);

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rankingDevedores, setRankingDevedores] = useState<RankingItem[]>([]);
  const [curva, setCurva] = useState<ClasseABC[]>([]);
  const [lista, setLista] = useState<ListaResponse>(LISTA_VAZIA);

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [loadingTabela, setLoadingTabela] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const empFilIds = empresasFiliais.join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro"));
  }, []);

  useEffect(() => {
    setLoadingResumo(true);
    const params = { empFil: empFilIds, faixa: faixa || undefined };
    Promise.all([
      axios.get(`${API_BASE}/kpis`, { params }),
      axios.get(`${API_BASE}/ranking-devedores`, { params }),
      axios.get(`${API_BASE}/curva-abc`, { params }),
    ])
      .then(([kpisRes, rankingRes, curvaRes]) => {
        setKpis(kpisRes.data);
        setRankingDevedores(
          rankingRes.data.rows.map((r: { codcli: number; nomcli: string; qtd: number; valor: number }) => ({
            chave: r.codcli,
            nome: `${r.codcli} - ${r.nomcli}`,
            quantidade: r.qtd,
            valor: r.valor,
          }))
        );
        setCurva(curvaRes.data.curva);
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoadingResumo(false));
  }, [empFilIds, faixa]);

  useEffect(() => {
    setLoadingTabela(true);
    axios
      .get(API_BASE, { params: { empFil: empFilIds, faixa: faixa || undefined, page, pageSize: 50 } })
      .then(({ data }) => setLista(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar a lista de títulos vencidos"))
      .finally(() => setLoadingTabela(false));
  }, [empFilIds, faixa, page]);

  function handleEmpFilChange(v: string[]) {
    setEmpresasFiliais(v);
    setPage(1);
  }
  function handleFaixaChange(v: string) {
    setFaixa(v);
    setPage(1);
  }

  const kpiCards = kpis
    ? [
        { label: "Total Vencido", value: fmtMoney(kpis.totalVencido), sub: "carteira em atraso", tone: "destructive" as const },
        { label: "Clientes Inadimplentes", value: kpis.qtdClientesInadimplentes.toLocaleString("pt-BR"), sub: "com título vencido", tone: "neutral" as const },
        { label: "% da Carteira Vencida", value: fmtPct(kpis.pctCarteiraVencida), sub: "vencido / total em aberto", tone: "warning" as const },
        { label: "Vencido > 90 dias", value: fmtMoney(kpis.vencidoMais90d), sub: "atraso crítico", tone: "destructive" as const },
      ]
    : [];

  const toneText: Record<string, string> = { success: "text-success", warning: "text-warning", destructive: "text-destructive", neutral: "text-foreground" };
  const toneBg: Record<string, string> = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", neutral: "bg-muted" };

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Financeiro · Inadimplência
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <EmpresaFilialFilter
          empresas={opcoes?.empresas ?? []}
          filiais={opcoes?.filiais ?? []}
          selecionados={empresasFiliais}
          onChange={handleEmpFilChange}
        />
        <select
          value={faixa}
          onChange={(e) => handleFaixaChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {FAIXAS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
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
                  <span className={`block font-mono text-2xl font-semibold tabular-nums ${toneText[kpi.tone]}`}>{kpi.value}</span>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                    <span className={`h-1.5 w-1.5 flex-none rounded-full ${toneBg[kpi.tone]}`} />
                    {kpi.sub}
                  </p>
                </div>
              ))}
            </div>

            <div className="mb-6">
              <RankingBarra titulo="Top 20 devedores" itens={rankingDevedores} unidade="títulos" />
            </div>

            <div className="mb-6">
              <CurvaABC curva={curva} />
            </div>
          </>
        )
      )}

      <div className="mt-6">
        <InadimplenciaTable
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
