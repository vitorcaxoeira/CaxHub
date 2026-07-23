import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { formatHoras } from "../../utils/horas";
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

export interface ColunaKanban {
  id: number;
  nome: string;
  ordem: number;
  corBadge: string | null;
  ehFinal: boolean;
}

export interface AtividadeKanban {
  id: number;
  codemp: number;
  codpro: number;
  seqite: number;
  numprj: number;
  cliente: string;
  pripro: number | null;
  priproLabel: string;
  datval: string | null;
  depexeLabel: string;
  codfor: number;
  consultorNome: string;
  qtdhorPrevisto: number | null;
  colunaId: number | null;
  coluna: { id: number; nome: string } | null;
  // Início (ISO) da sessão de execução em aberto — presente só quando a atividade está
  // "Em Andamento" agora. Alimenta o cronômetro ao vivo (useCronometro).
  sessaoAtualInicio: string | null;
  atrasada: boolean;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  podeMover: boolean;
  podeEditar: boolean;
  itemDescricao: string | null;
  itemQtdhor: number | null;
  itemAlocado: number;
  // Minutos já trabalhados de verdade, agregados por item (soma de todas as atividades
  // do item) e por esta atividade — sessões de execução + apontamentos confirmados, ver
  // carregarAtividadesVisiveis em backend/src/routes/atividades.ts.
  itemRealizado: number;
  horasRealizadas: number;
  estruturaAtividadeId: number | null;
  estruturaNome: string | null;
  estruturaPercentual: number | null;
  podeVerCronograma: boolean;
}

export interface DetalheInfo {
  titulo: string;
  podeEditar: boolean;
  dataPrevistaInicio: string | null;
  dataPrevistaFim: string | null;
  codemp: number;
  codpro: number;
  seqite: number;
  itemDescricao: string | null;
  itemQtdhor: number | null;
  itemAlocado: number;
  itemRealizado: number;
  horasRealizadas: number;
  estruturaNome: string | null;
  estruturaPercentual: number | null;
  podeVerCronograma: boolean;
}

interface KanbanBoardProps {
  colunas: ColunaKanban[];
  atividades: AtividadeKanban[];
  onMover: (atividadeId: number, novaColunaId: number) => void;
  onAbrirDetalhe: (atividadeId: number, info: DetalheInfo) => void;
  onIniciar: (atividadeId: number) => void;
  onParar: (atividadeId: number) => void;
  // Ids com uma requisição de iniciar/parar em andamento — controla spinner + disabled.
  processando: Set<number>;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });

const corBorda: Record<string, string> = {
  neutral: "border-t-muted",
  warning: "border-t-warning",
  destructive: "border-t-destructive",
  success: "border-t-success",
};

