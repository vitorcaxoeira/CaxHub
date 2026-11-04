import axios from "axios";
import { useEffect, useState } from "react";
import { CampoFiltro, SelectFiltro } from "../../components/ui/ControlesFiltro";
import { usePadroesTela } from "../../components/ui/padroesFiltros/usePadroesTela";
import { campoEmpFil } from "../../components/ui/padroesFiltros/campos";
import { regras } from "../../components/ui/padroesFiltros/regras";
import { EmpresaFilialFilter, EmpresaOption, FilialOption } from "../../components/financeiro/EmpresaFilialFilter";
import { SincronizacaoStatus } from "../../components/financeiro/SincronizacaoStatus";
import { Tabs } from "../../components/ui/Tabs";
import { ExecutivaTab } from "./fluxoCaixa/ExecutivaTab";
import { RiscoTab } from "./fluxoCaixa/RiscoTab";
import { OperacionalTab } from "./fluxoCaixa/OperacionalTab";

const API_BASE = "/api/financeiro/fluxo-caixa";

interface OpcoesFiltro {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
}

type PeriodoPreset = "30" | "60" | "90" | "custom";

const TABS = [
  { key: "executiva", label: "Executiva" },
  { key: "risco", label: "Risco" },
  { key: "operacional", label: "Operacional" },
];

export function FluxoCaixa() {
  const [opcoes, setOpcoes] = useState<OpcoesFiltro | null>(null);
  const [empresasFiliais, setEmpresasFiliais] = useState<string[]>([]);
  const [periodoPreset, setPeriodoPreset] = useState<PeriodoPreset>("30");
  const [periodoInicioCustom, setPeriodoInicioCustom] = useState<string | null>(null);
  const [periodoFimCustom, setPeriodoFimCustom] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("executiva");
  const [refreshKey, setRefreshKey] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [opcoesFalharam, setOpcoesFalharam] = useState(false);

  // Padrão de cada filtro (estrela): aplicado uma vez ao abrir, antes da 1ª consulta das abas.
  const p = usePadroesTela({
    tela: "financeiro.fluxo-caixa",
    opcoesProntas: !!opcoes,
    opcoesFalharam,
    campos: {
      empFil: campoEmpFil(empresasFiliais, setEmpresasFiliais, opcoes?.filiais),
      // O preset (30/60/90 dias) ou, em "Personalizado", as datas fixas.
      periodo: {
        rotulo: "Período",
        atual: periodoPreset === "custom" ? ["custom", periodoInicioCustom ?? "", periodoFimCustom ?? ""] : [periodoPreset],
        aplicar: (v: { preset: string; de?: string; ate?: string }) => {
          setPeriodoPreset(v.preset as PeriodoPreset);
          setPeriodoInicioCustom(v.de ?? null);
          setPeriodoFimCustom(v.ate ?? null);
        },
        validar: regras.periodo(["30", "60", "90", "custom"], "custom"),
        semOpcoes: true,
        ordem: true,
      },
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

  function handleSincronizado() {
    setRefreshKey((k) => k + 1);
  }

  const periodoParams =
    periodoPreset === "custom" && periodoInicioCustom && periodoFimCustom
      ? { periodo: "custom", periodoInicio: periodoInicioCustom, periodoFim: periodoFimCustom }
      : { periodo: periodoPreset };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">
          Financeiro · Fluxo de Caixa
        </p>
        <SincronizacaoStatus onAtualizado={handleSincronizado} />
      </div>

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
          className="w-44"
          value={periodoPreset}
          onChange={(e) => setPeriodoPreset(e.target.value as PeriodoPreset)}
          acessorio={p.estrela("periodo")}
        >
          <option value="30">30 dias</option>
          <option value="60">60 dias</option>
          <option value="90">90 dias</option>
          <option value="custom">Personalizado</option>
        </SelectFiltro>
        {periodoPreset === "custom" && (
          <div className="flex items-center gap-2">
            <CampoFiltro type="date" aria-label="Período, de" value={periodoInicioCustom ?? ""} onChange={(e) => setPeriodoInicioCustom(e.target.value || null)} />
            <span className="text-sm text-muted">até</span>
            <CampoFiltro type="date" aria-label="Período, até" value={periodoFimCustom ?? ""} onChange={(e) => setPeriodoFimCustom(e.target.value || null)} />
          </div>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <Tabs tabs={TABS} activeKey={activeTab} onChange={setActiveTab} />

      {p.pronto && activeTab === "executiva" && (
        <ExecutivaTab empFilIds={empFilIds} periodoParams={periodoParams} refreshKey={refreshKey} />
      )}
      {p.pronto && activeTab === "risco" && <RiscoTab empFilIds={empFilIds} refreshKey={refreshKey} />}
      {p.pronto && activeTab === "operacional" && <OperacionalTab empFilIds={empFilIds} refreshKey={refreshKey} />}
    </div>
  );
}
