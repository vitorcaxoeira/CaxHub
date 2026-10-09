import { ReactNode, useState } from "react";
import { cn } from "../../lib/cn";
import { Skeleton } from "../ui/Skeleton";
import { BarraFiltrosRh } from "./BarraFiltrosRh";
import { fmtVariacao } from "./formato";
import type { RespostaBase } from "./useRh";

// Peças visuais comuns às telas de RH. A ideia de todas as telas é a mesma:
//   1. cabeçalho com o que a tela responde e a barra de filtros única;
//   2. linha de KPIs, cada um com "como calculamos" e, quando faz sentido, comparação;
//   3. painéis com gráfico + a definição do número ao alcance de um clique.
// Número que a base não sustenta aparece como "—" com o motivo, nunca como zero.

export function PaginaRh({
  titulo,
  pergunta,
  resposta,
  carregando,
  erro,
  children,
  rodape,
}: {
  titulo: string;
  /** A pergunta de negócio que a tela responde, em uma frase. */
  pergunta: string;
  resposta: RespostaBase | null;
  carregando: boolean;
  erro: string | null;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  const escopoImplicito = resposta?.filtro.tipcolImplicito;
  return (
    <div className="space-y-5">
      <header>
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted">Pessoas</p>
        <h1 className="font-display text-2xl font-bold text-foreground">{titulo}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{pergunta}</p>
      </header>

      <BarraFiltrosRh escopoPadrao={escopoImplicito ? "Só empregados (padrão desta tela: terceiros e parceiros não seguem a jornada CLT)." : undefined} />

      {resposta && !resposta.acesso.individual && (
        <Aviso tom="info">
          Visão agregada: nomes e valores individuais ficam com o RH, e grupos com menos de 3 pessoas não são detalhados.
        </Aviso>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className={cn("space-y-5 transition-opacity", carregando && resposta && "opacity-60")}>
        {!resposta && carregando ? <EsqueletoTela /> : resposta ? children : null}
      </div>
      {rodape}
    </div>
  );
}

function EsqueletoTela() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export function Aviso({ tom, children }: { tom: "info" | "erro" | "alerta"; children: ReactNode }) {
  const cores = {
    info: "border-border bg-surface-2 text-muted",
    erro: "border-destructive/40 bg-destructive/10 text-destructive",
    alerta: "border-warning/40 bg-warning/10 text-foreground",
  }[tom];
  return <p className={cn("rounded-md border px-4 py-2 text-sm", cores)}>{children}</p>;
}

/** "Como calculamos": definição do número, recolhida por padrão. */
export function ComoCalculamos({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="text-[11.5px] text-muted">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
        aria-expanded={aberto}
      >
        Como calculamos
        <svg width="9" height="9" viewBox="0 0 10 10" className={cn("transition-transform", aberto && "rotate-180")} aria-hidden="true">
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {aberto && <div className="mt-1.5 rounded-md bg-surface-2 px-3 py-2 leading-relaxed text-foreground/80">{children}</div>}
    </div>
  );
}

export function Painel({
  titulo,
  descricao,
  ajuda,
  acao,
  className,
  children,
}: {
  titulo: string;
  descricao?: string;
  ajuda?: ReactNode;
  acao?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-foreground">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-[12px] text-muted">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
      {ajuda && (
        <div className="mt-3 border-t border-border pt-2">
          <ComoCalculamos>{ajuda}</ComoCalculamos>
        </div>
      )}
    </section>
  );
}

export type TomKpi = "neutro" | "bom" | "atencao" | "ruim";

const tomTexto: Record<TomKpi, string> = {
  neutro: "text-foreground",
  bom: "text-success",
  atencao: "text-warning",
  ruim: "text-destructive",
};

export function Kpi({
  rotulo,
  valor,
  sub,
  tom = "neutro",
  variacao,
  bomQuando = "cair",
  vsRotulo,
  onClick,
  ativo,
  ajuda,
  restrito,
}: {
  rotulo: string;
  valor: string;
  sub?: ReactNode;
  tom?: TomKpi;
  /** Variação percentual já calculada pelo backend (12,3 = +12,3%). */
  variacao?: number | null;
  /** O que é bom: o valor subir (receita, retenção) ou cair (turnover, absenteísmo, custo). */
  bomQuando?: "subir" | "cair";
  vsRotulo?: string;
  onClick?: () => void;
  ativo?: boolean;
  ajuda?: ReactNode;
  /** Valor escondido por privacidade (grupo pequeno / sem o papel rh). */
  restrito?: boolean;
}) {
  const Raiz = onClick ? "button" : "div";
  const bom = variacao == null ? null : bomQuando === "subir" ? variacao > 0 : variacao < 0;
  return (
    <div className={cn("rounded-lg border bg-surface p-4", ativo ? "border-primary" : "border-border")}>
      <Raiz
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn("block w-full text-left", onClick && "cursor-pointer")}
      >
        <p className="text-[11.5px] font-medium text-muted">{rotulo}</p>
        <p className={cn("mt-1 font-display text-[26px] font-bold leading-tight", restrito ? "text-muted" : tomTexto[tom])} title={restrito ? "Restrito ao papel RH (grupo pequeno)" : undefined}>
          {restrito ? "—" : valor}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
          {variacao != null && !restrito && (
            <span className={cn("font-semibold", variacao === 0 ? "text-muted" : bom ? "text-success" : "text-destructive")}>
              {variacao > 0 ? "▲" : variacao < 0 ? "▼" : "•"} {fmtVariacao(variacao)}
              {vsRotulo ? <span className="font-normal text-muted"> {vsRotulo}</span> : null}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      </Raiz>
      {ajuda && (
        <div className="mt-2">
          <ComoCalculamos>{ajuda}</ComoCalculamos>
        </div>
      )}
    </div>
  );
}

export function GradeKpis({ children, colunas = 4 }: { children: ReactNode; colunas?: 3 | 4 | 5 | 6 }) {
  const cls = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5", 6: "lg:grid-cols-6" }[colunas];
  return <div className={cn("grid grid-cols-2 gap-3", cls)}>{children}</div>;
}

export function VazioRh({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

/** Tabela simples e legível (sem paginação: as listas de RH têm no máximo dezenas de linhas). */
export function Tabela<T>({
  colunas,
  linhas,
  vazio = "Sem dados no período.",
}: {
  colunas: { titulo: string; render: (l: T) => ReactNode; alinhar?: "esq" | "dir"; largura?: string }[];
  linhas: T[];
  vazio?: string;
}) {
  if (!linhas.length) return <VazioRh>{vazio}</VazioRh>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {colunas.map((c) => (
              <th
                key={c.titulo}
                className={cn("px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted", c.alinhar === "dir" ? "text-right" : "text-left")}
                style={c.largura ? { width: c.largura } : undefined}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
              {colunas.map((c) => (
                <td key={c.titulo} className={cn("px-2 py-1.5 text-foreground", c.alinhar === "dir" && "text-right tabular-nums")}>
                  {c.render(l)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
