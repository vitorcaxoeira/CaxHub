import type { FiltroColuna } from "./FiltroColunaServidor";
import { type ColunaDoChip, type OrdemColuna, textoDoChip } from "./estadoColunas";

// Um chip por filtro de coluna ativo, com "✕" para tirar e "Limpar filtros" (24/10/2026, igual ao CaxHub). Sem filtro, não renderiza nada.
export function ChipsFiltros({
  filtros,
  coluna,
  onRemover,
  onLimpar,
}: {
  filtros: FiltroColuna[];
  /** Dá a coluna (domínio, tipo, título) para formatar o chip; pode ser undefined. */
  coluna: (nome: string) => ColunaDoChip | undefined;
  onRemover: (nome: string) => void;
  onLimpar: () => void;
}) {
  if (filtros.length === 0) return null;
  return (
    <>
      {filtros.map((f) => {
        const texto = textoDoChip(f, coluna(f.coluna));
        return (
          <span key={f.coluna} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11.5px] font-medium text-primary">
            <span className="max-w-[320px] truncate" title={texto}>
              {texto}
            </span>
            <button type="button" onClick={() => onRemover(f.coluna)} aria-label={`Remover filtro de ${f.coluna}`} className="hover:text-foreground">
              ✕
            </button>
          </span>
        );
      })}
      <button type="button" onClick={onLimpar} className="text-[11.5px] text-muted hover:text-foreground hover:underline">
        Limpar filtros
      </button>
    </>
  );
}

/** Chip "Ordem: Status ↓, Sigla ↑" com ✕ para tirar a ordenação. `titulos` troca o nome técnico da coluna pelo da tela. */
export function ChipOrdem({ ordem, titulos, onLimpar }: { ordem: OrdemColuna[]; titulos?: Record<string, string>; onLimpar: () => void }) {
  if (ordem.length === 0) return null;
  const texto = ordem.map((o) => `${titulos?.[o.coluna] ?? o.coluna} ${o.direcao === "asc" ? "↑" : "↓"}`).join(", ");
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-medium text-foreground">
      <span className="max-w-[320px] truncate" title={texto}>
        Ordem: {texto}
      </span>
      <button type="button" onClick={onLimpar} aria-label="Remover a ordenação" className="text-muted hover:text-foreground">
        ✕
      </button>
    </span>
  );
}
