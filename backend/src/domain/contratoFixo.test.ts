import assert from "node:assert/strict";
import { test } from "node:test";
import { CODMOT_CONTRATO_FIXO, contratoFixoDe, totalDoContratoFixo } from "./contratoFixo";

test("contratoFixoDe: só codmot 12 com quantidade vira fixo; valor mensal = vlrhor × qtdctr em centavos", () => {
  assert.equal(CODMOT_CONTRATO_FIXO, 12);
  assert.deepEqual(contratoFixoDe({ codmot: 12, vlrhor: 93.897, qtdctr: 150 }), { qtd: 150, valorMensal: 14084.55 });
  assert.deepEqual(contratoFixoDe({ codmot: 12, vlrhor: 73.3633, qtdctr: 150 }), { qtd: 150, valorMensal: 11004.5 });
  assert.deepEqual(contratoFixoDe({ codmot: 12, vlrhor: 44.41, qtdctr: 191.4 }), { qtd: 191.4, valorMensal: 8500.07 });
  // vlrhor com muitas casas (108,33333334 × 120) não deixa resíduo.
  assert.equal(contratoFixoDe({ codmot: 12, vlrhor: 108.33333334, qtdctr: 120 })?.valorMensal, 13000);
});

test("contratoFixoDe: contrato por hora, fixo sem quantidade ou quantidade inválida não são fixos", () => {
  assert.equal(contratoFixoDe({ codmot: 16, vlrhor: 80, qtdctr: 150 }), null, "outro motivo");
  assert.equal(contratoFixoDe({ codmot: null, vlrhor: 80, qtdctr: 150 }), null);
  assert.equal(contratoFixoDe({ codmot: 12, vlrhor: 80, qtdctr: null }), null, "sem quantidade");
  assert.equal(contratoFixoDe({ codmot: 12, vlrhor: 80, qtdctr: 0 }), null);
  assert.equal(contratoFixoDe({ codmot: 12, vlrhor: 80, qtdctr: -5 }), null);
  assert.equal(contratoFixoDe({ codmot: 12, vlrhor: 80, qtdctr: Number.NaN }), null);
});

test("totalDoContratoFixo: o fixo vale por mês do período e o deslocamento entra em cima", () => {
  const fixo = { qtd: 150, valorMensal: 14084.55 };
  assert.deepEqual(totalDoContratoFixo(fixo, 1, 0), { qtd: 150, valorMensal: 14084.55, meses: 1, deslocamento: 0, total: 14084.55 });
  assert.equal(totalDoContratoFixo(fixo, 2, 0).total, 28169.1);
  assert.equal(totalDoContratoFixo(fixo, 1, 123.456).deslocamento, 123.46);
  assert.equal(totalDoContratoFixo(fixo, 1, 123.456).total, 14208.01);
  assert.equal(totalDoContratoFixo(fixo, 0, 50).total, 50, "sem mês no período sobra só o deslocamento");
  assert.equal(totalDoContratoFixo(fixo, 1, -10).deslocamento, 0, "deslocamento negativo não reduz o fixo");
});
