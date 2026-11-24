import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularCustoClt,
  chaveConta,
  competenciaDia1,
  competenciasDoPeriodo,
  escolherCusto,
  mesSeguinte,
  precoEhMensal,
  validarParametro,
  validarPeriodoMensal,
  validarRegrasContasFolha,
  validarValorManual,
  valorManualEm,
  vigenciaManualEm,
} from "./custoHora";

// Os números abaixo são de TESTE (não são regra de negócio): servem só para conferir a conta.

test("parâmetro horas_mes: aceita vírgula decimal, recusa zero e absurdo", () => {
  assert.deepEqual(validarParametro("horas_mes", "180,5"), { ok: true, valor: "180.5" });
  assert.deepEqual(validarParametro("horas_mes", 200), { ok: true, valor: "200" });
  assert.equal(validarParametro("horas_mes", "0").ok, false);
  assert.equal(validarParametro("horas_mes", "800").ok, false);
  assert.equal(validarParametro("horas_mes", "").ok, false);
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

// ---------- CLT pela contabilização da folha (R048CTB) ----------
// Os valores abaixo são de TESTE (não são regra de negócio): servem só para conferir a conta.

const C = (ctared: number) => chaveConta(1, ctared);

test("CLT: o débito só das contas escolhidas, dividido pelas horas da escala", () => {
  const r = calcularCustoClt({
    lancamentos: [
      { conta: C(224), opcctb: 1, valor: 5000 }, // salários (débito)
      { conta: C(226), opcctb: 1, valor: 1200 }, // INSS (débito)
      { conta: C(120), opcctb: 3, valor: 600 }, // provisão de 13º
      { conta: C(235), opcctb: 1, valor: 300 }, // desconto do plano — conta que o teste NÃO escolhe
    ],
    contas: new Set([C(224), C(226), C(120)]),
    horasMes: 200,
  })!;
  assert.equal(r.detalhe.custoMensal, 6800);
  assert.equal(r.detalhe.folha, 6200);
  assert.equal(r.detalhe.provisoes, 600);
  assert.equal(r.custoHora, 34);
  assert.deepEqual(r.detalhe.porConta.map((c) => c.conta), [C(224), C(226), C(120)]);
});

test("CLT: lançamentos da mesma conta (folha e provisão) somam", () => {
  const r = calcularCustoClt({ lancamentos: [{ conta: C(224), opcctb: 1, valor: 1000 }, { conta: C(224), opcctb: 3, valor: 250 }], contas: new Set([C(224)]), horasMes: 100 })!;
  assert.equal(r.detalhe.custoMensal, 1250);
  assert.equal(r.detalhe.provisoes, 250);
  assert.equal(r.custoHora, 12.5);
});

test("CLT: sem horas, sem lançamento nas contas escolhidas ou total zero = sem custo", () => {
  const um = [{ conta: C(224), opcctb: 1, valor: 1000 }];
  assert.equal(calcularCustoClt({ lancamentos: um, contas: new Set([C(224)]), horasMes: 0 }), null);
  assert.equal(calcularCustoClt({ lancamentos: um, contas: new Set([C(999)]), horasMes: 200 }), null);
  assert.equal(calcularCustoClt({ lancamentos: [], contas: new Set([C(224)]), horasMes: 200 }), null);
  assert.equal(calcularCustoClt({ lancamentos: [{ conta: C(224), opcctb: 1, valor: 0 }], contas: new Set([C(224)]), horasMes: 200 }), null);
});

test("CLT: arredonda o custo mensal a centavos e o custo-hora a 4 casas", () => {
  const r = calcularCustoClt({ lancamentos: [{ conta: C(1), opcctb: 1, valor: 1000.005 }], contas: new Set([C(1)]), horasMes: 220 })!;
  assert.equal(r.detalhe.custoMensal, 1000.01);
  assert.equal(r.custoHora, 4.5455);
});

test("regras de contas da folha: valida lista, ação e repetição", () => {
  assert.deepEqual(validarRegrasContasFolha([{ codemp: 1, ctared: 224, acao: "incluir" }, { codemp: 1, ctared: 235, acao: "excluir" }]), {
    ok: true,
    valor: [{ codemp: 1, ctared: 224, acao: "incluir" }, { codemp: 1, ctared: 235, acao: "excluir" }],
  });
  assert.equal(validarRegrasContasFolha([]).ok, true);
  assert.equal(validarRegrasContasFolha("x").ok, false);
  assert.equal(validarRegrasContasFolha([{ codemp: 1, ctared: 224, acao: "somar" }]).ok, false);
  assert.equal(validarRegrasContasFolha([{ codemp: 1, ctared: 0, acao: "incluir" }]).ok, false);
  assert.equal(validarRegrasContasFolha([{ codemp: 1, ctared: 224, acao: "incluir" }, { codemp: 1, ctared: 224, acao: "excluir" }]).ok, false);
});

test("parâmetros: só horas_mes existe (tipos de cálculo saiu com a R048CTB)", () => {
  assert.equal(validarParametro("tipos_calculo" as never, "11").ok, false);
});

test("vigência manual: devolve a linha inteira (com observação) que valeu no mês", () => {
  const v = [
    { vigenciaInicio: "2026-05-01", valor: 70, observacao: "reajuste" },
    { vigenciaInicio: "2025-01-01", valor: 50, observacao: null },
  ];
  assert.deepEqual(vigenciaManualEm(v, "2026-07-01"), { vigenciaInicio: "2026-05-01", valor: 70, observacao: "reajuste" });
  assert.equal(vigenciaManualEm(v, "2024-01-01"), null);
});
