import { type CSSProperties, type ReactNode, useMemo } from "react";
import { cn } from "../../lib/cn";
import { TD, TD_DIR, TH } from "./estilosTabela";
import type { RespostaValores } from "./FiltroColunaServidor";
import { CelulaResumo } from "./CelulaResumo";
import { type CalculadasDoPainel, PainelColunas } from "./PainelColunas";
import type { FuncaoResumo, PedidoResumo, ResultadoResumo } from "./resumo";
import { type ColunaApi, type EstadoColunas, ThColuna } from "./ThColuna";

/** Estado de uma tabela SEM ordenação nem filtro por coluna (ex.: Usuários, jobs): o cabeçalho só mostra o título. */
const ESTADO_INERTE: EstadoColunas = { filtros: [], ordem: [], filtrosParam: undefined, aplicarFiltro: () => undefined, ordenar: () => undefined };

/** Onde a coluna está entre as visíveis (bordas da linha aberta, por exemplo). */
export interface PosicaoColuna {
  primeira: boolean;
  ultima: boolean;
}
import { useLayoutColunas } from "./useLayoutColunas";
import { useRedimensionarColunas } from "./useRedimensionarColunas";

/**
 * Uma coluna de tabela configurável (26/10/2026): o que o cabeçalho mostra e como a célula é desenhada, declarado UMA vez. A ordem, as
 * ocultas e as larguras vêm da arrumação do usuário (useLayoutColunas + useRedimensionarColunas), não da posição no código.
 * `C` = contexto da linha que a tela passa para o `render` (ex.: linha aberta, função de navegar).
 */
export interface DefColuna<T, C = undefined> {
  /** Nome técnico: o mesmo do filtro/ordem por coluna (`?f=`, `?o=`) e o que fica salvo na arrumação. */
  nome: string;
  /** Título em texto: painel "Colunas", chips de filtro e ordem, funil. */
  titulo: string;
  /** Cabeçalho quando não é só texto (ex.: bolinha com a cor da fase). */
  cabecalho?: ReactNode;
  /** Dica do título (title do `<th>`). */
  dica?: string;
  direita?: boolean;
  /** Alinhado ao centro (título e células). */
  centro?: boolean;
  /** Valor como aparece na lista do funil desta coluna (ver ThColuna). */
  formatarValor?: (valor: unknown) => string;
  /** Tem funil mas não ordena. */
  semOrdenar?: boolean;
  /** Largura (px) quando a coluna aparece depois que o usuário já ajustou as outras; padrão 120. */
  largura?: number;
  /** Não pode ser ocultada (ex.: a coluna que abre o detalhe da linha). */
  fixa?: boolean;
  classe?: string | ((linha: T, ctx: C, pos: PosicaoColuna) => string | undefined);
  /** title da célula. */
  title?: (linha: T) => string | undefined;
  /** Texto inteiro no title quando a coluna está estreita e o conteúdo corta com "…". */
  texto?: (linha: T) => string | null | undefined;
  /** `cortar`: a tabela tem larguras fixas (algo inline-block dentro da célula precisa de `max-w-full truncate` para ganhar o "…"). */
  render: (linha: T, ctx: C, cortar: boolean) => ReactNode;
  /** Resumo do rodapé (28/10/2026): funções que a coluna oferece, limitando as do tipo (ex.: Δ % sem Soma; código só Contagem/Distintos). */
  resumos?: FuncaoResumo[];
  /** Formato do resumo na unidade da coluna (soma, média, mínimo...): R$, kg, 3 casas... Sem ele, o padrão do tipo. */
  formatarResumo?: (v: number) => string;
  /** Aviso ao lado de soma/média/... (ex.: "soma unidades diferentes"). */
  avisoResumo?: string;
}

const LARGURA_SEM_PADRAO = 120;
/**
 * Coluna reservada no começo de toda tabela configurável (27/10/2026): o ícone das Colunas fica sempre no canto esquerdo do cabeçalho, no
 * mesmo lugar em todas as listas, parado na rolagem horizontal (sticky). Nas linhas é uma célula vazia da mesma largura.
 */
const LARGURA_PAINEL = 28;

/**
 * Mover, ocultar e mudar a largura das colunas de uma tabela, guardado por usuário no servidor. `defs` precisa ser estável (constante do
 * módulo ou useMemo). Uso:
 *
 *   const tc = useColunasConfiguraveis("plannix.obras", COLUNAS);
 *   <table className={tc.classeTabela} style={tc.estiloTabela}>      // o ícone "Colunas" já vem no cabeçalho
 *     {tc.colgroup}
 *     <thead>{tc.cabecalho({ colunas, estado, valores })}</thead>
 *     <tbody>{linhas.map((l) => <tr key=...>{tc.celulas(l, ctx)}</tr>)}  // colSpan={tc.nColunas} (já conta a coluna do ícone)
 *
 * `classeEspaco`: classes da célula reservada de cada linha (ex.: a borda esquerda da linha aberta).
 */
