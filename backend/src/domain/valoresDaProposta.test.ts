import assert from "node:assert/strict";
import { test } from "node:test";
import { podeVerValoresDaProposta } from "./valoresDaProposta";

test("admin e comercial veem os valores, com ou sem gestão de área", () => {
  assert.equal(podeVerValoresDaProposta("admin", []), true);
  assert.equal(podeVerValoresDaProposta("comercial", []), true);
});

test("gestor de área vê, qualquer que seja o perfil", () => {
  for (const role of ["consultoria", "suporte", "desenvolvimento", "administrativo"]) assert.equal(podeVerValoresDaProposta(role, [8]), true, role);
});

test("os demais perfis, sem gerenciar departamento, não veem", () => {
  for (const role of ["consultoria", "suporte", "desenvolvimento", "administrativo", "system", ""]) assert.equal(podeVerValoresDaProposta(role, []), false, role);
});
