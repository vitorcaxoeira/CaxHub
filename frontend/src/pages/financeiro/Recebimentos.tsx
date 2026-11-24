import axios from "axios";
import { useEffect, useState } from "react";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { PortadorFilter, PortadorOption } from "../../components/financeiro/PortadorFilter";
import { ContaFilter, ContaOption } from "../../components/financeiro/ContaFilter";
import { ClienteFilter, ClienteOption } from "../../components/financeiro/ClienteFilter";
import { RankingBarra, RankingItem } from "../../components/ui/RankingBarra";
import { RecebidoPorDiaChart, PontoRecebidoDia } from "../../components/financeiro/RecebidoPorDiaChart";
import { RecebimentosTable } from "../../components/financeiro/RecebimentosTable";
import { KpiTile, KpiTileSkeleton } from "../../components/ui/KpiTile";
import { SeletorPeriodo } from "../../components/financeiro/SeletorPeriodo";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { campoEmpFil, campoPeriodo } from "../../components/ui/padroesFiltros/campos";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { usePeriodo } from "../../utils/periodo";

const API_BASE = "/api/financeiro/recebimentos";

interface Kpis {
  totalRecebido: number;
  qtdRecebimentos: number;
  ticketMedio: number;
  pctNoPrazo: number;
}

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
  portadores: PortadorOption[];
  contas: ContaOption[];
}

const currency = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (v: number) => `R$ ${currency.format(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

export function Recebimentos() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [portadores, setPortadores] = useState<string[]>([]);
  const [contas, setContas] = useState<string[]>([]);
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const periodo = usePeriodo();
  const { de: datpgtInicio, ate: datpgtFim } = periodo;

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [porDia, setPorDia] = useState<PontoRecebidoDia[]>([]);
  const [porPortador, setPorPortador] = useState<RankingItem[]>([]);
  const [porConta, setPorConta] = useState<RankingItem[]>([]);

  const [loadingResumo, setLoadingResumo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta.
  const p = usePadroesTela({
    tela: "financeiro.recebimentos",
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    campos: {
      clientes: { rotulo: "Cliente", atual: clientes, aplicar: setClientes, validar: regras.listaObjetos("codcli"), semOpcoes: true },
      empFil: campoEmpFil(empresasFiliais, setEmpresasFiliais, opcoes?.filiais),
      portadores: { rotulo: "Portador", atual: portadores, aplicar: setPortadores, validar: regras.lista("string", opcoes?.portadores.map((x) => x.codpor)) },
      contas: { rotulo: "Conta", atual: contas, aplicar: setContas, validar: regras.lista("string", opcoes?.contas.map((x) => x.numcco)) },
      periodo: campoPeriodo(periodo),
    },
  });

  const empFilIds = empresasFiliais.join(",") || undefined;
  const portadorIds = portadores.join(",") || undefined;
  const contaIds = contas.join(",") || undefined;
  const clienteIds = clientes.map((c) => c.codcli).join(",") || undefined;

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
    const params = {
      empFil: empFilIds,
      portadores: portadorIds,
      contas: contaIds,
      clientes: clienteIds,
      datpgtInicio: datpgtInicio ?? undefined,
      datpgtFim: datpgtFim ?? undefined,
    };
    Promise.all([
      axios.get(`${API_BASE}/kpis`, { params }),
      axios.get(`${API_BASE}/por-dia`, { params }),
      axios.get(`${API_BASE}/por-portador`, { params }),
      axios.get(`${API_BASE}/por-conta`, { params }),
    ])
      .then(([kpisRes, porDiaRes, porPortadorRes, porContaRes]) => {
        setKpis(kpisRes.data);
        setPorDia(porDiaRes.data.serie);
        setPorPortador(
          porPortadorRes.data.rows.map((r: { codpor: string; despor: string; qtd: number; valor: number }) => ({
            chave: r.codpor,
            nome: r.despor,
            quantidade: r.qtd,
            valor: r.valor,
          }))
        );
        setPorConta(
          porContaRes.data.rows.map((r: { numcco: string; descco: string; qtd: number; valor: number }) => ({
            chave: r.numcco,
            nome: r.descco,
            quantidade: r.qtd,
            valor: r.valor,
          }))
        );
        setErro(null);
      })
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar os indicadores"))
      .finally(() => setLoadingResumo(false));
  }, [empFilIds, portadorIds, contaIds, clienteIds, datpgtInicio, datpgtFim, p.pronto]);

  function handleEmpFilChange(v: string[]) {
    setEmpresasFiliais(v);
  }
  function handlePortadoresChange(v: string[]) {
    setPortadores(v);
  }
  function handleContasChange(v: string[]) {
    setContas(v);
  }
  function handleClientesChange(v: ClienteOption[]) {
    setClientes(v);
  }

  const kpiCards = kpis
    ? [
        { label: "Total Recebido", value: fmtMoney(kpis.totalRecebido), sub: "no período (mês corrente por padrão)" },
        { label: "Nº de Recebimentos", value: kpis.qtdRecebimentos.toLocaleString("pt-BR"), sub: "movimentos com baixa PG" },
        { label: "Ticket Médio", value: fmtMoney(kpis.ticketMedio), sub: "por recebimento" },
        { label: "% Recebido no Prazo", value: fmtPct(kpis.pctNoPrazo), sub: "sem dias de atraso" },
      ]
    : [];

  return (
    <div>
      <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
        Financeiro · Recebimentos
      </p>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ClienteFilter selecionados={clientes} onChange={handleClientesChange} acessorio={p.estrela("clientes")} />
          <EmpresaFilialFilter
            empresas={opcoes?.empresas ?? []}
            filiais={opcoes?.filiais ?? []}
            selecionados={empresasFiliais}
            onChange={handleEmpFilChange}
            acessorio={p.estrela("empFil")}
          />
          <PortadorFilter opcoes={opcoes?.portadores ?? []} selecionados={portadores} onChange={handlePortadoresChange} acessorio={p.estrela("portadores")} />
          <ContaFilter opcoes={opcoes?.contas ?? []} selecionados={contas} onChange={handleContasChange} acessorio={p.estrela("contas")} />
        </div>
        <SeletorPeriodo periodo={periodo} rotuloDatas="Recebido entre" acessorio={p.estrela("periodo")} />
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
                <KpiTile key={kpi.label} label={kpi.label} value={kpi.value} sub={kpi.sub} />
              ))}
            </div>

            <div className="mb-6">
              <RecebidoPorDiaChart titulo="Recebido por dia" pontos={porDia} />
            </div>

            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RankingBarra titulo="Recebido por portador" itens={porPortador} unidade="recebimentos" />
              <RankingBarra titulo="Recebido por conta (contas ativas)" itens={porConta} unidade="recebimentos" />
            </div>
          </>
        )
      )}

      <div className="mt-6">
        <RecebimentosTable
          url={API_BASE}
          params={{ empFil: empFilIds, portadores: portadorIds, contas: contaIds, clientes: clienteIds, datpgtInicio: datpgtInicio ?? undefined, datpgtFim: datpgtFim ?? undefined }}
        />
      </div>
    </div>
  );
}
