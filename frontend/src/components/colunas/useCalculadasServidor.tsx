import { useCallback, useMemo } from "react";
import { avaliarFormula, formulaParaTexto, type No, type TipoColunaFormula } from "../../lib/formulas/formula";
import { colunasParaFormula, formatarCalculada, nomeDaCalculada } from "./colunasCalculadas";
import type { CalculadasDoPainel } from "./PainelColunas";
import type { ColunaApi } from "./ThColuna";
import { useColunasCalculadas } from "./useColunasCalculadas";
import type { DefColuna } from "./useColunasConfiguraveis";

/**
 * Colunas calculadas nas listas do SERVIDOR (28/10/2026): a fórmula vai junto com cada busca (`param` → `calculadas` na query) e o servidor
 * a calcula em SQL (filtro, ordem, resumo e TOTAL sobre todas as linhas do filtro, plannix/consultaColunas.ts); a coluna mostra o valor que
 * veio em cada linha (`calc_<id>`). Fórmula que não vale nesta lista volta em `problemas` e a coluna mostra o aviso. Uso:
 *
 *   const calc = useCalculadasServidor("plannix.obras", TITULOS, dados?.colunas, dados?.itens, dados?.calculadasComProblema);
 *   const defs = useMemo(() => [...COLUNAS, ...calc.defs], [calc.defs]);
 *   const tc = useColunasConfiguraveis("plannix.obras", defs, { calculadas: calc.painel });
 *   axios.get(url, { params: { ...params, calculadas: calc.param } })   // na lista, no resumo e no funil de valores
 */
export function useCalculadasServidor<T>(
  chave: string,
  titulos: Record<string, string>,
  colunas: ColunaApi[] | undefined,
  itens: T[] | undefined,
  problemas: Record<string, string> | undefined,
) {
  const gestao = useColunasCalculadas(chave);
  const param = useMemo(
    () => (gestao.lista.length ? JSON.stringify(gestao.lista.map((c) => ({ nome: nomeDaCalculada(c.id), arvore: c.arvore }))) : undefined),
    [gestao.lista],
  );
  const disponiveis = useMemo(() => colunasParaFormula(colunas ?? [], titulos), [colunas, titulos]);
  const tipos = useMemo(() => new Map<string, TipoColunaFormula>(disponiveis.map((c) => [c.nome, c.tipo])), [disponiveis]);

  const defs = useMemo<DefColuna<T, unknown>[]>(
    () =>
      gestao.lista.map((c) => {
        const nome = nomeDaCalculada(c.id);
        const problema = problemas?.[nome];
        const valor = (l: T) => (l as Record<string, unknown>)[nome];
        return {
          nome,
          titulo: c.titulo,
          direita: true,
          largura: 140,
          dica: problema
            ? `Coluna calculada com problema: ${problema}`
            : `Coluna calculada${c.publicada ? " (publicada para todos)" : ""}: ${formulaParaTexto(c.arvore, titulos)}`,
          texto: (l: T) => formatarCalculada(valor(l), c.formato, c.casas),
          formatarResumo: (v: number) => formatarCalculada(v, c.formato, c.casas),
          render: (l: T) =>
            problema ? (
              <span className="cursor-help text-warning" title={problema}>
                ⚠
              </span>
            ) : (
              formatarCalculada(valor(l), c.formato, c.casas)
            ),
        };
      }),
    [gestao.lista, problemas, titulos],
  );

  /** Títulos das colunas da lista com os das calculadas (chips de filtro e de ordem). */
  const titulosTodos = useMemo(() => ({ ...titulos, ...Object.fromEntries(gestao.lista.map((c) => [nomeDaCalculada(c.id), c.titulo])) }), [titulos, gestao.lista]);

  /** Prévia do editor: a fórmula nas primeiras linhas da página (TOTAL fica vazio na prévia: ele é do servidor). */
  const previa = useCallback(
    (arvore: No) => (itens ?? []).slice(0, 3).map((l) => avaliarFormula(arvore, (n) => (l as Record<string, unknown>)[n], tipos)),
    [itens, tipos],
  );

  const painel = useMemo<CalculadasDoPainel>(() => ({ gestao, disponiveis, previa }), [gestao, disponiveis, previa]);
  return { param, defs, titulos: titulosTodos, painel };
}
