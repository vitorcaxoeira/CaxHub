// Indicadores configuráveis da Rentabilidade (17/11/2026) — lógica PURA (sem banco), com teste.
// Regra do Vitor: nenhuma conta fixa no código. Aqui só existe o MECANISMO (selecionar contas, avaliar
// fórmulas); quais contas e quais fórmulas formam cada indicador vem da configuração gravada pela tela.
import { avaliarFormula } from "../../consultas/local/avaliarFormula";
import { colunasDaFormula, ErroFormula, validarFormula, type No, type TipoColunaFormula } from "../../formulas/formula";

export const TIPOS_INDICADOR = ["contas", "formula", "sistema"] as const;
export type TipoIndicador = (typeof TIPOS_INDICADOR)[number];
export const BASES = ["realizado", "orcado"] as const;
export type BaseIndicador = (typeof BASES)[number];
export const NATUREZAS = ["ambos", "debito", "credito"] as const;
export type NaturezaIndicador = (typeof NATUREZAS)[number];
export const FORMATOS = ["moeda", "percentual", "horas", "numero"] as const;
export type FormatoIndicador = (typeof FORMATOS)[number];

/** Campos que o SISTEMA calcula por centro de custo (não são soma de contas). */
export const FONTES_SISTEMA = {
  HorasKyria: "Horas apontadas no Kyria, pelo CC do cliente do ticket",
  HorasRat: "Horas de RAT (consultoria), pelo CC do projeto",
  // Custo REAL (18/11/2026): horas × o custo-hora do consultor no MÊS da hora (consultor_custo_hora, calculado pelo job de Custo-hora real:
  // folha + encargos do CLT, contrato do PJ ou valor-hora manual). Hora sem consultor vinculado ou sem custo no mês não entra e vira aviso.
  CustoKyria: "Custo real das horas do Kyria (horas × custo-hora do consultor no mês), pelo CC do cliente do ticket",
  CustoRat: "Custo real das horas de RAT (horas × custo-hora do consultor no mês), pelo CC do projeto",
  CustoReal: "Custo real total das horas (Kyria + RAT), pelo CC",
} as const;
export type FonteSistema = keyof typeof FONTES_SISTEMA;

export interface RegraConta {
  codemp: number;
  ctared: number;
  acao: "incluir" | "excluir";
}

export interface IndicadorEntrada {
  codigo: string;
  rotulo: string;
  tipo: TipoIndicador;
  base: BaseIndicador;
  natureza: NaturezaIndicador;
  formato: FormatoIndicador;
  formulaTexto: string | null;
  formulaArvore: No | null;
  fonte: FonteSistema | null;
  ordem: number;
  visivel: boolean;
  contas: RegraConta[];
}

/** Indicador já gravado (com id) — o que o cálculo recebe. */
export type IndicadorConfigurado = IndicadorEntrada & { id: number };

const CODIGO = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_ROTULO = 80;
const MAX_FORMULA = 500;
const MAX_CONTAS = 2000;

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const naLista = <T extends string>(lista: readonly T[], v: unknown): v is T => typeof v === "string" && (lista as readonly string[]).includes(v);

/**
 * Confere o corpo de um indicador (POST/PUT e cada item da importação). `outrosCodigos` = códigos dos DEMAIS indicadores (os que a
 * fórmula pode citar). Devolve a entrada normalizada ou a mensagem em português do que está errado.
 */
