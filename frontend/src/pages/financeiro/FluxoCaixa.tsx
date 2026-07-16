import axios from "axios";
import { useEffect, useState } from "react";
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

function dateInputClass() {
  return "rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

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

  const empFilIds = empresasFiliais.join(",") || undefined;

  useEffect(() => {
    axios
      .get(`${API_BASE}/opcoes-filtro`)
      .then(({ data }) => setOpcoes(data))
      .catch((err) => setErro(err.response?.data?.error ?? "Falha ao carregar as opções de filtro"));
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
        />
        <select
          value={periodoPreset}
          onChange={(e) => setPeriodoPreset(e.target.value as PeriodoPreset)}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="30">30 dias</option>
          <option value="60">60 dias</option>
          <option value="90">90 dias</option>
          <option value="custom">Personalizado</option>
        </select>
        {periodoPreset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className={dateInputClass()}
              value={periodoInicioCustom ?? ""}
              onChange={(e) => setPeriodoInicioCustom(e.target.value || null)}
            />
            <span className="text-sm text-muted">até</span>
            <input
              type="date"
              className={dateInputClass()}
              value={periodoFimCustom ?? ""}
              onChange={(e) => setPeriodoFimCustom(e.target.value || null)}
            />
          </div>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {erro}
        </p>
      )}

      <Tabs tabs={TABS} activeKey={activeTab} onChange={setActiveTab} />

      {activeTab === "executiva" && (
        <ExecutivaTab empFilIds={empFilIds} periodoParams={periodoParams} refreshKey={refreshKey} />
      )}
      {activeTab === "risco" && <RiscoTab empFilIds={empFilIds} refreshKey={refreshKey} />}
      {activeTab === "operacional" && <OperacionalTab empFilIds={empFilIds} refreshKey={refreshKey} />}
    </div>
  );
}
