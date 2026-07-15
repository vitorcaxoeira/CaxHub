import { useEffect, useRef, useState } from "react";

export interface EmpresaOption {
  codemp: number;
  nomemp: string;
  sigemp: string;
}

export interface FilialOption {
  codemp: number;
  codfil: number;
  nomfil: string;
  sigfil: string;
}

interface EmpresaFilialFilterProps {
  empresas: EmpresaOption[];
  filiais: FilialOption[];
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
}

function chave(codemp: number, codfil: number): string {
  return `${codemp}:${codfil}`;
}

export function EmpresaFilialFilter({ empresas, filiais, selecionados, onChange }: EmpresaFilialFilterProps) {
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

  const empresasOrdenadas = [...empresas].sort((a, b) => a.codemp - b.codemp);

  function filiaisDaEmpresa(codemp: number): FilialOption[] {
    return filiais.filter((f) => f.codemp === codemp).sort((a, b) => a.codfil - b.codfil);
  }

  function toggleFilial(codemp: number, codfil: number) {
    const key = chave(codemp, codfil);
    onChange(selecionados.includes(key) ? selecionados.filter((v) => v !== key) : [...selecionados, key]);
  }

  function toggleEmpresa(codemp: number) {
    const keys = filiaisDaEmpresa(codemp).map((f) => chave(f.codemp, f.codfil));
    const todasSelecionadas = keys.length > 0 && keys.every((k) => selecionados.includes(k));
    if (todasSelecionadas) {
      onChange(selecionados.filter((v) => !keys.includes(v)));
    } else {
      onChange([...new Set([...selecionados, ...keys])]);
    }
  }

  const totalFiliais = filiais.length;
  const label =
    selecionados.length === 0 || selecionados.length === totalFiliais
      ? "Todas as empresas/filiais"
      : selecionados.length === 1
        ? filiais.find((f) => chave(f.codemp, f.codfil) === selecionados[0])?.sigfil ?? selecionados[0]
        : `${selecionados.length} filiais selecionadas`;

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
        <div className="absolute left-0 top-full z-20 mt-1 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {empresasOrdenadas.map((emp) => {
            const filiaisEmp = filiaisDaEmpresa(emp.codemp);
            const keys = filiaisEmp.map((f) => chave(f.codemp, f.codfil));
            const todasSelecionadas = keys.length > 0 && keys.every((k) => selecionados.includes(k));

            return (
              <div key={emp.codemp}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={todasSelecionadas}
                    onChange={() => toggleEmpresa(emp.codemp)}
                    className="accent-primary"
                  />
                  {emp.codemp} - {emp.sigemp}
                </label>
                {filiaisEmp.map((fil) => (
                  <label
                    key={`${fil.codemp}-${fil.codfil}`}
                    className="flex cursor-pointer items-center gap-2 py-1.5 pl-8 pr-3 text-sm text-foreground hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={selecionados.includes(chave(fil.codemp, fil.codfil))}
                      onChange={() => toggleFilial(fil.codemp, fil.codfil)}
                      className="accent-primary"
                    />
                    {fil.codfil} - {fil.sigfil}
                  </label>
                ))}
              </div>
            );
          })}
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
