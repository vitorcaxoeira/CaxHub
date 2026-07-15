import { useEffect, useRef, useState } from "react";

export interface PortadorOption {
  codemp: number;
  codpor: string;
  despor: string;
}

interface PortadorFilterProps {
  opcoes: PortadorOption[];
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
}

export function PortadorFilter({ opcoes, selecionados, onChange }: PortadorFilterProps) {
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

  function toggle(codpor: string) {
    onChange(selecionados.includes(codpor) ? selecionados.filter((v) => v !== codpor) : [...selecionados, codpor]);
  }

  const label =
    selecionados.length === 0
      ? "Todos os portadores"
      : selecionados.length === 1
        ? opcoes.find((o) => o.codpor === selecionados[0])?.despor ?? selecionados[0]
        : `${selecionados.length} portadores`;

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
        <div className="absolute left-0 top-full z-20 mt-1 w-64 max-h-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {opcoes.map((o) => (
            <label
              key={`${o.codemp}-${o.codpor}`}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={selecionados.includes(o.codpor)}
                onChange={() => toggle(o.codpor)}
                className="accent-primary"
              />
              {o.despor}
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
