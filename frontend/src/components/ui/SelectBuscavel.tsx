import { useEffect, useMemo, useRef, useState } from "react";

export interface OpcaoBuscavel<T extends string | number> {
  value: T;
  /** Cabeçalho do grupo a que a opção pertence (ex.: "Proposta 8346 · 1 - ACME"). */
  grupo: string;
  /** Linha da opção em si (ex.: "3 - Admissão Digital"). */
  rotulo: string;
}

interface SelectBuscavelProps<T extends string | number> {
  opcoes: OpcaoBuscavel<T>[];
  valor: T | null;
  onChange: (valor: T) => void;
  placeholder: string;
  /** Texto quando não há NENHUMA opção — diferente de "a busca não achou nada". */
  textoVazio: string;
  desabilitado?: boolean;
  className?: string;
}

// Normaliza pra busca: sem acento e sem diferença de maiúscula. Sem isso, procurar por
// "admissao" não acha "Admissão", que é exatamente o que se digita com pressa.
function normalizar(texto: string): string {
  // NFD separa a letra da marca diacrítica; `\p{Diacritic}` então remove só a marca.
  // Usado no lugar da classe de combinantes escrita à mão porque deixa o fonte 100%
  // ASCII — combinante solto num arquivo é invisível no editor e sobrevive mal a
  // copiar/colar.
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Seleção única com busca e agrupamento, no mesmo vocabulário visual do
// MultiSelectDropdown. Existe porque `<option>` de `<select>` nativo não aceita estilo
// nenhum — nem hierarquia tipográfica, nem duas linhas, nem cabeçalho de grupo — e a
// lista de atividades do apontamento manual chega a dezenas de itens com a mesma proposta
// repetida várias vezes.
export function SelectBuscavel<T extends string | number>({
  opcoes,
  valor,
  onChange,
  placeholder,
  textoVazio,
  desabilitado = false,
  className = "",
}: SelectBuscavelProps<T>) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Abrir sempre começa do zero: busca antiga preservada faria a lista parecer vazia.
  useEffect(() => {
    if (open) {
      setBusca("");
      setIndiceAtivo(0);
      buscaRef.current?.focus();
    }
  }, [open]);

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return opcoes;
    // Busca no grupo TAMBÉM: é onde estão o número da proposta e o cliente, que é como
    // as pessoas procuram ("8346", "acme"), não pela descrição do item.
    return opcoes.filter((o) => normalizar(`${o.grupo} ${o.rotulo}`).includes(termo));
  }, [opcoes, busca]);

  // Agrupa preservando a ordem de chegada (o backend já ordena).
  const grupos = useMemo(() => {
    const mapa = new Map<string, OpcaoBuscavel<T>[]>();
    for (const o of filtradas) {
      const atual = mapa.get(o.grupo);
      if (atual) atual.push(o);
      else mapa.set(o.grupo, [o]);
    }
    return [...mapa.entries()];
  }, [filtradas]);

  const selecionada = opcoes.find((o) => o.value === valor) ?? null;

  function escolher(opcao: OpcaoBuscavel<T>) {
    onChange(opcao.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const proximo = e.key === "ArrowDown" ? indiceAtivo + 1 : indiceAtivo - 1;
      const limitado = Math.max(0, Math.min(filtradas.length - 1, proximo));
      setIndiceAtivo(limitado);
      // Mantém a opção ativa visível — sem isso a navegação por teclado "some" da tela
      // assim que passa da parte visível da lista.
      listaRef.current?.querySelector(`[data-indice="${limitado}"]`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const escolhida = filtradas[indiceAtivo];
      if (escolhida) escolher(escolhida);
    }
  }

  // Índice contínuo entre grupos: a navegação por teclado percorre a lista achatada,
  // enquanto a exibição é agrupada.
  let indiceCorrente = -1;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => !desabilitado && setOpen((o) => !o)}
        disabled={desabilitado}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate ${selecionada ? "text-foreground" : "text-muted"}`}>
          {selecionada ? `${selecionada.grupo} · ${selecionada.rotulo}` : placeholder}
        </span>
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
        <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-md border border-border bg-surface shadow-lg">
          <div className="border-b border-border p-2">
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setIndiceAtivo(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Buscar por proposta, cliente ou descrição..."
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div ref={listaRef} className="max-h-64 overflow-y-auto py-1">
            {opcoes.length === 0 && <p className="px-3 py-3 text-center text-[12.5px] text-muted">{textoVazio}</p>}
            {opcoes.length > 0 && filtradas.length === 0 && (
              <p className="px-3 py-3 text-center text-[12.5px] text-muted">Nenhum resultado para "{busca}".</p>
            )}
            {grupos.map(([grupo, itens]) => (
              <div key={grupo}>
                {/* sticky: rolando uma proposta longa, o cabeçalho continua à vista —
                    senão perde-se a referência de qual proposta se está olhando. */}
                <p className="sticky top-0 z-10 bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted">
                  {grupo}
                </p>
                {itens.map((o) => {
                  indiceCorrente += 1;
                  const indice = indiceCorrente;
                  const ativa = indice === indiceAtivo;
                  const escolhida = o.value === valor;
                  return (
                    <button
                      key={String(o.value)}
                      type="button"
                      data-indice={indice}
                      onMouseEnter={() => setIndiceAtivo(indice)}
                      onClick={() => escolher(o)}
                      className={`block w-full px-3 py-1.5 text-left text-[12.5px] ${
                        ativa ? "bg-surface-2" : ""
                      } ${escolhida ? "font-semibold text-primary" : "text-foreground"}`}
                    >
                      {o.rotulo}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
