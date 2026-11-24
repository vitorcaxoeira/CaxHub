import test from "node:test";
import assert from "node:assert/strict";
import { campoFiltroValido, validarValorFiltro } from "./preferenciasFiltros";

test("campoFiltroValido: nome estável, sem espaço nem rótulo", () => {
  for (const ok of ["empFil", "anos", "tiposNf", "busca", "a-b_c"]) assert.equal(campoFiltroValido(ok), true, ok);
  for (const ruim of ["", "Empresa/filial", "1anos", "a".repeat(41), null, 3]) assert.equal(campoFiltroValido(ruim), false, String(ruim));
});

test("validarValorFiltro: lista vazia é um valor ('Todos'), diferente de não ter padrão", () => {
  assert.deepEqual(validarValorFiltro([]), []);
  assert.deepEqual(validarValorFiltro([2026]), [2026]);
  assert.deepEqual(validarValorFiltro(["1:2", "1:3"]), ["1:2", "1:3"]);
  assert.equal(validarValorFiltro("cimento"), "cimento");
  assert.equal(validarValorFiltro(""), "");
  assert.equal(validarValorFiltro(true), true);
});

test("validarValorFiltro: null (Todas num select) e lista de objetos planos (cliente escolhido)", () => {
  assert.equal(validarValorFiltro(null), null);
  assert.deepEqual(validarValorFiltro([{ cod: 10, nome: "ACME" }]), [{ cod: 10, nome: "ACME" }]);
  assert.deepEqual(validarValorFiltro([{ cod: "7", nome: null }]), [{ cod: "7", nome: null }]);
  for (const ruim of [[{ a: { b: 1 } }], [{ "chave ruim": 1 }], [{ a: [1] }], [{ a: 1 }, 2], [{ a: "x".repeat(201) }]]) {
    assert.equal(validarValorFiltro(ruim), undefined, JSON.stringify(ruim));
  }
  const grande = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
  assert.equal(validarValorFiltro([grande]), undefined);
});

test("validarValorFiltro: recusa formato que não é de filtro", () => {
  for (const ruim of [undefined, { a: 1 }, [null], [[1]], NaN, "x".repeat(201), Array.from({ length: 501 }, (_, i) => i)]) {
    assert.equal(validarValorFiltro(ruim), undefined, JSON.stringify(ruim)?.slice(0, 40));
  }
});
