import assert from "node:assert/strict";
import { test } from "node:test";
import { SITPRO_EM_EXECUCAO, SITPRO_EXECUTADA, SITPRO_FINALIZAVEL, SITPRO_LABELS } from "./propostasDominio";

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
