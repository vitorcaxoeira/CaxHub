import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCustoClt,
  competenciaDia1,
  competenciasDoPeriodo,
  encargosVigentes,
  escolherCusto,
  lerTiposCalculo,
  mesSeguinte,
  precoEhMensal,
  validarEncargo,
  validarParametro,
  validarPeriodoMensal,
  validarValorManual,
  valorManualEm,
} from "./custoHora";

// Os números abaixo são de TESTE (não são regra de negócio): servem só para conferir a conta.

test("tipos de cálculo: lê lista, ordena e tira repetidos; recusa lixo", () => {
  assert.deepEqual(lerTiposCalculo("13, 11,12,11"), [11, 12, 13]);
  assert.equal(lerTiposCalculo(""), null);
  assert.equal(lerTiposCalculo("11,abc"), null);
  assert.equal(lerTiposCalculo("0"), null);
});

test("parâmetro horas_mes: aceita vírgula decimal, recusa zero e absurdo", () => {
  assert.deepEqual(validarParametro("horas_mes", "180,5"), { ok: true, valor: "180.5" });
  assert.deepEqual(validarParametro("horas_mes", 200), { ok: true, valor: "200" });
  assert.equal(validarParametro("horas_mes", "0").ok, false);
  assert.equal(validarParametro("horas_mes", "800").ok, false);
  assert.equal(validarParametro("horas_mes", "").ok, false);
});

test("parâmetro tipos_calculo normaliza a lista", () => {
  assert.deepEqual(validarParametro("tipos_calculo", "12, 11"), { ok: true, valor: "11,12" });
  assert.equal(validarParametro("tipos_calculo", "x").ok, false);
});

test("encargo: valida código, nome, percentual e vigência", () => {
  const ok = validarEncargo({ codigo: "inss_patronal", rotulo: "INSS patronal", percentual: "20,5", vigenciaInicio: "2026-01-01" });
  assert.deepEqual(ok, { ok: true, valor: { codigo: "inss_patronal", rotulo: "INSS patronal", percentual: 20.5, vigenciaInicio: "2026-01-01" } });
  assert.equal(validarEncargo({ codigo: "INSS", rotulo: "x", percentual: 1, vigenciaInicio: "2026-01-01" }).ok, false);
  assert.equal(validarEncargo({ codigo: "rat", rotulo: "", percentual: 1, vigenciaInicio: "2026-01-01" }).ok, false);
  assert.equal(validarEncargo({ codigo: "rat", rotulo: "RAT", percentual: -1, vigenciaInicio: "2026-01-01" }).ok, false);
  assert.equal(validarEncargo({ codigo: "rat", rotulo: "RAT", percentual: 2000, vigenciaInicio: "2026-01-01" }).ok, false);
  assert.equal(validarEncargo({ codigo: "rat", rotulo: "RAT", percentual: 1, vigenciaInicio: "2026-02-30" }).ok, false);
});

test("encargo vigente: a última vigência que não passa do mês, por código", () => {
  const linhas = [
    { codigo: "rat", rotulo: "RAT", percentual: 1, vigenciaInicio: "2025-01-01" },
    { codigo: "rat", rotulo: "RAT", percentual: 2, vigenciaInicio: "2026-03-01" },
    { codigo: "terceiros", rotulo: "Terceiros", percentual: 5.8, vigenciaInicio: "2026-06-01" },
  ];
  assert.deepEqual(encargosVigentes(linhas, "2026-02-01").map((e) => [e.codigo, e.percentual]), [["rat", 1]]);
  assert.deepEqual(encargosVigentes(linhas, "2026-03-01").map((e) => [e.codigo, e.percentual]), [["rat", 2]]);
  assert.deepEqual(encargosVigentes(linhas, "2026-07-01").map((e) => [e.codigo, e.percentual]), [["rat", 2], ["terceiros", 5.8]]);
  assert.deepEqual(encargosVigentes(linhas, "2024-12-01"), []);
});

test("CLT: soma remuneração, benefícios, encargos da folha e os percentuais sobre a remuneração, e divide pelas horas", () => {
  const r = calcularCustoClt({
    remuneracao: 5000,
    beneficios: 800,
    encargosFolha: 400,
    encargos: [
      { codigo: "a", rotulo: "A", percentual: 20 },
      { codigo: "b", rotulo: "B", percentual: 8.33 },
    ],
    horasMes: 200,
  })!;
  // 5000 + 800 + 400 + 1000 + 416.50 = 7616.50 ; ÷ 200 = 38.0825
  assert.equal(r.detalhe.custoMensal, 7616.5);
  assert.equal(r.custoHora, 38.0825);
  assert.deepEqual(r.detalhe.encargos.map((e) => e.valor), [1000, 416.5]);
});

