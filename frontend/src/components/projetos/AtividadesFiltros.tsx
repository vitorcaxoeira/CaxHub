import { ColunaKanban } from "./KanbanBoard";
import { MultiSelectDropdown } from "../ui/MultiSelectDropdown";
import type { SituacaoKpi } from "./IndicadoresProjetos";
import type { FiltrosAtividades } from "./AtividadesTable";

interface OpcaoFiltro {
  value: number;
  label: string;
}

// "134,207" -> [134, 207]. Exportado porque a tela precisa da mesma leitura pra decidir
// se já existe seleção vinda da URL antes de aplicar o padrão.
export function lerCodfors(valor: string): number[] {
  return valor
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v !== 0);
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
        placeholder="Buscar cliente, proposta ou ID da atividade..."
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
      {/* codfor viaja como "134,207" (string) porque é o formato que já vai pra URL e pro
          backend; a conversão pra lista vive só aqui, na borda do componente. */}
      <MultiSelectDropdown
        opcoes={consultores}
        selecionados={lerCodfors(filtros.codfor)}
        onChange={(valores) => onFiltros({ codfor: valores.join(",") })}
        labelTodos="Todos os consultores"
        labelSufixo="consultores"
      />
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
