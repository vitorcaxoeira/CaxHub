import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OBSSIT_MAX,
  SITPRO_ABERTA,
  SITPRO_DECLINADA,
  SITPRO_EM_EXECUCAO,
  SITPRO_EXECUTADA,
  SITPRO_FINALIZAVEL,
  SITPRO_LABELS,
  SITPRO_PERDIDAS,
  lerMotivo,
  sitproTone,
} from "./propostasDominio";

test("Gestão Propostas: Finalizar leva para Executada (8) e só parte de Em Execução (7); Em Execução volta de 8 para 7", () => {
  assert.equal(SITPRO_EM_EXECUCAO, 7);
  assert.equal(SITPRO_EXECUTADA, 8);
  assert.deepEqual(SITPRO_FINALIZAVEL, [7]);
  // O estado de destino do Finalizar nunca é também origem dele (não dá para finalizar o que já está executado).
  assert.ok(!SITPRO_FINALIZAVEL.includes(SITPRO_EXECUTADA));
  // Os dois existem no domínio USU_SitPro do Senior (não há "Finalizada" nele).
  assert.equal(SITPRO_LABELS[7], "Em Execução");
  assert.equal(SITPRO_LABELS[8], "Executada");
});

test("situação 9 é Declinada: fora do pipeline em aberto, entre as perdidas e com selo de perda", () => {
  assert.equal(SITPRO_DECLINADA, 9);
  assert.equal(SITPRO_LABELS[9], "Declinada");
  assert.ok(!SITPRO_ABERTA.includes(9));
  assert.ok(SITPRO_PERDIDAS.includes(9));
  assert.equal(sitproTone(9), "destructive");
});

test("lerMotivo: obrigatório nas ações que pedem, aparado, limitado a 200 e ignorado no Finalizar", () => {
  assert.deepEqual(lerMotivo("  Cliente sem orçamento ", true), { ok: true, motivo: "Cliente sem orçamento" });
  assert.equal(lerMotivo("", true).ok, false);
  assert.equal(lerMotivo("   ", true).ok, false);
  assert.equal(lerMotivo(undefined, true).ok, false);
  assert.equal(lerMotivo(123, true).ok, false);
  assert.equal(lerMotivo("x".repeat(OBSSIT_MAX), true).ok, true);
  assert.equal(lerMotivo("x".repeat(OBSSIT_MAX + 1), true).ok, false);
  assert.deepEqual(lerMotivo("qualquer coisa", false), { ok: true, motivo: null });
});
