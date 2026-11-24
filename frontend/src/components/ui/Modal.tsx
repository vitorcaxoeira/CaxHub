import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitulo?: string;
  children: ReactNode;
  className?: string;
  // Desliga os fechamentos ACIDENTAIS — clique no backdrop e Esc. Pro modal que pede uma
  // decisão (um texto, um sim/não), onde sair sem querer perde o que a pessoa escreveu.
  // O ✕ do cabeçalho continua fechando: um <dialog> sem nenhuma saída pelo teclado seria
  // uma armadilha de foco.
  fecharPorFora?: boolean;
  // O conteúdo cuida da própria rolagem (ex.: uma tabela com cabeçalho fixo): o modal não rola, fica limitado a 90% da tela e o corpo vira
  // uma coluna flexível em que o filho com `min-h-0 flex-1 overflow-auto` ocupa o resto. Sem isso, modal com tabela rolável tinha 3 barras
  // (a do <dialog>, a do corpo e a da tabela).
  corpoFixo?: boolean;
}

// Dialog nativo — foco preso e Esc de graça, sem precisar de lib. `onClose` cobre Esc
// (evento `close` do <dialog>) e clique no backdrop (clique cujo alvo é o próprio
// elemento, não um filho — <dialog> ocupa a tela toda quando aberto via showModal()).
export function Modal({ open, onClose, title, subtitulo, children, className, fecharPorFora = true, corpoFixo = false }: ModalProps) {
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
      // Esc dispara `cancel` antes de `close`; barrar ali é o único jeito de impedir o
      // fechamento nativo do <dialog>.
      onCancel={(e) => {
        if (!fecharPorFora) e.preventDefault();
      }}
      onClick={(e) => fecharPorFora && e.target === ref.current && onClose()}
      className={cn(
        // O Preflight do Tailwind zera `margin` de todo elemento (inclusive <dialog>) —
        // sem `m-auto` o <dialog nativo> perde a centralização automática que o
        // navegador dá de graça em showModal() (via margin:auto no modo modal).
        "fixed inset-0 m-auto h-fit w-full max-w-lg rounded-lg border border-border bg-surface p-0 text-foreground shadow-lg",
        "backdrop:bg-black/50",
        // `open:flex` e não `flex`: display fixo deixaria o <dialog> fechado visível (o navegador o esconde com display: none).
        corpoFixo && "max-h-[90vh] overflow-hidden open:flex open:flex-col",
        className
      )}
    >
      <div className="flex flex-none items-start justify-between gap-3 border-b border-border p-4">
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
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className={corpoFixo ? "flex min-h-0 flex-1 flex-col p-4" : "max-h-[75vh] overflow-y-auto p-4"}>{children}</div>
    </dialog>
  );
}
