import { ChevronRight, Pencil, Pin, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { raizDoPortal } from "../ui/raizDoPortal";
import { autoUpdate, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import type { ColunaDisponivel, No } from "../../lib/formulas/formula";
import { cn } from "../../lib/cn";
import { useToast } from "../ui/Toast";
import { type ColunaCalculadaSalva, nomeDaCalculada } from "./colunasCalculadas";
import { EditorColunaCalculada } from "./EditorColunaCalculada";
import type { GestaoCalculadas } from "./useColunasCalculadas";
import type { ExtrasDoPainel } from "./useCamposRelacionados";
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

export function PainelColunas({
  layout,
  titulos,
  titulosOriginais,
  calculadas,
  extras,
}: {
  layout: LayoutColunas;
  /** Títulos que valem na tela (o próprio da pessoa, senão o da tela). */
  titulos: Record<string, string>;
  /** Títulos da tela, sem o que a pessoa renomeou: a dica e o que volta ao restaurar. */
  titulosOriginais?: Record<string, string>;
  calculadas?: CalculadasDoPainel;
  extras?: ExtrasDoPainel;
}) {
  const [open, setOpen] = useState(false);
  // "Mais campos" (12/11/2026): a mesma janela troca a lista de colunas pela lista de campos das tabelas relacionadas; fechar volta à lista.
  const [vista, setVista] = useState<"colunas" | "campos">("colunas");
  useEffect(() => {
    if (!open) {
      setVista("colunas");
      setEditandoTitulo(null);
    }
  }, [open]);
  // Renomear a coluna (12/11/2026): só o texto exibido; o nome técnico (filtro, ordem, resumo, fórmula) não muda. Enter ou sair do campo grava; Esc cancela; vazio volta ao original.
  const [editandoTitulo, setEditandoTitulo] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const canceladoRef = useRef(false);
  const comecarEdicao = (nome: string, atual: string) => {
    canceladoRef.current = false;
    setRascunho(atual);
    setEditandoTitulo(nome);
  };
  const confirmarEdicao = (nome: string) => {
    if (canceladoRef.current) {
      canceladoRef.current = false;
      return;
    }
    const texto = rascunho.trim();
    layout.renomear(nome, texto === "" || texto === titulosOriginais?.[nome] ? null : texto);
    setEditandoTitulo(null);
  };
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
            className="z-popover flex w-80 flex-col overflow-hidden rounded-md border border-border bg-surface text-left shadow-lg"
            {...getFloatingProps()}
          >
            {vista === "campos" && extras ? (
              <VistaCampos extras={extras} onVoltar={() => setVista("colunas")} />
            ) : (
              <>
            <p className="border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted">Colunas · ordem e visíveis</p>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {layout.ordem.map((nome, i) => {
                const obrigatoria = layout.obrigatorias.includes(nome);
                const titulo = titulos[nome] ?? nome;
                // "Congelar até aqui" (09/11/2026): a coluna e as visíveis antes dela ficam paradas ao rolar na horizontal. Clicar no limite solta tudo.
                const parada = layout.congeladas.includes(nome);
                const eLimite = layout.congeladaAte === nome;
                const oculta = layout.ocultas.includes(nome);
                const proprio = !!layout.titulos[nome];
                return (
                  <li key={nome} className="flex items-center gap-2 px-3 py-0.5 hover:bg-surface-2/60">
                    {editandoTitulo === nome ? (
                      <input
                        autoFocus
                        value={rascunho}
                        maxLength={60}
                        onChange={(e) => setRascunho(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={() => confirmarEdicao(nome)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmarEdicao(nome);
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            canceladoRef.current = true;
                            setEditandoTitulo(null);
                          }
                        }}
                        aria-label={`Novo título da coluna ${titulosOriginais?.[nome] ?? titulo}`}
                        placeholder={titulosOriginais?.[nome] ?? titulo}
                        className="min-w-0 flex-1 rounded border border-border bg-surface px-1.5 py-1 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : (
                    <label
                      title={proprio ? `Original: ${titulosOriginais?.[nome] ?? ""}` : undefined}
                      className={cn("flex min-w-0 flex-1 items-center gap-2 py-1 text-[12.5px]", obrigatoria ? "text-muted" : "cursor-pointer text-foreground")}
                    >
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
                    )}
                    {!porNome.has(nome) && editandoTitulo !== nome && (
                      <>
                        {proprio && (
                          <button
                            type="button"
                            className={setaCls}
                            onClick={() => layout.renomear(nome, null)}
                            aria-label={`Voltar ao título original de ${titulo}`}
                            title={`Voltar ao título original (${titulosOriginais?.[nome] ?? ""})`}
                          >
                            <RotateCcw size={12} strokeWidth={1.75} aria-hidden />
                          </button>
                        )}
                        <button type="button" className={setaCls} onClick={() => comecarEdicao(nome, titulo)} aria-label={`Renomear ${titulo}`} title="Renomear: muda só o texto do título; filtros, ordem e fórmulas continuam valendo">
                          <Pencil size={12} strokeWidth={1.75} aria-hidden />
                        </button>
                      </>
                    )}
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
                    <button
                      type="button"
                      className={cn(setaCls, parada && "text-primary")}
                      disabled={oculta}
                      aria-pressed={parada}
                      onClick={() => layout.congelarAte(eLimite ? null : nome)}
                      aria-label={eLimite ? `Descongelar as colunas paradas (até ${titulo})` : `Congelar as colunas até ${titulo}`}
                      title={
                        oculta
                          ? "Mostre a coluna para poder congelar até ela"
                          : eLimite
                            ? "Descongelar (soltar as colunas paradas)"
                            : "Congelar até esta coluna: ela e as anteriores ficam paradas ao rolar na horizontal"
                      }
                    >
                      <Pin size={13} strokeWidth={1.75} aria-hidden className={parada ? "fill-current" : undefined} />
                    </button>
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
            {extras && (
              <button
                type="button"
                onClick={() => {
                  extras.carregar();
                  setVista("campos");
                }}
                className="border-t border-border px-3 py-2 text-left text-[12.5px] font-medium text-primary transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                title="Mostrar também os campos da tabela e das tabelas relacionadas (ex.: dados do cadastro do cliente)"
              >
                + Mais campos (tabela e relacionadas)
              </button>
            )}
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
              <span className="text-[11px] text-muted" title="A largura muda puxando a borda direita do título da coluna; o alfinete congela até a coluna escolhida">
                Ordem, colunas, larguras e colunas paradas ficam no seu usuário
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
              </>
            )}
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

/** "Mais campos": campos da tabela da lista e das relacionadas, para ligar como coluna (fica no fim da lista de colunas). */
function VistaCampos({ extras, onVoltar }: { extras: ExtrasDoPainel; onVoltar: () => void }) {
  const [busca, setBusca] = useState("");
  // Acordeão (12/11/2026): cada tabela abre e fecha ao clicar no título; começa tudo fechado. Com busca, as tabelas que têm resultado ficam abertas.
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const alternarGrupo = (id: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(id)) proximo.add(id);
      return proximo;
    });
  const termo = busca.trim().toLowerCase();
  const grupos = useMemo(
    () =>
      (extras.fontes ?? [])
        .map((f) => ({
          ...f,
          total: f.campos.length,
          ligados: f.campos.filter((c) => extras.selecionados.has(c.nome)).length,
          campos: f.campos.filter((c) => !termo || c.titulo.toLowerCase().includes(termo) || c.nome.toLowerCase().includes(termo)),
        }))
        .filter((f) => f.campos.length > 0),
    [extras.fontes, extras.selecionados, termo],
  );
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button type="button" className={setaCls} onClick={onVoltar} aria-label="Voltar para a lista de colunas" title="Voltar para a lista de colunas">
          ←
        </button>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Mais campos · {extras.selecionados.size} ligado(s)</p>
      </div>
      <div className="border-b border-border px-3 py-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar campo…"
          aria-label="Buscar campo"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {extras.carregando && <p className="px-3 py-2 text-[12.5px] text-muted">Carregando campos…</p>}
        {extras.erro && <p className="px-3 py-2 text-[12.5px] text-destructive">{extras.erro}</p>}
        {!extras.carregando && !extras.erro && extras.fontes && grupos.length === 0 && <p className="px-3 py-2 text-[12.5px] text-muted">Nenhum campo encontrado.</p>}
        {grupos.map((f) => {
          const aberto = !!termo || abertas.has(f.id);
          const idLista = `campos-${f.id}`;
          return (
            <section key={f.id} className="border-b border-border/60 last:border-b-0">
              <h3>
                <button
                  type="button"
                  onClick={() => alternarGrupo(f.id)}
                  aria-expanded={aberto}
                  aria-controls={idLista}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-medium text-foreground transition hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <ChevronRight size={14} strokeWidth={2} aria-hidden className={cn("shrink-0 text-muted transition-transform", aberto && "rotate-90")} />
                  <span className="flex-1 truncate">{f.titulo}</span>
                  <span className={cn("shrink-0 font-mono text-[10.5px]", f.ligados > 0 ? "text-primary" : "text-muted")} title={`${f.ligados} de ${f.total} campo(s) ligado(s)`}>
                    {f.ligados > 0 ? `${f.ligados}/${f.total}` : f.total}
                  </span>
                </button>
              </h3>
              {aberto && (
                <ul id={idLista} className="pb-1">
                  {f.campos.map((c) => (
                    <li key={c.nome}>
                      <label className="flex cursor-pointer items-center gap-2 py-1 pl-9 pr-3 text-[12.5px] text-foreground hover:bg-surface-2/60" title={c.nome.split("__")[1]}>
                        <input type="checkbox" checked={extras.selecionados.has(c.nome)} onChange={() => extras.alternar(c.nome)} className="accent-primary" />
                        <span className="truncate">{c.titulo}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted">O campo marcado vira uma coluna no fim da tabela; desmarque para tirar.</p>
    </>
  );
}