export function useColunasConfiguraveis<T, C = undefined>(
  chave: string,
  defs: DefColuna<T, C>[],
  opcoes: {
    th?: string;
    td?: string;
    classeEspaco?: (linha: T, ctx: C) => string | undefined;
    /** Oferece "+ Coluna calculada" no painel (28/10/2026); as calculadas em si entram em `defs` (useTabelaLocal.defsCalculadas). */
    calculadas?: CalculadasDoPainel;
  } = {},
) {
  const padrao = useMemo(() => defs.map((d) => d.nome), [defs]);
  const fixas = useMemo(() => defs.filter((d) => d.fixa).map((d) => d.nome), [defs]);
  const titulos = useMemo(() => Object.fromEntries(defs.map((d) => [d.nome, d.titulo])), [defs]);
  const larguraPadrao = useMemo(() => Object.fromEntries(defs.map((d) => [d.nome, d.largura ?? LARGURA_SEM_PADRAO])), [defs]);
  const porNome = useMemo(() => new Map(defs.map((d) => [d.nome, d])), [defs]);
  const layout = useLayoutColunas(chave, padrao, fixas);
  const larg = useRedimensionarColunas(layout, larguraPadrao);
  const visiveis = layout.visiveis.map((n) => porNome.get(n)).filter((d): d is DefColuna<T, C> => !!d);
  const cortar = larg.larguras !== null;

  const cabecalho = ({
    colunas,
    estado = ESTADO_INERTE,
    valores,
  }: { colunas?: ColunaApi[] | undefined; estado?: EstadoColunas; valores?: (nome: string) => (termo: string) => Promise<RespostaValores> } = {}) => (
    <tr ref={larg.refCabecalho}>
      <th className={cn(TH, "sticky left-0 z-[1] w-7 min-w-7 max-w-7 p-0 text-center")}>
        <PainelColunas layout={layout} titulos={titulos} calculadas={opcoes.calculadas} />
      </th>
      {visiveis.map((d) => (
        <ThColuna
          key={d.nome}
          nome={d.nome}
          titulo={d.cabecalho ?? d.titulo}
          rotulo={d.titulo}
          direita={d.direita}
          className={cn(opcoes.th, d.centro && "text-center")}
          title={d.dica}
          formatarValor={d.formatarValor}
          semOrdenar={d.semOrdenar}
          colunas={colunas}
          estado={estado}
          carregarValores={valores?.(d.nome)}
          arrastar={layout.arrastar}
          redimensionar={larg.alca(d.nome)}
        />
      ))}
    </tr>
  );

  /** O que pedir de resumo: as colunas visíveis com função escolhida (na ordem da tela). */
  const pedidosResumo: PedidoResumo[] = visiveis.flatMap((d) => (layout.resumos[d.nome] ? [{ coluna: d.nome, funcao: layout.resumos[d.nome] }] : []));

  /**
   * Linha de resumo (para um <tfoot>): em cada coluna, o valor da função escolhida sobre TODAS as linhas do filtro e a escolha da função.
   * `colunas` = as mesmas do cabeçalho (o tipo de cada uma decide as funções); `resultado` = useResumoServidor ou resumirLinhas.
   */
  const rodape = ({
    colunas,
    resultado,
    carregando = false,
    erro,
  }: { colunas?: ColunaApi[] | undefined; resultado: ResultadoResumo | null; carregando?: boolean; erro?: string | null }) => (
    <tr className="border-t-2 border-border bg-surface-2">
      <td
        className="sticky left-0 z-[1] w-7 min-w-7 max-w-7 bg-surface-2 p-0 text-center font-mono text-[12px] text-muted"
        title={resultado ? `Resumo sobre ${resultado.linhas.toLocaleString("pt-BR")} linha(s): todas as do filtro, não só as da página` : "Resumo sobre todas as linhas do filtro"}
      >
        Σ
      </td>
      {visiveis.map((d) => {
        const funcao = layout.resumos[d.nome];
        return (
          <CelulaResumo
            key={d.nome}
            titulo={d.titulo}
            tipo={colunas?.find((c) => c.nome === d.nome)?.tipo}
            permitidas={d.resumos}
            funcao={funcao}
            onEscolher={(f) => layout.definirResumo(d.nome, f)}
            valor={funcao ? resultado?.valores[`${d.nome}:${funcao}`] : undefined}
            carregando={carregando}
            erro={erro}
            direita={d.direita}
            formatar={d.formatarResumo}
            aviso={d.avisoResumo}
          />
        );
      })}
    </tr>
  );

  const celulas = (linha: T, ctx: C) => [
    <td key="__colunas" aria-hidden className={cn("w-7 min-w-7 max-w-7 p-0", opcoes.classeEspaco?.(linha, ctx))} />,
    ...visiveis.map((d, i) => (
      <td
        key={d.nome}
        data-coluna={d.nome}
        className={cn(
          d.direita ? TD_DIR : TD,
          opcoes.td,
          d.centro && "text-center",
          typeof d.classe === "function" ? d.classe(linha, ctx, { primeira: i === 0, ultima: i === visiveis.length - 1 }) : d.classe,
          cortar && "overflow-hidden text-ellipsis",
        )}
        title={d.title?.(linha) ?? (cortar ? d.texto?.(linha) || undefined : undefined)}
      >
        {d.render(linha, ctx, cortar)}
      </td>
    )),
  ];

  return {
    layout,
    titulos,
    /** Colunas visíveis + a do ícone: é o colSpan de uma linha que ocupa a tabela inteira. */
    nColunas: visiveis.length + 1,
    cortar,
    /** Sem largura ajustada: layout automático, como sempre foi. Com ajuste: larguras fixas e texto cortado com "…". */
    classeTabela: cn("border-collapse", cortar ? "table-fixed" : "w-full"),
    estiloTabela: (larg.total ? { width: larg.total + LARGURA_PAINEL } : undefined) as CSSProperties | undefined,
    colgroup: cortar ? (
      <colgroup>
        <col style={{ width: LARGURA_PAINEL }} />
        {visiveis.map((d) => (
          <col key={d.nome} style={{ width: larg.larguras![d.nome] }} />
        ))}
      </colgroup>
    ) : null,
    cabecalho,
    celulas,
    pedidosResumo,
    rodape,
  };
}

/** Títulos das colunas para os chips de filtro e de ordem. */
export const titulosDe = <T, C>(defs: DefColuna<T, C>[]): Record<string, string> => Object.fromEntries(defs.map((d) => [d.nome, d.titulo]));
