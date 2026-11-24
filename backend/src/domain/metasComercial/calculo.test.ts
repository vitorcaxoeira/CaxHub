import assert from "node:assert/strict";
import { test } from "node:test";
import { atingimentoGeral, consolidar, distribuirPorPesos, mesesDoPeriodo, PESOS_PADRAO, validarPesos } from "./calculo";

// Os números vêm da planilha META 2026.xlsx (abas "2026", "2026 - Taiza", "2026 - Cati").

test("pesos padrão da planilha somam 100% (tolerância da validação)", () => {
  assert.equal(validarPesos(PESOS_PADRAO), null);
  assert.match(validarPesos([...PESOS_PADRAO.slice(0, 11), 50]) ?? "", /somar 100/);
  assert.match(validarPesos([1, 2]) ?? "", /12 pesos/);
});

test("meta mensal da empresa: Incremento 200.000 → Jan 13.333,33 e Abr 20.000", () => {
  const m = distribuirPorPesos(200000, PESOS_PADRAO);
  assert.equal(m[0], 13333.33);
  assert.equal(m[3], 20000);
  assert.equal(Math.round(m.reduce((a, b) => a + b, 0) * 100) / 100, 200000);
});

test("Taíza: Licenças 420.000 → 28.000 em Jan e 42.000 em Abr", () => {
  const m = distribuirPorPesos(420000, PESOS_PADRAO);
  assert.equal(m[0], 28000);
  assert.equal(m[3], 42000);
});

test("Cati entrou em julho: 43.200 só de Jul–Dez → 8.640 (Jul–Set) e 5.760 (Out–Dez)", () => {
  const m = distribuirPorPesos(43200, PESOS_PADRAO, [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(m.slice(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(m.slice(6, 9), [8640, 8640, 8640]);
  assert.deepEqual(m.slice(9), [5760, 5760, 5760]);
  assert.equal(Math.round(m.reduce((a, b) => a + b, 0) * 100) / 100, 43200);
});

test("a soma distribuída é sempre exatamente o valor, mesmo com dízima", () => {
  const m = distribuirPorPesos(100, PESOS_PADRAO);
  assert.equal(Math.round(m.reduce((a, b) => a + b, 0) * 100) / 100, 100);
});

test("sem meses escolhidos devolve zeros; sem peso nenhum divide igualmente", () => {
  assert.deepEqual(distribuirPorPesos(100, PESOS_PADRAO, []), new Array(12).fill(0));
  const m = distribuirPorPesos(90, new Array(12).fill(0), [1, 2, 3]);
  assert.deepEqual(m.slice(0, 3), [30, 30, 30]);
});

test("períodos: ano, semestres, trimestres, mês e acumulado até o mês", () => {
  assert.equal(mesesDoPeriodo("ano")?.length, 12);
  assert.deepEqual(mesesDoPeriodo("s2"), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(mesesDoPeriodo("t3"), [7, 8, 9]);
  assert.deepEqual(mesesDoPeriodo("mes-5"), [5]);
  assert.deepEqual(mesesDoPeriodo("ate-3"), [1, 2, 3]);
  assert.equal(mesesDoPeriodo("mes-13"), null);
  assert.equal(mesesDoPeriodo("xyz"), null);
});

test("consolidar SOMA: Licenças da Taíza soma 470.148,80 dos 10 meses lançados (total da aba dela)", () => {
  const metas = distribuirPorPesos(840000, PESOS_PADRAO);
  const realizados = [52331.41, 251983.45, 13429.83, 8483.2, 12192.5, 34079.42, 37289.34, 7500, 24305.59, 28554.06];
  // Meta de 840.000 só para exercitar a soma por período; o realizado é o da aba da Taíza.
  const linhas = metas.map((meta, i) => ({ mes: i + 1, meta, realizado: realizados[i] ?? null }));
  const c = consolidar(linhas, "SOMA", mesesDoPeriodo("ano")!);
  assert.equal(c.meta, 840000);
  assert.equal(c.realizado, 470148.8);
  assert.ok(c.atingimento! > 0 && c.atingimento! < 1);
  assert.equal(c.saldo, Math.round((840000 - c.realizado) * 100) / 100);
});

test("consolidar SALDO: usa o último mês com realizado (carteira de mensalidade)", () => {
  const linhas = [
    { mes: 1, meta: 1000000, realizado: 900000 },
    { mes: 2, meta: 1000000, realizado: 948672.34 },
    { mes: 3, meta: 1000000, realizado: null },
  ];
  const c = consolidar(linhas, "SALDO", mesesDoPeriodo("ano")!);
  assert.equal(c.realizado, 948672.34);
  assert.equal(c.meta, 1000000);
  assert.ok(Math.abs(c.atingimento! - 0.94867234) < 1e-9);
});

test("meta zero não gera percentual; superar a meta dá saldo negativo e passa de 100%", () => {
  assert.equal(consolidar([{ mes: 1, meta: 0, realizado: 10 }], "SOMA", [1]).atingimento, null);
  const c = consolidar([{ mes: 1, meta: 100, realizado: 141.78 }], "SOMA", [1]);
  assert.equal(c.saldo, -41.78);
  assert.ok(c.atingimento! > 1);
});

test("atingimento geral = média dos percentuais conhecidos (planilha 2026: 64,10%)", () => {
  const geral = atingimentoGeral([0.94867234, 0.8381936, 0.599478381, 0.5936666667, 0.7862253785, 0.7737226277, 0.2545454545, 0.3333333333]);
  assert.ok(Math.abs(geral! - 0.6409797227) < 1e-9);
  assert.equal(atingimentoGeral([null, null]), null);
  assert.equal(atingimentoGeral([0.5, null, 1]), 0.75);
});
