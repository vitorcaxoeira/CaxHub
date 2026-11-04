import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ORDEM, ordemParaTexto, validarOrdem } from "./ordemColuna";

const COLUNAS = ["codObra", "sigla", "status", "dataInicial"];

test("ordem: aceita texto 'coluna:desc,outra', direção omitida = crescente", () => {
  assert.deepEqual(validarOrdem(COLUNAS, "status:desc,sigla"), [
    { coluna: "status", direcao: "desc" },
    { coluna: "sigla", direcao: "asc" },
  ]);
  assert.deepEqual(validarOrdem(COLUNAS, ["codObra:asc"]), [{ coluna: "codObra", direcao: "asc" }]);
});

test("ordem: vazio ou ausente = sem critério", () => {
  assert.deepEqual(validarOrdem(COLUNAS, undefined), []);
  assert.deepEqual(validarOrdem(COLUNAS, ""), []);
  assert.deepEqual(validarOrdem(COLUNAS, " , "), []);
});

test("ordem: recusa coluna fora da lista (nada vira SQL a partir do cliente), direção inválida, repetida e excesso", () => {
  assert.throws(() => validarOrdem(COLUNAS, "senha:asc"), /não existe/);
  assert.throws(() => validarOrdem(COLUNAS, "sigla; DROP TABLE x:asc"), /não existe/);
  assert.throws(() => validarOrdem(COLUNAS, "sigla:cima"), /inválida/);
  assert.throws(() => validarOrdem(COLUNAS, "sigla:asc:extra"), /inválida/);
  assert.throws(() => validarOrdem(COLUNAS, "sigla,sigla:desc"), /duas vezes/);
  assert.throws(() => validarOrdem(COLUNAS, 42), /inválida/);
  assert.throws(() => validarOrdem(["a", "b", "c", "d", "e"], "a,b,c,d,e"), new RegExp(`No máximo ${MAX_ORDEM}`));
});

test("ordem: ida e volta pelo texto da URL", () => {
  const ordem = validarOrdem(COLUNAS, "status:desc,codObra");
  assert.equal(ordemParaTexto(ordem), "status:desc,codObra:asc");
  assert.deepEqual(validarOrdem(COLUNAS, ordemParaTexto(ordem)), ordem);
});
