import { useEffect, useRef, useState } from "react";
import { autoUpdate, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { cn } from "../../lib/cn";

// Funil de coluna das telas "Ver dados"/"Removidos" (21/10/2026, pedido do Vitor): nada é carregado antes de abrir. Duas abas:
//  - Condição: operador + valor, com os operadores que o servidor aceita para o tipo da coluna (filtroColunaLocal.ts);
//  - Valores: os valores mais frequentes da coluna no recorte atual, buscados no servidor ao abrir (GET .../dados/valores).
// Um filtro por coluna; o servidor aplica todos em E. Mesmo popover/posicionamento do MultiSelectColumnFilter.

export type OperadorColuna = "=" | "≠" | "IN" | "≥" | "≤" | "entre" | "contém" | "começa com" | "vazio" | "não vazio";

export interface FiltroColuna {
  coluna: string;
  operador: OperadorColuna;
  valores: string[];
}

export interface ColunaComFiltro {
  nome: string;
  tipo: "texto" | "inteiro" | "decimal" | "data" | "booleano" | "json";
  operadores: OperadorColuna[];
  // Lista fechada documentada no schema (/// Domínio "X": 1=...): o funil oferece a lista completa e um select na Condição.
  dominio?: { valor: string; rotulo: string }[];
}

export interface RespostaValores {
  valores: { valor: unknown; quantidade: number }[];
  temMais: boolean;
}

const ROTULO_OPERADOR: Record<OperadorColuna, string> = {
  "=": "igual a",
  "≠": "diferente de",
  IN: "em (lista)",
  "≥": "maior ou igual",
  "≤": "menor ou igual",
  entre: "entre",
  contém: "contém",
  "começa com": "começa com",
  vazio: "vazio",
  "não vazio": "não vazio",
};

const ALTURA_MAX = 380;
const campoCls =
  "w-full rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Valor como a API devolve (ISO para data) → texto do filtro (AAAA-MM-DD para data). */
export function valorParaFiltro(valor: unknown, tipo: ColunaComFiltro["tipo"]): string {
  if (tipo === "data" && typeof valor === "string") return valor.slice(0, 10);
  return String(valor);
}

interface Props {
  coluna: ColunaComFiltro;
  filtro: FiltroColuna | null;
  onAplicar: (filtro: FiltroColuna | null) => void;
  carregarValores: (termo: string) => Promise<RespostaValores>;
  formatarValor: (valor: unknown) => string;
}

export function FiltroColunaServidor({ coluna, filtro, onAplicar, carregarValores, formatarValor }: Props) {
  const [open, setOpen] = useState(false);
  const [aba, setAba] = useState<"condicao" | "valores">("condicao");
  const [operador, setOperador] = useState<OperadorColuna>(coluna.operadores[0]);
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [termo, setTermo] = useState("");
  const [valores, setValores] = useState<RespostaValores | "carregando" | { erro: string } | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const primeiroCampo = useRef<HTMLSelectElement>(null);
  // Vários valores só onde o servidor aceita IN (texto e inteiro); "(Vazio)" é exclusivo (não dá para combinar com valores sem OU).
  const multi = coluna.operadores.includes("IN");
  const aceitaVazio = coluna.operadores.includes("vazio");

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (proximo) => {
      setOpen(proximo);
      if (proximo) {
        // Abre mostrando o filtro atual da coluna, se houver.
        setOperador(filtro?.operador ?? coluna.operadores[0]);
        setV1(filtro && filtro.operador !== "IN" ? filtro.valores[0] ?? "" : filtro?.valores.join(", ") ?? "");
        setV2(filtro?.operador === "entre" ? filtro.valores[1] ?? "" : "");
        setMarcados(filtro?.operador === "IN" || filtro?.operador === "=" ? filtro.valores : filtro?.operador === "vazio" ? ["__vazio__"] : []);
        setTermo("");
        setValores(null);
      }
    },
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(180, Math.min(ALTURA_MAX, availableHeight))}px`;
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

  useEffect(() => {
    if (open && aba === "condicao") primeiroCampo.current?.focus({ preventScroll: true });
  }, [open, aba]);

  // Aba Valores: busca no servidor ao abrir e a cada termo (debounce curto).
  useEffect(() => {
    if (!open || aba !== "valores") return;
    let cancelado = false;
    const timer = window.setTimeout(() => {
      setValores("carregando");
      carregarValores(coluna.dominio ? "" : termo)
        .then((r) => !cancelado && setValores(r))
        .catch((e) => !cancelado && setValores({ erro: e?.response?.data?.error ?? "Falha ao carregar os valores" }));
    }, termo && !coluna.dominio ? 300 : 0);
    return () => {
      cancelado = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, aba, coluna.dominio ? "" : termo]);

  // Com domínio: a lista COMPLETA do schema, com a quantidade que veio do servidor (0 para quem não aparece no recorte), e no fim os
  // valores dos dados que não estão no domínio. A busca é local (código ou rótulo).
  const linhasValores: { chave: string; texto: string; quantidade: number; fora?: boolean }[] | null = (() => {
    if (valores === null || valores === "carregando" || "erro" in valores) return null;
    const qtd = new Map<string, number>();
    for (const v of valores.valores) qtd.set(v.valor === null ? "__vazio__" : valorParaFiltro(v.valor, coluna.tipo), v.quantidade);
    if (!coluna.dominio) {
      return valores.valores
        .filter((v) => v.valor !== null || aceitaVazio)
        .map((v) => {
          const chave = v.valor === null ? "__vazio__" : valorParaFiltro(v.valor, coluna.tipo);
          return { chave, texto: v.valor === null ? "(Vazio)" : formatarValor(v.valor), quantidade: v.quantidade };
        });
    }
    const doDominio = coluna.dominio.map((o) => ({ chave: o.valor, texto: `${o.valor} · ${o.rotulo}`, quantidade: qtd.get(o.valor) ?? 0 }));
    const conhecidos = new Set(coluna.dominio.map((o) => o.valor));
    const fora = [...qtd.entries()]
      .filter(([chave]) => !conhecidos.has(chave) && (chave !== "__vazio__" || aceitaVazio))
      .map(([chave, quantidade]) => ({ chave, texto: chave === "__vazio__" ? "(Vazio)" : `${chave} · fora do domínio`, quantidade, fora: true }));
    const termoNorm = termo.trim().toLowerCase();
    return [...doDominio, ...fora].filter((l) => !termoNorm || l.texto.toLowerCase().includes(termoNorm));
  })();

  const ativo = filtro != null;
  const precisa = operador === "vazio" || operador === "não vazio" ? 0 : operador === "entre" ? 2 : 1;
  const tipoInput = coluna.tipo === "data" ? "date" : coluna.tipo === "inteiro" || coluna.tipo === "decimal" ? "text" : "text";

  function aplicarCondicao() {
    let vals: string[] = [];
    if (operador === "IN") vals = v1.split(",").map((v) => v.trim()).filter(Boolean);
    else if (precisa === 1) vals = [v1.trim()];
    else if (precisa === 2) vals = [v1.trim(), v2.trim()];
    // número com vírgula decimal (padrão brasileiro) vira ponto, como a API espera
    if (coluna.tipo === "decimal") vals = vals.map((v) => v.replace(/\./g, "").replace(",", "."));
    if (precisa > 0 && vals.some((v) => !v)) return;
    onAplicar({ coluna: coluna.nome, operador, valores: vals });
    setOpen(false);
  }

  function aplicarValores() {
    if (marcados.length === 0) return;
    if (marcados.includes("__vazio__")) onAplicar({ coluna: coluna.nome, operador: "vazio", valores: [] });
    else if (marcados.length === 1) onAplicar({ coluna: coluna.nome, operador: "=", valores: marcados });
    else onAplicar({ coluna: coluna.nome, operador: "IN", valores: marcados });
    setOpen(false);
  }

  function alternar(chave: string) {
    setMarcados((atual) => {
      if (chave === "__vazio__") return atual.includes(chave) ? [] : [chave];
      const semVazio = atual.filter((m) => m !== "__vazio__");
      if (!multi) return semVazio.includes(chave) ? [] : [chave];
      return semVazio.includes(chave) ? semVazio.filter((m) => m !== chave) : [...semVazio, chave];
    });
  }

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        aria-label={`Filtrar por ${coluna.nome}`}
        title={ativo ? `${coluna.nome}: filtro ativo` : `Filtrar por ${coluna.nome}`}
        className={cn(
          "ml-1 inline-flex items-center rounded p-0.5 align-middle transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ativo ? "text-primary" : "text-muted hover:text-foreground"
        )}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill={ativo ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-popover flex w-72 flex-col overflow-hidden rounded-md border border-border bg-surface text-left normal-case tracking-normal shadow-lg"
            {...getFloatingProps({ onClick: (e) => e.stopPropagation() })}
          >
            <div className="shrink-0 border-b border-border px-2 pt-2">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">{coluna.nome}</p>
              <div className="flex gap-3 text-[12px]" role="tablist">
                {(["condicao", "valores"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="tab"
                    aria-selected={aba === a}
                    onClick={() => setAba(a)}
                    className={cn("-mb-px border-b-2 pb-1.5 font-medium", aba === a ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground")}
                  >
                    {a === "condicao" ? "Condição" : "Valores"}
                  </button>
                ))}
              </div>
            </div>

            {aba === "condicao" ? (
              <div className="space-y-2 p-2">
                <select ref={primeiroCampo} value={operador} onChange={(e) => setOperador(e.target.value as OperadorColuna)} className={campoCls} aria-label="Operador">
                  {coluna.operadores.map((op) => (
                    <option key={op} value={op}>
                      {ROTULO_OPERADOR[op]}
                    </option>
                  ))}
                </select>
                {precisa >= 1 &&
                  (coluna.dominio && (operador === "=" || operador === "≠") ? (
                    <select value={v1} onChange={(e) => setV1(e.target.value)} className={campoCls} aria-label="Valor">
                      <option value="">escolha…</option>
                      {coluna.dominio.map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.valor} · {o.rotulo}
                        </option>
                      ))}
                    </select>
                  ) : coluna.tipo === "booleano" ? (
                    <select value={v1} onChange={(e) => setV1(e.target.value)} className={campoCls} aria-label="Valor">
                      <option value="">escolha…</option>
                      <option value="true">sim</option>
                      <option value="false">não</option>
                    </select>
                  ) : (
                    <input
                      type={operador === "IN" ? "text" : tipoInput}
                      value={v1}
                      onChange={(e) => setV1(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && aplicarCondicao()}
                      placeholder={operador === "IN" ? "valor1, valor2, ..." : operador === "entre" ? "de" : "valor"}
                      className={campoCls}
                      aria-label={operador === "entre" ? "De" : "Valor"}
                    />
                  ))}
                {precisa === 2 && (
                  <input
                    type={tipoInput}
                    value={v2}
                    onChange={(e) => setV2(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && aplicarCondicao()}
                    placeholder="até"
                    className={campoCls}
                    aria-label="Até"
                  />
                )}
                <div className="flex justify-between pt-1">
                  <button type="button" onClick={() => (onAplicar(null), setOpen(false))} disabled={!ativo} className="text-[11.5px] text-muted hover:text-foreground disabled:opacity-40">
                    Limpar
                  </button>
                  <button type="button" onClick={aplicarCondicao} className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:opacity-90">
                    Aplicar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="shrink-0 border-b border-border p-2">
                  <input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar valor..." className={campoCls} aria-label="Buscar valor" />
                  <p className="mt-1 text-[10.5px] text-muted">
                    {multi ? "Marque um ou mais valores." : "Escolha um valor."} {coluna.dominio ? "Lista do domínio, com a quantidade de cada." : "Mais frequentes primeiro."}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                  {valores === "carregando" || valores === null ? (
                    <p className="px-3 py-3 text-center text-[11.5px] text-muted">Carregando…</p>
                  ) : "erro" in valores ? (
                    <p className="px-3 py-3 text-center text-[11.5px] text-destructive">{valores.erro}</p>
                  ) : !linhasValores || linhasValores.length === 0 ? (
                    <p className="px-3 py-3 text-center text-[11.5px] text-muted">Nenhum valor encontrado.</p>
                  ) : (
                    <>
                      {linhasValores.map((l) => (
                        <label
                          key={l.chave}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[12.5px] hover:bg-surface-2",
                            l.quantidade === 0 || l.fora ? "text-muted" : "text-foreground"
                          )}
                        >
                          <input type="checkbox" checked={marcados.includes(l.chave)} onChange={() => alternar(l.chave)} className="accent-primary" />
                          <span className="min-w-0 flex-1 truncate" title={l.texto}>
                            {l.texto}
                          </span>
                          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted">{l.quantidade.toLocaleString("pt-BR")}</span>
                        </label>
                      ))}
                      {valores.temMais && !coluna.dominio && (
                        <p className="px-3 py-1.5 text-center text-[11px] text-muted">Mostrando os 200 mais frequentes — use a busca para achar outros.</p>
                      )}
                    </>
                  )}
                </div>
                <div className="flex shrink-0 justify-between border-t border-border p-2">
                  <button type="button" onClick={() => (onAplicar(null), setOpen(false))} disabled={!ativo} className="text-[11.5px] text-muted hover:text-foreground disabled:opacity-40">
                    Limpar
                  </button>
                  <button type="button" onClick={aplicarValores} disabled={marcados.length === 0} className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40">
                    Aplicar{marcados.length > 1 ? ` (${marcados.length})` : ""}
                  </button>
                </div>
              </>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
