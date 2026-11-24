import assert from "node:assert/strict";
import { test } from "node:test";
import { totalDasFerias } from "./feriasNota";

test("totalDasFerias: soma em centavos, sem resíduo de ponto flutuante", () => {
  assert.equal(totalDasFerias([]), 0);
  assert.equal(totalDasFerias([{ valor: 3744.66 }]), 3744.66);
  assert.equal(totalDasFerias([{ valor: 0.1 }, { valor: 0.2 }]), 0.3);
  assert.equal(totalDasFerias([{ valor: 1000.005 }, { valor: 2000.004 }]), 3000.01);
});