function DraggableCard({
  atividade,
  onAbrirDetalhe,
  onIniciar,
  onParar,
  processando,
}: {
  atividade: AtividadeKanban;
  onAbrirDetalhe: (id: number, info: DetalheInfo) => void;
  onIniciar: (id: number) => void;
  onParar: (id: number) => void;
  processando: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `atividade-${atividade.id}`,
    disabled: !atividade.podeMover,
  });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined;
  const atrasada = atividade.atrasada;
  const emAndamento = atividade.coluna?.nome === RAIA_EM_ANDAMENTO;
  const cronometro = useCronometro(atividade.sessaoAtualInicio);
  const habilitaIniciar = podeIniciar(atividade);
  const habilitaParar = podeParar(atividade);

  function abrirDetalhe() {
    onAbrirDetalhe(atividade.id, {
      titulo: `Proposta ${atividade.codpro} · Projeto ${atividade.numprj}`,
      podeEditar: atividade.podeEditar,
      dataPrevistaInicio: atividade.dataPrevistaInicio,
      dataPrevistaFim: atividade.dataPrevistaFim,
      codemp: atividade.codemp,
      codpro: atividade.codpro,
      seqite: atividade.seqite,
      itemDescricao: atividade.itemDescricao,
      itemQtdhor: atividade.itemQtdhor,
      itemAlocado: atividade.itemAlocado,
      itemRealizado: atividade.itemRealizado,
      horasRealizadas: atividade.horasRealizadas,
      estruturaNome: atividade.estruturaNome,
      estruturaPercentual: atividade.estruturaPercentual,
      podeVerCronograma: atividade.podeVerCronograma,
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(atividade.podeMover ? { ...listeners, ...attributes } : {})}
      role="button"
      tabIndex={0}
      onClick={abrirDetalhe}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrirDetalhe();
        }
      }}
      className={`rounded-md border bg-surface p-3 shadow-sm transition hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        emAndamento ? "border-warning" : "border-border"
      } ${atividade.podeMover ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-foreground">Proposta {atividade.codpro}</p>
        {atividade.pripro !== null && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide ${toneBadge[priproTone(atividade.pripro)]}`}
          >
            {atividade.priproLabel}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[12px] text-muted" title={atividade.cliente}>
        {atividade.cliente}
      </p>
      {atividade.itemDescricao && (
        <p className="mt-1 truncate text-[11px] text-muted" title={atividade.itemDescricao}>
          {atividade.itemDescricao}
        </p>
      )}
      {atividade.estruturaNome && (
        <span className={`mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[9.5px] ${toneBadge.neutral}`}>
          {atividade.estruturaNome}
        </span>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        {emAndamento && (
          <span className="relative flex h-2 w-2 flex-none">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
        )}
        <p className="truncate text-[12px] text-foreground">{atividade.consultorNome}</p>
        {emAndamento && cronometro && (
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-success">{cronometro}</span>
        )}
      </div>
      <p className="text-[11px] text-muted">{atividade.depexeLabel}</p>
      <div className="mt-2 flex items-center justify-between font-mono text-[11px] tabular-nums text-muted">
        <span>{atividade.qtdhorPrevisto != null ? formatHoras(atividade.qtdhorPrevisto / 60) : "—"}</span>
        {atividade.dataPrevistaFim && (
          <span className={atrasada ? "font-semibold text-destructive" : ""}>
            {atrasada ? "Atrasado · " : ""}
            {dateFormatter.format(new Date(atividade.dataPrevistaFim))}
          </span>
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        {(EXIBIR_AMBOS_BOTOES || habilitaIniciar) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIniciar(atividade.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!habilitaIniciar || processando}
            title={motivoIniciarDesabilitado(atividade)}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-primary py-1 text-[10.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none"
          >
            {processando ? <Spinner className="h-3 w-3" /> : <IconePlay />}
            Iniciar
          </button>
        )}
        {(EXIBIR_AMBOS_BOTOES || habilitaParar) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onParar(atividade.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!habilitaParar || processando}
            title={motivoPararDesabilitado(atividade)}
            className="flex flex-1 items-center justify-center gap-1 rounded border border-destructive/50 py-1 text-[10.5px] font-medium text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:pointer-events-none"
          >
            {processando ? <Spinner className="h-3 w-3" /> : <IconeStop />}
            Parar
          </button>
        )}
      </div>
    </div>
  );
}

function DroppableColuna({
  coluna,
  atividades,
  onAbrirDetalhe,
  onIniciar,
  onParar,
  processando,
}: {
  coluna: ColunaKanban;
  atividades: AtividadeKanban[];
  onAbrirDetalhe: (id: number, info: DetalheInfo) => void;
  onIniciar: (id: number) => void;
  onParar: (id: number) => void;
  processando: Set<number>;
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
          <DraggableCard
            key={a.id}
            atividade={a}
            onAbrirDetalhe={onAbrirDetalhe}
            onIniciar={onIniciar}
            onParar={onParar}
            processando={processando.has(a.id)}
          />
        ))}
        {atividades.length === 0 && <p className="px-2 py-4 text-center text-[11.5px] text-muted">Sem atividades</p>}
      </div>
    </div>
  );
}

export function KanbanBoard({ colunas, atividades, onMover, onAbrirDetalhe, onIniciar, onParar, processando }: KanbanBoardProps) {
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
          <DroppableColuna
            key={coluna.id}
            coluna={coluna}
            atividades={atividadesPorColuna.get(coluna.id) ?? []}
            onAbrirDetalhe={onAbrirDetalhe}
            onIniciar={onIniciar}
            onParar={onParar}
            processando={processando}
          />
        ))}
      </div>
    </DndContext>
  );
}
