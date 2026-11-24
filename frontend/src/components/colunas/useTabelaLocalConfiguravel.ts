import { useMemo } from "react";
import type { ColunaLocal, LeitorDeValor } from "./aplicarLocal";
import { useColunasCalculadas } from "./useColunasCalculadas";
import { type DefColuna, useColunasConfiguraveis } from "./useColunasConfiguraveis";
import { useTabelaLocal } from "./useTabelaLocal";

/**
 * Tabela do navegador com colunas configuráveis E colunas calculadas por fórmula (28/10/2026): junta useColunasCalculadas (as fórmulas
 * salvas da lista), useTabelaLocal (filtro, ordem, resumo e o valor das calculadas) e useColunasConfiguraveis (arrumação, rodapé e o
 * "+ Coluna calculada" do painel). A chave é a mesma da arrumação. `defs`, `linhas` e `colunas` precisam ser estáveis. Uso:
 *
 *   const { t, tc } = useTabelaLocalConfiguravel("plannix.consumo.origens", COLUNAS, linhas, COLUNAS_LOCAIS, { ler, titulos: TITULOS });
 */
export function useTabelaLocalConfiguravel<T, C = undefined>(
  chave: string,
  defs: DefColuna<T, C>[],
  linhas: T[],
  colunas: ColunaLocal[],
  opcoes: { ler?: LeitorDeValor<T>; titulos?: Record<string, string> } = {},
) {
  const gestao = useColunasCalculadas(chave);
  const t = useTabelaLocal(linhas, colunas, { ...opcoes, calculadas: gestao.lista });
  const todas = useMemo<DefColuna<T, C>[]>(() => [...defs, ...t.defsCalculadas], [defs, t.defsCalculadas]);
  const tc = useColunasConfiguraveis(chave, todas, { calculadas: { gestao, disponiveis: t.disponiveis, previa: t.previa } });
  return { t, tc };
}
