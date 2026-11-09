import axios from "axios";
import { type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { TH, TH_DIR } from "./estilosTabela";
import { CabecalhoColuna } from "./CabecalhoColuna";
import type { FiltroColuna, OperadorColuna, RespostaValores } from "./FiltroColunaServidor";
import { ariaSort, type OrdemColuna } from "./estadoColunas";

// `<th>` com ordenação e filtro por coluna para as telas do módulo Integração Plannix (24/10/2026). A API descreve cada coluna na resposta
// (`colunas`: tipo, operadores, se é agregada, domínio); a tela só diz o nome e o título. Serve às tabelas do servidor (valores vêm de uma
// rota) e às locais (valores calculados nas linhas da tela): quem monta passa `carregarValores`.

/** Descrição de uma coluna como a API devolve (backend/src/plannix/consultaColunas.ts). */
export interface ColunaApi {
  nome: string;
  tipo: "texto" | "inteiro" | "decimal" | "data" | "booleano" | "json";
  operadores: OperadorColuna[];
  agregada?: boolean;
  semAbaValores?: boolean;
  dominio?: { valor: string; rotulo: string }[];
}

/** O que a tabela precisa do hook de estado (useFiltroOrdemNaUrl ou useFiltroOrdemLocal). */
export interface EstadoColunas {
  filtros: FiltroColuna[];
  ordem: OrdemColuna[];
  filtrosParam: string | undefined;
  aplicarFiltro: (coluna: string, filtro: FiltroColuna | null) => void;
  ordenar: (coluna: string, aditivo: boolean) => void;
}

/** Valor de uma coluna como aparece na lista do funil. */
export function formatarValorColuna(valor: unknown, tipo: ColunaApi["tipo"]): string {
  if (valor === null || valor === undefined) return "—";
  if (tipo === "data" && typeof valor === "string") return new Date(valor).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (tipo === "decimal" && typeof valor === "number") return valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  if (tipo === "booleano") return valor ? "sim" : "não";
  return String(valor);
}

/** Valores de uma coluna vindos do servidor (aba "Valores"): mesma query da lista (`paramsFixos`) mais os filtros de coluna. */
export function valoresDoServidor(url: string, paramsFixos: Record<string, unknown>, filtrosParam: string | undefined, coluna: string) {
  return (termo: string) => axios.get<RespostaValores>(url, { params: { ...paramsFixos, coluna, termo, filtros: filtrosParam } }).then(({ data }) => data);
}

interface Props {
  nome: string;
  titulo: ReactNode;
  /** Coluna numérica: alinhada à direita. */
  direita?: boolean;
  colunas: ColunaApi[] | undefined;
  estado: EstadoColunas;
  /** Sem ele, a coluna só ordena (sem funil). */
  carregarValores?: (termo: string) => Promise<RespostaValores>;
  dica?: string;
  title?: string;
  /** Nome em texto para o funil, quando `titulo` não é um texto simples. */
  rotulo?: string;
  /** Liga o arrastar do título para mudar a ordem (useLayoutColunas().arrastar). */
  arrastar?: ArrastarColuna;
  /** Liga a alça de largura na borda direita (useRedimensionarColunas().alca(nome)). */
  redimensionar?: RedimensionarColuna;
  /** Classes extras do `<th>` (espaçamento e alinhamento próprios da tela); vencem as padrão. */
  className?: string;
  /** Estilo do `<th>` (ex.: o `left` da coluna parada). */
  style?: CSSProperties;
  /** Valor como aparece na lista do funil; padrão: formatarValorColuna pelo tipo (ex.: domínio "código · rótulo" no Ver dados). */
  formatarValor?: (valor: unknown) => string;
  /** A coluna tem funil mas não ordena (ex.: json). */
  semOrdenar?: boolean;
}

/**
 * Arrastar o título para mudar a ordem das colunas (useLayoutColunas). O tipo do arrasto leva o `grupo` (a tabela), então soltar a
 * coluna de uma tabela em outra não faz nada. Arrasto nativo do HTML: no celular a ordem muda pelo PainelColunas.
 */
export interface ArrastarColuna {
  grupo: string;
  onSoltar: (origem: string, destino: string) => void;
}

const tipoDoArrasto = (grupo: string) => `application/x-coluna.${grupo.toLowerCase()}`;

/**
 * Alça de largura na borda direita do título: arrastar muda a largura ao vivo (`onAjustar`) e soltar grava (`onFim`); duplo clique ajusta
 * ao conteúdo; setas do teclado, 10 px por toque. Pointer events, então funciona também no toque. `cortar`: a tabela tem larguras fixas e
 * o título que não cabe é cortado com "…".
 */
export interface RedimensionarColuna {
  cortar: boolean;
  onInicio: () => void;
  onAjustar: (px: number) => void;
  onFim: (px: number) => void;
  onAutoAjuste: () => void;
}

const PASSO_TECLADO = 10;

function AlcaLargura({ th, r, onRedimensionando }: { th: () => HTMLElement | null; r: RedimensionarColuna; onRedimensionando: (sim: boolean) => void }) {
  const inicio = useRef<{ x: number; largura: number; atual: number } | null>(null);
  const comecar = (e: PointerEvent<HTMLSpanElement>) => {
    const el = th();
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const largura = el.getBoundingClientRect().width;
    inicio.current = { x: e.clientX, largura, atual: largura };
    onRedimensionando(true);
    r.onInicio();
  };
  const mover = (e: PointerEvent<HTMLSpanElement>) => {
    if (!inicio.current) return;
    inicio.current.atual = inicio.current.largura + e.clientX - inicio.current.x;
    r.onAjustar(inicio.current.atual);
  };
  const terminar = () => {
    if (!inicio.current) return;
    r.onFim(inicio.current.atual);
    inicio.current = null;
    onRedimensionando(false);
  };
  const teclado = (e: KeyboardEvent<HTMLSpanElement>) => {
    const el = th();
    if (!el || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const px = el.getBoundingClientRect().width + (e.key === "ArrowRight" ? PASSO_TECLADO : -PASSO_TECLADO);
    r.onInicio();
    r.onFim(px);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da coluna"
      tabIndex={0}
      title="Arraste para mudar a largura · duplo clique ajusta ao conteúdo"
      draggable={false}
      onPointerDown={comecar}
      onPointerMove={mover}
      onPointerUp={terminar}
      onPointerCancel={terminar}
      onLostPointerCapture={terminar}
      onDoubleClick={(e) => {
        e.stopPropagation();
        r.onAutoAjuste();
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={teclado}
      className="absolute right-0 top-0 z-[1] h-full w-1.5 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-primary/60 focus:outline-none focus-visible:bg-primary"
    />
  );
}

export function ThColuna({ nome, titulo, direita, colunas, estado, carregarValores, dica, title, rotulo, arrastar, redimensionar, className, style, formatarValor, semOrdenar }: Props) {
  const c = colunas?.find((x) => x.nome === nome);
  const [alvo, setAlvo] = useState(false);
  // Puxando a alça de largura: o título não pode virar arrasto de coluna ao mesmo tempo.
  const [redimensionando, setRedimensionando] = useState(false);
  const refTh = useRef<HTMLTableCellElement>(null);
  const tipo = arrastar ? tipoDoArrasto(arrastar.grupo) : "";
  const doGrupo = (e: DragEvent) => !!arrastar && e.dataTransfer.types.includes(tipo);
  const propsArrastar = arrastar
    ? {
        draggable: !redimensionando,
        onDragStart: (e: DragEvent) => {
          if (redimensionando) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(tipo, nome);
          e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e: DragEvent) => {
          if (!doGrupo(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setAlvo(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAlvo(false);
        },
        onDrop: (e: DragEvent) => {
          setAlvo(false);
          if (!doGrupo(e)) return;
          e.preventDefault();
          const origem = e.dataTransfer.getData(tipo);
          if (origem && origem !== nome) arrastar.onSoltar(origem, nome);
        },
        onDragEnd: () => setAlvo(false),
      }
    : {};
  return (
    <th
      ref={refTh}
      data-coluna={nome}
      className={cn(
        direita ? TH_DIR : TH,
        arrastar && "cursor-grab active:cursor-grabbing",
        redimensionar && "relative",
        redimensionar?.cortar && "overflow-hidden text-ellipsis",
        alvo && "ring-2 ring-inset ring-primary",
        className,
      )}
      style={style}
      aria-sort={ariaSort(estado.ordem, nome)}
      title={title ?? (arrastar ? "Arraste para mudar a ordem das colunas" : undefined)}
      {...propsArrastar}
    >
      <CabecalhoColuna
        nome={nome}
        titulo={titulo}
        dica={dica}
        ordem={estado.ordem}
        onOrdenar={c && !semOrdenar ? estado.ordenar : undefined}
        filtro={
          c && carregarValores && c.operadores.length > 0
            ? {
                coluna: { nome, rotulo: rotulo ?? (typeof titulo === "string" ? titulo : undefined), tipo: c.tipo, operadores: c.operadores, dominio: c.dominio, semAbaValores: c.semAbaValores },
                atual: estado.filtros.find((f) => f.coluna === nome) ?? null,
                onAplicar: (f) => estado.aplicarFiltro(nome, f),
                carregarValores,
                formatarValor: formatarValor ?? ((v) => formatarValorColuna(v, c.tipo)),
              }
            : null
        }
      />
      {redimensionar && <AlcaLargura th={() => refTh.current} r={redimensionar} onRedimensionando={setRedimensionando} />}
    </th>
  );
}
