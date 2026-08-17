import { useEffect, useMemo, useRef, useState } from "react";

export interface MultiSelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface MultiSelectDropdownProps<T extends string | number> {
  opcoes: MultiSelectOption<T>[];
  selecionados: T[];
  onChange: (selecionados: T[]) => void;
  labelTodos: string;
  labelSufixo: string;
}

// Mesma normalização de SelectBuscavel/MultiSelectColumnFilter: sem acento e sem diferença
// de maiúscula — sem isso, buscar "edson" não acha "Édson", nem o código bate se vier com
// espaço/zero à esquerda diferente do digitado.
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function MultiSelectDropdown<T extends string | number>({
  opcoes,
  selecionados,
  onChange,
  labelTodos,
  labelSufixo,
}: MultiSelectDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Abrir sempre começa sem busca — texto de uma abertura anterior preservado faria a
  // lista parecer incompleta (ou vazia) da próxima vez, sem nenhum indício visível do porquê.
  useEffect(() => {
    if (open) {
      setBusca("");
      buscaRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  function toggle(value: T) {
    onChange(selecionados.includes(value) ? selecionados.filter((v) => v !== value) : [...selecionados, value]);
  }

  // Casa contra `value` (código) e `label` (nome) juntos — dá pra digitar "151" ou
  // "kramer" e achar o mesmo consultor. Quem monta as opções decide se o código já
  // aparece no label (ver MeusApontamentos.tsx, "151 - Edson..."); mesmo se não aparecer,
  // a busca ainda casa pelo `value` por baixo.
  const opcoesFiltradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return opcoes;
    return opcoes.filter((o) => normalizar(`${o.value} ${o.label}`).includes(termo));
  }, [opcoes, busca]);

  const label =
    selecionados.length === 0
      ? labelTodos
      : selecionados.length === 1
        ? opcoes.find((o) => o.value === selecionados[0])?.label ?? String(selecionados[0])
        : `${selecionados.length} ${labelSufixo}`;

  // "Selecionar todos" respeita a busca (age só sobre o que está filtrado, somando à
  // seleção atual) — mesmo comportamento de MultiSelectColumnFilter, pra não escolher
  // "todos" quando na verdade só uma dúzia está visível.
  function selecionarTodosFiltrados() {
    const novos = opcoesFiltradas.map((o) => o.value).filter((v) => !selecionados.includes(v));
    onChange([...selecionados, ...novos]);
  }

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
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-surface shadow-lg">
          <div className="border-b border-border p-2">
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código ou nome..."
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {(opcoesFiltradas.some((o) => !selecionados.includes(o.value)) || selecionados.length > 0) && (
            <div className="border-b border-border">
              {opcoesFiltradas.some((o) => !selecionados.includes(o.value)) && (
                <button
                  onClick={selecionarTodosFiltrados}
                  className="w-full px-3 py-2 text-left text-[11.5px] text-muted hover:bg-surface-2"
                >
                  Selecionar todos{busca.trim() ? ` (${opcoesFiltradas.length})` : ""}
                </button>
              )}
              {selecionados.length > 0 && (
                <button
                  onClick={() => onChange([])}
                  className="w-full px-3 py-2 text-left text-[11.5px] text-muted hover:bg-surface-2"
                >
                  Limpar seleção
                </button>
              )}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {opcoesFiltradas.length === 0 && (
              <p className="px-3 py-3 text-center text-[12.5px] text-muted">Nenhum resultado para "{busca}".</p>
            )}
            {opcoesFiltradas.map((o) => (
              <label
                key={String(o.value)}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selecionados.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="accent-primary"
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
