import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CAIXA_CONTROLE, CONTROLE, GATILHO_EMBUTIDO, ICONE_CONTROLE } from "../ui/estilos";
import { cn } from "../../lib/cn";
import { normalizar } from "../../lib/normalizarBusca";
import { IconeX } from "../ui/IconeX";

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
  /** Botão no canto do campo, na mesma moldura (ver MultiSelectDropdown.acessorio). Sem ele, como sempre foi. */
  acessorio?: ReactNode;
}

function chave(codemp: number, codfil: number): string {
  return `${codemp}:${codfil}`;
}

export function EmpresaFilialFilter({ empresas, filiais, selecionados, onChange, acessorio }: EmpresaFilialFilterProps) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [gruposColapsados, setGruposColapsados] = useState<Record<number, boolean>>({});
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

  // Abrir sempre começa do zero: busca ou colapso de uma vez anterior preservados fariam a
  // lista parecer incompleta (ou vazia) na próxima abertura, sem nenhum indício do porquê.
  useEffect(() => {
    if (open) {
      setBusca("");
      setGruposColapsados({});
      buscaRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  const empresasOrdenadas = useMemo(() => [...empresas].sort((a, b) => a.codemp - b.codemp), [empresas]);

  function filiaisDaEmpresa(codemp: number): FilialOption[] {
    return filiais.filter((f) => f.codemp === codemp).sort((a, b) => a.codfil - b.codfil);
  }

  const buscaAtiva = busca.trim().length > 0;
  const termo = normalizar(busca.trim());

  // Grupos com a busca já aplicada. Sem busca, devolve toda empresa (mesmo sem filial),
  // igual ao comportamento de sempre. Com busca, uma filial entra se ela mesma bater com o
  // termo OU se o nome/sigla da própria empresa bater (digitar a sigla da empresa mostra o
  // grupo inteiro); empresa sem nenhuma filial batendo some da lista.
  const gruposFiltrados = useMemo(() => {
    const todos = empresasOrdenadas.map((emp) => {
      const todasFiliais = filiaisDaEmpresa(emp.codemp);
      if (!termo) return { empresa: emp, filiaisVisiveis: todasFiliais, total: todasFiliais.length };
      const empresaBate = normalizar(`${emp.codemp} ${emp.sigemp} ${emp.nomemp}`).includes(termo);
      const filiaisVisiveis = empresaBate
        ? todasFiliais
        : todasFiliais.filter((f) => normalizar(`${f.codfil} ${f.sigfil} ${f.nomfil}`).includes(termo));
      return { empresa: emp, filiaisVisiveis, total: todasFiliais.length };
    });
    return termo ? todos.filter((g) => g.filiaisVisiveis.length > 0) : todos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresasOrdenadas, filiais, termo]);

  const chavesVisiveis = useMemo(
    () => gruposFiltrados.flatMap((g) => g.filiaisVisiveis.map((f) => chave(f.codemp, f.codfil))),
    [gruposFiltrados]
  );
  const temVisivelNaoSelecionado = chavesVisiveis.some((k) => !selecionados.includes(k));

  function toggleFilial(codemp: number, codfil: number) {
    const key = chave(codemp, codfil);
    onChange(selecionados.includes(key) ? selecionados.filter((v) => v !== key) : [...selecionados, key]);
  }

  // Alterna só as filiais atualmente VISÍVEIS do grupo (respeitando a busca) — mesmo
  // espírito do "Selecionar todos" geral, restrito a um grupo só.
  function toggleEmpresa(codemp: number, filiaisVisiveis: FilialOption[]) {
    const keys = filiaisVisiveis.map((f) => chave(f.codemp, f.codfil));
    const todasSelecionadas = keys.length > 0 && keys.every((k) => selecionados.includes(k));
    if (todasSelecionadas) {
      onChange(selecionados.filter((v) => !keys.includes(v)));
    } else {
      onChange([...new Set([...selecionados, ...keys])]);
    }
  }

  function selecionarTodosVisiveis() {
    const novos = chavesVisiveis.filter((k) => !selecionados.includes(k));
    onChange([...selecionados, ...novos]);
  }

  function toggleColapso(codemp: number) {
    // Durante busca ativa o grupo já fica forçado aberto (ver `expandido` abaixo) — não
    // deixa colapsar por baixo dos panos, senão limpar a busca depois revela um grupo
    // "misteriosamente" fechado sem a pessoa ter feito isso de propósito.
    if (buscaAtiva) return;
    setGruposColapsados((atual) => ({ ...atual, [codemp]: !atual[codemp] }));
  }

  const totalFiliais = filiais.length;
  const label =
    selecionados.length === 0 || selecionados.length === totalFiliais
      ? "Todas as empresas/filiais"
      : selecionados.length === 1
        ? filiais.find((f) => chave(f.codemp, f.codfil) === selecionados[0])?.sigfil ?? selecionados[0]
        : `${selecionados.length} filiais selecionadas`;

  return (
    <div className={acessorio ? cn(CAIXA_CONTROLE, open && "border-primary/60") : "relative"} ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={acessorio ? GATILHO_EMBUTIDO : cn(CONTROLE, open && "border-primary/60")}
      >
        <span className="truncate">{label}</span>
        <ChevronDown {...ICONE_CONTROLE} className={cn("shrink-0 text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {acessorio}

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-96 rounded-md border border-border bg-surface shadow-lg">
          {/* Busca */}
          <div className="border-b border-border p-2">
            <div className="relative">
              <input
                ref={buscaRef}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar empresa ou filial..."
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

          {/* Selecionar todos / Limpar seleção */}
          {(temVisivelNaoSelecionado || selecionados.length > 0) && (
            <div className="flex items-center justify-between border-b border-border">
              {temVisivelNaoSelecionado ? (
                <button
                  onClick={selecionarTodosVisiveis}
                  type="button"
                  className="px-3 py-2 text-left text-[11.5px] text-muted hover:bg-surface-2"
                >
                  Selecionar todos{buscaAtiva ? ` (${chavesVisiveis.length})` : ""}
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

          {/* Árvore empresa -> filiais */}
          <div className="max-h-72 overflow-y-auto p-1.5">
            {buscaAtiva && gruposFiltrados.length === 0 && (
              <p className="px-3 py-4 text-center text-[12.5px] text-muted">Nenhum resultado para "{busca}".</p>
            )}
            {gruposFiltrados.map(({ empresa: emp, filiaisVisiveis, total }) => {
              const keys = filiaisVisiveis.map((f) => chave(f.codemp, f.codfil));
              const todasSelecionadas = keys.length > 0 && keys.every((k) => selecionados.includes(k));
              const algumaSelecionada = keys.some((k) => selecionados.includes(k));
              const expandido = buscaAtiva || !gruposColapsados[emp.codemp];
              const mostrarContador = buscaAtiva && filiaisVisiveis.length < total;

              return (
                <div key={emp.codemp} className="mb-1 overflow-hidden rounded-md last:mb-0">
                  <div className="flex items-center gap-1 py-1.5 pl-1 pr-3 hover:bg-surface-2">
                    <button
                      onClick={() => toggleColapso(emp.codemp)}
                      type="button"
                      disabled={buscaAtiva}
                      aria-label={expandido ? "Colapsar" : "Expandir"}
                      className="shrink-0 rounded p-1 text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-40"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform ${expandido ? "rotate-90" : ""}`}
                      >
                        <polyline points="9 6 15 12 9 18" />
                      </svg>
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                      <input
                        type="checkbox"
                        checked={todasSelecionadas}
                        ref={(el) => {
                          if (el) el.indeterminate = !todasSelecionadas && algumaSelecionada;
                        }}
                        onChange={() => toggleEmpresa(emp.codemp, filiaisVisiveis)}
                        className="shrink-0 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate" title={`${emp.codemp} - ${emp.sigemp}`}>
                        {emp.codemp} - {emp.sigemp}
                      </span>
                    </label>
                    {mostrarContador && (
                      <span className="shrink-0 text-[11px] text-muted">
                        {filiaisVisiveis.length}/{total}
                      </span>
                    )}
                  </div>
                  {expandido &&
                    filiaisVisiveis.map((fil) => {
                      const key = chave(fil.codemp, fil.codfil);
                      const marcada = selecionados.includes(key);
                      return (
                        <label
                          key={key}
                          className={`flex cursor-pointer items-center gap-2 py-1.5 pl-8 pr-3 text-sm text-foreground hover:bg-surface-2 ${
                            marcada ? "bg-primary/5" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={marcada}
                            onChange={() => toggleFilial(fil.codemp, fil.codfil)}
                            className="shrink-0 accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate" title={`${fil.codfil} - ${fil.sigfil}`}>
                            {fil.codfil} - {fil.sigfil}
                          </span>
                          {buscaAtiva && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              match
                            </span>
                          )}
                        </label>
                      );
                    })}
                </div>
              );
            })}
          </div>

          {/* Resumo com chips removíveis */}
          {selecionados.length > 0 && (
            <div className="border-t border-border p-2">
              <p className="mb-1.5 text-[11px] font-medium text-muted">{selecionados.length} selecionado(s)</p>
              <div className="flex flex-wrap gap-1.5">
                {selecionados.map((key) => {
                  const [codempStr, codfilStr] = key.split(":");
                  const fil = filiais.find((f) => f.codemp === Number(codempStr) && f.codfil === Number(codfilStr));
                  const rotulo = fil ? `${fil.codfil} - ${fil.sigfil}` : key;
                  return (
                    <span
                      key={key}
                      className="inline-flex max-w-[12rem] items-center gap-1 rounded border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-foreground"
                    >
                      <span className="min-w-0 truncate" title={rotulo}>
                        {rotulo}
                      </span>
                      <button
                        onClick={() => onChange(selecionados.filter((v) => v !== key))}
                        type="button"
                        aria-label="Remover"
                        className="rounded p-0.5 text-muted hover:bg-surface hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <IconeX tamanho={9} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
