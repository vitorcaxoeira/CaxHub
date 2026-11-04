import { useState } from "react";
import { raizDoPortal } from "../ui/raizDoPortal";
import { autoUpdate, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import type { ColunaDisponivel, No } from "../../lib/formulas/formula";
import { cn } from "../../lib/cn";
import { useToast } from "../ui/Toast";
import { type ColunaCalculadaSalva, nomeDaCalculada } from "./colunasCalculadas";
import { EditorColunaCalculada } from "./EditorColunaCalculada";
import type { GestaoCalculadas } from "./useColunasCalculadas";
import type { LayoutColunas } from "./useLayoutColunas";

/** O que o painel precisa para oferecer colunas calculadas (28/10/2026): as salvas, gravar/excluir e as colunas que entram em fórmula. */
export interface CalculadasDoPainel {
  gestao: GestaoCalculadas;
  disponiveis: ColunaDisponivel[];
  previa?: (arvore: No) => (number | null)[];
}

// Botão "Colunas" (26/10/2026): lista as colunas da tabela na ordem atual, com caixa para mostrar/ocultar e setas para subir e descer.
// Desde 27/10/2026 é só o ícone, sempre no canto esquerdo do cabeçalho de toda tabela configurável (coluna reservada do
// useColunasConfiguraveis), no mesmo lugar em todas as listas.
// É o caminho por teclado e no celular; no computador também dá para arrastar o título da coluna (ThColuna `arrastar`). Mesmo
// popover do funil (FiltroColunaServidor). A arrumação é do usuário e fica no servidor (useLayoutColunas).

const ALTURA_MAX = 420;
const setaCls =
  "inline-flex h-6 w-6 items-center justify-center rounded text-muted transition hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Seta({ direcao }: { direcao: "cima" | "baixo" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {direcao === "cima" ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  );
}

export function PainelColunas({ layout, titulos, calculadas }: { layout: LayoutColunas; titulos: Record<string, string>; calculadas?: CalculadasDoPainel }) {
  const [open, setOpen] = useState(false);
  const { mostrar } = useToast();
  // Editor de coluna calculada: null = fechado; "nova" ou a que está sendo editada.
  const [editando, setEditando] = useState<ColunaCalculadaSalva | "nova" | null>(null);
  const porNome = new Map((calculadas?.gestao.lista ?? []).map((c) => [nomeDaCalculada(c.id), c]));
  const excluir = (c: ColunaCalculadaSalva) => {
    if (!window.confirm(`Excluir a coluna calculada "${c.titulo}"${c.publicada ? " (publicada para todos)" : ""}?`)) return;
    calculadas?.gestao.remover(c.id).catch((e: Error) => mostrar(e.message, "destructive"));
  };
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    // O ícone mora no canto esquerdo da tabela: abre para a direita.
    placement: "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(200, Math.min(ALTURA_MAX, availableHeight))}px`;
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);
  const ocultas = layout.ocultas.length;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Colunas"
        title={`Colunas: ordem, visíveis e larguras (também dá para arrastar o título da coluna)${ocultas > 0 ? ` · ${ocultas} oculta(s)` : ""}`}
        className={cn(
          "relative inline-flex h-6 w-6 items-center justify-center rounded text-muted transition hover:bg-surface hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          (layout.personalizado || open) && "text-primary",
        )}
        {...getReferenceProps()}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        {/* Há coluna oculta: um pontinho, para ninguém procurar a coluna sem saber que ela foi escondida. */}
        {ocultas > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
      </button>
      {open && (
        <FloatingPortal root={raizDoPortal(refs.domReference.current)}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            role="dialog"
            aria-label="Colunas da tabela"
            className="z-popover flex w-72 flex-col overflow-hidden rounded-md border border-border bg-surface text-left shadow-lg"
            {...getFloatingProps()}
          >
            <p className="border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted">Colunas · ordem e visíveis</p>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {layout.ordem.map((nome, i) => {
                const obrigatoria = layout.obrigatorias.includes(nome);
                const titulo = titulos[nome] ?? nome;
                return (
                  <li key={nome} className="flex items-center gap-2 px-3 py-0.5 hover:bg-surface-2/60">
                    <label className={cn("flex min-w-0 flex-1 items-center gap-2 py-1 text-[12.5px]", obrigatoria ? "text-muted" : "cursor-pointer text-foreground")}>
                      <input
                        type="checkbox"
                        checked={!layout.ocultas.includes(nome)}
                        disabled={obrigatoria}
                        onChange={() => layout.alternar(nome)}
                        className="accent-primary"
                      />
                      <span className="truncate">{titulo}</span>
                      {obrigatoria && <span className="shrink-0 text-[10.5px] text-muted">(fixa)</span>}
                      {porNome.has(nome) && (
                        <span className="shrink-0 font-mono text-[10px] text-primary" title={porNome.get(nome)!.publicada ? `Calculada, publicada${porNome.get(nome)!.autor ? ` por ${porNome.get(nome)!.autor}` : ""}` : "Calculada"}>
                          ƒ{porNome.get(nome)!.publicada ? "·todos" : ""}
                        </span>
                      )}
                    </label>
                    {porNome.get(nome)?.podeEditar && (
                      <>
                        <button
                          type="button"
                          className={setaCls}
                          onClick={() => {
                            setEditando(porNome.get(nome)!);
                            setOpen(false);
                          }}
                          aria-label={`Editar a fórmula de ${titulo}`}
                          title="Editar a fórmula"
                        >
                          ✎
                        </button>
                        <button type="button" className={setaCls} onClick={() => excluir(porNome.get(nome)!)} aria-label={`Excluir ${titulo}`} title="Excluir a coluna calculada">
                          ✕
                        </button>
                      </>
                    )}
                    <button type="button" className={setaCls} disabled={i === 0} onClick={() => layout.passo(nome, -1)} aria-label={`Subir ${titulo}`} title="Subir (mais à esquerda)">
                      <Seta direcao="cima" />
                    </button>
                    <button type="button" className={setaCls} disabled={i === layout.ordem.length - 1} onClick={() => layout.passo(nome, 1)} aria-label={`Descer ${titulo}`} title="Descer (mais à direita)">
                      <Seta direcao="baixo" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {calculadas && (
              <button
                type="button"
                onClick={() => {
                  setEditando("nova");
                  setOpen(false);
                }}
                className="border-t border-border px-3 py-2 text-left text-[12.5px] font-medium text-primary transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                + Coluna calculada (fórmula)
              </button>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <span className="text-[11px] text-muted" title="A largura muda puxando a borda direita do título da coluna">
                Ordem, colunas e larguras ficam no seu usuário
              </span>
              <button
                type="button"
                disabled={!layout.personalizado}
                onClick={layout.restaurar}
                className="rounded px-1.5 py-0.5 text-[12px] text-primary hover:underline disabled:pointer-events-none disabled:text-muted disabled:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Restaurar padrão
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
      {calculadas && (
        <EditorColunaCalculada
          aberto={editando !== null}
          onFechar={() => setEditando(null)}
          inicial={editando && editando !== "nova" ? editando : undefined}
          disponiveis={calculadas.disponiveis}
          previa={calculadas.previa}
          podePublicar={calculadas.gestao.podePublicar}
          onSalvar={async (dados) => {
            await calculadas.gestao.salvar(dados, editando && editando !== "nova" ? editando.id : undefined);
            mostrar(editando === "nova" ? `Coluna "${dados.titulo}" criada: aparece no fim da lista de colunas` : `Coluna "${dados.titulo}" alterada`, "success");
          }}
        />
      )}
    </>
  );
}
