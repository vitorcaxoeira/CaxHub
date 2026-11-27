import assert from "node:assert/strict";
import { test } from "node:test";
import { motivoParaRecusarModo, type ModoVarredura } from "./politicaVarredura";

test("nenhuma tabela pula de desligada direto para marcar; as outras trocas são aceitas", () => {
  assert.match(motivoParaRecusarModo("Cargos", "desligada", "marcar")!, /passe por "Simular" primeiro/);
  const aceitas: [ModoVarredura, ModoVarredura][] = [
    ["desligada", "simular"],
    ["desligada", "desligada"],
    ["simular", "marcar"],
    ["simular", "desligada"],
    ["marcar", "marcar"],
    ["marcar", "simular"],
    ["marcar", "desligada"],
  ];
  for (const [de, para] of aceitas) assert.equal(motivoParaRecusarModo("Cargos", de, para), null, `${de} -> ${para}`);
});
