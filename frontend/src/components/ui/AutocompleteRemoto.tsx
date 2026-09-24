import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";

interface AutocompleteRemotoProps<T> {
  /** Item já escolhido (mostrado no campo). */
  valor: T | null;
  onChange: (item: T | null) => void;
  /** Rota relativa (`/api/...`) que devolve `{ [chaveLista]: T[] }` e aceita `?q=`. */
  url: string;
  chaveLista: string;
  /** Parâmetros fixos além de `q` (ex.: filtrar propostas por cliente). */
  params?: Record<string, string | number | undefined>;
  rotulo: (item: T) => string;
  /** Segunda linha opcional da opção. */
  detalhe?: (item: T) => string | null;
  chave: (item: T) => string | number;
  placeholder: string;
  desabilitado?: boolean;
}

// Escolha única com busca no servidor — SelectBuscavel filtra uma lista já carregada, e
// cliente/proposta são milhares de linhas, então a busca precisa ir ao backend a cada
// digitação (com debounce).
export function AutocompleteRemoto<T>({
  valor,
  onChange,
  url,
  chaveLista,
  params,
  rotulo,
  detalhe,
  chave,
  placeholder,
  desabilitado = false,
}: AutocompleteRemotoProps<T>) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(false);
  const buscaDebounced = useDebouncedValue(busca, 250);
  const containerRef = useRef<HTMLDivElement>(null);
  const paramsChave = JSON.stringify(params ?? {});

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setCarregando(true);
    axios
      .get(url, { params: { ...(params ?? {}), q: buscaDebounced } })
      .then(({ data }) => !cancelado && setOpcoes(data[chaveLista] ?? []))
      .catch(() => !cancelado && setOpcoes([]))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, buscaDebounced, url, chaveLista, paramsChave]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => setAberto((a) => !a)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${valor ? "" : "text-muted"}`}>{valor ? rotulo(valor) : placeholder}</span>
        {valor && !desabilitado ? (
          <span
            role="button"
            aria-label="Limpar"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="flex-none px-1 text-muted hover:text-foreground"
          >
            ✕
          </span>
        ) : (
          <span className="flex-none text-muted">▾</span>
        )}
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] rounded-md border border-border bg-surface shadow-lg">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="w-full rounded-t-md border-b border-border bg-transparent px-2.5 py-2 text-sm text-foreground focus:outline-none"
          />
          <ul className="max-h-60 overflow-auto py-1">
            {carregando && <li className="px-3 py-2 text-[12.5px] text-muted">Buscando...</li>}
            {!carregando && opcoes.length === 0 && <li className="px-3 py-2 text-[12.5px] text-muted">Nada encontrado.</li>}
            {opcoes.map((o) => (
              <li key={chave(o)}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o);
                    setAberto(false);
                    setBusca("");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-surface-2"
                >
                  <span className="block truncate">{rotulo(o)}</span>
                  {detalhe && detalhe(o) && <span className="block truncate text-[11.5px] text-muted">{detalhe(o)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
