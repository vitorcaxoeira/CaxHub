import assert from "node:assert/strict";
import { test } from "node:test";
import { FATSER_FATURAVEL, itemFaturavel } from "./eficienciaPropostas";

test("itemFaturavel: S e A são faturáveis, ignorando maiúscula e espaço", () => {
  for (const f of FATSER_FATURAVEL) assert.equal(itemFaturavel(f), true);
  assert.equal(itemFaturavel("s"), true);
  assert.equal(itemFaturavel(" A "), true);
});

test("itemFaturavel: demais códigos, vazio, nulo e sem item caem em não faturável (mesma régua do SQL da Gestão Propostas)", () => {
  for (const f of ["N", "n", "C", "H", "I", "", "  ", "X"]) assert.equal(itemFaturavel(f), false, `"${f}"`);
  assert.equal(itemFaturavel(null), false);
  assert.equal(itemFaturavel(undefined), false);
});
