import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { colunasDaFormula, ErroFormula, formulaParaSql, validarFormula, type No, type TipoColunaFormula } from "./formula";

const TIPOS = new Map<string, TipoColunaFormula>([
  ["quantidade", "decimal"],
  ["consumoErp", "decimal"],
  ["pecas", "inteiro"],
  ["descricao", "texto"],
  ["primeiro", "data"],
  ["ultimo", "data"],
  ["incompleto", "booleano"],
]);
const col = (nome: string): No => ({ t: "col", nome });
const num = (v: number): No => ({ t: "num", v });
const recusa = (bruto: unknown, mensagem: RegExp) => assert.throws(() => validarFormula(bruto, TIPOS), (e: unknown) => e instanceof ErroFormula && mensagem.test(e.message));

test("aceita a árvore que a tela monta e devolve uma cópia limpa", () => {
  const arvore = { t: "bin", op: "/", a: { t: "bin", op: "-", a: col("quantidade"), b: col("consumoErp") }, b: col("consumoErp") };
  assert.deepEqual(validarFormula(arvore, TIPOS), arvore);
});

test("recusa estrutura estranha (entrada não confiável)", () => {
  recusa({ t: "sql", v: "1; DROP TABLE x" }, /inválida/);
  recusa({ t: "num", v: "1" }, /Número inválido/);
  recusa({ t: "num", v: Infinity }, /Número inválido/);
  recusa({ t: "num", v: 1, extra: true }, /Número inválido/);
  recusa({ t: "cmp", op: "LIKE", a: num(1), b: num(1) }, /Operação inválida/);
  recusa({ t: "fn", nome: "PG_SLEEP", args: [num(1)] }, /Função inválida/);
  recusa({ t: "col", nome: "senha" }, /não existe nesta lista/);
  recusa(null, /inválida/);
});

test("limites de tamanho e de aninhamento", () => {
  let fundo: No = num(1);
  for (let i = 0; i < 40; i++) fundo = { t: "neg", a: fundo };
  recusa(fundo, /aninhada demais/);
  const largo: No = { t: "fn", nome: "MAX", args: Array.from({ length: 250 }, () => num(1)) };
  recusa(largo, /grande demais/);
});

test("mesmas regras de tipo da tela", () => {
  recusa({ t: "bin", op: "+", a: col("descricao"), b: num(1) }, /texto não entra/);
  recusa({ t: "bin", op: "+", a: col("primeiro"), b: num(1) }, /precisa de número/);
  recusa({ t: "cmp", op: ">", a: col("pecas"), b: num(1) }, /precisa dar um número/);
  recusa({ t: "fn", nome: "ARRED", args: [col("pecas"), num(1.5)] }, /inteiro de 0 a 6/);
  recusa({ t: "fn", nome: "TOTAL", args: [{ t: "bin", op: "*", a: col("pecas"), b: num(2) }] }, /TOTAL recebe uma coluna/);
  recusa({ t: "fn", nome: "MIN", args: [num(1)] }, /argumentos/);
  recusa({ t: "fn", nome: "DIAS", args: [col("primeiro"), col("pecas")] }, /DIAS precisa/);
  recusa({ t: "cmp", op: "=", a: col("incompleto"), b: col("incompleto") }, /dois números ou de duas datas/);
});

const sqlDe = (no: No, totais = new Map<string, number | null>()) => {
  const s = formulaParaSql(no, (n) => Prisma.raw(`x.${n}`), TIPOS, totais);
  return { texto: s.text.replace(/\s+/g, " "), valores: s.values };
};

test("SQL: colunas pela expressão do servidor, números como parâmetro, divisão protegida", () => {
  const { texto, valores } = sqlDe({ t: "bin", op: "/", a: col("quantidade"), b: { t: "bin", op: "*", a: col("consumoErp"), b: num(1.5) } });
  assert.equal(texto, "((x.quantidade)::numeric / NULLIF(((x.consumoErp)::numeric * $1::numeric), 0))");
  assert.deepEqual(valores, ["1.5"]);
});

test("SQL: funções e TOTAL calculado antes", () => {
  assert.match(sqlDe({ t: "fn", nome: "MIN", args: [col("pecas"), num(2)] }).texto, /^LEAST\(/);
  assert.match(sqlDe({ t: "fn", nome: "SE", args: [{ t: "cmp", op: ">", a: col("pecas"), b: num(0) }, num(1), num(0)] }).texto, /CASE WHEN \(\(x\.pecas\)::numeric > \$1::numeric\) THEN/);
  assert.match(sqlDe({ t: "fn", nome: "DIAS", args: [col("primeiro"), col("ultimo")] }).texto, /EXTRACT\(EPOCH FROM \(\(x\.ultimo\)::timestamptz - \(x\.primeiro\)::timestamptz\)\) \/ 86400/);
  const total = sqlDe({ t: "bin", op: "/", a: col("consumoErp"), b: { t: "fn", nome: "TOTAL", args: [col("consumoErp")] } }, new Map([["consumoErp", 400]]));
  assert.deepEqual(total.valores, ["400"]);
  assert.match(sqlDe({ t: "fn", nome: "TOTAL", args: [col("consumoErp")] }).texto, /NULL::numeric/);
});

test("colunas citadas, e as de dentro do TOTAL", () => {
  const no: No = { t: "bin", op: "+", a: { t: "bin", op: "/", a: col("consumoErp"), b: { t: "fn", nome: "TOTAL", args: [col("consumoErp")] } }, b: col("pecas") };
  assert.deepEqual(colunasDaFormula(no).sort(), ["consumoErp", "pecas"]);
  assert.deepEqual(colunasDaFormula(no, true), ["consumoErp"]);
});
