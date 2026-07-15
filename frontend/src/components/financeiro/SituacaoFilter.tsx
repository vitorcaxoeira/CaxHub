import { useEffect, useRef, useState } from "react";

export const SITUACOES = [
  { value: "AB_VENCER", label: "A Vencer" },
  { value: "AB_VENCIDO", label: "Vencido" },
  { value: "AP", label: "Aberto Protestado" },
  { value: "CO", label: "Aberto Cobrança" },
  { value: "LQ", label: "Liquidado Normal" },
  { value: "CA", label: "Cancelado" },
];

interface SituacaoFilterProps {
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
}

export function SituacaoFilter({ selecionados, onChange }: SituacaoFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggle(value: string) {
    onChange(selecionados.includes(value) ? selecionados.filter((v) => v !== value) : [...selecionados, value]);
  }

  const label =
    selecionados.length === 0
      ? "Todas as situações"
      : selecionados.length === 1
        ? SITUACOES.find((s) => s.value === selecionados[0])?.label ?? selecionados[0]
        : `${selecionados.length} situações`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          {SITUACOES.map((s) => (
            <label
              key={s.value}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={selecionados.includes(s.value)}
                onChange={() => toggle(s.value)}
                className="accent-primary"
              />
              {s.label}
            </label>
          ))}
          {selecionados.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full border-t border-border px-3 py-2 text-left text-[11.5px] text-muted hover:bg-surface-2"
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}
