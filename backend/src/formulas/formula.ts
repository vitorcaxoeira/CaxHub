// Colunas calculadas por fórmula no servidor (28/10/2026). A tela lê o texto da fórmula e manda a ÁRVORE (frontend/src/lib/formulas/
// formula.ts, o único leitor de texto); aqui a árvore é conferida como entrada não confiável — só os nós conhecidos, só colunas declaradas
// da lista, limites de tamanho, MESMAS regras de tipo da tela — e traduzida para SQL com a expressão confiável de cada coluna (escrita no
// servidor) e os números como parâmetros. Mesma semântica do cálculo da tela: vazio contamina, divisão por zero dá vazio, MIN/MAX ignoram
// vazios, condição vazia vai para o "senão", potência fora do domínio dá vazio (no Postgres seria erro).
import { Prisma } from "@prisma/client";

export type TipoColunaFormula = "texto" | "inteiro" | "decimal" | "data" | "booleano";
export type OpBinario = "+" | "-" | "*" | "/" | "^";
export type OpComparacao = "=" | "<>" | ">" | "<" | ">=" | "<=";
export type NomeFuncao = "ABS" | "ARRED" | "MIN" | "MAX" | "SE" | "SEVAZIO" | "DIAS" | "TOTAL" | "E" | "OU";

export type No =
  | { t: "num"; v: number }
  | { t: "col"; nome: string }
  | { t: "neg"; a: No }
  | { t: "bin"; op: OpBinario; a: No; b: No }
  | { t: "cmp"; op: OpComparacao; a: No; b: No }
  | { t: "fn"; nome: NomeFuncao; args: No[] };

type TipoNo = "numero" | "data" | "logico";

export const LIMITE_NOS = 200;
export const LIMITE_PROFUNDIDADE = 30;
export const LIMITE_EXPOENTE = 100;
export const LIMITE_CASAS_ARRED = 6;

export class ErroFormula extends Error {}

const OPS_BIN = new Set<string>(["+", "-", "*", "/", "^"]);
const OPS_CMP = new Set<string>(["=", "<>", ">", "<", ">=", "<="]);
const FUNCOES = new Set<string>(["ABS", "ARRED", "MIN", "MAX", "SE", "SEVAZIO", "DIAS", "TOTAL", "E", "OU"]);

/** Nome técnico de coluna (camelCase, ou calc_<id> de outra calculada). */
const NOME_COLUNA = /^[A-Za-z0-9_]{1,60}$/;

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const chavesExatas = (o: Record<string, unknown>, chaves: string[]) => Object.keys(o).length === chaves.length && chaves.every((k) => k in o);

/** Confere a ESTRUTURA da árvore vinda da tela (nada além dos nós conhecidos, com as chaves exatas). Não confere tipos. */
function estrutura(bruto: unknown, contagem: { nos: number }, profundidade: number): No {
  if (profundidade > LIMITE_PROFUNDIDADE) throw new ErroFormula("Fórmula aninhada demais");
  if (++contagem.nos > LIMITE_NOS) throw new ErroFormula("Fórmula grande demais");
  if (!ehObjeto(bruto)) throw new ErroFormula("Fórmula inválida");
  const p = profundidade + 1;
  switch (bruto.t) {
    case "num":
      if (!chavesExatas(bruto, ["t", "v"]) || typeof bruto.v !== "number" || !Number.isFinite(bruto.v)) throw new ErroFormula("Número inválido na fórmula");
      return { t: "num", v: bruto.v };
    case "col":
      if (!chavesExatas(bruto, ["t", "nome"]) || typeof bruto.nome !== "string" || !NOME_COLUNA.test(bruto.nome)) throw new ErroFormula("Coluna inválida na fórmula");
      return { t: "col", nome: bruto.nome };
    case "neg":
      if (!chavesExatas(bruto, ["t", "a"])) throw new ErroFormula("Fórmula inválida");
      return { t: "neg", a: estrutura(bruto.a, contagem, p) };
    case "bin":
    case "cmp": {
      const ops = bruto.t === "bin" ? OPS_BIN : OPS_CMP;
      if (!chavesExatas(bruto, ["t", "op", "a", "b"]) || typeof bruto.op !== "string" || !ops.has(bruto.op)) throw new ErroFormula("Operação inválida na fórmula");
      const a = estrutura(bruto.a, contagem, p);
      const b = estrutura(bruto.b, contagem, p);
      return bruto.t === "bin" ? { t: "bin", op: bruto.op as OpBinario, a, b } : { t: "cmp", op: bruto.op as OpComparacao, a, b };
    }
    case "fn":
      if (!chavesExatas(bruto, ["t", "nome", "args"]) || typeof bruto.nome !== "string" || !FUNCOES.has(bruto.nome) || !Array.isArray(bruto.args))
        throw new ErroFormula("Função inválida na fórmula");
      return { t: "fn", nome: bruto.nome as NomeFuncao, args: bruto.args.map((a) => estrutura(a, contagem, p)) };
    default:
      throw new ErroFormula("Fórmula inválida");
  }
}

