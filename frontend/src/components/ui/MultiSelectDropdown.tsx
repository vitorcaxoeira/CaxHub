import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { normalizar } from "../../lib/normalizarBusca";
import { CAIXA_CONTROLE, CONTROLE, GATILHO_EMBUTIDO, ICONE_CONTROLE } from "./estilos";
import { cn } from "../../lib/cn";
import { IconeX } from "./IconeX";
import { agruparOpcoes, grupoEstaAberto, marcadasDoGrupo, rotuloComGrupo } from "./agruparOpcoes";

export interface MultiSelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Grupo da opção (só usado com `gruposRecolhiveis`): o cabeçalho sob o qual ela aparece. */
  grupo?: string;
}

interface MultiSelectDropdownProps<T extends string | number> {
  opcoes: MultiSelectOption<T>[];
  selecionados: T[];
  onChange: (selecionados: T[]) => void;
  labelTodos: string;
  labelSufixo: string;
  /** Seleção fixa (não abre): o texto explica por quê (title). Ex.: Consumo aberto pela tela da obra. */
  bloqueado?: string;
  /**
   * Botão no canto superior direito do campo, dentro da mesma moldura do gatilho (03/11/2026; hoje só a estrela de padrão do filtro do
   * Acompanhamento de Compra). Sem ele, o componente fica exatamente como sempre foi.
   */
  acessorio?: ReactNode;
  /**
   * Opções agrupadas e EXPANSÍVEIS (18/11/2026, etiquetas de Departamento x Time, mesmo formato do campo Recurso do Mapeamento Kyria): cada abertura
   * da lista começa com todos os grupos contraídos; o cabeçalho (seta, nome, marcadas/total) expande e contrai. Com texto na busca, os grupos que
   * têm resultado ficam abertos. Só vale para opções com `grupo`. Desligado por padrão: as demais telas continuam com a lista simples.
   */
  gruposRecolhiveis?: boolean;
}