export function validarIndicador(corpo: unknown, outrosCodigos: Set<string>): { ok: true; valor: IndicadorEntrada } | { ok: false; erro: string } {
  if (!ehObjeto(corpo)) return { ok: false, erro: "Indicador inválido" };
  const { codigo, rotulo, tipo, base = "realizado", natureza = "ambos", formato = "moeda", formulaTexto = null, formulaArvore = null, fonte = null, ordem = 0, visivel = true, contas = [] } = corpo;

  if (typeof codigo !== "string" || !CODIGO.test(codigo)) return { ok: false, erro: "O código começa por letra e usa só letras, números e _ (até 40 caracteres)" };
  if (outrosCodigos.has(codigo)) return { ok: false, erro: `Já existe um indicador com o código ${codigo}` };
  if (typeof rotulo !== "string" || !rotulo.trim() || rotulo.trim().length > MAX_ROTULO) return { ok: false, erro: `Dê um nome de até ${MAX_ROTULO} caracteres` };
  if (!naLista(TIPOS_INDICADOR, tipo)) return { ok: false, erro: "Tipo inválido (contas, formula ou sistema)" };
  if (!naLista(BASES, base)) return { ok: false, erro: "Base inválida (realizado ou orcado)" };
  if (!naLista(NATUREZAS, natureza)) return { ok: false, erro: "Natureza inválida (ambos, debito ou credito)" };
  if (!naLista(FORMATOS, formato)) return { ok: false, erro: "Formato inválido" };
  if (typeof ordem !== "number" || !Number.isInteger(ordem) || ordem < 0 || ordem > 10_000) return { ok: false, erro: "Ordem inválida" };
  if (typeof visivel !== "boolean") return { ok: false, erro: "Visível inválido" };

  let regras: RegraConta[] = [];
  let arvore: No | null = null;
  let texto: string | null = null;
  let fonteOk: FonteSistema | null = null;

  if (tipo === "contas") {
    if (natureza !== "ambos" && base === "orcado") return { ok: false, erro: "O orçado não tem débito/crédito: use natureza ambos" };
    if (!Array.isArray(contas) || contas.length > MAX_CONTAS) return { ok: false, erro: `Lista de contas inválida (máximo de ${MAX_CONTAS})` };
    const vistas = new Set<string>();
    for (const c of contas) {
      if (!ehObjeto(c) || !Number.isInteger(c.codemp) || !Number.isInteger(c.ctared) || (c.acao !== "incluir" && c.acao !== "excluir")) return { ok: false, erro: "Conta inválida na lista (codemp, ctared e acao incluir/excluir)" };
      const chave = `${c.codemp}:${c.ctared}`;
      if (vistas.has(chave)) return { ok: false, erro: `A conta ${c.ctared} aparece duas vezes na lista` };
      vistas.add(chave);
      regras.push({ codemp: c.codemp as number, ctared: c.ctared as number, acao: c.acao });
    }
  } else if (tipo === "formula") {
    if (typeof formulaTexto !== "string" || !formulaTexto.trim() || formulaTexto.length > MAX_FORMULA) return { ok: false, erro: `Fórmula vazia ou longa demais (máximo de ${MAX_FORMULA} caracteres)` };
    const tipos = new Map<string, TipoColunaFormula>([...outrosCodigos].map((c) => [c, "decimal"]));
    try {
      arvore = validarFormula(formulaArvore, tipos);
    } catch (e) {
      return { ok: false, erro: e instanceof ErroFormula ? e.message : "Fórmula inválida" };
    }
    texto = formulaTexto.trim();
  } else {
    if (!naLista(Object.keys(FONTES_SISTEMA) as FonteSistema[], fonte)) return { ok: false, erro: "Escolha o campo do sistema (horas ou custo real)" };
    fonteOk = fonte;
  }

  return {
    ok: true,
    valor: {
      codigo,
      rotulo: rotulo.trim(),
      tipo,
      base: tipo === "contas" ? base : "realizado",
      natureza: tipo === "contas" ? natureza : "ambos",
      formato,
      formulaTexto: texto,
      formulaArvore: arvore,
      fonte: fonteOk,
      ordem,
      visivel,
      contas: regras,
    },
  };
}

// ---------- seleção de contas ----------

export interface ContaDoPlano {
  codemp: number;
  ctared: number;
  paiCtared: number | null;
  anasin: string | null;
}

/**
 * Contas ANALÍTICAS que o indicador soma. Conta de qualquer nível: a sintética vale por todas as analíticas abaixo dela (pelo pai da conta
 * no plano), e `excluir` tira a conta e tudo abaixo dela do que foi incluído — a exclusão sempre ganha da inclusão.
 */
