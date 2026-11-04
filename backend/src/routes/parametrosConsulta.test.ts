import test from "node:test";
import assert from "node:assert/strict";
import { escaparLike, lerData, lerEmpresasFiliais, lerInteiro, lerListaInt, lerListaTexto, paresSql } from "./parametrosConsulta";

test("lerData: só AAAA-MM-DD válido", () => {
  assert.equal(lerData("2026-10-16"), "2026-10-16");
  assert.equal(lerData("2026-13-40"), null);
  assert.equal(lerData("16/10/2026"), null);
  assert.equal(lerData(undefined), null);
});

test("lerEmpresasFiliais + paresSql: descarta par inválido e nunca deixa texto cru passar", () => {
  const pares = lerEmpresasFiliais("1:1,1:2,x:3,4");
  assert.deepEqual(pares, [
    { codemp: 1, codfil: 1 },
    { codemp: 1, codfil: 2 },
  ]);
  assert.equal(paresSql(pares), "(1,1),(1,2)");
  assert.deepEqual(lerEmpresasFiliais("1:1); DROP TABLE x;--"), []);
});

test("lerListaInt e lerListaTexto", () => {
  assert.deepEqual(lerListaInt("1,3, 4,abc,"), [1, 3, 4]);
  assert.deepEqual(lerListaInt(undefined), []);
  assert.deepEqual(lerListaInt("0,1"), [0, 1]); // 0 é válido (tipo "Sem tipo")
  assert.deepEqual(lerListaTexto("2,3,9", (s) => ["1", "2", "3"].includes(s)), ["2", "3"]);
});

test("lerInteiro: padrão quando inválido, respeita mínimo e teto", () => {
  assert.equal(lerInteiro("abc", 50, 1, 500), 50);
  assert.equal(lerInteiro("0", 50, 1, 500), 1);
  assert.equal(lerInteiro("9999", 50, 1, 500), 500);
  assert.equal(lerInteiro("100", 50, 1, 500), 100);
});

test("escaparLike: % e _ viram literais", () => {
  assert.equal(escaparLike("100%_a\\b"), "100\\%\\_a\\\\b");
});