export function MultiSelectDropdown<T extends string | number>({
  opcoes,
  selecionados,
  onChange,
  labelTodos,
  labelSufixo,
  bloqueado,
  acessorio,
  gruposRecolhiveis = false,
}: MultiSelectDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  // Grupos que a pessoa expandiu (só vale com `gruposRecolhiveis`); volta a vazio a cada abertura da lista.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
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

  // Abrir sempre começa sem busca — texto de uma abertura anterior preservado faria a lista
  // parecer incompleta (ou vazia) da próxima vez, sem nenhum indício visível do porquê.
  useEffect(() => {
    if (open) {
      setBusca("");
      setAbertos(new Set());
      buscaRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  function toggle(value: T) {
    onChange(selecionados.includes(value) ? selecionados.filter((v) => v !== value) : [...selecionados, value]);
  }

  const buscaAtiva = busca.trim().length > 0;

  // Casa contra `value` (código) e `label` (nome) juntos — dá pra digitar "1" ou "aberto" e
  // achar a mesma opção.
  const opcoesFiltradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (!termo) return opcoes;
    return opcoes.filter((o) => normalizar(`${o.value} ${o.grupo ?? ""} ${o.label}`).includes(termo));
  }, [opcoes, busca]);

  const agrupar = gruposRecolhiveis && opcoes.some((o) => o.grupo);
  const rotuloCompleto = (o: MultiSelectOption<T> | undefined) => rotuloComGrupo(o, agrupar);

  // Grupos na ordem de chegada, com só as opções que passam na busca.
  const grupos = useMemo(() => (agrupar ? agruparOpcoes(opcoesFiltradas) : []), [agrupar, opcoesFiltradas]);

  function alternarGrupo(grupo: string) {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(grupo)) novo.delete(grupo);
      else novo.add(grupo);
      return novo;
    });
  }

  const label =
    selecionados.length === 0
      ? labelTodos
      : selecionados.length === 1
        ? rotuloCompleto(opcoes.find((o) => o.value === selecionados[0])) ?? String(selecionados[0])
        : `${selecionados.length} ${labelSufixo}`;

  const temFiltradaNaoSelecionada = opcoesFiltradas.some((o) => !selecionados.includes(o.value));

  // "Selecionar todos" respeita a busca (age só sobre o que está filtrado, somando à
  // seleção atual) — não escolhe "todos" quando na verdade só uma parte está visível.
  function selecionarTodosFiltrados() {
    const novos = opcoesFiltradas.map((o) => o.value).filter((v) => !selecionados.includes(v));
    onChange([...selecionados, ...novos]);
  }

  function linhaDaOpcao(o: MultiSelectOption<T>) {
    return (
      <label key={String(o.value)} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-surface-2">
        <input type="checkbox" checked={selecionados.includes(o.value)} onChange={() => toggle(o.value)} className="shrink-0 accent-primary" />
        <span className="min-w-0 flex-1 truncate" title={o.label}>
          {o.label}
        </span>
      </label>
    );
  }

  return (
    <div className={acessorio ? cn(CAIXA_CONTROLE, open && "border-primary/60") : "relative"} ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!!bloqueado}
        title={bloqueado}
        className={acessorio ? GATILHO_EMBUTIDO : cn(CONTROLE, open && "border-primary/60")}
      >
        <span className="truncate">{label}</span>
        {bloqueado ? (
          <Lock {...ICONE_CONTROLE} size={14} className="shrink-0 text-muted" />
        ) : (
          <ChevronDown {...ICONE_CONTROLE} className={cn("shrink-0 text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        )}
      </button>
      {acessorio}

      {open && !bloqueado && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg">
          {/* Busca */}
          <div className="border-b border-border p-2">
            <div className="relative">
              <input
                ref={buscaRef}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por código ou nome..."
                className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 pr-7 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {busca && (
                <button
                  onClick={() => {
                    setBusca("");
                    buscaRef.current?.focus();
                  }}
                  type="button"
                  aria-label="Limpar busca"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconeX />
                </button>
              )}
            </div>
          </div>

          {/* Selecionar todos / Limpar seleção — sempre no topo, nunca no rodapé (ver
              Preferências/filtro-multisselecao-acoes-no-topo no segundo cérebro). */}
          {(temFiltradaNaoSelecionada || selecionados.length > 0) && (
            <div className="flex items-center justify-between border-b border-border">
              {temFiltradaNaoSelecionada ? (
                <button
                  onClick={selecionarTodosFiltrados}
                  type="button"
                  className="px-3 py-2 text-left text-[11.5px] text-muted hover:bg-surface-2"
                >
                  Selecionar todos{buscaAtiva ? ` (${opcoesFiltradas.length})` : ""}
                </button>
              ) : (
                <span />
              )}
              {selecionados.length > 0 && (
                <button
                  onClick={() => onChange([])}
                  type="button"
                  className="px-3 py-2 text-left text-[11.5px] text-muted hover:bg-surface-2"
                >
                  Limpar seleção
                </button>
              )}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {buscaAtiva && opcoesFiltradas.length === 0 && (
              <p className="px-3 py-4 text-center text-[12.5px] text-muted">Nenhum resultado para "{busca}".</p>
            )}
            {agrupar
              ? grupos.map(([grupo, itens]) => {
                  const aberto = grupoEstaAberto(buscaAtiva, abertos, grupo);
                  const marcadas = marcadasDoGrupo(opcoes, grupo, selecionados);
                  return (
                    <div key={grupo}>
                      <button
                        type="button"
                        onClick={() => alternarGrupo(grupo)}
                        aria-expanded={aberto}
                        className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-surface-2 px-3 py-1 text-left font-mono text-[10px] uppercase tracking-wider text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <ChevronRight {...ICONE_CONTROLE} size={10} strokeWidth={2.5} className={cn("shrink-0 transition-transform motion-reduce:transition-none", aberto && "rotate-90")} />
                        <span className="min-w-0 flex-1 truncate">{grupo}</span>
                        <span className="tabular-nums">{marcadas > 0 ? `${marcadas}/` : ""}{itens.length}</span>
                      </button>
                      {aberto && itens.map((o) => linhaDaOpcao(o))}
                    </div>
                  );
                })
              : opcoesFiltradas.map((o) => linhaDaOpcao(o))}
          </div>
        </div>
      )}
    </div>
  );
}
