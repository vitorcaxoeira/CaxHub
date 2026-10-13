import test from "node:test";
import assert from "node:assert/strict";
import { SITRAT_CANCELADO, filtroRatItemRealizado } from "./ratDominio";

test("o filtro de hora realizada tira RAT cancelada, item excluído no Senior e RAT excluída", () => {
  assert.deepEqual(filtroRatItemRealizado(), {
    removidoEmSenior: null,
    rat: { sitrat: { not: SITRAT_CANCELADO }, removidoEmSenior: null },
  });
});

test("condições do cabeçalho entram sem desfazer as regras do filtro", () => {
  const filtro = filtroRatItemRealizado({ codfor: 653 });
  assert.deepEqual(filtro.rat, { codfor: 653, sitrat: { not: SITRAT_CANCELADO }, removidoEmSenior: null });
  assert.equal(filtro.removidoEmSenior, null);

  // Quem chama não consegue, sem querer, reabrir o que o filtro fecha.
  const tentativa = filtroRatItemRealizado({ sitrat: 5, removidoEmSenior: new Date() });
  assert.deepEqual(tentativa.rat, { sitrat: { not: SITRAT_CANCELADO }, removidoEmSenior: null });
});
