import axios from "axios";
import { useEffect, useState } from "react";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { campoEmpFil } from "../../components/ui/padroesFiltros/campos";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { ParDatasFiltro } from "../../components/ui/ControlesFiltro";
import { campoParDatas } from "../../components/ui/padroesFiltros/campos";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { KpiTile, KpiTileSkeleton } from "../../components/ui/KpiTile";

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
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta.
  const p = usePadroesTela({
    tela: "financeiro.clientes",
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    campos: {
      empFil: campoEmpFil(empresasFiliais, setEmpresasFiliais, opcoes?.filiais),
      periodo: campoParDatas("Período", periodoInicio, periodoFim, (de, ate) => {
        setPeriodoInicio(de);
        setPeriodoFim(ate);
      }),
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
  }, [empFilIds, periodoInicio, periodoFim, p.pronto]);

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
            acessorio={p.estrela("empFil")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ParDatasFiltro
            rotulo="Período (base p/ novos)"
            de={periodoInicio ?? ""}
            ate={periodoFim ?? ""}
            onDe={(v) => setPeriodoInicio(v || null)}
            onAte={(v) => setPeriodoFim(v || null)}
            acessorio={p.estrela("periodo")}
          />
        </div>
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      {loading ? (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <KpiTileSkeleton key={i} />
          ))}
        </div>
      ) : (
        kpis && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {kpiCards.map((kpi) => (
                <KpiTile key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} />
              ))}
            </div>

            <div className="mb-6">
              <RankingBarra titulo="Maiores clientes (valor em aberto)" itens={maiores} formatarValor={fmtMoney} unidade="títulos" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankingBarra titulo="Clientes novos (no período)" itens={novos} formatarValor={fmtMoney} unidade="títulos" />
              <RankingBarra
                titulo="Clientes perdidos"
                itens={perdidos}
                formatarValor={fmtMoney}
                unidade="títulos"
                descricao="Tinham título emitido nos últimos 12 meses, mas nenhum nos últimos 3"
              />
            </div>
          </>
        )
      )}
    </div>
  );
}
