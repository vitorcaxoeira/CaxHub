import { useEffect, useRef, useState } from "react";

export type TipoIgnorado = "proposta" | "consultor" | "item" | "consultorProposta";

const TEXTOS: Record<TipoIgnorado, { um: string; varios: string; efeito: string; onde: string; restaurar: string }> = {
  proposta: { um: "proposta ignorada", varios: "propostas ignoradas", efeito: "nos cálculos", onde: "na lista da aba Propostas", restaurar: "Restaurar todas" },
  consultor: { um: "consultor ignorado", varios: "consultores ignorados", efeito: "nos indicadores da equipe", onde: "na lista da aba Equipe e carga", restaurar: "Restaurar todos" },
  item: { um: "item ignorado", varios: "itens ignorados", efeito: "no cálculo das propostas", onde: "no detalhe da proposta, em Itens e consultores", restaurar: "Restaurar todos" },
  consultorProposta: { um: "consultor ignorado", varios: "consultores ignorados", efeito: "no cálculo das propostas", onde: "no detalhe da proposta, na aba Consultores", restaurar: "Restaurar todos" },
};

// Um desenho por tipo, no mesmo traço do ícone de apontamentos fora do cálculo, para dar para distinguir os alertas lado a lado.
const ICONES: Record<TipoIgnorado, JSX.Element> = {
  proposta: (
    <>
      <path d="M5.5 2.8h6l3.5 3.5v10.9h-9.5z" strokeLinejoin="round" />
      <path d="M11.5 2.8v3.5H15M8 10h4.5M8 13h4.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  consultor: (
    <>
      <circle cx="10" cy="6.8" r="3" />
      <path d="M4 16.5c0-3.2 2.6-5 6-5s6 1.8 6 5" strokeLinecap="round" />
    </>
  ),
  item: <path d="M4 6h12M4 10h12M4 14h7.5" strokeLinecap="round" />,
  consultorProposta: (
    <>
      <circle cx="7.6" cy="7" r="2.5" />
      <path d="M2.8 16c0-2.7 2.1-4.3 4.8-4.3s4.8 1.6 4.8 4.3" strokeLinecap="round" />
      <path d="M12.6 4.7a2.4 2.4 0 0 1 0 4.6M14 11.9c1.9.4 3.2 1.8 3.2 4.1" strokeLinecap="round" />
    </>
  ),
};

// Lembra, em qualquer aba, que há propostas, itens ou consultores fora dos cálculos por escolha da própria pessoa. Sem este aviso, os
// totais pareceriam "errados" para quem esqueceu que marcou alguma coisa (a marcação fica guardada no navegador). Fica discreto: um ícone
// amarelo com a contagem ao lado do título, e o clique abre o que dá para fazer (ver onde está e restaurar).
export function AlertaIgnorados({
  total,
  tipo = "proposta",
  verRotulo = "Ver na lista",
  onVer,
  onRestaurar,
}: {
  total: number;
  tipo?: TipoIgnorado;
  verRotulo?: string;
  onVer: () => void;
  onRestaurar: () => void;
}) {
  const t = TEXTOS[tipo];
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const titulo = `${total} ${total > 1 ? t.varios : t.um} ${t.efeito}`;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const botao =
    "whitespace-nowrap rounded-md border border-border bg-surface px-3 py-1 text-[12.5px] font-medium text-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        title={titulo}
        aria-label={`${titulo}. Abrir as ações`}
        className="relative inline-flex size-6 items-center justify-center rounded-full text-warning transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          {ICONES[tipo]}
        </svg>
        <span className="absolute -right-1.5 -top-1.5 flex min-w-[14px] items-center justify-center rounded-full bg-warning px-[3px] text-[9px] font-bold leading-[14px] text-background">
          {total}
        </span>
      </button>
      {aberto && (
        <div role="dialog" aria-label={titulo} className="absolute right-0 top-full z-30 mt-1.5 w-[min(22rem,85vw)] sm:left-0 sm:right-auto rounded-md border border-border bg-surface p-3 text-[13px] text-foreground shadow-lg">
          <p>
            <b>{titulo}.</b> <span className="text-muted">Escolha sua, vale só neste navegador. Marque ou desmarque {t.onde}.</span>
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                onVer();
              }}
              className={botao}
            >
              {verRotulo}
            </button>
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                onRestaurar();
              }}
              className={botao}
            >
              {total > 1 ? t.restaurar : "Restaurar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
