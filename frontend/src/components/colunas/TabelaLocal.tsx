import { useMemo } from "react";
import { cn } from "../../lib/cn";
import { SkeletonLinhas } from "../ui/Skeleton";
import type { ColunaLocal, LeitorDeValor } from "./aplicarLocal";
import { type DefColuna, titulosDe } from "./useColunasConfiguraveis";
import { useTabelaLocalConfiguravel } from "./useTabelaLocalConfiguravel";

/**
 * Tabela que já está inteira na tela (itens de uma nota, movimentos de um produto...) com colunas configuráveis, filtro e ordem por coluna,
 * resumo no rodapé (soma, média...) e colunas calculadas por fórmula (29/10/2026). Só declara as colunas (`defs`) e como filtrá-las
 * (`colunas`); `defs`, `colunas` e `linhas` precisam ser estáveis (constante do módulo ou useMemo). Para uma lista paginada no servidor, ListaServidor.
 */
interface Props<T, C> {
  /** Chave da arrumação das colunas e das calculadas (ex.: "mercado.pedido.itens-produto"). */
  chave: string;
  defs: DefColuna<T, C>[];
  /** Como cada coluna filtra e ordena (tipo do valor). */
  colunas: ColunaLocal[];
  linhas: T[];
  chaveLinha: (linha: T, indice: number) => string;
  vazio: string;
  /** Texto das colunas cujo valor na tela difere do campo (ex.: "código — descrição"). */
  ler?: LeitorDeValor<T>;
  ctx?: C;
  loading?: boolean;
  alturaMax?: string;
  classeLinha?: (linha: T) => string | undefined;
  onLinha?: (linha: T) => void;
}

export function TabelaLocal<T, C = undefined>({ chave, defs, colunas, linhas, chaveLinha, vazio, ler, ctx, loading = false, alturaMax = "max-h-[60vh]", classeLinha, onLinha }: Props<T, C>) {
  const titulos = useMemo(() => titulosDe(defs), [defs]);
  const { t, tc } = useTabelaLocalConfiguravel(chave, defs, linhas, colunas, { ler, titulos });
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      {t.barra}
      <div className={cn("overflow-auto", alturaMax)}>
        <table className={tc.classeTabela} style={tc.estiloTabela} aria-busy={loading}>
          {tc.colgroup}
          <thead className="sticky top-0 z-10">{tc.cabecalho({ colunas: t.colunas, estado: t.estado, valores: t.valores })}</thead>
          <tbody>
            {loading && <SkeletonLinhas linhas={4} colunas={tc.nColunas} />}
            {!loading &&
              t.linhas.map((l, i) => (
                <tr key={chaveLinha(l, i)} className={cn("border-t border-border/60", onLinha && "cursor-pointer hover:bg-surface-2", classeLinha?.(l))} onClick={onLinha ? () => onLinha(l) : undefined}>
                  {tc.celulas(l, ctx as C)}
                </tr>
              ))}
            {!loading && t.linhas.length === 0 && (
              <tr>
                <td colSpan={tc.nColunas} className="px-4 py-6 text-center text-sm text-muted">
                  {linhas.length === 0 ? vazio : "Nada encontrado com esses filtros."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">{!loading && tc.rodape({ colunas: t.colunas, resultado: t.resumir(tc.pedidosResumo) })}</tfoot>
        </table>
      </div>
    </div>
  );
}

