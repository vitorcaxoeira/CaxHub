import assert from "node:assert/strict";
import { test } from "node:test";
import { anoMesSaoPaulo } from "./carteira";

test("mês da foto segue o fuso de São Paulo, não o UTC do servidor", () => {
  // 1º/11 às 02:00 UTC ainda é 31/10 em São Paulo (UTC-3).
  assert.deepEqual(anoMesSaoPaulo(new Date("2026-11-01T02:00:00Z")), { ano: 2026, mes: 10 });
  // A foto das 6h30 de São Paulo (09:30 UTC) do dia 1º já é do mês novo.
  assert.deepEqual(anoMesSaoPaulo(new Date("2026-11-01T09:30:00Z")), { ano: 2026, mes: 11 });
  // Virada de ano.
  assert.deepEqual(anoMesSaoPaulo(new Date("2027-01-01T02:59:00Z")), { ano: 2026, mes: 12 });
  assert.deepEqual(anoMesSaoPaulo(new Date("2027-01-01T03:00:00Z")), { ano: 2027, mes: 1 });
});
