import { ColunaKanban } from "./KanbanBoard";
import type { SituacaoKpi } from "./IndicadoresProjetos";
import type { FiltrosAtividades } from "./AtividadesTable";

interface OpcaoFiltro {
  value: number;
  label: string;
}

const SITUACAO_KPI_LABEL: Record<SituacaoKpi, string> = {
  backlog: "Backlog",
  atrasadas: "Atrasadas",
  concluidas: "Concluídas",
};

interface AtividadesFiltrosProps {
  colunas: ColunaKanban[];
  departamentos: OpcaoFiltro[];
  prioridades: OpcaoFiltro[];
  consultores: OpcaoFiltro[];
  filtros: FiltrosAtividades;
  situacaoKpi: SituacaoKpi | null;
  onFiltros: (patch: Partial<FiltrosAtividades>) => void;
  onLimparKpi: () => void;
}

// Barra de filtros compartilhada entre a Lista (dentro de AtividadesTable) e o Quadro
// (renderizada direto por Atividades.tsx) — mesmo conjunto de filtros nas duas visões,
// já que ambas consomem o mesmo GET /api/atividades filtrado.
export function AtividadesFiltros({
  colunas,
  departamentos,
  prioridades,
  consultores,
  filtros,
  situacaoKpi,
  onFiltros,
  onLimparKpi,
}: AtividadesFiltrosProps) {
  const selectClass =
    "rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input
        type="text"
        placeholder="Buscar cliente ou proposta..."
        value={filtros.busca}
        onChange={(e) => onFiltros({ busca: e.target.value })}
        className={`${selectClass} w-56`}
      />
      <select value={filtros.depexe} onChange={(e) => onFiltros({ depexe: e.target.value })} className={selectClass}>
        <option value="">Todos os departamentos</option>
        {departamentos.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <select value={filtros.colunaId} onChange={(e) => onFiltros({ colunaId: e.target.value })} className={selectClass}>
        <option value="">Todas as situações</option>
        {colunas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
      <select value={filtros.pripro} onChange={(e) => onFiltros({ pripro: e.target.value })} className={selectClass}>
        <option value="">Todas as prioridades</option>
        {prioridades.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <select value={filtros.codfor} onChange={(e) => onFiltros({ codfor: e.target.value })} className={selectClass}>
        <option value="">Todos os consultores</option>
        {consultores.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      {situacaoKpi ? (
        <button
          onClick={onLimparKpi}
          className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/25"
        >
          Filtro do KPI ativo: {SITUACAO_KPI_LABEL[situacaoKpi]} <span aria-hidden>✕</span>
        </button>
      ) : (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={filtros.atrasada} onChange={(e) => onFiltros({ atrasada: e.target.checked })} />
          Só atrasadas
        </label>
      )}
    </div>
  );
}
