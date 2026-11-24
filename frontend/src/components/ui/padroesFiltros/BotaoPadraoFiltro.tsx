import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, Star, Trash2 } from "lucide-react";
import { cn } from "../../../lib/cn";
import type { EstadoPadrao } from "./regras";

// Estrela do padrão de UM filtro (03/11/2026): pequena, no canto superior direito do campo (contorno = sem padrão ou outro valor salvo;
// verde preenchida = o valor atual é o padrão; verde e não âmbar, que é a cor dos alertas da tela). Sem padrão ou com outro valor salvo,
// o clique grava o valor atual; com o valor atual já salvo, abre um menu pequeno para remover. É um botão irmão do gatilho do filtro
// (nunca um botão dentro de outro), com área de toque de 24×24 px e dica no hover e no foco de teclado.

const DICA: Record<EstadoPadrao, string> = {
  nenhum: "Usar este valor ao abrir a tela",
  igual: "Padrão salvo para este filtro",
  diferente: "Substituir o padrão pelo valor atual",
};

const ICONE = { size: 15, strokeWidth: 1.75, "aria-hidden": true } as const;
const ICONE_ESTRELA = { size: 12, strokeWidth: 1.75, "aria-hidden": true } as const;

interface BotaoPadraoFiltroProps {
  /** Rótulo do filtro para leitores de tela ("Empresa/filial", "Ano"...). */
  nome: string;
  estado: EstadoPadrao;
  salvando: boolean;
  onSalvar: () => void;
  onRemover: () => void;
}

export function BotaoPadraoFiltro({ nome, estado, salvando, onSalvar, onRemover }: BotaoPadraoFiltroProps) {
  const [menu, setMenu] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const remover = useRef<HTMLButtonElement>(null);
  const idDica = useId();
  const idMenu = useId();

  // O menu só existe enquanto o valor atual é o padrão: mudou o filtro (ou removeu), fecha.
  useEffect(() => {
    if (estado !== "igual") setMenu(false);
  }, [estado]);

  useEffect(() => {
    if (!menu) return;
    remover.current?.focus();
    const fora = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setMenu(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") e.preventDefault();
        setMenu(false);
        botao.current?.focus();
      }
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [menu]);

  const rotulo = salvando
    ? `Salvando padrão do filtro ${nome}`
    : estado === "igual"
      ? `Padrão salvo para o filtro ${nome}`
      : estado === "diferente"
        ? `Substituir o padrão do filtro ${nome} pelo valor atual`
        : `Salvar padrão do filtro ${nome}`;

  return (
    // Ícone encostado no canto superior direito; o botão (24×24) ocupa o canto inteiro para o toque não ficar minúsculo. Com menu, hover
    // ou foco, a camada sobe: senão a dica e o menu passam por baixo da estrela do campo seguinte (cada uma é uma camada z-10).
    <span ref={raiz} className={cn("absolute right-0 top-0 flex focus-within:z-50 hover:z-50", menu ? "z-50" : "z-10")}>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        aria-describedby={salvando || menu ? undefined : idDica}
        aria-busy={salvando || undefined}
        // aria-disabled (e não disabled) para o foco não sumir do botão no meio do salvamento.
        aria-disabled={salvando || undefined}
        aria-haspopup={estado === "igual" ? "menu" : undefined}
        aria-expanded={estado === "igual" ? menu : undefined}
        aria-controls={menu ? idMenu : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (salvando) return;
          if (estado === "igual") setMenu((m) => !m);
          else onSalvar();
        }}
        className={cn(
          "peer inline-flex h-6 w-6 items-start justify-end rounded-bl-md rounded-tr-md pr-[5px] pt-[5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          estado === "igual" ? "text-primary hover:text-primary/80" : "text-muted hover:text-foreground",
          salvando && "cursor-progress"
        )}
      >
        {salvando ? (
          <LoaderCircle {...ICONE_ESTRELA} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Star {...ICONE_ESTRELA} className={estado === "igual" ? "fill-current" : undefined} />
        )}
      </button>

      {!menu && !salvando && (
        <span
          id={idDica}
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-30 mt-4 hidden whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11.5px] font-medium text-surface shadow-md peer-hover:block peer-focus-visible:block"
        >
          {DICA[estado]}
        </span>
      )}

      {menu && (
        <div id={idMenu} role="menu" aria-label={`Padrão do filtro ${nome}`} className="absolute right-0 top-full z-40 mt-3.5 min-w-[220px] rounded-md border border-border bg-surface py-1 shadow-lg">
          <div role="presentation" className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-muted">
            <Check {...ICONE} className="text-primary" />
            Valor salvo como padrão
          </div>
          <div role="separator" className="my-1 h-px bg-border" />
          <button
            ref={remover}
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(false);
              botao.current?.focus();
              onRemover();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
          >
            <Trash2 {...ICONE} className="text-muted" />
            Remover padrão deste filtro
          </button>
        </div>
      )}
    </span>
  );
}
