import { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Moldura comum a todo painel de TV — GENÉRICA (título + carimbo de frescor do
// dado + conteúdo). O que fica ilegível a 3-4 metros nas telas normais do app
// (texto pequeno, tooltip de hover, rolagem horizontal) é resolvido aqui de
// uma vez, pra cada painel novo (deste ou de outro projeto) herdar de graça.
// ---------------------------------------------------------------------------

interface PainelMolduraProps {
  eyebrow: string;
  titulo: string;
  // "dados de HH:mm" — só aparece quando o painel tem uma origem que pode ficar
  // defasada (dominioSync != null); painel 100% local não precisa disto.
  atualizadoEm?: string | null;
  children: ReactNode;
}

export function PainelMoldura({ eyebrow, titulo, atualizadoEm, children }: PainelMolduraProps) {
  return (
    <div className="flex min-h-screen w-full flex-col gap-10 bg-background p-16 text-foreground">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-xl uppercase tracking-widest text-muted">{eyebrow}</p>
          <h1 className="mt-1 font-display text-6xl font-bold">{titulo}</h1>
        </div>
        {atualizadoEm && <p className="font-mono text-lg text-muted">dados de {atualizadoEm}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
