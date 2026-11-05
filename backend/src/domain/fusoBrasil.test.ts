import assert from "node:assert/strict";
import { test } from "node:test";
import { diaBrasilComoData, inicioDoDiaBrasil } from "./fusoBrasil";

const iso = (d: Date) => d.toISOString();

test("diaBrasilComoData: trabalho das 21h às 23:59 de Brasília fica no MESMO dia (o dia UTC já seria o seguinte)", () => {
  // 04/11/2026 21:14 BRT = 05/11 00:14 UTC (a sessão 3925 de produção)
  assert.equal(iso(diaBrasilComoData(new Date("2026-11-05T00:14:00Z"))), "2026-11-04T00:00:00.000Z");
  assert.equal(iso(diaBrasilComoData(new Date("2026-11-05T02:59:00Z"))), "2026-11-04T00:00:00.000Z"); // 23:59 BRT
  assert.equal(iso(diaBrasilComoData(new Date("2026-11-05T03:01:00Z"))), "2026-11-05T00:00:00.000Z"); // 00:01 BRT
});

test("diaBrasilComoData: durante o dia o dia de Brasília e o UTC coincidem", () => {
  assert.equal(iso(diaBrasilComoData(new Date("2026-11-04T13:00:00Z"))), "2026-11-04T00:00:00.000Z");
});

test("inicioDoDiaBrasil: meia-noite de Brasília do dia do calendário (03:00 UTC em horário padrão)", () => {
  assert.equal(iso(inicioDoDiaBrasil(new Date("2026-11-04T00:00:00Z"))), "2026-11-04T03:00:00.000Z");
});

test("inicioDoDiaBrasil: faixas de dias vizinhos são contíguas e a sessão das 21h cai na faixa do próprio dia", () => {
  const d4 = new Date("2026-11-04T00:00:00Z");
  const d5 = new Date("2026-11-05T00:00:00Z");
  const sessao = new Date("2026-11-05T00:14:00Z"); // 04/11 21:14 BRT
  assert.ok(sessao >= inicioDoDiaBrasil(d4) && sessao < inicioDoDiaBrasil(d5));
  // virada de mês: 30/11 23:30 BRT (01/12 02:30 UTC) é de novembro
  const fimNov = new Date("2026-12-01T02:30:00Z");
  assert.ok(fimNov >= inicioDoDiaBrasil(new Date("2026-11-01T00:00:00Z")) && fimNov < inicioDoDiaBrasil(new Date("2026-12-01T00:00:00Z")));
});
