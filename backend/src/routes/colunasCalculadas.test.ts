import { test } from "node:test";
import assert from "node:assert/strict";
import { validarColunaCalculada } from "./colunasCalculadas";

const ARVORE = { t: "bin", op: "/", a: { t: "col", nome: "consumoErp" }, b: { t: "num", v: 2 } };

test("aceita o corpo da tela, com padrões para formato, casas e publicada", () => {
  assert.deepEqual(validarColunaCalculada({ titulo: " Metade ", formula: "[Consumo ERP] / 2", arvore: ARVORE }), {
    ok: true,
    valor: { titulo: "Metade", formula: "[Consumo ERP] / 2", arvore: ARVORE, formato: "numero", casas: 2, publicada: false },
  });
});

test("recusa título, fórmula, formato, casas e árvore inválidos", () => {
  const base = { titulo: "X", formula: "1", arvore: { t: "num", v: 1 } };
  const erro = (extra: Record<string, unknown>) => {
    const r = validarColunaCalculada({ ...base, ...extra });
    return r.ok ? null : r.erro;
  };
  assert.match(erro({ titulo: "  " })!, /título/);
  assert.match(erro({ titulo: "x".repeat(61) })!, /título/);
  assert.match(erro({ formula: "" })!, /Fórmula vazia/);
  assert.match(erro({ formato: "data" })!, /Formato/);
  assert.match(erro({ casas: 4 })!, /Casas/);
  assert.match(erro({ publicada: "sim" })!, /Publicada/);
  assert.match(erro({ arvore: { t: "col", nome: "a; DROP" } })!, /Coluna inválida/);
  assert.match(erro({ arvore: { t: "fn", nome: "PG_SLEEP", args: [] } })!, /Função inválida/);
  assert.equal(validarColunaCalculada(null).ok, false);
});
