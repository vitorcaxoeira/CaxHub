import axios from "axios";
import { useEffect, useRef, useState } from "react";

export interface ClienteOption {
  codcli: number;
  nomcli: string;
}

interface ClienteFilterProps {
  selecionados: ClienteOption[];
  onChange: (selecionados: ClienteOption[]) => void;
}

export function ClienteFilter({ selecionados, onChange }: ClienteFilterProps) {
  const [query, setQuery] = useState("");
  const [opcoes, setOpcoes] = useState<ClienteOption[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length === 0) {
      setOpcoes([]);
      return;
    }
    const handle = setTimeout(() => {
      axios
        .get("/api/financeiro/contas-a-receber/clientes-busca", { params: { q: query } })
        .then(({ data }) => setOpcoes(data.clientes))
        .catch(() => setOpcoes([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function addCliente(cliente: ClienteOption) {
    if (!selecionados.some((c) => c.codcli === cliente.codcli)) {
      onChange([...selecionados, cliente]);
    }
    setQuery("");
    setOpcoes([]);
  }

  function removeCliente(codcli: number) {
    onChange(selecionados.filter((c) => c.codcli !== codcli));
  }

  const opcoesFiltradas = opcoes.filter((o) => !selecionados.some((s) => s.codcli === o.codcli));

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex min-w-[260px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5">
        {selecionados.map((cliente) => (
          <span
            key={cliente.codcli}
            className="flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-xs text-foreground"
          >
            {cliente.codcli} - {cliente.nomcli}
            <button
              onClick={() => removeCliente(cliente.codcli)}
              className="text-muted hover:text-destructive"
              aria-label={`Remover ${cliente.nomcli}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={selecionados.length === 0 ? "Buscar cliente por nome ou código..." : "Adicionar..."}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
        />
      </div>

      {open && opcoesFiltradas.length > 0 && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full min-w-[280px] overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {opcoesFiltradas.map((cliente) => (
            <button
              key={cliente.codcli}
              onClick={() => addCliente(cliente)}
              className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-2"
            >
              <span className="font-mono text-muted">{cliente.codcli}</span> - {cliente.nomcli}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
