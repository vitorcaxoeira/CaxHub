import { test } from "node:test";
import assert from "node:assert/strict";
import { camposQueMudaram, horariosDoSenior, motivoBloqueioManutencao } from "./manutencaoSessao";

// 2026-11-05 em Brasília (UTC-3): 09:00 = 12:00Z
const em = (hhmmZ: string) => new Date(`2026-11-05T${hhmmZ}:00Z`);

test("horariosDoSenior: converte para minutos de parede brasileira", () => {
  const r = horariosDoSenior(em("12:00"), em("15:30"));
  assert.deepEqual(r, { ok: true, horini: 9 * 60, horfim: 12 * 60 + 30 });
});

test("horariosDoSenior: segundos de diferença no mesmo minuto são duração zero", () => {
  const r = horariosDoSenior(new Date("2026-11-05T12:00:05Z"), new Date("2026-11-05T12:00:50Z"));
  assert.equal(r.ok, false);
});

test("horariosDoSenior: fim antes do início é recusado", () => {
  assert.equal(horariosDoSenior(em("15:00"), em("12:00")).ok, false);
});

const base = { datati: new Date("2026-11-05T00:00:00Z"), horini: 540, horfim: 720, desati: "Teste" };

test("camposQueMudaram: nada mudou", () => {
  assert.deepEqual(camposQueMudaram(base, { ...base }), []);
});

test("camposQueMudaram: espaços nas pontas da descrição não contam", () => {
  assert.deepEqual(camposQueMudaram(base, { ...base, desati: "  Teste " }), []);
  assert.deepEqual(camposQueMudaram({ ...base, desati: null }, { ...base, desati: "" }), []);
});

test("camposQueMudaram: lista cada campo alterado", () => {
  const depois = { datati: new Date("2026-11-06T00:00:00Z"), horini: 550, horfim: 730, desati: "Outro" };
  assert.deepEqual(camposQueMudaram(base, depois), ["datati", "horini", "horfim", "desati"]);
});

test("camposQueMudaram: só descrição", () => {
  assert.deepEqual(camposQueMudaram(base, { ...base, desati: "Novo" }), ["desati"]);
});

const ok = { souAdmin: true, temRatItem: true, removidaNoSenior: false, sitrat: 9 };

test("motivoBloqueioManutencao: admin com RAT Digitada pode", () => {
  assert.equal(motivoBloqueioManutencao(ok), null);
});

test("motivoBloqueioManutencao: quem não é admin só lê, mesmo com a RAT Digitada", () => {
  assert.match(motivoBloqueioManutencao({ ...ok, souAdmin: false })!, /Somente o administrador/);
});

test("motivoBloqueioManutencao: RAT fora de Digitado, excluída ou sessão sem RAT bloqueiam", () => {
  for (const sitrat of [8, 6, 5, 4, 2, 1, null]) {
    assert.match(motivoBloqueioManutencao({ ...ok, sitrat })!, /Digitado/, String(sitrat));
  }
  assert.match(motivoBloqueioManutencao({ ...ok, removidaNoSenior: true })!, /excluída no Senior/);
  assert.match(motivoBloqueioManutencao({ ...ok, temRatItem: false })!, /ainda não foi confirmada/);
});
