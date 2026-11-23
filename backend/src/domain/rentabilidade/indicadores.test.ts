import { test } from "node:test";
import assert from "node:assert/strict";
import type { No } from "../../formulas/formula";
import { calcularIndicadores, contasEmMaisDeUm, contasSemIndicador, contasSelecionadas, ordemDeCalculo, quemUsa, validarIndicador, type ContaDoPlano } from "./indicadores";

const col = (nome: string): No => ({ t: "col", nome });
const num = (v: number): No => ({ t: "num", v });
const bin = (op: "+" | "-" | "*" | "/", a: No, b: No): No => ({ t: "bin", op, a, b });
const total = (nome: string): No => ({ t: "fn", nome: "TOTAL", args: [col(nome)] });
const abs = (a: No): No => ({ t: "fn", nome: "ABS", args: [a] });

// 1 (S) → 11 (S) → 111 (A), 112 (A); 1 → 12 (A); 2 (S) sem filhos
const plano: ContaDoPlano[] = [
  { codemp: 1, ctared: 1, paiCtared: null, anasin: "S" },
  { codemp: 1, ctared: 11, paiCtared: 1, anasin: "S" },
  { codemp: 1, ctared: 111, paiCtared: 11, anasin: "A" },
  { codemp: 1, ctared: 112, paiCtared: 11, anasin: "A" },
  { codemp: 1, ctared: 12, paiCtared: 1, anasin: "A" },
  { codemp: 1, ctared: 2, paiCtared: null, anasin: "S" },
];
const ids = (s: Set<string>) => [...s].map((k) => Number(k.split(":")[1])).sort((a, b) => a - b);

test("conta sintética vale por todas as analíticas abaixo dela", () => {
  assert.deepEqual(ids(contasSelecionadas([{ codemp: 1, ctared: 1, acao: "incluir" }], plano)), [12, 111, 112]);
  assert.deepEqual(ids(contasSelecionadas([{ codemp: 1, ctared: 11, acao: "incluir" }], plano)), [111, 112]);
});

test("conta analítica avulsa entra sozinha", () => {
  assert.deepEqual(ids(contasSelecionadas([{ codemp: 1, ctared: 12, acao: "incluir" }], plano)), [12]);
});

test("excluir tira a conta e tudo abaixo dela, e ganha da inclusão em qualquer ordem", () => {
  const a = contasSelecionadas([{ codemp: 1, ctared: 1, acao: "incluir" }, { codemp: 1, ctared: 11, acao: "excluir" }], plano);
  const b = contasSelecionadas([{ codemp: 1, ctared: 11, acao: "excluir" }, { codemp: 1, ctared: 1, acao: "incluir" }], plano);
  assert.deepEqual(ids(a), [12]);
  assert.deepEqual(ids(b), [12]);
});

test("sintética sem filhos e conta que não existe no plano não somam nada", () => {
  assert.deepEqual(ids(contasSelecionadas([{ codemp: 1, ctared: 2, acao: "incluir" }, { codemp: 1, ctared: 999, acao: "incluir" }], plano)), []);
});

test("a ordem de cálculo põe a fórmula depois do que ela cita", () => {
  const ordem = ordemDeCalculo([
    { codigo: "Margem", tipo: "formula", formulaArvore: bin("-", col("Receita"), col("CustoTotal")) },
    { codigo: "CustoTotal", tipo: "formula", formulaArvore: bin("+", col("Pessoal"), col("Outros")) },
    { codigo: "Receita", tipo: "contas", formulaArvore: null },
    { codigo: "Pessoal", tipo: "contas", formulaArvore: null },
    { codigo: "Outros", tipo: "contas", formulaArvore: null },
  ]);
  assert.ok(ordem.indexOf("CustoTotal") < ordem.indexOf("Margem"));
});

test("fórmulas que se citam em círculo são recusadas, com o caminho", () => {
  assert.throws(
    () => ordemDeCalculo([
      { codigo: "A", tipo: "formula", formulaArvore: bin("+", col("B"), num(1)) },
      { codigo: "B", tipo: "formula", formulaArvore: bin("+", col("A"), num(1)) },
    ]),
    /em círculo: A → B → A/
  );
});

test("quem usa um indicador", () => {
  const inds = [
    { codigo: "Receita", tipo: "contas" as const, formulaArvore: null },
    { codigo: "Margem", tipo: "formula" as const, formulaArvore: bin("-", col("Receita"), num(1)) },
    { codigo: "Outra", tipo: "formula" as const, formulaArvore: num(3) },
  ];
  assert.deepEqual(quemUsa("Receita", inds), ["Margem"]);
  assert.deepEqual(quemUsa("Margem", inds), []);
});

