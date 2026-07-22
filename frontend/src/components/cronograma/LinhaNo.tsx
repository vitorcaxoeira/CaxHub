import { useEffect, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { HorasAgregadas, OrcamentoItem, StatusNo, estadoAlertaItem, formatHorasCompacto } from "../../lib/cronograma";
import { NoCronogramaCompleto } from "../../hooks/useCronograma";
import { IndicadorProgresso } from "./IndicadorProgresso";
import { OrcamentoItemLinha } from "./OrcamentoItemLinha";
import { BadgeStatus } from "./BadgeStatus";
import { MenuAcoesNo, DestinoMover } from "./MenuAcoesNo";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function formatPeriodoCompacto(inicio: string | null, fim: string | null): string {
  if (!inicio && !fim) return "—";
  const i = inicio ? dateFormatter.format(new Date(inicio)) : "?";
  const f = fim ? dateFormatter.format(new Date(fim)) : "?";
  return `${i} – ${f}`;
}

function iniciais(nome: string | null): string {
  if (!nome) return "—";
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

const CIRCULO_STATUS: Record<StatusNo, string> = {
  nao_iniciada: "border-muted",
  em_curso: "border-primary bg-primary/20",
  bloqueada: "border-warning bg-warning/20",
  concluida: "border-success bg-success",
};

function IconeStatusAtividade({ status }: { status: StatusNo }) {
  return (
    <span className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border-2 ${CIRCULO_STATUS[status]}`}>
      {status === "concluida" && (
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--success-foreground)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}

function combinarRefs<T>(...refs: (((node: T) => void) | undefined)[]) {
  return (node: T) => {
    for (const ref of refs) ref?.(node);
  };
}

interface LinhaNoProps {
  no: NoCronogramaCompleto;
  profundidade: number;
  temFilhos: boolean;
  expandido: boolean;
  statusEfetivo: StatusNo;
  agregado: HorasAgregadas;
  // Só presente pra tipo="item" — orçamento (contratado/distribuído/realizado) daquele
  // item; pasta/atividade usam só `agregado` (não têm contratado próprio).
  orcamento?: OrcamentoItem;
  contagemDescendentes: number;
  selecionado: boolean;
  destinosPossiveis: DestinoMover[];
  onToggleExpandir: () => void;
  onSelecionar: () => void;
  onAbrirDrawer: () => void;
  onRenomear: (nome: string) => Promise<void>;
  onDuplicar: () => void;
  onMoverPara: (parentId: number) => void;
  onSoltar?: () => void;
  onAdicionarDentro?: (tipo: "pasta" | "atividade") => void;
  onExcluir: () => void;
  // Dígitos mínimos de hora usados em toda a linha (ver larguraHorasProposta em
  // cronograma.ts) — mesmo valor pra árvore inteira, calculado uma vez no topo.
  larguraHoras: number;
}

export function LinhaNo({
  no,
  profundidade,
  temFilhos,
  expandido,
  statusEfetivo,
  agregado,
  orcamento,
  contagemDescendentes,
  selecionado,
  destinosPossiveis,
  onToggleExpandir,
  onSelecionar,
  onAbrirDrawer,
  onRenomear,
  onDuplicar,
  onMoverPara,
  onSoltar,
  onAdicionarDentro,
  onExcluir,
  larguraHoras,
}: LinhaNoProps) {
  const paddingEsquerda = 14 + profundidade * 24;
  const [renomeando, setRenomeando] = useState(false);
  const [valorNome, setValorNome] = useState(no.nome);
  const inputRenomeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renomeando) requestAnimationFrame(() => inputRenomeRef.current?.select());
  }, [renomeando]);

  const podeArrastar = no.podeEditarItem;
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `no-${no.id}`,
    disabled: !podeArrastar,
  });
  const { setNodeRef: setTopoRef, isOver: isOverTopo } = useDroppable({
    id: `topo-${no.id}`,
    disabled: no.tipo === "item",
  });
  const { setNodeRef: setCorpoRef, isOver: isOverCorpo } = useDroppable({ id: `corpo-${no.id}` });

  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 } : undefined;

  async function confirmarRenomear() {
    const nome = valorNome.trim();
    setRenomeando(false);
    if (nome === "" || nome === no.nome) return;
    await onRenomear(nome);
  }

  function aoClicarLinha() {
    onSelecionar();
    if (no.tipo !== "item" && !renomeando) onAbrirDrawer();
  }

  // Tratamento de linha por estado de alerta do item — só os dois mais graves pintam a
  // linha inteira (borda + fundo); "estouro_distribuicao" fica só nos números/barra do
  // próprio bloco de orçamento (ver OrcamentoItemLinha), não pinta a linha.
  const alerta = orcamento ? estadoAlertaItem(orcamento) : "ok";
  const excedenteReal = orcamento ? orcamento.horasRealizadas - orcamento.horasContratadas : 0;

  // Largura da coluna HORAS de pasta/atividade em "ch" (largura exata de um caractere no
  // fonte monoespaçada) — dois números "HH:MM" mais o separador (" / " ou " · ", 3
  // caracteres) e uma folga de 1ch. Fixa em px (90px) quebrava linha quando a proposta
  // inteira precisa de mais dígitos de hora (ver larguraHorasProposta); em "ch" a coluna
  // acompanha `larguraHoras` sem precisar de um valor por chute.
  const larguraColunaHoras = `${2 * (larguraHoras + 3) + 4}ch`;

  return (
    <div className="group relative" ref={setTopoRef}>
      {isOverTopo && <div className="absolute inset-x-0 top-0 z-20 h-0.5 bg-primary" />}
      <div
        ref={combinarRefs(setDragRef, setCorpoRef)}
        role="treeitem"
        aria-expanded={temFilhos ? expandido : undefined}
        aria-selected={selecionado}
        tabIndex={0}
        onClick={aoClicarLinha}
        onFocus={onSelecionar}
        className={`flex ${
          no.tipo === "item" ? "min-h-[46px]" : "min-h-9"
        } cursor-pointer items-center gap-1.5 border-b border-border/50 py-1.5 pr-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
          alerta === "estouro_realizado"
            ? "border-l-[3px] border-l-destructive bg-destructive/10"
            : alerta === "real_acima_previsto"
              ? "border-l-[3px] border-l-warning bg-warning/10"
              : no.tipo === "pasta"
                ? "bg-surface-2"
                : "bg-surface hover:bg-surface-2"
        } ${
          alerta === "ok" || alerta === "estouro_distribuicao"
            ? no.tipo === "item" && expandido
              ? "border-l-[3px] border-l-primary"
              : no.tipo === "item"
                ? "border-l border-l-border"
                : ""
            : ""
        } ${selecionado ? "ring-1 ring-inset ring-primary/50" : ""} ${isDragging ? "opacity-40" : ""} ${
          isOverCorpo && no.tipo !== "atividade" ? "ring-2 ring-inset ring-primary/40" : ""
        }`}
        style={{ ...style, paddingLeft: paddingEsquerda }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpandir();
          }}
          className="flex w-4 flex-none items-center justify-center rounded text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {temFilhos ? (expandido ? "▾" : "▸") : "·"}
        </button>

        {podeArrastar && (
          <span
            {...listeners}
            {...attributes}
            onClick={(e) => e.stopPropagation()}
            className="flex-none cursor-grab text-[11px] text-muted opacity-0 group-hover:opacity-100 active:cursor-grabbing"
            title="Arrastar"
          >
            ⠿
          </span>
        )}

        <span className="flex-none text-[13px]">{no.tipo === "item" ? "📦" : no.tipo === "pasta" ? "📁" : null}</span>

        {no.tipo === "atividade" && <IconeStatusAtividade status={statusEfetivo} />}

        {renomeando ? (
          <input
            ref={inputRenomeRef}
            autoFocus
            value={valorNome}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setValorNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmarRenomear();
              if (e.key === "Escape") {
                setValorNome(no.nome);
                setRenomeando(false);
              }
            }}
            onBlur={confirmarRenomear}
            className="flex-1 rounded border border-primary/40 bg-surface px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <span
            className={`truncate text-sm ${
              no.tipo === "item" ? "min-w-0 max-w-[90px] flex-1 font-medium text-foreground sm:max-w-[220px]" : "flex-1 text-foreground"
            }`}
            title={no.nome}
          >
            {no.nome}
          </span>
        )}

        {no.tipo === "item" && alerta === "estouro_realizado" && (
          <span
            className="hidden flex-none items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-destructive sm:inline-flex"
            title={`Realizado excede o contratado em ${formatHorasCompacto(excedenteReal, larguraHoras)}`}
          >
            ⚠ +{formatHorasCompacto(excedenteReal, larguraHoras)}
          </span>
        )}

        {no.tipo === "item" && alerta === "real_acima_previsto" && (
          <span
            className="hidden flex-none items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-warning sm:inline-flex"
            title="O realizado já passou do que foi distribuído — planejamento ficou pra trás"
          >
            real &gt; distr
          </span>
        )}

        {no.tipo === "item" && orcamento && (
          <OrcamentoItemLinha orcamento={orcamento} larguraHoras={larguraHoras} className="max-w-md flex-[2]" />
        )}

        {/* Espaçador sem conteúdo — nome (max-w-[220px]) e bloco de orçamento (max-w-md)
            têm teto de largura; em telas largas os dois batem no teto e sobra espaço no
            meio da linha, empurrando Horas/Período/Status/Menu pra esquerda do que
            deveriam ficar (cada item sobra uma quantidade diferente, já que depende do
            texto). Pasta/atividade não têm esse problema porque o nome deles não tem
            teto e absorve 100% da sobra sozinho. Isso aqui faz o mesmo papel só pro
            item, sem alterar os tetos de name/orçamento. */}
        {no.tipo === "item" && <div className="min-w-0 flex-1" />}

        {no.tipo === "atividade" && no.predecessoraId != null && (
          <span className="flex-none rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-warning">
            dep. {no.predecessoraId}
          </span>
        )}

        {no.tipo === "atividade" && (
          <span
            className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-surface-2 font-mono text-[9.5px] font-medium text-muted"
            title={no.responsavelNome ?? undefined}
          >
            {iniciais(no.responsavelNome)}
          </span>
        )}

        {no.tipo === "atividade" ? (
          <div className="hidden flex-none md:block" style={{ width: larguraColunaHoras }}>
            <p
              className={`text-right font-mono text-[12px] tabular-nums ${
                agregado.horasRealizadas > agregado.horasPrevistas ? "text-warning" : "text-muted"
              }`}
            >
              {formatHorasCompacto(agregado.horasRealizadas, larguraHoras)} / {formatHorasCompacto(agregado.horasPrevistas, larguraHoras)}
            </p>
            <IndicadorProgresso
              avanco={agregado.avanco}
              cor={agregado.horasRealizadas > agregado.horasPrevistas ? "bg-warning" : "bg-primary"}
              alturaPx={3}
              className="mt-1"
            />
          </div>
        ) : no.tipo === "pasta" ? (
          <div
            className="hidden flex-none text-right font-mono text-[12px] tabular-nums md:block"
            style={{ width: larguraColunaHoras }}
          >
            <span className="text-primary">{formatHorasCompacto(agregado.horasRealizadas, larguraHoras)}</span>
            <span className="text-muted"> · {formatHorasCompacto(agregado.horasPrevistas, larguraHoras)}</span>
          </div>
        ) : (
          <div className="hidden flex-none md:block" style={{ width: larguraColunaHoras }} />
        )}

        <div className="hidden w-[110px] flex-none text-right font-mono text-[11.5px] text-muted md:block">
          {no.tipo === "atividade" ? formatPeriodoCompacto(no.dataPrevistaInicio, no.dataPrevistaFim) : ""}
        </div>

        <div className="w-[90px] flex-none text-right">
          <BadgeStatus status={statusEfetivo} />
        </div>

        <div className="w-6 flex-none" onClick={(e) => e.stopPropagation()}>
          {no.podeEditarItem && (
            <MenuAcoesNo
              no={no}
              contagemDescendentes={contagemDescendentes}
              destinosPossiveis={destinosPossiveis}
              ehItem={no.tipo === "item"}
              onRenomear={() => setRenomeando(true)}
              onDuplicar={onDuplicar}
              onMoverPara={onMoverPara}
              onSoltar={onSoltar}
              onAdicionarDentro={no.tipo !== "atividade" ? onAdicionarDentro : undefined}
              permiteAdicionarAtividade={no.tipo === "pasta" && no.seqite != null}
              onExcluir={onExcluir}
            />
          )}
        </div>
      </div>
    </div>
  );
}
