import { KpiCard } from "../ui/KpiCard";

export type SituacaoKpi = "backlog" | "atrasadas" | "concluidas";

export interface KpiValor {
  quantidade: number;
  horas: number;
}

// Vem de GET /api/atividades (kpis), calculado no escopo total visível ao usuário,
// antes dos filtros transitórios da tabela/quadro — mesmo padrão da Alocação.
export interface KpisAtividades {
  totalNoEscopo: number;
  backlog: KpiValor;
  atrasadas: KpiValor;
  concluidas: KpiValor;
}

export interface IndicadoresProjetosData {
  slaPct: number | null;
  slaAmostra: number;
  porSituacao: { colunaId: number | null; nome: string; corBadge: string | null; qtd: number; horas: number }[];
  porDepartamento: { depexe: number; depexeLabel: string; qtd: number; horas: number; atrasadas: number }[];
  porConsultor: { codfor: number; nome: string; qtd: number; horas: number; atrasadas: number }[];
}

interface IndicadoresProjetosProps {
  dados: IndicadoresProjetosData;
  kpis: KpisAtividades;
  situacaoAtiva: SituacaoKpi | null;
  onKpiClick: (situacao: SituacaoKpi) => void;
}

const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

function toneAtraso(pct: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 50) return "destructive";
  if (pct >= 20) return "warning";
  return "success";
}

function toneSla(pct: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 80) return "success";
  if (pct >= 50) return "warning";
  return "destructive";
}

export function IndicadoresProjetos({ dados, kpis, situacaoAtiva, onKpiClick }: IndicadoresProjetosProps) {
  const pctAtrasadas = kpis.backlog.quantidade > 0 ? (kpis.atrasadas.quantidade / kpis.backlog.quantidade) * 100 : null;

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
      <KpiCard
        label="Backlog"
        tone="primary"
        quantidade={kpis.backlog.quantidade}
        total={kpis.totalNoEscopo}
        horas={kpis.backlog.horas}
        horasLabel="previstas"
        ativo={situacaoAtiva === "backlog"}
        onClick={() => onKpiClick("backlog")}
      />
      <KpiCard
        label="Atrasadas"
        tone={toneAtraso(pctAtrasadas)}
        quantidade={kpis.atrasadas.quantidade}
        total={kpis.backlog.quantidade}
        horas={kpis.atrasadas.horas}
        horasLabel="em atraso"
        ativo={situacaoAtiva === "atrasadas"}
        onClick={() => onKpiClick("atrasadas")}
      />
      <KpiCard
        label="Concluídas"
        tone="success"
        quantidade={kpis.concluidas.quantidade}
        total={kpis.totalNoEscopo}
        horas={kpis.concluidas.horas}
        horasLabel="concluídas"
        ativo={situacaoAtiva === "concluidas"}
        onClick={() => onKpiClick("concluidas")}
      />
      <KpiCard
        label="SLA (concluídas no prazo)"
        tone={toneSla(dados.slaPct)}
        quantidade={Math.round(dados.slaPct ?? 0)}
        total={100}
        valor={fmtPct(dados.slaPct)}
        rodape={dados.slaAmostra > 0 ? `${dados.slaAmostra.toLocaleString("pt-BR")} concluídas com histórico` : "sem amostra ainda"}
      />
    </div>
  );
}
