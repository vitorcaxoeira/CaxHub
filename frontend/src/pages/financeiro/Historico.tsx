import axios from "axios";
import { useEffect, useState } from "react";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { campoEmpFil } from "../../components/ui/padroesFiltros/campos";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { SelectFiltro } from "../../components/ui/ControlesFiltro";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { SerieTemporalBarra, SeriePonto } from "../../components/ui/SerieTemporalBarra";
import { KpiTile, KpiTileSkeleton } from "../../components/ui/KpiTile";

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
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta.
  const p = usePadroesTela({
    tela: "financeiro.historico",
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    campos: {
      empFil: campoEmpFil(empresasFiliais, setEmpresasFiliais, opcoes?.filiais),
      meses: { rotulo: "Período", atual: meses, aplicar: setMeses, validar: regras.valorUnico("number", [12, 24, 36]), semOpcoes: true },
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
  }, [empFilIds, meses, p.pronto]);

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
          acessorio={p.estrela("empFil")}
        />
        <SelectFiltro
          aria-label="Período"
          className="w-52"
          value={meses}
          onChange={(e) => setMeses(Number(e.target.value) as 12 | 24 | 36)}
          acessorio={p.estrela("meses")}
        >
          <option value={12}>Últimos 12 meses</option>
          <option value={24}>Últimos 24 meses</option>
          <option value={36}>Últimos 36 meses</option>
        </SelectFiltro>
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