const TIPO_DA_COLUNA: Record<TipoColunaFormula, TipoNo | null> = { inteiro: "numero", decimal: "numero", data: "data", booleano: "logico", texto: null };

/** Mesmas regras de tipo da tela (frontend/src/lib/formulas/formula.ts, tipoDoNo). Mudar lá = mudar aqui. */
function tipoDoNo(no: No, colunas: Map<string, TipoColunaFormula>): TipoNo {
  const numero = (filho: No) => {
    if (tipoDoNo(filho, colunas) !== "numero") throw new ErroFormula("A fórmula usa uma data ou condição onde precisa de número");
  };
  const logico = (filho: No) => {
    if (tipoDoNo(filho, colunas) !== "logico") throw new ErroFormula("A fórmula usa um número onde precisa de condição");
  };
  const qtd = (n: number, min: number, max: number, nome: string) => {
    if (n < min || n > max) throw new ErroFormula(`${nome} com número errado de argumentos`);
  };
  switch (no.t) {
    case "num":
      return "numero";
    case "col": {
      const tipo = colunas.get(no.nome);
      if (!tipo) throw new ErroFormula(`A coluna ${no.nome} não existe nesta lista`);
      const t = TIPO_DA_COLUNA[tipo];
      if (!t) throw new ErroFormula("Coluna de texto não entra em conta");
      return t;
    }
    case "neg":
      numero(no.a);
      return "numero";
    case "bin":
      numero(no.a);
      numero(no.b);
      return "numero";
    case "cmp": {
      const a = tipoDoNo(no.a, colunas);
      const b = tipoDoNo(no.b, colunas);
      if (a === "logico" || a !== b) throw new ErroFormula("A comparação precisa de dois números ou de duas datas");
      return "logico";
    }
    case "fn": {
      const n = no.args.length;
      switch (no.nome) {
        case "ABS":
          qtd(n, 1, 1, "ABS");
          numero(no.args[0]);
          return "numero";
        case "ARRED": {
          qtd(n, 2, 2, "ARRED");
          numero(no.args[0]);
          const casas = no.args[1];
          if (casas.t !== "num" || !Number.isInteger(casas.v) || casas.v < 0 || casas.v > LIMITE_CASAS_ARRED)
            throw new ErroFormula(`As casas do ARRED são um número inteiro de 0 a ${LIMITE_CASAS_ARRED}`);
          return "numero";
        }
        case "MIN":
        case "MAX":
          qtd(n, 2, Infinity, no.nome);
          no.args.forEach(numero);
          return "numero";
        case "SE":
          qtd(n, 3, 3, "SE");
          logico(no.args[0]);
          numero(no.args[1]);
          numero(no.args[2]);
          return "numero";
        case "SEVAZIO":
          qtd(n, 2, 2, "SEVAZIO");
          numero(no.args[0]);
          numero(no.args[1]);
          return "numero";
        case "DIAS":
          qtd(n, 2, 2, "DIAS");
          for (const a of no.args) if (tipoDoNo(a, colunas) !== "data") throw new ErroFormula("DIAS precisa de duas colunas de data");
          return "numero";
        case "TOTAL":
          qtd(n, 1, 1, "TOTAL");
          if (no.args[0].t !== "col") throw new ErroFormula("TOTAL recebe uma coluna");
          numero(no.args[0]);
          return "numero";
        case "E":
        case "OU":
          qtd(n, 2, Infinity, no.nome);
          no.args.forEach(logico);
          return "logico";
      }
    }
  }
}

/**
 * Só a estrutura (nós conhecidos, nomes de coluna bem formados, limites). Para GRAVAR a coluna calculada de uma lista do navegador, cujas
 * colunas o servidor não conhece: os tipos são conferidos pela tela ao usar, e pelo servidor nas listas dele (validarFormula).
 */
export function validarEstruturaFormula(bruto: unknown): No {
  return estrutura(bruto, { nos: 0 }, 0);
}

