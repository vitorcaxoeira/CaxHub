import { test } from "node:test";
import assert from "node:assert/strict";
import { converterValorInterno, ErroValorInterno, tipoEhEditavel } from "./valorCampoInterno";

test("Boolean aceita só verdadeiro/falso (nada de texto 'true' nem número)", () => {
  assert.equal(converterValorInterno("Boolean", true), true);
  assert.equal(converterValorInterno("Boolean", false), false);
  assert.throws(() => converterValorInterno("Boolean", "true"), ErroValorInterno);
  assert.throws(() => converterValorInterno("Boolean", 1), ErroValorInterno);
});

test("null limpa o campo em qualquer tipo", () => {
  for (const t of ["Boolean", "String", "Int", "Float", "DateTime", "Json"]) assert.equal(converterValorInterno(t, null), null);
});

test("String: tira espaço das pontas, recusa vazio e texto gigante", () => {
  assert.equal(converterValorInterno("String", "  olá  "), "olá");
  assert.throws(() => converterValorInterno("String", "   "), /vazio/);
  assert.throws(() => converterValorInterno("String", "x".repeat(2001)), /longo demais/);
  assert.throws(() => converterValorInterno("String", 5), ErroValorInterno);
});

test("Int: só inteiro dentro do limite do INTEGER do Postgres", () => {
  assert.equal(converterValorInterno("Int", 42), 42);
  assert.equal(converterValorInterno("Int", -7), -7);
  assert.throws(() => converterValorInterno("Int", 1.5), ErroValorInterno);
  assert.throws(() => converterValorInterno("Int", 2147483648), /limite/);
  assert.throws(() => converterValorInterno("Int", "3"), ErroValorInterno);
});

test("Float: qualquer número finito", () => {
  assert.equal(converterValorInterno("Float", 1.25), 1.25);
  assert.throws(() => converterValorInterno("Float", Infinity), ErroValorInterno);
  assert.throws(() => converterValorInterno("Float", NaN), ErroValorInterno);
});

test("tipos que a tela ainda não edita dão mensagem clara", () => {
  assert.throws(() => converterValorInterno("DateTime", "2026-01-01"), /ainda não são editáveis/);
  assert.throws(() => converterValorInterno("Json", {}), /Json/);
  assert.equal(tipoEhEditavel("Boolean"), true);
  assert.equal(tipoEhEditavel("DateTime"), false);
});
