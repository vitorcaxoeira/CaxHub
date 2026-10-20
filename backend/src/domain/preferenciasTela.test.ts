import test from "node:test";
import assert from "node:assert/strict";
import { preferenciasPublicas, validarPreferencias } from "./preferenciasTela";

test("visão válida passa e só ela é gravada", () => {
  assert.deepEqual(validarPreferencias({ atividadesVisao: "lista", outra: 1 }), { dados: { atividadesVisao: "lista" } });
});

test("visão inválida, vazia ou de outro tipo é recusada", () => {
  for (const v of ["kanban", "", "LISTA", 3, null]) assert.ok("erro" in validarPreferencias({ atividadesVisao: v }), String(v));
});

test("corpo sem preferência conhecida é recusado", () => {
  assert.ok("erro" in validarPreferencias({}));
  assert.ok("erro" in validarPreferencias(undefined));
});

test("quem nunca escolheu (ou tem valor estranho no banco) recebe o Quadro", () => {
  assert.deepEqual(preferenciasPublicas(null), { atividadesVisao: "quadro" });
  assert.deepEqual(preferenciasPublicas({ atividadesVisao: "xyz" }), { atividadesVisao: "quadro" });
  assert.deepEqual(preferenciasPublicas({ atividadesVisao: "workload" }), { atividadesVisao: "workload" });
});
