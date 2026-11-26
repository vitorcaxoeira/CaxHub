import assert from "node:assert/strict";
import { test } from "node:test";
import { kbDaResposta, linhasDaResposta } from "./registroLeitura";

test("linhasDaResposta: lista paginada, relatório agregado e resposta sem dados", () => {
  assert.equal(linhasDaResposta({ data: [{ id: "a" }, { id: "b" }], page: { hasMore: false, nextCursor: null } }), 2);
  assert.equal(linhasDaResposta({ data: { rows: [{ minutes: 1 }, { minutes: 2 }, { minutes: 3 }], totalMinutes: 6 } }), 3);
  assert.equal(linhasDaResposta({ data: [] }), 0);
  assert.equal(linhasDaResposta({ error: { code: "X" } }), 0);
  assert.equal(linhasDaResposta(null), 0);
  assert.equal(linhasDaResposta(undefined), 0);
});

test("kbDaResposta: usa o Content-Length quando existe; senão mede o JSON recebido", () => {
  assert.equal(kbDaResposta({ data: [] }, "20480"), 20);
  assert.equal(kbDaResposta({ data: [] }, 2048), 2);
  const medido = kbDaResposta({ texto: "x".repeat(4096) });
  assert.ok(medido >= 4 && medido <= 5, `esperado ~4 KB, veio ${medido}`);
  // Content-Length inválido cai na medição
  assert.ok(kbDaResposta({ texto: "x".repeat(2048) }, "abc") >= 2);
  assert.equal(kbDaResposta(null), 0);
});
