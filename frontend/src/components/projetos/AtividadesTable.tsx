import { useNavigate } from "react-router-dom";
import { Pagination } from "../ui/Pagination";
import { toneBadge, priproTone } from "../ui/badges";
import { AtividadeKanban, ColunaKanban, DetalheInfo } from "./KanbanBoard";
import { AtividadesFiltros } from "./AtividadesFiltros";
import type { SituacaoKpi } from "./IndicadoresProjetos";

// Mesmo array que alimenta o Kanban/Calendário/Timeline (GET /api/atividades) — o tipo
// de linha da tabela é o mesmo, não uma projeção separada.
export type AtividadeRow = AtividadeKanban;

interface OpcaoFiltro {
  value: number;
  label: string;
}

export interface FiltrosAtividades {
  busca: string;
  depexe: string;
  colunaId: string;
  pripro: string;
  codfor: string;
  atrasada: boolean;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const horasFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function formatQtdHor(minutos: number | null): string {
  if (minutos == null) return "—";
  const totalMinutos = Math.round(minutos);
  const horas = Math.trunc(totalMinutos / 60);
  const resto = Math.abs(totalMinutos % 60);
  return `${horasFormatter.format(horas)}:${String(resto).padStart(2, "0")} h`;
}

const PAGE_SIZE = 25;

interface AtividadesTableProps {
  rows: AtividadeRow[];
  total: number;
  page: number;
  loading: boolean;
  colunas: ColunaKanban[];
  departamentos: OpcaoFiltro[];
  prioridades: OpcaoFiltro[];
  consultores: OpcaoFiltro[];
  filtros: FiltrosAtividades;
  situacaoKpi: SituacaoKpi | null;
  onFiltros: (patch: Partial<FiltrosAtividades>) => void;
  onPageChange: (page: number) => void;
  onLimparKpi: () => void;
  onMover: (atividadeId: number, novaColunaId: number) => void;
  onAbrirDetalhe: (atividadeId: number, info: DetalheInfo) => void;
}

// Componente controlado: filtros, paginação e dados vêm da página (Atividades.tsx),
// que também alimenta o Kanban/Calendário/Timeline com o mesmo recorte — isso permite
// que um KPI clicado filtre tanto a lista quanto o quadro.
export function AtividadesTable({
  rows,
  total,
  page,
  loading,
  colunas,
  departamentos,
  prioridades,
  consultores,
  filtros,
  situacaoKpi,
  onFiltros,
  onPageChange,
  onLimparKpi,
  onMover,
  onAbrirDetalhe,
}: AtividadesTableProps) {
  const navigate = useNavigate();

  return (
    <div>
      <AtividadesFiltros
        colunas={colunas}
        departamentos={departamentos}
        prioridades={prioridades}
        consultores={consultores}
        filtros={filtros}
        situacaoKpi={situacaoKpi}
        onFiltros={onFiltros}
        onLimparKpi={onLimparKpi}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Proposta
                </th>
                <th className="bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Cliente
                </th>
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted md:table-cell">
                  Departamento
                </th>
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted lg:table-cell">
                  Consultor
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Horas
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Prioridade
                </th>
                <th className="hidden bg-surface-2 px-5 py-3 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted sm:table-cell">
                  Fim previsto
                </th>
                <th className="bg-surface-2 px-5 py-3 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-muted">
                  Situação
                </th>
                <th className="bg-surface-2 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border/60 transition hover:bg-surface-2">
                  <td className="px-5 py-3.5 text-sm font-semibold">
                    <button
                      onClick={() => navigate(`/projetos/proposta/${row.codemp}/${row.codpro}`)}
                      className="text-primary hover:underline"
                    >
                      {row.codpro}
                    </button>
                    {row.estruturaNome && (
                      <span className={`mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${toneBadge.neutral}`}>
                        {row.estruturaNome}
                      </span>
                    )}
                  </td>
                  <td className="max-w-[220px] px-5 py-3.5 text-sm text-foreground">
                    <p className="truncate" title={row.cliente}>
                      {row.cliente}
                    </p>
                    {row.itemDescricao && (
                      <p className="truncate text-[11px] text-muted" title={row.itemDescricao}>
                        {row.itemDescricao}
                      </p>
                    )}
                  </td>
                  <td className="hidden px-5 py-3.5 text-sm text-muted md:table-cell">{row.depexeLabel}</td>
                  <td className="hidden px-5 py-3.5 text-sm text-muted lg:table-cell">{row.consultorNome}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-muted">
                    {formatQtdHor(row.qtdhorPrevisto)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {row.pripro !== null && (
                      <span
                        className={`inline-block rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${toneBadge[priproTone(row.pripro)]}`}
                      >
                        {row.priproLabel}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-5 py-3.5 font-mono text-sm sm:table-cell">
                    <span className={row.atrasada ? "font-semibold text-destructive" : "text-muted"}>
                      {row.dataPrevistaFim ? dateFormatter.format(new Date(row.dataPrevistaFim)) : "—"}
                      {row.atrasada ? " · Atrasado" : ""}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <select
                      value={row.colunaId ?? ""}
                      disabled={!row.podeMover}
                      onChange={(e) => onMover(row.id, Number(e.target.value))}
                      className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {colunas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() =>
                        onAbrirDetalhe(row.id, {
                          titulo: `Proposta ${row.codpro} · Projeto ${row.numprj}`,
                          podeEditar: row.podeEditar,
                          dataPrevistaInicio: row.dataPrevistaInicio,
                          dataPrevistaFim: row.dataPrevistaFim,
                          codemp: row.codemp,
                          codpro: row.codpro,
                          seqite: row.seqite,
                          itemDescricao: row.itemDescricao,
                          itemQtdhor: row.itemQtdhor,
                          itemAlocado: row.itemAlocado,
                          itemRealizado: row.itemRealizado,
                          estruturaNome: row.estruturaNome,
                          horasRealizadas: row.horasRealizadas,
                          estruturaPercentual: row.estruturaPercentual,
                          podeVerCronograma: row.podeVerCronograma,
                        })
                      }
                      className="text-sm text-primary hover:underline"
                    >
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-sm text-muted">
                    Nenhuma atividade encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} loading={loading} onPageChange={onPageChange} label="atividades" />
      </div>
    </div>
  );
}