export function contasSelecionadas(regras: RegraConta[], plano: ContaDoPlano[]): Set<string> {
  const filhos = new Map<string, ContaDoPlano[]>();
  const porChave = new Map<string, ContaDoPlano>();
  for (const c of plano) {
    porChave.set(`${c.codemp}:${c.ctared}`, c);
    if (c.paiCtared != null) {
      const k = `${c.codemp}:${c.paiCtared}`;
      const l = filhos.get(k);
      if (l) l.push(c);
      else filhos.set(k, [c]);
    }
  }
  const descendentes = (raiz: ContaDoPlano): ContaDoPlano[] => {
    const saida: ContaDoPlano[] = [];
    const pilha = [raiz];
    const vistos = new Set<string>();
    while (pilha.length) {
      const atual = pilha.pop()!;
      const k = `${atual.codemp}:${atual.ctared}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      saida.push(atual);
      for (const f of filhos.get(k) ?? []) pilha.push(f);
    }
    return saida;
  };
  const analiticas = (r: RegraConta) => {
    const raiz = porChave.get(`${r.codemp}:${r.ctared}`);
    return raiz ? descendentes(raiz).filter((c) => c.anasin === "A") : [];
  };
  const incluidas = new Set<string>();
  for (const r of regras) if (r.acao === "incluir") for (const c of analiticas(r)) incluidas.add(`${c.codemp}:${c.ctared}`);
  for (const r of regras) if (r.acao === "excluir") for (const c of analiticas(r)) incluidas.delete(`${c.codemp}:${c.ctared}`);
  return incluidas;
}

// ---------- ordem de cálculo ----------

/** Códigos das fórmulas na ordem em que podem ser calculadas (as que dependem de outra vêm depois). Lança ErroFormula no ciclo. */
export function ordemDeCalculo(indicadores: { codigo: string; tipo: TipoIndicador; formulaArvore: No | null }[]): string[] {
  const formulas = new Map(indicadores.filter((i) => i.tipo === "formula" && i.formulaArvore).map((i) => [i.codigo, i.formulaArvore as No]));
  const ordem: string[] = [];
  const estado = new Map<string, 1 | 2>(); // 1 = visitando, 2 = pronto
  const visitar = (codigo: string, caminho: string[]) => {
    if (estado.get(codigo) === 2) return;
    if (estado.get(codigo) === 1) throw new ErroFormula(`As fórmulas se citam em círculo: ${[...caminho, codigo].join(" → ")}`);
    estado.set(codigo, 1);
    for (const dep of colunasDaFormula(formulas.get(codigo)!)) if (formulas.has(dep)) visitar(dep, [...caminho, codigo]);
    estado.set(codigo, 2);
    ordem.push(codigo);
  };
  for (const codigo of formulas.keys()) visitar(codigo, []);
  return ordem;
}

/** Indicadores que citam `codigo` em alguma fórmula. */
export function quemUsa(codigo: string, indicadores: { codigo: string; tipo: TipoIndicador; formulaArvore: No | null }[]): string[] {
  return indicadores.filter((i) => i.tipo === "formula" && i.formulaArvore && i.codigo !== codigo && colunasDaFormula(i.formulaArvore).includes(codigo)).map((i) => i.codigo);
}

// ---------- cálculo ----------

export type ValoresLinha = Record<string, number | null>;

export interface ResultadoCalculo {
  porLinha: Map<string, ValoresLinha>;
  total: ValoresLinha;
}

/**
 * Valores de cada indicador em cada linha (centro de custo) e no total. `bases` = valor já somado por (indicador de contas/sistema, linha).
 * Contas e sistema somam; fórmulas são avaliadas na ordem de dependência. `TOTAL(x)` usa a linha de total: o total das linhas para contas e
 * sistema e, para uma fórmula, a fórmula avaliada sobre esses totais (uma razão como Margem % não se soma).
 */
export function calcularIndicadores(
  indicadores: { codigo: string; tipo: TipoIndicador; formulaArvore: No | null }[],
  bases: Map<string, Map<string, number>>,
  linhas: string[]
): ResultadoCalculo {
  const tipos = new Map<string, TipoColunaFormula>(indicadores.map((i) => [i.codigo, "decimal"]));
  const formulas = ordemDeCalculo(indicadores);
  const arvores = new Map(indicadores.filter((i) => i.formulaArvore).map((i) => [i.codigo, i.formulaArvore as No]));
  const simples = indicadores.filter((i) => i.tipo !== "formula");

  const total: ValoresLinha = {};
  for (const i of simples) {
    let soma = 0;
    for (const l of linhas) soma += bases.get(i.codigo)?.get(l) ?? 0;
    total[i.codigo] = arredondar(soma);
  }
  for (const codigo of formulas) total[codigo] = avaliarFormula(arvores.get(codigo)!, (n) => total[n] ?? null, tipos, total);

  const porLinha = new Map<string, ValoresLinha>();
  for (const l of linhas) {
    const v: ValoresLinha = {};
    for (const i of simples) v[i.codigo] = arredondar(bases.get(i.codigo)?.get(l) ?? 0);
    for (const codigo of formulas) v[codigo] = avaliarFormula(arvores.get(codigo)!, (n) => v[n] ?? null, tipos, total);
    porLinha.set(l, v);
  }
  return { porLinha, total };
}

const arredondar = (x: number) => Math.round(x * 100) / 100;

// ---------- grupos (aba Por Grupo, 24/11/2026) ----------

/** Ordem dos grupos (Conta Paralela) na aba: alfabética, com "" (sem grupo) sempre por último. */
export function ordenarGrupos(grupos: string[]): string[] {
  return [...new Set(grupos)].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "pt-BR")));
}

/** Como o grupo aparece na tela: "" vira "Sem grupo". */
export const rotuloGrupo = (grupo: string): string => (grupo === "" ? "Sem grupo" : grupo);

// ---------- origem do valor (24/11/2026) ----------

/** Um indicador de contas (realizado) que compõe o valor de uma coluna, e o sinal em que entra (-1 quando é subtraído numa fórmula). */
export interface ComponenteDeOrigem {
  codigo: string;
  sinal: 1 | -1;
}

/** A fórmula como soma/subtração de colunas (`a + b - c`): cada coluna com o seu sinal. Qualquer outra operação (`*`, `/`, funções, número) devolve null. */
function combinacaoLinear(no: No): { nome: string; sinal: 1 | -1 }[] | null {
  switch (no.t) {
    case "col":
      return [{ nome: no.nome, sinal: 1 }];
    case "neg": {
      const a = combinacaoLinear(no.a);
      return a && a.map((x) => ({ nome: x.nome, sinal: (x.sinal * -1) as 1 | -1 }));
    }
    case "bin": {
      if (no.op !== "+" && no.op !== "-") return null;
      const a = combinacaoLinear(no.a);
      const b = combinacaoLinear(no.b);
      if (!a || !b) return null;
      return [...a, ...(no.op === "-" ? b.map((x) => ({ nome: x.nome, sinal: (x.sinal * -1) as 1 | -1 })) : b)];
    }
    default:
      return null;
  }
}

/** O indicador "folha" de uma origem linear: de CONTAS (realizado; lançamentos) ou do SISTEMA (horas e custo das horas). */
type TipoFolha = "contas" | "sistema";

/**
 * Os indicadores "folha" que formam o valor de uma coluna, com o sinal: o indicador vale por si se for da folha pedida; uma fórmula só se for soma/subtração de colunas
 * que, no fim, são todas dessa folha (fórmulas citadas por ela são abertas). Qualquer outra coisa devolve `null`.
 */
function origemLinear(codigo: string, indicadores: IndicadorConfigurado[], folha: TipoFolha, profundidade = 0): ComponenteDeOrigem[] | null {
  if (profundidade > 10) return null;
  const i = indicadores.find((x) => x.codigo === codigo);
  if (!i) return null;
  if (i.tipo === folha) return folha === "contas" && i.base !== "realizado" ? null : [{ codigo: i.codigo, sinal: 1 }];
  if (i.tipo !== "formula" || !i.formulaArvore) return null;
  const termos = combinacaoLinear(i.formulaArvore);
  if (!termos || termos.length === 0) return null;
  const saida: ComponenteDeOrigem[] = [];
  for (const t of termos) {
    const sub = origemLinear(t.nome, indicadores, folha, profundidade + 1);
    if (!sub) return null;
    for (const s of sub) saida.push({ codigo: s.codigo, sinal: (s.sinal * t.sinal) as 1 | -1 });
  }
  return saida;
}

/**
 * De onde vem o valor de uma coluna, em lançamentos: os indicadores de CONTAS (base realizado) que o formam, com o sinal. Indicador de contas vale por si;
 * fórmula só se for soma/subtração de colunas que, no fim, são indicadores de contas. Qualquer outra coisa — razão, percentual, horas do sistema, base orçada —
 * não tem origem em lançamentos: `null` (ver `classificarOrigem` para os demais tipos).
 */
export function origemDoIndicador(codigo: string, indicadores: IndicadorConfigurado[]): ComponenteDeOrigem[] | null {
  return origemLinear(codigo, indicadores, "contas");
}

/** O que o modal de origem de uma coluna mostra (fase 2, 24/11/2026). */
export type OrigemClassificada =
  /** Soma/subtração de indicadores de contas: a lista de lançamentos contábeis. */
  | { tipo: "lancamentos"; componentes: ComponenteDeOrigem[] }
  /** Soma/subtração de indicadores do sistema (horas Kyria/RAT e o custo delas): a lista de apontamentos. */
  | { tipo: "horas"; componentes: ComponenteDeOrigem[] }
  /** Qualquer outra conta (ABS, ×, ÷, TOTAL): a composição — cada coluna citada, com o valor da linha e, nas de dentro de TOTAL(), o do total do recorte. */
  | { tipo: "formula"; referencias: { codigo: string; emTotal: boolean }[] };

/**
 * Como se chega ao valor de uma coluna: lançamentos (contas), apontamentos (horas e custo do sistema) ou a composição de uma fórmula. `null` quando não há o que
 * mostrar (indicador de contas de base orçada, sem fórmula, ou código desconhecido).
 */
export function classificarOrigem(codigo: string, indicadores: IndicadorConfigurado[]): OrigemClassificada | null {
  const i = indicadores.find((x) => x.codigo === codigo);
  if (!i) return null;
  const lancamentos = origemLinear(codigo, indicadores, "contas");
  if (lancamentos) return { tipo: "lancamentos", componentes: lancamentos };
  const horas = origemLinear(codigo, indicadores, "sistema");
  if (horas) return { tipo: "horas", componentes: horas };
  if (i.tipo === "formula" && i.formulaArvore) {
    const emTotal = new Set(colunasDaFormula(i.formulaArvore, true));
    return { tipo: "formula", referencias: colunasDaFormula(i.formulaArvore).map((c) => ({ codigo: c, emTotal: emTotal.has(c) })) };
  }
  return null;
}

// ---------- diagnóstico ----------

/** Contas analíticas com movimento que nenhum indicador de soma pega. */
export function contasSemIndicador(comMovimento: string[], selecionadas: Map<string, Set<string>>): string[] {
  const cobertas = new Set<string>();
  for (const s of selecionadas.values()) for (const c of s) cobertas.add(c);
  return comMovimento.filter((c) => !cobertas.has(c));
}

/** Contas pegas por mais de um indicador de soma, com quais indicadores (é o risco de contar em dobro que o BI não avisa). */
export function contasEmMaisDeUm(selecionadas: Map<string, Set<string>>): { conta: string; indicadores: string[] }[] {
  const por = new Map<string, string[]>();
  for (const [codigo, contas] of selecionadas) for (const c of contas) por.set(c, [...(por.get(c) ?? []), codigo]);
  return [...por.entries()].filter(([, l]) => l.length > 1).map(([conta, indicadores]) => ({ conta, indicadores }));
}
