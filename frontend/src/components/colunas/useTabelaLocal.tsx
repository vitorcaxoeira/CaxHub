import { type ReactNode, useCallback, useMemo } from "react";
import { avaliarFormula, colunasDaFormula, formulaParaTexto, type No, type TipoColunaFormula } from "../../lib/formulas/formula";
import { ChipOrdem, ChipsFiltros } from "./ChipsFiltros";
import { aplicarFiltrosLocal, type ColunaLocal, type LeitorDeValor, operadoresPorTipo, ordenarLocal, valoresLocais } from "./aplicarLocal";
import { type ColunaCalculadaSalva, colunasParaFormula, ehCalculada, formatarCalculada, nomeDaCalculada, problemaDaCalculada } from "./colunasCalculadas";
import type { ColunaApi } from "./ThColuna";
import { type PedidoResumo, resumirLinhas, type ResultadoResumo, type TipoResumo } from "./resumo";
import type { DefColuna } from "./useColunasConfiguraveis";
import { useFiltroOrdemLocal } from "./useFiltroOrdemLocal";

const LER_PADRAO = (linha: unknown, coluna: string): unknown => (linha as Record<string, unknown>)[coluna];
const SEM_CALCULADAS: ColunaCalculadaSalva[] = [];

/**
 * Filtro e ordenação por coluna para uma tabela PEQUENA que já está inteira na tela (24/10/2026): Evolução, fases e consumo dentro da
 * obra, revisões e consumo dentro da peça, Explorador. Mesmo funil (Condição e Valores) e mesmos operadores do servidor, aplicados nas
 * linhas da tela (aplicarLocal.ts). `colunas` e `linhas` precisam ser estáveis (useMemo ou constante). Uso:
 *
 *   const t = useTabelaLocal(linhas, COLUNAS, { titulos });
 *   <ThColuna nome="fase" titulo="Fase" colunas={t.colunas} estado={t.estado} carregarValores={t.valores("fase")} />
 *   {t.barra}   // chips dos filtros e da ordem ativos
 *   t.linhas.map(...)
 *
 * Colunas calculadas (28/10/2026): com `calculadas` (useColunasCalculadas), cada fórmula vira uma coluna `calc_<id>` (decimal) que filtra,
 * ordena e resume como as outras; `defsCalculadas` desenha as células e `disponiveis` são as colunas que entram em fórmula. TOTAL([x]) =
 * soma de x nas linhas que passam nos filtros das colunas comuns (os filtros das próprias calculadas ficam de fora: senão o total
 * dependeria do filtro que depende do total).
 */