test("cálculo: contas somam, fórmula por linha, e TOTAL usa a linha de total", () => {
  const indicadores = [
    { codigo: "Receita", tipo: "contas" as const, formulaArvore: null },
    { codigo: "Custo", tipo: "contas" as const, formulaArvore: null },
    { codigo: "Margem", tipo: "formula" as const, formulaArvore: bin("-", col("Receita"), abs(col("Custo"))) },
    { codigo: "MargemPct", tipo: "formula" as const, formulaArvore: bin("/", col("Margem"), col("Receita")) },
    { codigo: "PartReceita", tipo: "formula" as const, formulaArvore: bin("/", col("Receita"), total("Receita")) },
  ];
  const bases = new Map([
    ["Receita", new Map([["1001", 300], ["1002", 100]])],
    ["Custo", new Map([["1001", -120], ["1002", -60]])],
  ]);
  const r = calcularIndicadores(indicadores, bases, ["1001", "1002"]);
  assert.equal(r.total.Receita, 400);
  assert.equal(r.total.Custo, -180);
  assert.equal(r.total.Margem, 220);
  assert.equal(r.total.MargemPct, 0.55); // razão do total, não soma das razões
  assert.equal(r.porLinha.get("1001")!.Margem, 180);
  assert.equal(r.porLinha.get("1002")!.Margem, 40);
  assert.equal(r.porLinha.get("1001")!.PartReceita, 0.75);
  assert.equal(r.porLinha.get("1002")!.PartReceita, 0.25);
});

test("linha sem movimento vale zero e divisão por zero dá vazio", () => {
  const indicadores = [
    { codigo: "Receita", tipo: "contas" as const, formulaArvore: null },
    { codigo: "Pct", tipo: "formula" as const, formulaArvore: bin("/", num(1), col("Receita")) },
  ];
  const r = calcularIndicadores(indicadores, new Map([["Receita", new Map([["A", 10]])]]), ["A", "B"]);
  assert.equal(r.porLinha.get("B")!.Receita, 0);
  assert.equal(r.porLinha.get("B")!.Pct, null);
  assert.equal(r.porLinha.get("A")!.Pct, 0.1);
});

test("validar: código, tipo e natureza do orçado", () => {
  const vazio = new Set<string>();
  assert.equal(validarIndicador({ codigo: "1abc", rotulo: "x", tipo: "contas" }, vazio).ok, false);
  assert.equal(validarIndicador({ codigo: "A", rotulo: "x", tipo: "qualquer" }, vazio).ok, false);
  assert.equal(validarIndicador({ codigo: "A", rotulo: "x", tipo: "contas", base: "orcado", natureza: "debito" }, vazio).ok, false);
  assert.equal(validarIndicador({ codigo: "A", rotulo: "x", tipo: "contas" }, new Set(["A"])).ok, false);
  const ok = validarIndicador({ codigo: "Pessoal", rotulo: " Gastos com Pessoal ", tipo: "contas", natureza: "debito", contas: [{ codemp: 1, ctared: 223, acao: "incluir" }] }, vazio);
  assert.ok(ok.ok && ok.valor.rotulo === "Gastos com Pessoal" && ok.valor.contas.length === 1);
});

test("validar: conta repetida e conta mal formada", () => {
  const dup = validarIndicador({ codigo: "A", rotulo: "x", tipo: "contas", contas: [{ codemp: 1, ctared: 5, acao: "incluir" }, { codemp: 1, ctared: 5, acao: "excluir" }] }, new Set());
  assert.equal(dup.ok, false);
  const ruim = validarIndicador({ codigo: "A", rotulo: "x", tipo: "contas", contas: [{ codemp: 1, ctared: "5", acao: "incluir" }] }, new Set());
  assert.equal(ruim.ok, false);
});

test("validar: fórmula só cita os outros indicadores e precisa dar número", () => {
  const outros = new Set(["Receita", "Custo"]);
  const certo = validarIndicador({ codigo: "Margem", rotulo: "Margem", tipo: "formula", formulaTexto: "Receita - Custo", formulaArvore: bin("-", col("Receita"), col("Custo")) }, outros);
  assert.ok(certo.ok);
  const naoExiste = validarIndicador({ codigo: "M", rotulo: "M", tipo: "formula", formulaTexto: "Receita - Fantasma", formulaArvore: bin("-", col("Receita"), col("Fantasma")) }, outros);
  assert.equal(naoExiste.ok, false);
  const semArvore = validarIndicador({ codigo: "M", rotulo: "M", tipo: "formula", formulaTexto: "Receita" }, outros);
  assert.equal(semArvore.ok, false);
  const aSiMesmo = validarIndicador({ codigo: "M", rotulo: "M", tipo: "formula", formulaTexto: "M + 1", formulaArvore: bin("+", col("M"), num(1)) }, outros);
  assert.equal(aSiMesmo.ok, false);
});

test("validar: campo do sistema exige uma fonte conhecida", () => {
  assert.equal(validarIndicador({ codigo: "H", rotulo: "Horas", tipo: "sistema", formato: "horas" }, new Set()).ok, false);
  assert.equal(validarIndicador({ codigo: "H", rotulo: "Horas", tipo: "sistema", formato: "horas", fonte: "Outra" }, new Set()).ok, false);
  assert.equal(validarIndicador({ codigo: "H", rotulo: "Horas", tipo: "sistema", formato: "horas", fonte: "HorasKyria" }, new Set()).ok, true);
});

test("diagnóstico: conta sem indicador e conta em mais de um", () => {
  const sel = new Map([["Servicos", new Set(["1:10", "1:11"])], ["Deducoes", new Set(["1:11", "1:12"])]]);
  assert.deepEqual(contasSemIndicador(["1:10", "1:99"], sel), ["1:99"]);
  assert.deepEqual(contasEmMaisDeUm(sel), [{ conta: "1:11", indicadores: ["Servicos", "Deducoes"] }]);
});
