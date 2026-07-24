import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitulo?: string;
  children: ReactNode;
  className?: string;
}

// Dialog nativo — foco preso e Esc de graça, sem precisar de lib. `onClose` cobre Esc
// (evento `close` do <dialog>) e clique no backdrop (clique cujo alvo é o próprio
// elemento, não um filho — <dialog> ocupa a tela toda quando aberto via showModal()).
export function Modal({ open, onClose, title, subtitulo, children, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        // O Preflight do Tailwind zera `margin` de todo elemento (inclusive <dialog>) —
        // sem `m-auto` o <dialog nativo> perde a centralização automática que o
        // navegador dá de graça em showModal() (via margin:auto no modo modal).
        "fixed inset-0 m-auto h-fit w-full max-w-lg rounded-lg border border-border bg-surface p-0 text-foreground shadow-lg",
        "backdrop:bg-black/50",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitulo && <p className="mt-0.5 truncate text-[12.5px] text-muted">{subtitulo}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="flex-none rounded-md p-1 text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ✕
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}
