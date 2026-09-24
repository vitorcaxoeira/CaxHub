import { cn } from "../../lib/cn";

interface BotoesNotaProps {
  nota: number | null;
  naoSeAplica: boolean;
  disabled?: boolean;
  onChange: (valor: { nota: number | null; naoSeAplica: boolean }) => void;
}

// 1–5 + NA em botões grandes (alvo de toque ≥ 44px no celular). Tocar de novo na opção já
// marcada limpa a resposta.
export function BotoesNota({ nota, naoSeAplica, disabled, onChange }: BotoesNotaProps) {
  const opcoes: { rotulo: string; valor: number | "NA" }[] = [1, 2, 3, 4, 5].map((n) => ({ rotulo: String(n), valor: n }));
  opcoes.push({ rotulo: "NA", valor: "NA" });

  return (
    <div role="radiogroup" className="grid grid-cols-6 gap-1.5 sm:gap-2">
      {opcoes.map(({ rotulo, valor }) => {
        const ativo = valor === "NA" ? naoSeAplica : !naoSeAplica && nota === valor;
        return (
          <button
            key={rotulo}
            type="button"
            role="radio"
            aria-checked={ativo}
            disabled={disabled}
            onClick={() => {
              if (ativo) return onChange({ nota: null, naoSeAplica: false });
              onChange(valor === "NA" ? { nota: null, naoSeAplica: true } : { nota: valor, naoSeAplica: false });
            }}
            className={cn(
              "min-h-11 rounded-md border text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              ativo
                ? valor === "NA"
                  ? "border-muted bg-muted text-background"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            {rotulo}
          </button>
        );
      })}
    </div>
  );
}
