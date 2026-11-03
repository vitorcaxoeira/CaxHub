// Filtro e ordenação POR COLUNA nas consultas SQL do módulo Integração Plannix (24/10/2026, pedido do Vitor), com os mesmos operadores do
// "Ver dados" (sync/filtroColunaLocal.ts) e a mesma ordenação em várias colunas (sync/ordemColuna.ts).
//
// As telas do Plannix usam SQL próprio (agregações, LATERAL, GROUP BY), não Prisma. Uma coluna é declarada UMA vez, com a expressão SQL
// dela escrita no servidor (`expr`, nunca vinda do cliente): o cliente só escolhe entre os NOMES declarados, e cada valor entra como
// parâmetro ($1...). Este módulo valida (reaproveitando validarFiltrosColuna e validarOrdem), traduz para SQL e devolve os valores mais
// frequentes de uma coluna (aba "Valores" do funil). Sem banco aqui: quem executa a consulta é a rota (exceto valoresDaColunaSql).
import { Prisma } from "@prisma/client";
import { ColunaFiltravel, FiltroColuna, OperadorColuna, TipoColuna, operadoresDaColuna, validarFiltrosColuna } from "../sync/filtroColunaLocal";
import { OrdemColuna, validarOrdem } from "../sync/ordemColuna";
import { type PedidoResumo, sqlDoResumo, validarPedidosResumo, valorDoResumo } from "../sync/resumoColuna";
import { colunasDaFormula, ErroFormula, formulaParaSql, type TipoColunaFormula, validarFormula } from "../formulas/formula";

export interface ColunaConsulta {
  /** Nome da coluna como a API a devolve (camelCase): é o que vai em `filtros` e `ordem`. */
  nome: string;
  tipo: Exclude<TipoColuna, "json">;
  /** Expressão SQL da coluna (confiável: escrita no servidor). */
  expr: Prisma.Sql;
  /** Não aceita nulo (sem "vazio"/"não vazio"). */
  obrigatoria?: boolean;
  /**
   * Agregada (count/sum de outra tabela): só entra no WHERE quando a consulta já tem o agregado calculado; a rota decide o caminho
   * (ver `usaAgregada`). Não tem aba "Valores".
   */
  agregada?: boolean;
  /** Sem aba "Valores" (ex.: subconsulta cara por linha). */
  semValores?: boolean;
  dominio?: { valor: string; rotulo: string }[];
}

/** Descrição da coluna que a API devolve à tela (operadores que o funil oferece, domínio, se tem aba Valores). */
export interface ColunaDescrita {
  nome: string;
  tipo: ColunaConsulta["tipo"];
  operadores: OperadorColuna[];
  agregada: boolean;
  semAbaValores: boolean;
  dominio?: { valor: string; rotulo: string }[];
}

export function descreverColunas(colunas: ColunaConsulta[]): ColunaDescrita[] {
  return colunas.map((c) => ({
    nome: c.nome,
    tipo: c.tipo,
    operadores: operadoresDaColuna({ tipo: c.tipo, obrigatoria: !!c.obrigatoria }),
    agregada: !!c.agregada,
    semAbaValores: !!(c.agregada || c.semValores),
    ...(c.dominio ? { dominio: c.dominio } : {}),
  }));
}

const PRISMA_POR_TIPO: Record<ColunaConsulta["tipo"], string> = { texto: "String", inteiro: "Int", decimal: "Decimal", data: "DateTime", booleano: "Boolean" };

function filtraveis(colunas: ColunaConsulta[]): ColunaFiltravel[] {
  return colunas.map((c) => ({ nome: c.nome, tipo: c.tipo, obrigatoria: !!c.obrigatoria, prisma: PRISMA_POR_TIPO[c.tipo] }));
}

export class ErroEntradaConsulta extends Error {}

/** Lê `filtros` (JSON) e `ordem` da query de uma rota e valida contra as colunas declaradas. Lança ErroEntradaConsulta em português (400). */
export function lerFiltrosEOrdemConsulta(colunas: ColunaConsulta[], query: Record<string, unknown>): { filtros: FiltroColuna[]; ordem: OrdemColuna[] } {
  try {
    const bruto = typeof query.filtros === "string" && query.filtros.trim() ? JSON.parse(query.filtros) : [];
    return { filtros: validarFiltrosColuna(filtraveis(colunas), bruto), ordem: validarOrdem(colunas.map((c) => c.nome), query.ordem) };
  } catch (erro) {
    throw new ErroEntradaConsulta(erro instanceof SyntaxError ? "Filtros inválidos." : erro instanceof Error ? erro.message : "Filtros inválidos.");
  }
}

