import assert from "node:assert/strict";
import { test } from "node:test";
import { indicacaoDaNota } from "./bonificacaoContrato";

test("indicacaoDaNota: só vai para a nota se o processo compõe a nota E o consultor tem contrato Fixo/Hora", () => {
  assert.deepEqual(indicacaoDaNota(true, "hora"), { vaiParaNota: true, contrato: "hora", motivo: null });
  assert.deepEqual(indicacaoDaNota(true, "fixo"), { vaiParaNota: true, contrato: "fixo", motivo: null });
  const semContrato = indicacaoDaNota(true, null);
  assert.equal(semContrato.vaiParaNota, false);
  assert.match(semContrato.motivo!, /contrato/i);
  const semFlag = indicacaoDaNota(false, "hora");
  assert.equal(semFlag.vaiParaNota, false);
  assert.equal(semFlag.contrato, "hora");
  assert.match(semFlag.motivo!, /não compõe/i);
  // sem a flag o motivo é o do processo, mesmo sem contrato
  assert.match(indicacaoDaNota(false, null).motivo!, /não compõe/i);
});
