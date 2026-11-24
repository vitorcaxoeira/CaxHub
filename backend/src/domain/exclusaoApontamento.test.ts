import assert from "node:assert/strict";
import { test } from "node:test";
import { CODIGO_AJUSTE_PENDENTE, confirmouExcluirAjuste, decidirExclusaoComAjuste } from "./exclusaoApontamento";

test("sem pedido de ajuste: exclui direto, nada a levar junto", () => {
  assert.deepEqual(decidirExclusaoComAjuste([], false), { ok: true, ajustesAExcluir: [] });
});

test("com pedido pendente e sem a confirmação: 409 ajuste_pendente e não exclui", () => {
  const d = decidirExclusaoComAjuste([{ id: 221, status: "pendente" }], false);
  assert.equal(d.ok, false);
  if (d.ok) return;
  assert.equal(d.status, 409);
  assert.equal(d.body.codigo, CODIGO_AJUSTE_PENDENTE);
  assert.equal(d.body.solicitacaoId, 221);
  assert.match(d.body.error, /será excluída junto com o apontamento/);
});

test("com pedido pendente e confirmação: exclui o apontamento e leva o pedido pendente junto", () => {
  assert.deepEqual(decidirExclusaoComAjuste([{ id: 221, status: "pendente" }], true), { ok: true, ajustesAExcluir: [221] });
});

test("pedidos já decididos (aprovada/reprovada) não pedem aviso nem são excluídos: ficam como histórico", () => {
  const ajustes = [
    { id: 10, status: "aprovada" },
    { id: 11, status: "reprovada" },
  ];
  assert.deepEqual(decidirExclusaoComAjuste(ajustes, false), { ok: true, ajustesAExcluir: [] });
  assert.deepEqual(decidirExclusaoComAjuste([...ajustes, { id: 12, status: "pendente" }], true), { ok: true, ajustesAExcluir: [12] });
});

test("confirmação: só ?excluirAjuste=1 ou true", () => {
  assert.equal(confirmouExcluirAjuste("1"), true);
  assert.equal(confirmouExcluirAjuste("true"), true);
  for (const v of [undefined, "", "0", "false", "sim", ["1"]]) assert.equal(confirmouExcluirAjuste(v), false);
});