/** Árvore vinda da tela → árvore conferida (estrutura + tipos; o resultado tem que ser número). Lança ErroFormula em português. */
export function validarFormula(bruto: unknown, colunas: Map<string, TipoColunaFormula>): No {
  const no = estrutura(bruto, { nos: 0 }, 0);
  if (tipoDoNo(no, colunas) !== "numero") throw new ErroFormula("A fórmula precisa dar um número");
  return no;
}

/** Colunas que a fórmula cita (sem repetir); `soTotal` = só as de dentro de TOTAL. */
export function colunasDaFormula(no: No, soTotal = false): string[] {
  const nomes = new Set<string>();
  const visitar = (n: No, dentro: boolean) => {
    if (n.t === "col") {
      if (!soTotal || dentro) nomes.add(n.nome);
    } else if (n.t === "neg") visitar(n.a, dentro);
    else if (n.t === "bin" || n.t === "cmp") {
      visitar(n.a, dentro);
      visitar(n.b, dentro);
    } else if (n.t === "fn") n.args.forEach((a) => visitar(a, dentro || n.nome === "TOTAL"));
  };
  visitar(no, false);
  return [...nomes];
}

/**
 * SQL da fórmula conferida. `expr(nome)` = expressão confiável da coluna (do servidor); `tipos` = tipo de cada coluna; `totais[nome]` = o
 * TOTAL da coluna, calculado antes (entra como parâmetro).
 */
export function formulaParaSql(no: No, expr: (nome: string) => Prisma.Sql, tipos: Map<string, TipoColunaFormula>, totais: Map<string, number | null> = new Map()): Prisma.Sql {
  const s = (n: No): Prisma.Sql => formulaParaSql(n, expr, tipos, totais);
  switch (no.t) {
    case "num":
      return Prisma.sql`${String(no.v)}::numeric`;
    case "col": {
      const tipo = tipos.get(no.nome);
      if (tipo === "data") return Prisma.sql`(${expr(no.nome)})::timestamptz`;
      if (tipo === "booleano") return Prisma.sql`(${expr(no.nome)})::boolean`;
      return Prisma.sql`(${expr(no.nome)})::numeric`;
    }
    case "neg":
      return Prisma.sql`(-${s(no.a)})`;
    case "bin": {
      const a = s(no.a);
      const b = s(no.b);
      switch (no.op) {
        case "+":
          return Prisma.sql`(${a} + ${b})`;
        case "-":
          return Prisma.sql`(${a} - ${b})`;
        case "*":
          return Prisma.sql`(${a} * ${b})`;
        case "/":
          return Prisma.sql`(${a} / NULLIF(${b}, 0))`;
        case "^":
          // Fora do domínio (expoente enorme, raiz de negativo, 0 elevado a negativo) o power() do Postgres dá erro: aqui vira vazio.
          return Prisma.sql`(CASE WHEN abs(${b}) > ${LIMITE_EXPOENTE} OR (${a} < 0 AND ${b} <> trunc(${b})) OR (${a} = 0 AND ${b} < 0) THEN NULL
                                  ELSE power(${a}, ${b}) END)`;
      }
      break;
    }
    case "cmp":
      return Prisma.sql`(${s(no.a)} ${Prisma.raw(no.op)} ${s(no.b)})`;
    case "fn": {
      const args = no.args.map(s);
      switch (no.nome) {
        case "ABS":
          return Prisma.sql`abs(${args[0]})`;
        case "ARRED":
          return Prisma.sql`round(${args[0]}, ${(no.args[1] as { v: number }).v}::int)`;
        case "MIN":
          return Prisma.sql`LEAST(${Prisma.join(args)})`;
        case "MAX":
          return Prisma.sql`GREATEST(${Prisma.join(args)})`;
        case "SE":
          return Prisma.sql`(CASE WHEN ${args[0]} THEN ${args[1]} ELSE ${args[2]} END)`;
        case "SEVAZIO":
          return Prisma.sql`COALESCE(${args[0]}, ${args[1]})`;
        case "DIAS":
          return Prisma.sql`(EXTRACT(EPOCH FROM (${args[1]} - ${args[0]})) / 86400)::numeric`;
        case "TOTAL": {
          const total = totais.get((no.args[0] as { nome: string }).nome);
          return total === undefined || total === null ? Prisma.sql`NULL::numeric` : Prisma.sql`${String(total)}::numeric`;
        }
        case "E":
          return Prisma.sql`(${Prisma.join(args, " AND ")})`;
        case "OU":
          return Prisma.sql`(${Prisma.join(args, " OR ")})`;
      }
    }
  }
  throw new ErroFormula("Fórmula inválida");
}
