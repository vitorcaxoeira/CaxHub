import { useEffect, useMemo, useRef, useState } from "react";
import { autoUpdate, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { cn } from "../../lib/cn";

// Rótulo dos valores nulos/vazios. Exportado porque quem monta as opções e quem testa a
// linha contra o filtro precisam usar exatamente o mesmo texto — se um mandar "(Vazio)" e
// o outro "", o filtro nunca casa.
export const VALOR_VAZIO = "(Vazio)";

// Quantos valores entram por vez. O resto vem por scroll infinito — renderizar tudo de
// saída é desperdício quando a pessoa quase sempre acha o que quer nos primeiros itens ou
// digitando, e protege o popover de uma coluna que venha com muitos valores distintos.
const LOTE = 50;

// Distância do fim da lista que dispara o lote seguinte. Folga de ~1,5 item, pra carregar
// antes de a pessoa bater no fundo e ver a rolagem travar.
const MARGEM_SCROLL = 40;

// Altura máxima do popover inteiro (cabeçalho + ações + lista). Quando sobra menos espaço
// abaixo do funil, o `size()` reduz este valor e a lista rola dentro — o popover NÃO vira
// pra cima.
const ALTURA_MAX = 320;

interface MultiSelectColumnFilterProps {
  /** Nome da coluna, usado no cabeçalho do popover e no aria-label do funil. */
  titulo: string;
  /** Valores distintos, já ordenados pelo chamador. */
  opcoes: string[];
  selecionados: string[];
  onChange: (selecionados: string[]) => void;
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Filtro de coluna com seleção múltipla, reutilizável em qualquer tabela. Um por coluna,
// parametrizado — a tela só passa os valores distintos e recebe a seleção de volta.
export function MultiSelectColumnFilter({ titulo, opcoes, selecionados, onChange }: MultiSelectColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(LOTE);
  const buscaRef = useRef<HTMLInputElement>(null);

  // Foco por efeito, não por `autoFocus`: o campo vive num portal no fim do <body>, e o
  // foco automático do browser rola a página pra trazê-lo à vista — era o que deslocava a
  // linha do accordion no instante do clique. `preventScroll` corta isso.
  useEffect(() => {
    if (open) buscaRef.current?.focus({ preventScroll: true });
  }, [open]);

  // FloatingPortal + posicionamento do floating-ui pelo mesmo motivo do DropdownMenu: a
  // tabela vive dentro de um `overflow-x-auto`, que vira contexto de recorte e cortaria um
  // popover posicionado com `absolute`.
  //
  // `strategy: "fixed"` e NÃO "absolute": ancorado ao viewport, o popover não estica o
  // documento quando abre perto do rodapé — com `absolute` ele aumentava a altura da
  // página e a linha do accordion pulava de lugar.
  //
  // Sem `flip()` de propósito: o popover abre sempre abaixo do funil, alinhado à esquerda
  // dele. Quando falta espaço, quem cede é a altura (`size()` abaixo), não a posição —
  // virar pra cima fazia o popover cobrir a própria linha que a pessoa está filtrando.
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (proximo) => {
      setOpen(proximo);
      if (proximo) {
        setBusca("");
        setLimite(LOTE);
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
          // Piso de 160px: abaixo disso o popover não mostraria nem a busca com um item, e
          // aí é melhor ele transbordar um pouco do que ficar inutilizável.
          elements.floating.style.maxHeight = `${Math.max(160, Math.min(ALTURA_MAX, availableHeight))}px`;
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

  const selecionadosSet = useMemo(() => new Set(selecionados), [selecionados]);

  // Todos os que casam com a busca — é sobre este conjunto que "Selecionar todos" age, não
  // só sobre o lote já rolado.
  const casam = useMemo(() => {
    const termo = normalizar(busca.trim());
    const filtrados = termo ? opcoes.filter((o) => normalizar(o).includes(termo)) : opcoes;
    // Selecionados primeiro: o que a pessoa acabou de marcar não some da vista quando a
    // lista é longa e o item está lá embaixo.
    return [...filtrados].sort((a, b) => Number(selecionadosSet.has(b)) - Number(selecionadosSet.has(a)));
  }, [opcoes, busca, selecionadosSet]);

  const visiveis = useMemo(() => casam.slice(0, limite), [casam, limite]);
  const temMais = casam.length > visiveis.length;

  function aoRolar(e: React.UIEvent<HTMLDivElement>) {
    if (!temMais) return;
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - MARGEM_SCROLL) setLimite((atual) => atual + LOTE);
  }

  const ativo = selecionados.length > 0;

  function alternar(valor: string) {
    onChange(selecionadosSet.has(valor) ? selecionados.filter((v) => v !== valor) : [...selecionados, valor]);
  }

  // "Selecionar todos" respeita a busca, mas ignora o scroll infinito: marca tudo que casa
  // com o termo, não só o lote já carregado — senão o botão faria coisas diferentes
  // dependendo de quanto a pessoa rolou.
  function selecionarTodos() {
    const novos = casam.filter((v) => !selecionadosSet.has(v));
    onChange([...selecionados, ...novos]);
  }

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        // stopPropagation TEM que entrar por dentro do getReferenceProps: passado como
        // prop solta depois do spread, ele substituiria o onClick do useClick e o popover
        // nunca abriria.
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        aria-label={`Filtrar por ${titulo}`}
        title={ativo ? `${titulo}: ${selecionados.length} selecionado(s)` : `Filtrar por ${titulo}`}
        className={cn(
          "ml-1 inline-flex items-center gap-0.5 rounded p-0.5 align-middle transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ativo ? "text-primary" : "text-muted hover:text-foreground"
        )}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill={ativo ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        {ativo && (
          <span className="rounded-full bg-primary px-1 font-mono text-[8.5px] font-semibold leading-[14px] text-primary-foreground">
            {selecionados.length}
          </span>
        )}
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            // flex-col: cabeçalho e ações têm altura fixa, a lista é quem encolhe quando o
            // `size()` aperta o maxHeight.
            className="z-popover flex w-64 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-lg"
            {...getFloatingProps({ onClick: (e) => e.stopPropagation() })}
          >
            <div className="shrink-0 border-b border-border p-2">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">{titulo}</p>
              <input
                ref={buscaRef}
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  // Busca nova recomeça do primeiro lote — senão a lista abriria já com
                  // centenas de itens só porque a pessoa tinha rolado antes de digitar.
                  setLimite(LOTE);
                }}
                placeholder="Buscar..."
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
              <button
                type="button"
                onClick={selecionarTodos}
                disabled={casam.length === 0}
                className="text-[11px] text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
              >
                Selecionar todos{busca.trim() && casam.length > 0 ? ` (${casam.length})` : ""}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={!ativo}
                className="text-[11px] text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Limpar
              </button>
            </div>

            {/* min-h-0 é o que permite o flex-1 encolher abaixo do conteúdo — sem ele a
                lista empurra o popover além do maxHeight em vez de rolar. */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1" onScroll={aoRolar}>
              {visiveis.length === 0 && (
                <p className="px-3 py-3 text-center text-[11.5px] text-muted">Nenhum valor encontrado.</p>
              )}
              {visiveis.map((valor) => (
                <label
                  key={valor}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-[12.5px] text-foreground hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={selecionadosSet.has(valor)}
                    onChange={() => alternar(valor)}
                    className="accent-primary"
                  />
                  <span className="truncate" title={valor}>
                    {valor}
                  </span>
                </label>
              ))}
              {/* Sentinela do scroll infinito: some assim que o último lote entra. */}
              {temMais && (
                <p className="px-3 py-1.5 text-center text-[11px] text-muted">
                  {visiveis.length} de {casam.length} — role para carregar mais.
                </p>
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
