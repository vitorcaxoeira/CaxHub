import axios from "axios";
import { useEffect, useState } from "react";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { campoEmpFil } from "../../components/ui/padroesFiltros/campos";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { SelectFiltro } from "../../components/ui/ControlesFiltro";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { CurvaABC, ClasseABC } from "../../components/financeiro/CurvaABC";
import { InadimplenciaTable } from "../../components/financeiro/InadimplenciaTable";
import { KpiTile, KpiTileSkeleton } from "../../components/ui/KpiTile";

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

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rankingDevedores, setRankingDevedores] = useState<RankingItem[]>([]);
  const [curva, setCurva] = useState<ClasseABC[]>([]);

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta.
  const p = usePadroesTela({
    tela: "financeiro.inadimplencia",
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    campos: {
      empFil: campoEmpFil(empresasFiliais, setEmpresasFiliais, opcoes?.filiais),
      faixa: { rotulo: "Faixa de atraso", atual: faixa, aplicar: setFaixa, validar: regras.valorUnico("string", FAIXAS.map((f) => f.value)), semOpcoes: true },
    },
  });

  const empFilIds = empresasFiliais.join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => {
        setOpcoesFalharam(true);
        setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro");
      });
  }, []);

  useEffect(() => {
    if (!p.pronto) return;
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
  }, [empFilIds, faixa, p.pronto]);

  function handleEmpFilChange(v: string[]) {
    setEmpresasFiliais(v);
  }
  function handleFaixaChange(v: string) {
    setFaixa(v);
  }

  const kpiCards = kpis
    ? [
        { label: "Total Vencido", value: fmtMoney(kpis.totalVencido), sub: "carteira em atraso", tone: "destructive" as const },
        { label: "Clientes Inadimplentes", value: kpis.qtdClientesInadimplentes.toLocaleString("pt-BR"), sub: "com título vencido", tone: "neutral" as const },
        { label: "% da Carteira Vencida", value: fmtPct(kpis.pctCarteiraVencida), sub: "vencido / total em aberto", tone: "warning" as const },
        { label: "Vencido > 90 dias", value: fmtMoney(kpis.vencidoMais90d), sub: "atraso crítico", tone: "destructive" as const },
      ]
    : [];


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
          acessorio={p.estrela("empFil")}
        />
        <SelectFiltro
          aria-label="Faixa de atraso"
          className="w-48"
          value={faixa}
          onChange={(e) => handleFaixaChange(e.target.value)}
          acessorio={p.estrela("faixa")}
        >
          {FAIXAS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </SelectFiltro>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loadingResumo ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiTileSkeleton key={i} />
          ))}
        </div>
      ) : (
        kpis && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpiCards.map((kpi) => (
                <KpiTile key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} tone={kpi.tone} />
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
        {p.pronto && <InadimplenciaTable url={API_BASE} params={{ empFil: empFilIds, faixa: faixa || undefined }} />}
      </div>
    </div>
  );
}