/** Alguma coluna agregada entra nos filtros ou na ordem? A rota usa para escolher o caminho (rápido por página, ou agregado completo). */
export function usaAgregada(colunas: ColunaConsulta[], filtros: FiltroColuna[], ordem: OrdemColuna[]): boolean {
  const agregadas = new Set(colunas.filter((c) => c.agregada).map((c) => c.nome));
  return filtros.some((f) => agregadas.has(f.coluna)) || ordem.some((o) => agregadas.has(o.coluna));
}

// ---- tradução para SQL ---------------------------------------------------------------------------------------------------------

const DIA_MS = 86_400_000;
/** Dia (AAAA-MM-DD) como o intervalo [00:00, +1 dia) no horário de Brasília, igual ao resto do módulo (plannix/conversao.ts). */
const inicioDoDia = (v: string) => new Date(`${v}T00:00:00-03:00`);
const diaSeguinte = (v: string) => new Date(inicioDoDia(v).getTime() + DIA_MS);
/** Escapa % _ \ para o LIKE tratar o texto digitado como texto. */
const escaparLike = (v: string) => v.replace(/[\\%_]/g, "\\$&");

function condicao(c: ColunaConsulta, f: FiltroColuna): Prisma.Sql {
  const E = c.expr;
  const [v1, v2] = f.valores;
  const texto = c.tipo === "texto";
  const data = c.tipo === "data";
  const conv = (v: string): Prisma.Sql => {
    switch (c.tipo) {
      case "inteiro":
        return Prisma.sql`${Number(v)}`;
      case "decimal":
        return Prisma.sql`${v}::numeric`;
      case "booleano":
        return Prisma.sql`${v === "true"}`;
      default:
        return Prisma.sql`${v}`;
    }
  };
  switch (f.operador) {
    case "vazio":
      return texto ? Prisma.sql`(${E} IS NULL OR ${E} = '')` : Prisma.sql`${E} IS NULL`;
    case "não vazio":
      return texto ? Prisma.sql`(${E} IS NOT NULL AND ${E} <> '')` : Prisma.sql`${E} IS NOT NULL`;
    case "=":
      if (data) return Prisma.sql`(${E} >= ${inicioDoDia(v1)} AND ${E} < ${diaSeguinte(v1)})`;
      return texto ? Prisma.sql`lower(${E}) = lower(${v1})` : Prisma.sql`${E} = ${conv(v1)}`;
    case "≠":
      if (data) return Prisma.sql`(${E} < ${inicioDoDia(v1)} OR ${E} >= ${diaSeguinte(v1)})`;
      return texto ? Prisma.sql`lower(${E}) <> lower(${v1})` : Prisma.sql`${E} <> ${conv(v1)}`;
    case "IN":
      return texto
        ? Prisma.sql`lower(${E}) IN (${Prisma.join(f.valores.map((v) => Prisma.sql`lower(${v})`))})`
        : Prisma.sql`${E} IN (${Prisma.join(f.valores.map(conv))})`;
    case "≥":
      return data ? Prisma.sql`${E} >= ${inicioDoDia(v1)}` : Prisma.sql`${E} >= ${conv(v1)}`;
    case "≤":
      return data ? Prisma.sql`${E} < ${diaSeguinte(v1)}` : Prisma.sql`${E} <= ${conv(v1)}`;
    case "entre":
      return data ? Prisma.sql`(${E} >= ${inicioDoDia(v1)} AND ${E} < ${diaSeguinte(v2)})` : Prisma.sql`(${E} >= ${conv(v1)} AND ${E} <= ${conv(v2)})`;
    case "contém":
      return Prisma.sql`${E} ILIKE ${"%" + escaparLike(v1) + "%"}`;
    case "começa com":
      return Prisma.sql`${E} ILIKE ${escaparLike(v1) + "%"}`;
  }
}

/**
 * Condições SQL dos filtros, em E. `semColuna` deixa de fora o filtro de uma coluna (os valores dela). `agregadas`: incluir (true) só as
 * colunas agregadas, (false) só as comuns, ou todas (undefined).
 */
