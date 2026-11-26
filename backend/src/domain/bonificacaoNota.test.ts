import assert from "node:assert/strict";
import { test } from "node:test";
import { totalDaBonificacao } from "./bonificacaoNota";

test("totalDaBonificacao: soma em centavos sem erro de ponto flutuante", () => {
  assert.equal(totalDaBonificacao([]), 0);
  assert.equal(totalDaBonificacao([{ valor: 240 }, { valor: 200 }, { valor: 400 }, { valor: 200 }, { valor: 400 }]), 1440);
  // 0,1 + 0,2 não é 0,3 em ponto flutuante: o total sai arredondado a centavos
  assert.equal(totalDaBonificacao([{ valor: 0.1 }, { valor: 0.2 }]), 0.3);
  assert.equal(totalDaBonificacao([{ valor: 33.335 }, { valor: 33.335 }]), 66.67);
});