export function useTabelaLocal<T>(
  linhas: T[],
  colunas: ColunaLocal[],
  opcoes: { ler?: LeitorDeValor<T>; titulos?: Record<string, string>; calculadas?: ColunaCalculadaSalva[] } = {},
) {
  const estado = useFiltroOrdemLocal();
  const { titulos } = opcoes;
  const lerBase: LeitorDeValor<T> = opcoes.ler ?? LER_PADRAO;
  const salvas = opcoes.calculadas ?? SEM_CALCULADAS;

  const tiposBase = useMemo(() => new Map<string, TipoColunaFormula>(colunas.map((c) => [c.nome, c.tipo])), [colunas]);
  const calculadas = useMemo(
    () => salvas.map((c) => ({ nome: nomeDaCalculada(c.id), salva: c, problema: problemaDaCalculada(c.arvore, tiposBase) })),
    [salvas, tiposBase],
  );
  const todasColunas = useMemo<ColunaLocal[]>(() => [...colunas, ...calculadas.map((c) => ({ nome: c.nome, tipo: "decimal" as const }))], [colunas, calculadas]);

  // TOTAL([x]) das fórmulas: soma de x nas linhas que passam nos filtros das colunas comuns.
  const filtrosComuns = useMemo(() => estado.filtros.filter((f) => !ehCalculada(f.coluna)), [estado.filtros]);
  const totais = useMemo<Record<string, number | null>>(() => {
    const nomes = new Set(calculadas.flatMap((c) => (c.problema ? [] : colunasDaFormula(c.salva.arvore, true))));
    if (!nomes.size) return {};
    const base = aplicarFiltrosLocal(linhas, colunas, filtrosComuns, lerBase);
    return Object.fromEntries(
      [...nomes].map((n) => {
        const ns = base.map((l) => lerBase(l, n)).filter((v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)));
        return [n, ns.length ? ns.reduce((s: number, v) => s + Number(v), 0) : null];
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, colunas, calculadas, filtrosComuns]);

  // Valor de cada calculada em cada linha (uma vez por mudança de linhas, fórmulas ou totais).
  const valoresCalculados = useMemo(() => {
    if (!calculadas.length) return null;
    return new Map(
      linhas.map((l) => [
        l,
        Object.fromEntries(calculadas.map((c) => [c.nome, c.problema ? null : avaliarFormula(c.salva.arvore, (n) => lerBase(l, n), tiposBase, totais)])) as Record<
          string,
          number | null
        >,
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, calculadas, totais, tiposBase]);

  const ler = useCallback<LeitorDeValor<T>>(
    (linha, coluna) => (valoresCalculados && ehCalculada(coluna) ? (valoresCalculados.get(linha)?.[coluna] ?? null) : lerBase(linha, coluna)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valoresCalculados, opcoes.ler],
  );

  const titulosTodos = useMemo(() => ({ ...titulos, ...Object.fromEntries(calculadas.map((c) => [c.nome, c.salva.titulo])) }), [titulos, calculadas]);

  const visiveis = useMemo(
    () => ordenarLocal(aplicarFiltrosLocal(linhas, todasColunas, estado.filtros, ler), todasColunas, estado.ordem, ler),
    [linhas, todasColunas, estado.filtros, estado.ordem, ler],
  );

  const colunasApi = useMemo<ColunaApi[]>(() => todasColunas.map((c) => ({ nome: c.nome, tipo: c.tipo, operadores: operadoresPorTipo(c.tipo, c.obrigatoria) })), [todasColunas]);

  const valores = useCallback(
    (coluna: string) => (termo: string) => Promise.resolve(valoresLocais(linhas, todasColunas, estado.filtros, coluna, termo, ler)),
    [linhas, todasColunas, estado.filtros, ler],
  );

  const barra: ReactNode =
    estado.filtros.length > 0 || estado.ordem.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 px-5 pb-2 pt-3">
        <ChipsFiltros
          filtros={estado.filtros}
          coluna={(n) => {
            const c = todasColunas.find((x) => x.nome === n);
            return c ? { tipo: c.tipo, titulo: titulosTodos[n] } : undefined;
          }}
          onRemover={(n) => estado.aplicarFiltro(n, null)}
          onLimpar={estado.limparFiltros}
        />
        <ChipOrdem ordem={estado.ordem} titulos={titulosTodos} onLimpar={estado.limparOrdem} />
      </div>
    ) : null;

  // Resumo do rodapé: sobre todas as linhas que passaram no filtro (28/10/2026). Mesmo leitor do filtro e da ordem.
  const tipos = useMemo(() => new Map<string, TipoResumo>(todasColunas.map((c) => [c.nome, c.tipo])), [todasColunas]);
  const resumir = useCallback((pedidos: PedidoResumo[]): ResultadoResumo => resumirLinhas(visiveis, pedidos, ler, tipos), [visiveis, ler, tipos]);

  /** Colunas que entram em fórmula (para o editor). */
  const disponiveis = useMemo(() => colunasParaFormula(colunas, titulos ?? {}), [colunas, titulos]);

  /** Desenho das calculadas, para juntar às colunas da tabela (useColunasConfiguraveis). */
  const defsCalculadas = useMemo<DefColuna<T, unknown>[]>(
    () =>
      calculadas.map(({ nome, salva, problema }) => ({
        nome,
        titulo: salva.titulo,
        direita: true,
        largura: 140,
        dica: problema
          ? `Coluna calculada com problema: ${problema}`
          : `Coluna calculada${salva.publicada ? " (publicada para todos)" : ""}: ${formulaParaTexto(salva.arvore, titulos ?? {})}`,
        texto: (l: T) => formatarCalculada(ler(l, nome), salva.formato, salva.casas),
        formatarResumo: (v: number) => formatarCalculada(v, salva.formato, salva.casas),
        render: (l: T) =>
          problema ? (
            <span className="cursor-help text-warning" title={problema}>
              ⚠
            </span>
          ) : (
            formatarCalculada(ler(l, nome), salva.formato, salva.casas)
          ),
      })),
    [calculadas, ler, titulos],
  );

  /** Prévia do editor: a fórmula nas primeiras linhas da lista (já filtradas), com os totais atuais. */
  const previa = useCallback(
    (arvore: No, quantas = 3) => visiveis.slice(0, quantas).map((l) => avaliarFormula(arvore, (n) => lerBase(l, n), tiposBase, totais)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiveis, tiposBase, totais],
  );

  return { estado, linhas: visiveis, colunas: colunasApi, valores, barra, filtrada: estado.filtros.length > 0, resumir, disponiveis, defsCalculadas, previa };
}