test("CLT: sem horas da escala ou sem custo não há custo-hora", () => {
  assert.equal(calcularCustoClt({ remuneracao: 5000, beneficios: 0, encargosFolha: 0, encargos: [], horasMes: 0 }), null);
  assert.equal(calcularCustoClt({ remuneracao: 0, beneficios: 0, encargosFolha: 0, encargos: [], horasMes: 200 }), null);
});

test("CLT: os percentuais incidem só na remuneração, não nos benefícios", () => {
  const r = calcularCustoClt({ remuneracao: 1000, beneficios: 1000, encargosFolha: 0, encargos: [{ codigo: "a", rotulo: "A", percentual: 10 }], horasMes: 100 })!;
  assert.equal(r.detalhe.custoMensal, 2100);
});

test("fonte de custo: folha vale mais que contrato, que vale mais que manual", () => {
  assert.deepEqual(escolherCusto({ clt: 40, pj: 90, manual: 10 }), { origem: "clt_folha", custoHora: 40 });
  assert.deepEqual(escolherCusto({ clt: null, pj: 90, manual: 10 }), { origem: "pj_contrato", custoHora: 90 });
  assert.deepEqual(escolherCusto({ clt: null, pj: null, manual: 10 }), { origem: "manual", custoHora: 10 });
  assert.equal(escolherCusto({ clt: null, pj: null, manual: null }), null);
  assert.equal(escolherCusto({ clt: 0, pj: 0, manual: 0 }), null);
});

test("valor manual: vale o de última vigência até o mês", () => {
  const v = [
    { vigenciaInicio: "2026-05-01", valor: 70 },
    { vigenciaInicio: "2025-01-01", valor: 50 },
  ];
  assert.equal(valorManualEm(v, "2024-12-01"), null);
  assert.equal(valorManualEm(v, "2025-06-01"), 50);
  assert.equal(valorManualEm(v, "2026-05-01"), 70);
});

test("valor manual: validação", () => {
  assert.deepEqual(validarValorManual({ vigenciaInicio: "2026-05-01", valor: "70,5", observacao: " sócio " }), { ok: true, valor: { vigenciaInicio: "2026-05-01", valor: 70.5, observacao: "sócio" } });
  assert.equal(validarValorManual({ vigenciaInicio: "2026-05-01", valor: 0 }).ok, false);
  assert.equal(validarValorManual({ vigenciaInicio: "05/2026", valor: 10 }).ok, false);
  assert.equal(validarValorManual({ vigenciaInicio: "2026-05-01", valor: 10, observacao: "x".repeat(501) }).ok, false);
});

test("competências: normaliza para o dia 1 e lista o período", () => {
  assert.equal(competenciaDia1("2026-03"), "2026-03-01");
  assert.equal(competenciaDia1("2026-03-17"), "2026-03-01");
  assert.equal(competenciaDia1("2026-13"), null);
  assert.deepEqual(competenciasDoPeriodo("2025-11", "2026-02"), ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  assert.equal(competenciasDoPeriodo("2026-03", "2026-01"), null);
  assert.equal(competenciasDoPeriodo("2000-01", "2026-01"), null);
  assert.equal(mesSeguinte("2026-12-01"), "2027-01-01");
  assert.equal(mesSeguinte("2026-03-01"), "2026-04-01");
});

test("preço mensal: só dentro do período marcado", () => {
  const sempre = { mensal: true, desde: null, ate: null };
  assert.equal(precoEhMensal(sempre, "2020-01-01"), true);
  assert.equal(precoEhMensal({ mensal: false, desde: null, ate: null }, "2026-01-01"), false);
  const janela = { mensal: true, desde: "2023-03-01", ate: "2026-08-01" };
  assert.equal(precoEhMensal(janela, "2023-02-01"), false);
  assert.equal(precoEhMensal(janela, "2023-03-01"), true);
  assert.equal(precoEhMensal(janela, "2026-08-01"), true);
  assert.equal(precoEhMensal(janela, "2026-09-01"), false);
  assert.equal(precoEhMensal({ mensal: true, desde: "2026-08-01", ate: null }, "2030-01-01"), true);
});

test("período mensal: valida e descarta o período quando não é mensal", () => {
  assert.deepEqual(validarPeriodoMensal({ mensal: true, desde: "2023-03", ate: "2026-08" }), { ok: true, valor: { mensal: true, desde: "2023-03-01", ate: "2026-08-01" } });
  assert.deepEqual(validarPeriodoMensal({ mensal: true }), { ok: true, valor: { mensal: true, desde: null, ate: null } });
  assert.deepEqual(validarPeriodoMensal({ mensal: false, desde: "2023-03" }), { ok: true, valor: { mensal: false, desde: null, ate: null } });
  assert.equal(validarPeriodoMensal({ mensal: true, desde: "2026-09", ate: "2026-01" }).ok, false);
  assert.equal(validarPeriodoMensal({ mensal: true, desde: "xx" }).ok, false);
  assert.equal(validarPeriodoMensal({}).ok, false);
});
