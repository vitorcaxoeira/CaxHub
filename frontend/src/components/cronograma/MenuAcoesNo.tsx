import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NoCronogramaCompleto } from "../../hooks/useCronograma";

// `id` é sempre um nó real (pasta) ou virtual (item) já existente na árvore — nunca um
// sentinela "raiz" à parte, já que "raiz do item" é só escolher o próprio nó do item.
export interface DestinoMover {
  id: number;
  label: string;
}

interface MenuAcoesNoProps {
  no: NoCronogramaCompleto;
  contagemDescendentes: number;
  destinosPossiveis: DestinoMover[];
  // Item de proposta: nunca é uma linha real (vem do Senior, virtual) — não dá pra
  // renomear/duplicar/excluir por aqui, só agrupar/soltar de uma pasta raiz.
  ehItem?: boolean;
  onRenomear: () => void;
  onDuplicar: () => void;
  onMoverPara: (parentId: number) => void;
  onSoltar?: () => void;
  onAdicionarDentro?: (tipo: "pasta" | "atividade") => void;
  permiteAdicionarAtividade?: boolean;
  onExcluir: () => void;
}

const LARGURA_POPOVER = 224;

export function MenuAcoesNo({
  no,
  contagemDescendentes,
  destinosPossiveis,
  ehItem = false,
  onRenomear,
  onDuplicar,
  onMoverPara,
  onSoltar,
  onAdicionarDentro,
  permiteAdicionarAtividade = true,
  onExcluir,
}: MenuAcoesNoProps) {
  const [aberto, setAberto] = useState(false);
  const [mostrarMover, setMostrarMover] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function aoClicarFora(evento: MouseEvent) {
      const alvo = evento.target as Node;
      if (botaoRef.current?.contains(alvo) || popoverRef.current?.contains(alvo)) return;
      setAberto(false);
      setMostrarMover(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, []);

  function alternarAberto() {
    if (!aberto && botaoRef.current) {
      const rect = botaoRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.right - LARGURA_POPOVER, window.innerWidth - LARGURA_POPOVER - 8)),
      });
    }
    setAberto((atual) => !atual);
  }

  function fechar() {
    setAberto(false);
    setMostrarMover(false);
  }

  function confirmarExcluir() {
    const aviso =
      contagemDescendentes > 0
        ? `Excluir "${no.nome}" e ${contagemDescendentes} item(ns) dentro dele?`
        : `Excluir "${no.nome}"?`;
    if (window.confirm(aviso)) onExcluir();
    fechar();
  }

  return (
    <div className="relative flex-none">
      <button
        ref={botaoRef}
        onClick={(e) => {
          e.stopPropagation();
          alternarAberto();
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Ações"
      >
        ⋯
      </button>
      {aberto &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, width: LARGURA_POPOVER }}
            className="fixed z-50 rounded-md border border-border bg-surface p-1 text-sm shadow-lg"
          >
            {!mostrarMover ? (
              <>
                {!ehItem && (
                  <>
                    <button
                      onClick={() => {
                        onRenomear();
                        fechar();
                      }}
                      className="block w-full rounded px-2.5 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      Renomear
                    </button>
                    <button
                      onClick={() => {
                        onDuplicar();
                        fechar();
                      }}
                      className="block w-full rounded px-2.5 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      Duplicar
                    </button>
                  </>
                )}
                {destinosPossiveis.length > 0 && (
                  <button
                    onClick={() => setMostrarMover(true)}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {ehItem ? "Agrupar em pasta…" : "Mover para…"}
                  </button>
                )}
                {ehItem && onSoltar && no.parentId != null && (
                  <button
                    onClick={() => {
                      onSoltar();
                      fechar();
                    }}
                    className="block w-full rounded px-2.5 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    Soltar do grupo
                  </button>
                )}
                {onAdicionarDentro && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={() => {
                        onAdicionarDentro("pasta");
                        fechar();
                      }}
                      className="block w-full rounded px-2.5 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      Adicionar pasta dentro
                    </button>
                    {permiteAdicionarAtividade && (
                      <button
                        onClick={() => {
                          onAdicionarDentro("atividade");
                          fechar();
                        }}
                        className="block w-full rounded px-2.5 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        Adicionar atividade dentro
                      </button>
                    )}
                  </>
                )}
                {!ehItem && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      onClick={confirmarExcluir}
                      className="block w-full rounded px-2.5 py-1.5 text-left text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      Excluir
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="p-1.5">
                <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">Mover para</p>
                {destinosPossiveis.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      onMoverPara(d.id);
                      fechar();
                    }}
                    className="block w-full truncate rounded px-2 py-1.5 text-left text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
