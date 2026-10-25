import test from "node:test";
import assert from "node:assert/strict";
import { ColunaFiltravel, operadoresDaColuna, validarFiltrosColuna, whereDosFiltros } from "./filtroColunaLocal";

const COLUNAS: ColunaFiltravel[] = [
  { nome: "numlct", tipo: "inteiro", obrigatoria: true, prisma: "BigInt" },
  { nome: "ctared", tipo: "inteiro", obrigatoria: true, prisma: "Int" },
  { nome: "codccu", tipo: "texto", obrigatoria: true, prisma: "String" },
  { nome: "vlrrat", tipo: "decimal", obrigatoria: false, prisma: "Decimal" },
  { nome: "datlct", tipo: "data", obrigatoria: false, prisma: "DateTime" },
  { nome: "extra", tipo: "json", obrigatoria: false, prisma: "Json" },
];

test("operadores por tipo: vazio só em coluna que aceita nulo; json sem filtro", () => {
  assert.ok(!operadoresDaColuna(COLUNAS[1]).includes("vazio"));
  assert.ok(operadoresDaColuna(COLUNAS[4]).includes("vazio"));
  assert.deepEqual(operadoresDaColuna(COLUNAS[5]), []);
  assert.ok(!operadoresDaColuna(COLUNAS[3]).includes("IN"), "decimal não tem IN");
});

test("filtros válidos passam e viram where em E, com o tipo do schema", () => {
  const f = validarFiltrosColuna(COLUNAS, [
    { coluna: "ctared", operador: "=", valores: ["583"] },
    { coluna: "numlct", operador: "IN", valores: ["1300765961", "1300750484"] },
    { coluna: "codccu", operador: "contém", valores: ["601"] },
    { coluna: "datlct", operador: "entre", valores: ["2026-01-01", "2026-03-31"] },
  ]);
  const w = whereDosFiltros(COLUNAS, f) as { AND: Record<string, unknown>[] };
  assert.equal(w.AND.length, 4);
  assert.deepEqual(w.AND[0], { ctared: 583 });
  assert.deepEqual(w.AND[1], { numlct: { in: [1300765961n, 1300750484n] } });
  assert.deepEqual(w.AND[2], { codccu: { contains: "601", mode: "insensitive" } });
  // data "entre": do início do 1º dia até ANTES do dia seguinte ao último (inclui o dia inteiro)
  assert.deepEqual(w.AND[3], { datlct: { gte: new Date("2026-01-01T00:00:00.000Z"), lt: new Date("2026-04-01T00:00:00.000Z") } });
});

test("data com = cobre o dia inteiro; vazio vira null", () => {
  const f = validarFiltrosColuna(COLUNAS, [
    { coluna: "datlct", operador: "=", valores: ["2026-08-21"] },
    { coluna: "vlrrat", operador: "vazio", valores: [] },
  ]);
  const w = whereDosFiltros(COLUNAS, f) as { AND: Record<string, unknown>[] };
  assert.deepEqual(w.AND[0], { datlct: { gte: new Date("2026-08-21T00:00:00.000Z"), lt: new Date("2026-08-22T00:00:00.000Z") } });
  assert.deepEqual(w.AND[1], { vlrrat: null });
});

test("entradas inválidas são recusadas com mensagem", () => {
  const recusa = (bruto: unknown, trecho: RegExp) => assert.throws(() => validarFiltrosColuna(COLUNAS, bruto), trecho);
  recusa([{ coluna: "naoexiste", operador: "=", valores: ["1"] }], /não existe/);
  recusa([{ coluna: "codccu", operador: "≥", valores: ["1"] }], /não vale/);
  recusa([{ coluna: "ctared", operador: "vazio", valores: [] }], /não vale/); // obrigatória
  recusa([{ coluna: "datlct", operador: "=", valores: ["21/08/2026"] }], /AAAA-MM-DD/);
  recusa([{ coluna: "ctared", operador: "=", valores: ["abc"] }], /número/);
  recusa([{ coluna: "datlct", operador: "entre", valores: ["2026-01-01"] }], /início e o fim/);
  recusa([{ coluna: "ctared", operador: "IN", valores: Array.from({ length: 501 }, (_, i) => String(i)) }], /No máximo 500/);
  recusa([{ coluna: "extra", operador: "=", valores: ["x"] }], /não tem filtro/);
  recusa("nao-e-lista", /inválidos/);
});

test("sem filtros: lista vazia e where indefinido", () => {
  assert.deepEqual(validarFiltrosColuna(COLUNAS, undefined), []);
  assert.equal(whereDosFiltros(COLUNAS, []), undefined);
});
