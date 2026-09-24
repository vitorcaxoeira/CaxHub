// Verificação manual das regras puras do 5S contra os números da planilha do cliente.
// Rodar: node_modules/.bin/ts-node prisma/verificarGestao5s.ts
import assert from "assert";
import { calcularPercentuais, montarTitulo, podeVerArea, tendencia } from "../src/domain/gestao5s";

const r = (senso: string, notas: Array<number | "NA">) =>
  notas.map((n) => ({ senso, nota: n === "NA" ? null : n, naoSeAplica: n === "NA" }));

// Aba Adm: 96 / 100 / 96 / 100 / 40 → geral 86,4.
const adm = calcularPercentuais([
  ...r("seiri", [4, 5, 5, 5, 5]),
  ...r("seiton", [5, 5, 5, 5, 5]),
  ...r("seiso", [4, 5, 5, 5, 5]),
  ...r("seiketsu", [5, 5, 5, 5, 5]),
  ...r("shitsuke", [2, 2, 2, 2, 2]),
]);
assert.deepStrictEqual(adm.porSenso, { seiri: 96, seiton: 100, seiso: 96, seiketsu: 100, shitsuke: 40 });
assert.strictEqual(adm.geral, 86.4);

// Seiri dos Comuns: 2 NA de 12 respostas não pesam (planilha divide por 75 = 15 × 5; aqui 10 aplicáveis).
const comum = calcularPercentuais(r("seiri", ["NA", "NA", 4, 5, 5, 5, 4, 5, 5, 5, 4, 4]));
assert.strictEqual(comum.porSenso.seiri, 92);

// Senso só com NA fica fora da média geral.
const soNa = calcularPercentuais([...r("seiri", ["NA", "NA"]), ...r("seiton", [5, 5])]);
assert.strictEqual(soNa.porSenso.seiri, null);
assert.strictEqual(soNa.geral, 100);
assert.strictEqual(calcularPercentuais([]).geral, null);

assert.strictEqual(tendencia(90, 80), "melhora");
assert.strictEqual(tendencia(80, 90), "queda");
assert.strictEqual(tendencia(85.5, 85), "estavel");
assert.strictEqual(tendencia(null, 85), null);

assert.strictEqual(montarTitulo(new Date(Date.UTC(2026, 8, 18)), "Administrativo"), "Avaliação 5S – 18/09/2026 – Administrativo");

const lider = { papel: "lider" as const, areasLider: [1] };
assert.ok(podeVerArea(lider, { id: 1, tipo: "setor", setorVinculadoId: null }));
assert.ok(!podeVerArea(lider, { id: 2, tipo: "setor", setorVinculadoId: null }));
assert.ok(podeVerArea(lider, { id: 3, tipo: "comum", setorVinculadoId: null }));
assert.ok(podeVerArea(lider, { id: 4, tipo: "comum", setorVinculadoId: 1 }));
assert.ok(!podeVerArea(lider, { id: 5, tipo: "comum", setorVinculadoId: 2 }));
assert.ok(!podeVerArea({ papel: null, areasLider: [] }, { id: 3, tipo: "comum", setorVinculadoId: null }));
console.log("OK — regras do 5S batem com a planilha");