export function condicoesDosFiltros(colunas: ColunaConsulta[], filtros: FiltroColuna[], opcoes: { semColuna?: string; agregadas?: boolean } = {}): Prisma.Sql[] {
  return filtros.flatMap((f) => {
    const c = colunas.find((x) => x.nome === f.coluna);
    if (!c || f.coluna === opcoes.semColuna) return [];
    if (opcoes.agregadas !== undefined && !!c.agregada !== opcoes.agregadas) return [];
    return [condicao(c, f)];
  });
}

/** `ORDER BY` dos critérios da tela (nulo por último) e, no fim, o desempate/ordem padrão da tela. Sempre devolve ao menos o `padrao`. */
export function ordenacaoSql(colunas: ColunaConsulta[], ordem: OrdemColuna[], padrao: Prisma.Sql): Prisma.Sql {
  const criterios = ordem.flatMap((o) => {
    const c = colunas.find((x) => x.nome === o.coluna);
    return c ? [Prisma.sql`${c.expr} ${o.direcao === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`} NULLS LAST`] : [];
  });
  return Prisma.join([...criterios, padrao], ", ");
}

// ---- valores de uma coluna -----------------------------------------------------------------------------------------------------

export interface ValoresSql {
  coluna: string;
  valores: { valor: unknown; quantidade: number }[];
  temMais: boolean;
}

const MAX_VALORES = 200;

/** Quem executa a consulta (o `prisma.$queryRaw` da rota, injetado para o módulo não depender do banco). */
export type ExecutarSql = (sql: Prisma.Sql) => Promise<Record<string, unknown>[]>;

function simples(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object" && Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toNumber();
  return v;
}

/**
 * Valores mais frequentes de UMA coluna comum (aba "Valores" do funil), dentro do recorte da tela: `de` é o FROM/JOINs, `base` as condições
 * que a tela sempre aplica, e os filtros de coluna entram em E, menos o da própria coluna (como no Excel, para dar para trocar a seleção).
 * Filtros de coluna agregada ficam de fora (não dá para aplicá-los antes do agrupamento). `contagem` é o que se conta (padrão count(*)).
 */
export async function valoresDaColunaSql(
  executar: ExecutarSql,
  colunas: ColunaConsulta[],
  coluna: string,
  args: { de: Prisma.Sql; base: Prisma.Sql[]; filtros: FiltroColuna[]; termo: string; contagem?: Prisma.Sql; /** `WITH ...` que a consulta precisa na frente (ex.: o universo de produtos do Acompanhamento de Compra). */ com?: Prisma.Sql },
): Promise<ValoresSql> {
  const c = colunas.find((x) => x.nome === coluna);
  if (!c || c.agregada || c.semValores) throw new ErroEntradaConsulta(`A coluna "${coluna}" não tem lista de valores.`);
  const condicoes = [...args.base, ...condicoesDosFiltros(colunas, args.filtros, { semColuna: coluna, agregadas: false })];
  const termo = args.termo.trim();
  if (termo) {
    if (c.tipo === "texto") condicoes.push(Prisma.sql`${c.expr} ILIKE ${"%" + escaparLike(termo) + "%"}`);
    else if (c.tipo === "inteiro" && /^-?\d{1,9}$/.test(termo)) condicoes.push(Prisma.sql`${c.expr} = ${Number(termo)}`);
    else if (c.tipo === "decimal" && /^-?\d+(\.\d+)?$/.test(termo)) condicoes.push(Prisma.sql`${c.expr} = ${termo}::numeric`);
    else if (c.tipo === "data") condicoes.push(Prisma.sql`to_char(${c.expr} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') LIKE ${"%" + escaparLike(termo) + "%"}`);
    else condicoes.push(Prisma.sql`FALSE`); // termo que não casa com o tipo da coluna: nenhum valor
  }
  const onde = condicoes.length > 0 ? Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}` : Prisma.empty;
  // Um a mais que o teto, só para saber se há mais. `GROUP BY 1`: a expressão da coluna pode ter parâmetros ligados (ex.: o status do item de NF),
  // e repetida no GROUP BY ela viraria outro `$n`, que o Postgres não reconhece como a mesma expressão do SELECT.
  const linhas = await executar(Prisma.sql`
    ${args.com ?? Prisma.empty}
    SELECT ${c.expr} AS valor, ${args.contagem ?? Prisma.sql`count(*)`} AS quantidade
      ${args.de} ${onde}
     GROUP BY 1 ORDER BY quantidade DESC, valor LIMIT ${MAX_VALORES + 1}`);
  return {
    coluna,
    valores: linhas.slice(0, MAX_VALORES).map((l) => ({ valor: simples(l.valor), quantidade: Number(simples(l.quantidade)) })),
    temMais: linhas.length > MAX_VALORES,
  };
}

// ---- resumo por coluna (rodapé) -------------------------------------------------------------------------------------------------

/** Pedidos de resumo da query (`resumo`, JSON `[{coluna, funcao}]`), conferidos contra as colunas declaradas. ErroEntradaConsulta (400). */
export function lerResumoConsulta(colunas: ColunaConsulta[], query: Record<string, unknown>): PedidoResumo[] {
  try {
    const bruto = typeof query.resumo === "string" && query.resumo.trim() ? JSON.parse(query.resumo) : [];
    return validarPedidosResumo(colunas, bruto);
  } catch (erro) {
    throw new ErroEntradaConsulta(erro instanceof SyntaxError ? "Resumo inválido." : erro instanceof Error ? erro.message : "Resumo inválido.");
  }
}

/**
 * SQL do resumo sobre TODAS as linhas do filtro (28/10/2026). `montar(selecao)` devolve a consulta da própria lista — mesmo FROM, WHERE,
 * GROUP BY e HAVING, sem ORDER BY nem LIMIT — selecionando `selecao` (a expressão de cada coluna pedida, como r0, r1...). Por fora, uma
 * linha só: quantas linhas e a função de cada pedido (a0, a1...). Funciona para lista simples e agrupada (a expressão agregada da coluna é
 * calculada por grupo lá dentro e resumida aqui fora).
 */
export function resumoSql(colunas: ColunaConsulta[], pedidos: PedidoResumo[], montar: (selecao: Prisma.Sql) => Prisma.Sql): Prisma.Sql {
  const nomes = [...new Set(pedidos.map((p) => p.coluna))];
  const porNome = new Map(colunas.map((c) => [c.nome, c]));
  const selecao = nomes.length
    ? Prisma.join(nomes.map((n, i) => Prisma.sql`${porNome.get(n)!.expr} AS ${Prisma.raw(`r${i}`)}`))
    : Prisma.sql`1 AS r`;
  const agregados = pedidos.map((p, j) => {
    const alvo = Prisma.raw(`t.r${nomes.indexOf(p.coluna)}`);
    return Prisma.sql`, ${sqlDoResumo(p.funcao, alvo, porNome.get(p.coluna)!.tipo)} AS ${Prisma.raw(`a${j}`)}`;
  });
  return Prisma.sql`SELECT count(*) AS linhas ${agregados.length ? Prisma.join(agregados, " ") : Prisma.empty} FROM (${montar(selecao)}) t`;
}

/** Linha do resumoSql → resposta da rota: `{ linhas, valores: { "coluna:funcao": valor } }`. */
export function respostaDoResumo(linha: Record<string, unknown> | undefined, pedidos: PedidoResumo[]): { linhas: number; valores: Record<string, number | string | null> } {
  return {
    linhas: Number(valorDoResumo(linha?.linhas) ?? 0),
    valores: Object.fromEntries(pedidos.map((p, j) => [`${p.coluna}:${p.funcao}`, valorDoResumo(linha?.[`a${j}`])])),
  };
}

// ---- colunas calculadas por fórmula (28/10/2026) ----------------------------------------------------------------------------------

const NOME_CALCULADA = /^calc_\d{1,9}$/;
export const ehCalculada = (nome: string) => NOME_CALCULADA.test(nome);
const MAX_CALCULADAS = 20;

/**
 * Colunas calculadas da tela (`calculadas`, JSON `[{nome: "calc_<id>", arvore}]`) viram colunas da consulta: a `expr` é a fórmula traduzida
 * para SQL com a expressão confiável de cada coluna citada (formulas/formula.ts); fórmula com coluna agregada vira agregada (HAVING).
 * Fórmula que não vale nesta lista (coluna que saiu, tipo errado) NÃO derruba a lista: fica de fora e volta em `problemas` (a tela mostra o
 * aviso na coluna). `totais` = TOTAL([x]) já calculado (sem ele, TOTAL dá vazio); `totalDe` = colunas que as fórmulas válidas pedem em TOTAL.
 */
export function lerCalculadasConsulta(
  base: ColunaConsulta[],
  query: Record<string, unknown>,
  totais: Map<string, number | null> = new Map(),
): { colunas: ColunaConsulta[]; problemas: Record<string, string>; totalDe: string[] } {
  let bruto: unknown = [];
  try {
    bruto = typeof query.calculadas === "string" && query.calculadas.trim() ? JSON.parse(query.calculadas) : [];
  } catch {
    throw new ErroEntradaConsulta("Colunas calculadas inválidas.");
  }
  if (!Array.isArray(bruto) || bruto.length > MAX_CALCULADAS) throw new ErroEntradaConsulta("Colunas calculadas inválidas.");
  const porNome = new Map(base.map((c) => [c.nome, c]));
  const tipos = new Map<string, TipoColunaFormula>(base.map((c) => [c.nome, c.tipo]));
  const problemas: Record<string, string> = {};
  const totalDe = new Set<string>();
  const calculadas: ColunaConsulta[] = [];
  for (const item of bruto) {
    const nome = item && typeof item === "object" ? (item as Record<string, unknown>).nome : undefined;
    if (typeof nome !== "string" || !ehCalculada(nome) || porNome.has(nome) || calculadas.some((c) => c.nome === nome)) throw new ErroEntradaConsulta("Colunas calculadas inválidas.");
    try {
      const arvore = validarFormula((item as Record<string, unknown>).arvore, tipos);
      colunasDaFormula(arvore, true).forEach((n) => totalDe.add(n));
      calculadas.push({
        nome,
        tipo: "decimal",
        expr: formulaParaSql(arvore, (n) => porNome.get(n)!.expr, tipos, totais),
        agregada: colunasDaFormula(arvore).some((n) => porNome.get(n)?.agregada),
        semValores: true,
      });
    } catch (erro) {
      if (!(erro instanceof ErroFormula)) throw erro;
      problemas[nome] = erro.message;
    }
  }
  return { colunas: [...base, ...calculadas], problemas, totalDe: [...totalDe] };
}

/** `, expr AS "calc_1", ...` das calculadas, para o SELECT da lista (vazio sem calculadas). */
export function selecaoCalculadas(colunas: ColunaConsulta[]): Prisma.Sql {
  const calc = colunas.filter((c) => ehCalculada(c.nome));
  return calc.length ? Prisma.sql`, ${Prisma.join(calc.map((c) => Prisma.sql`${c.expr} AS ${Prisma.raw(`"${c.nome}"`)}`))}` : Prisma.empty;
}

/**
 * Colunas da lista com as calculadas da tela, e os filtros e a ordem já lidos contra elas (a antiga `prepararColunas` do plannix.ts, que
 * passou para cá em 29/10/2026 para a tela Acompanhamento de Compra reusar). Fórmula com TOTAL([x]): o total é calculado antes, sobre as
 * linhas que passam nos filtros das colunas COMUNS (`montar(comuns)` = a consulta da própria lista com esses filtros; os das calculadas
 * ficam de fora, senão o total dependeria do filtro que depende dele), e entra como número na expressão.
 *
 * `mostraCalculadas` falso: a consulta não mostra o valor das calculadas (ex.: KPIs do Consumo); o TOTAL só é calculado se uma calculada
 * filtra ou ordena.
 */
export async function prepararColunasConsulta(
  executar: ExecutarSql,
  base: ColunaConsulta[],
  q: Record<string, unknown>,
  montar: (comuns: FiltroColuna[]) => (sel: Prisma.Sql) => Prisma.Sql,
  mostraCalculadas = true,
): Promise<{ colunas: ColunaConsulta[]; problemas: Record<string, string>; filtros: FiltroColuna[]; ordem: OrdemColuna[] }> {
  const pre = lerCalculadasConsulta(base, q);
  const { filtros, ordem } = lerFiltrosEOrdemConsulta(pre.colunas, q);
  const usaCalculada = filtros.some((f) => ehCalculada(f.coluna)) || ordem.some((o) => ehCalculada(o.coluna));
  if (!pre.totalDe.length || (!mostraCalculadas && !usaCalculada)) return { colunas: pre.colunas, problemas: pre.problemas, filtros, ordem };
  const comuns = filtros.filter((f) => !ehCalculada(f.coluna));
  const pedidos = pre.totalDe.map((coluna) => ({ coluna, funcao: "soma" as const }));
  const [linha] = await executar(resumoSql(base, pedidos, montar(comuns)));
  const valores = respostaDoResumo(linha, pedidos).valores;
  const totais = new Map(pre.totalDe.map((n): [string, number | null] => [n, typeof valores[`${n}:soma`] === "number" ? (valores[`${n}:soma`] as number) : null]));
  const fim = lerCalculadasConsulta(base, q, totais);
  return { colunas: fim.colunas, problemas: fim.problemas, filtros, ordem };
}
