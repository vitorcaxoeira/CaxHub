import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarNome, sugerirAtendenteKyria, sugerirColaboradorHcm } from "./vinculoConsultor";

test("normalizarNome tira acento, caixa e pontuação", () => {
  assert.equal(normalizarNome("  José  da Silva-Júnior "), "jose da silva junior");
  assert.equal(normalizarNome(null), "");
});

const membros = [
  { id: "m1", name: "Amarildo Kniess", email: "amarildo@soeltech.com.br" },
  { id: "m2", name: "Tiago Tormen", email: "tiago.t@soeltech.com.br" },
  { id: "m3", name: "Tiago Tormen", email: "outro@soeltech.com.br" },
];

test("Kyria: o mesmo e-mail (sem diferenciar maiúscula) é confiança alta", () => {
  const s = sugerirAtendenteKyria({ email: "Amarildo@Soeltech.com.br" }, membros);
  assert.equal(s?.item.id, "m1");
  assert.equal(s?.confianca, "alta");
});

test("Kyria: sem e-mail igual, o nome igual vale como média", () => {
  const s = sugerirAtendenteKyria({ nomfor: "Amarildo Kniess", email: "x@y.com" }, membros);
  assert.equal(s?.item.id, "m1");
  assert.equal(s?.confianca, "media");
});

test("Kyria: dois atendentes com o mesmo nome é ambíguo — nenhuma sugestão", () => {
  assert.equal(sugerirAtendenteKyria({ nomcom: "Tiago Tormen" }, membros), null);
});

test("Kyria: dois com o mesmo e-mail também não sugere", () => {
  const dup = [...membros, { id: "m4", name: "Outro", email: "amarildo@soeltech.com.br" }];
  assert.equal(sugerirAtendenteKyria({ email: "amarildo@soeltech.com.br" }, dup), null);
});

test("Kyria: sem nada em comum, sem sugestão", () => {
  assert.equal(sugerirAtendenteKyria({ nomfor: "Fulano de Tal", email: "f@x.com" }, membros), null);
  assert.equal(sugerirAtendenteKyria({}, membros), null);
});

const funcionarios = [
  { numcad: 1, nomfun: "Amarildo Kniess" },
  { numcad: 2, nomfun: "Luis Henrique Souza" },
  { numcad: 3, nomfun: "Maria Clara" },
  { numcad: 4, nomfun: "Maria Clara Dias" },
];

test("HCM: nome do fornecedor igual ao do funcionário (sem acento/caixa) é alta", () => {
  const s = sugerirColaboradorHcm({ nomfor: "AMARILDO KNIESS", nomcom: "Amarildo" }, funcionarios);
  assert.equal(s?.item.numcad, 1);
  assert.equal(s?.confianca, "alta");
});

test("HCM: nome com 2+ palavras contido no do funcionário é média", () => {
  const s = sugerirColaboradorHcm({ nomcom: "Luis Henrique " }, funcionarios);
  assert.equal(s?.item.numcad, 2);
  assert.equal(s?.confianca, "media");
});

test("HCM: nome de uma palavra só não sugere por contenção", () => {
  assert.equal(sugerirColaboradorHcm({ nomcom: "Luis" }, funcionarios), null);
});

test("HCM: contido em mais de um funcionário é ambíguo", () => {
  assert.equal(sugerirColaboradorHcm({ nomcom: "Maria Clara" }, [{ numcad: 5, nomfun: "Maria Clara Souza" }, { numcad: 6, nomfun: "Maria Clara Dias" }]), null);
});

test("HCM: nome igual tem prioridade sobre o contido", () => {
  const s = sugerirColaboradorHcm({ nomcom: "Maria Clara" }, funcionarios);
  assert.equal(s?.item.numcad, 3);
  assert.equal(s?.confianca, "alta");
});

test("HCM: dois funcionários com o mesmo nome é ambíguo", () => {
  assert.equal(sugerirColaboradorHcm({ nomfor: "Joao Silva" }, [{ numcad: 7, nomfun: "João Silva" }, { numcad: 8, nomfun: "Joao Silva" }]), null);
});

test("HCM: nomfun nulo não quebra", () => {
  assert.equal(sugerirColaboradorHcm({ nomfor: "Joao Silva" }, [{ numcad: 9, nomfun: null }]), null);
});
