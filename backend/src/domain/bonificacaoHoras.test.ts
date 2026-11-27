import assert from "node:assert/strict";
import { test } from "node:test";
import { horasDoMes } from "./bonificacaoHoras";

test("saldo positivo do banco entra como extra no total, no ocioso e no %", () => {
  const h = horasDoMes({ trabalhadas: 10000, saldoBanco: 500, kyria: 2100 });
  assert.equal(h.minutosExtras, 500);
  assert.equal(h.minutosTotal, 10500);
  assert.equal(h.minutosOcioso, 8400);
  assert.equal(h.percentual, 20);
});

test("saldo negativo (caso do Daniel em 10/2026: -02:53) não entra no cálculo", () => {
  const h = horasDoMes({ trabalhadas: 10659, saldoBanco: -173, kyria: 1872 });
  assert.equal(h.minutosExtras, 0);
  assert.equal(h.minutosTotal, 10659);
  assert.equal(h.minutosOcioso, 8787);
  assert.equal(Math.round(h.percentual! * 100) / 100, 17.56);
});

test("sem lançamento no banco ou saldo zero: total = trabalhadas", () => {
  assert.equal(horasDoMes({ trabalhadas: 600, saldoBanco: null, kyria: 0 }).minutosTotal, 600);
  assert.equal(horasDoMes({ trabalhadas: 600, saldoBanco: 0, kyria: 0 }).minutosExtras, 0);
});

test("Kyria acima do total deixa o ocioso negativo; sem total não há %", () => {
  assert.equal(horasDoMes({ trabalhadas: 100, saldoBanco: 0, kyria: 130.5 }).minutosOcioso, -30.5);
  assert.equal(horasDoMes({ trabalhadas: 0, saldoBanco: -10, kyria: 30 }).percentual, null);
});
