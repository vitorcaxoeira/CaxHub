import { useNavigate } from "react-router-dom";
import { Pagination } from "../ui/Pagination";
import { Skeleton } from "../ui/Skeleton";
import { toneBadge, priproTone } from "../ui/badges";
import { IconePlay, IconeStop } from "../ui/iconesExecucao";
import { Spinner } from "../ui/Spinner";
import { useCronometro } from "../../hooks/useCronometro";
import {
  EXIBIR_AMBOS_BOTOES,
  RAIA_EM_ANDAMENTO,
  motivoIniciarDesabilitado,
  motivoPararDesabilitado,
  podeIniciar,
  podeParar,
} from "../../lib/atividade-acoes";
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
  onIniciar: (atividadeId: number) => void;
  onParar: (atividadeId: number) => void;
  processando: Set<number>;
}

function IndicadorSessao({ row }: { row: AtividadeRow }) {
  const emAndamento = row.coluna?.nome === RAIA_EM_ANDAMENTO;
  const cronometro = useCronometro(row.sessaoAtualInicio);
  if (!emAndamento) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
      <span className="relative flex h-2 w-2 flex-none">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {cronometro && <span className="font-mono text-[10.5px] tabular-nums text-success">{cronometro}</span>}
    </span>
  );
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
  onIniciar,
  onParar,
  processando,
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
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="mt-1.5 h-3 w-12" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="h-4 w-36" />
                    </td>
                    <td className="hidden px-5 py-3.5 md:table-cell">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="hidden px-5 py-3.5 lg:table-cell">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-4 w-10" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-5 w-16 rounded" />
                    </td>
                    <td className="hidden px-5 py-3.5 sm:table-cell">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Skeleton className="ml-auto h-7 w-24 rounded" />
                    </td>
                    <td className="px-5 py-3.5">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                  </tr>
                ))}
              {!loading &&
                rows.map((row) => (
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
                  <td className="hidden px-5 py-3.5 text-sm text-muted lg:table-cell">
                    {row.consultorNome}
                    <IndicadorSessao row={row} />
                  </td>
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
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      {(EXIBIR_AMBOS_BOTOES || podeIniciar(row)) && (
                        <button
                          onClick={() => onIniciar(row.id)}
                          disabled={!podeIniciar(row) || processando.has(row.id)}
                          title={motivoIniciarDesabilitado(row)}
                          className="flex items-center gap-1 rounded border border-primary/40 px-2 py-1 text-[11.5px] font-medium text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {processando.has(row.id) ? <Spinner className="h-3 w-3" /> : <IconePlay />}
                          Iniciar
                        </button>
                      )}
                      {(EXIBIR_AMBOS_BOTOES || podeParar(row)) && (
                        <button
                          onClick={() => onParar(row.id)}
                          disabled={!podeParar(row) || processando.has(row.id)}
                          title={motivoPararDesabilitado(row)}
                          className="flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-[11.5px] font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {processando.has(row.id) ? <Spinner className="h-3 w-3" /> : <IconeStop />}
                          Parar
                        </button>
                      )}
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
                    </div>
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
