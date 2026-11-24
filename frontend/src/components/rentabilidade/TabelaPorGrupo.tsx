import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { useColunasConfiguraveis, type DefColuna } from "../colunas/useColunasConfiguraveis";
import { SkeletonLinhas } from "../ui/Skeleton";
import type { FormatoIndicador } from "../../lib/rentabilidade";

// Aba "Por Grupo" da Rentabilidade (24/11/2026): cada grupo (Conta Paralela, como na Matriz) é uma linha que expande os centros de custo que têm movimento nele.
// As COLUNAS são as mesmas da aba "Por Centro de Custo": a chave do kit de colunas é a mesma (`chave`), então ordem, largura, títulos e visibilidade valem nas duas.
// Sem filtro nem ordenação por coluna nesta aba: a árvore não se reordena linha a linha.

export interface ColunaResumo {
  codigo: string;
  rotulo: string;
  formato: FormatoIndicador;
}

/** Uma linha da tabela: um grupo, um CC dentro de um grupo, ou o total do recorte (rodapé). */
export interface LinhaTela {
  codccu: string;
  desccu: string;
  valores: Record<string, number | null>;
  /** Linha de total do recorte. */
  total?: boolean;
  /** Linha de grupo (expansível). */
  grupo?: boolean;
  /** Centro de custo dentro de um grupo. */
  cc?: boolean;
  /** Conta Paralela da linha de grupo ou do CC ("" = sem grupo). */
  grupoCodigo?: string;
}

export interface AcoesTabela {
  abrir: (coluna: ColunaResumo, linha: LinhaTela) => void;
  alternar: (grupo: string) => void;
  expandido: (grupo: string) => boolean;
}

export interface GrupoTela {
  grupo: string;
  rotulo: string;
  total: Record<string, number | null>;
  linhas: { codccu: string; desccu: string; valores: Record<string, number | null> }[];
}

/** Seta de expandir/recolher (a mesma da MatrizContabil). */
export function Seta({ aberta }: { aberta: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={cn("flex-none transition-transform", aberta && "rotate-90")}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

const chaveDaLinha = (l: LinhaTela): string => (l.total ? "total" : l.grupo ? `g:${l.grupoCodigo}` : `c:${l.grupoCodigo}:${l.codccu}`);

export function TabelaPorGrupo({
  chave,
  defs,
  grupos,
  total,
  abrir,
  loading,
  vazio,
}: {
  chave: string;
  defs: DefColuna<LinhaTela, AcoesTabela>[];
  grupos: GrupoTela[];
  total: Record<string, number | null>;
  abrir: AcoesTabela["abrir"];
  loading: boolean;
  vazio: string;
}) {
  const tc = useColunasConfiguraveis<LinhaTela, AcoesTabela>(chave, defs);
  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(new Set());
  const tudoExpandido = grupos.length > 0 && grupos.every((g) => expandidos.has(g.grupo));

  const alternar = (grupo: string) =>
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (!proximo.delete(grupo)) proximo.add(grupo);
      return proximo;
    });
  const acoes = useMemo<AcoesTabela>(() => ({ abrir, alternar, expandido: (g) => expandidos.has(g) }), [abrir, expandidos]);

  // Linhas na ordem da tela: cada grupo e, se expandido, os CCs dele (na ordem que o servidor mandou).
  const linhas = useMemo<LinhaTela[]>(
    () =>
      grupos.flatMap((g) => [
        { codccu: g.rotulo, desccu: "", valores: g.total, grupo: true, grupoCodigo: g.grupo },
        ...(expandidos.has(g.grupo) ? g.linhas.map((l) => ({ ...l, cc: true, grupoCodigo: g.grupo })) : []),
      ]),
    [grupos, expandidos]
  );
  const linhaTotal: LinhaTela | undefined = grupos.length > 0 ? { codccu: "", desccu: "Total do recorte", valores: total, total: true } : undefined;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => setExpandidos(tudoExpandido ? new Set() : new Set(grupos.map((g) => g.grupo)))}
          className="text-[12px] text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tudoExpandido ? "Recolher tudo" : "Expandir tudo"}
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className={tc.classeTabela} style={tc.estiloTabela} aria-busy={loading}>
          {tc.colgroup}
          <thead className="sticky top-0 z-10">{tc.cabecalho({})}</thead>
          <tbody>
            {loading && <SkeletonLinhas linhas={4} colunas={tc.nColunas} />}
            {!loading &&
              linhas.map((l) => (
                <tr key={chaveDaLinha(l)} className={cn("border-t border-border/60", l.grupo ? "bg-surface-2/40" : "hover:bg-surface-2")}>
                  {tc.celulas(l, acoes)}
                </tr>
              ))}
            {!loading && grupos.length === 0 && (
              <tr>
                <td colSpan={tc.nColunas} className="px-4 py-6 text-center text-sm text-muted">
                  {vazio}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">
            {!loading && linhaTotal && <tr className="border-t-2 border-border bg-surface-2 font-semibold text-foreground">{tc.celulas(linhaTotal, acoes)}</tr>}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
