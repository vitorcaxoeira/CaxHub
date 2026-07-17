import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { formatHoras } from "../../utils/horas";

export interface ColunaKanban {
  id: number;
  nome: string;
  ordem: number;
  corBadge: string | null;
  ehFinal: boolean;
}

export interface AtividadeKanban {
  id: number;
  codpro: number;
  numprj: number;
  cliente: string;
  pripro: number | null;
  priproLabel: string;
  datval: string | null;
  depexeLabel: string;
  consultorNome: string;
  qtdhorPrevisto: number | null;
  colunaId: number | null;
  podeMover: boolean;
}

interface KanbanBoardProps {
  colunas: ColunaKanban[];
  atividades: AtividadeKanban[];
  onMover: (atividadeId: number, novaColunaId: number) => void;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const corBorda: Record<string, string> = {
  neutral: "border-t-muted",
  warning: "border-t-warning",
  destructive: "border-t-destructive",
  success: "border-t-success",
};

const corBadgePrioridade: Record<number, string> = {
  1: "bg-destructive/15 text-destructive",
  2: "bg-warning/15 text-warning",
  3: "bg-muted/15 text-muted",
};

function estaAtrasada(datval: string | null, ehFinal: boolean): boolean {
  if (!datval || ehFinal) return false;
  return new Date(datval) < new Date(new Date().toDateString());
}

function DraggableCard({ atividade, ehFinal }: { atividade: AtividadeKanban; ehFinal: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `atividade-${atividade.id}`,
    disabled: !atividade.podeMover,
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined;
  const atrasada = estaAtrasada(atividade.datval, ehFinal);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(atividade.podeMover ? { ...listeners, ...attributes } : {})}
      className={`rounded-md border border-border bg-surface p-3 shadow-sm transition ${
        atividade.podeMover ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-90"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-foreground">
          Proposta {atividade.codpro} · Projeto {atividade.numprj}
        </p>
        {atividade.pripro !== null && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide ${
              corBadgePrioridade[atividade.pripro] ?? "bg-muted/15 text-muted"
            }`}
          >
            {atividade.priproLabel}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[12px] text-muted" title={atividade.cliente}>
        {atividade.cliente}
      </p>
      <p className="mt-2 text-[12px] text-foreground">{atividade.consultorNome}</p>
      <p className="text-[11px] text-muted">{atividade.depexeLabel}</p>
      <div className="mt-2 flex items-center justify-between font-mono text-[11px] tabular-nums text-muted">
        <span>{atividade.qtdhorPrevisto != null ? formatHoras(atividade.qtdhorPrevisto / 60) : "—"}</span>
        {atividade.datval && (
          <span className={atrasada ? "font-semibold text-destructive" : ""}>
            {atrasada ? "Atrasado · " : ""}
            {dateFormatter.format(new Date(atividade.datval))}
          </span>
        )}
      </div>
    </div>
  );
}

function DroppableColuna({
  coluna,
  atividades,
}: {
  coluna: ColunaKanban;
  atividades: AtividadeKanban[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `coluna-${coluna.id}` });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 flex-none flex-col rounded-lg border-t-4 bg-surface-2/40 ${
        corBorda[coluna.corBadge ?? "neutral"] ?? "border-t-muted"
      } ${isOver ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-foreground">{coluna.nome}</p>
        <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{atividades.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        {atividades.map((a) => (
          <DraggableCard key={a.id} atividade={a} ehFinal={coluna.ehFinal} />
        ))}
        {atividades.length === 0 && <p className="px-2 py-4 text-center text-[11.5px] text-muted">Sem atividades</p>}
      </div>
    </div>
  );
}

export function KanbanBoard({ colunas, atividades, onMover }: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const atividadeId = Number(String(active.id).replace("atividade-", ""));
    const colunaId = Number(String(over.id).replace("coluna-", ""));
    if (!Number.isFinite(atividadeId) || !Number.isFinite(colunaId)) return;
    const atual = atividades.find((a) => a.id === atividadeId);
    if (atual && atual.colunaId === colunaId) return;
    onMover(atividadeId, colunaId);
  }

  const primeiraColuna = colunas[0]?.id ?? null;
  const atividadesPorColuna = new Map<number, AtividadeKanban[]>();
  for (const coluna of colunas) atividadesPorColuna.set(coluna.id, []);
  for (const atividade of atividades) {
    const colunaId = atividade.colunaId ?? primeiraColuna;
    if (colunaId == null) continue;
    if (!atividadesPorColuna.has(colunaId)) atividadesPorColuna.set(colunaId, []);
    atividadesPorColuna.get(colunaId)!.push(atividade);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {colunas.map((coluna) => (
          <DroppableColuna key={coluna.id} coluna={coluna} atividades={atividadesPorColuna.get(coluna.id) ?? []} />
        ))}
      </div>
    </DndContext>
  );
}
