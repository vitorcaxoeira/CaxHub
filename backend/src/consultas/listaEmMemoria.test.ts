import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { ErroEntradaConsulta } from "./consultaColunas";
import { type ColunaMemoria, normalizarLinha, paginaDaLista, prepararLista, resumoDaLista, valoresDaLista } from "./listaEmMemoria";

const COLUNAS: ColunaMemoria[] = [
  { nome: "id", tipo: "inteiro", obrigatoria: true },
  { nome: "cliente", tipo: "texto" },
  { nome: "valor", tipo: "decimal" },
  { nome: "custo", tipo: "decimal" },
  { nome: "data", tipo: "data", utc: true },
];

const LINHAS = [
  { id: 3, cliente: "Alfa", valor: 100, custo: 40, data: new Date("2026-10-01T00:00:00.000Z") },
  { id: 2, cliente: "beta", valor: 50, custo: null, data: new Date("2026-10-05T00:00:00.000Z") },
  { id: 1, cliente: "Alfa Ltda", valor: new Prisma.Decimal("25.5"), custo: 5, data: null },
];

test("normaliza Date, Decimal e BigInt como a tela recebe", () => {
  assert.deepEqual(normalizarLinha({ d: new Date("2026-01-02T00:00:00.000Z"), x: new Prisma.Decimal("1.5"), b: BigInt(7), t: "a" }), {
    d: "2026-01-02T00:00:00.000Z",
    x: 1.5,
    b: 7,
    t: "a",
  });
});

test("sem filtro nem ordem: a ordem é a da rota, com página e totais sobre tudo", () => {
  const p = prepararLista(COLUNAS, LINHAS, {});
  const r = paginaDaLista(p, { page: 1, pageSize: 2, totais: ["valor"] });
  assert.deepEqual(r.itens.map((l) => l.id), [3, 2]);
  assert.equal(r.total, 3);
  assert.equal(r.totais.valor, 175.5);
  assert.equal(r.colunas.find((c) => c.nome === "id")?.operadores.includes("vazio"), false);
});

test("filtro de texto sem diferenciar maiúsculas, ordem por coluna, nulo por último", () => {
  const p = prepararLista(COLUNAS, LINHAS, {
    filtros: JSON.stringify([{ coluna: "cliente", operador: "contém", valores: ["alfa"] }]),
    ordem: "valor:asc",
  });
  const r = paginaDaLista(p, { page: 1, pageSize: 50, totais: ["valor"] });
  assert.deepEqual(r.itens.map((l) => l.id), [1, 3]);
  assert.equal(r.totais.valor, 125.5);
  const porCusto = paginaDaLista(prepararLista(COLUNAS, LINHAS, { ordem: "custo:desc" }), { page: 1, pageSize: 50 });
  assert.deepEqual(porCusto.itens.map((l) => l.id), [3, 1, 2]);
});

test("resumo sobre as linhas do filtro e valores do funil sem o filtro da própria coluna", () => {
  const q = { filtros: JSON.stringify([{ coluna: "valor", operador: "≥", valores: ["50"] }]), resumo: JSON.stringify([{ coluna: "valor", funcao: "soma" }, { coluna: "cliente", funcao: "distintos" }]) };
  const p = prepararLista(COLUNAS, LINHAS, q);
  assert.deepEqual(resumoDaLista(p, q), { linhas: 2, valores: { "valor:soma": 150, "cliente:distintos": 2 } });
  const v = valoresDaLista(p, "valor", "");
  assert.equal(v.valores.length, 3);
  assert.equal(valoresDaLista(p, "cliente", "alfa").valores.length, 1); // "Alfa Ltda" (valor 25,5) fica fora pelo filtro de valor
});

test("coluna calculada: fórmula por linha, filtrável e ordenável; inválida volta em problemas", () => {
  const calculadas = JSON.stringify([
    { nome: "calc_1", arvore: { t: "bin", op: "-", a: { t: "col", nome: "valor" }, b: { t: "col", nome: "custo" } } },
    { nome: "calc_2", arvore: { t: "col", nome: "naoExiste" } },
  ]);
  const p = prepararLista(COLUNAS, LINHAS, { calculadas, ordem: "calc_1:desc" });
  assert.ok(p.problemas.calc_2);
  const r = paginaDaLista(p, { page: 1, pageSize: 50 });
  assert.deepEqual(r.itens.map((l) => [l.id, l.calc_1]), [[3, 60], [1, 20.5], [2, null]]);
  const f = prepararLista(COLUNAS, LINHAS, { calculadas, filtros: JSON.stringify([{ coluna: "calc_1", operador: "≥", valores: ["30"] }]) });
  assert.deepEqual(paginaDaLista(f, { page: 1, pageSize: 50 }).itens.map((l) => l.id), [3]);
});

test("entrada inválida vira erro de entrada (400)", () => {
  assert.throws(() => prepararLista(COLUNAS, LINHAS, { filtros: "{quebrado" }), ErroEntradaConsulta);
  assert.throws(() => prepararLista(COLUNAS, LINHAS, { filtros: JSON.stringify([{ coluna: "senha", operador: "=", valores: ["x"] }]) }), ErroEntradaConsulta);
  assert.throws(() => prepararLista(COLUNAS, LINHAS, { ordem: "senha:asc" }), ErroEntradaConsulta);
  assert.throws(() => resumoDaLista(prepararLista(COLUNAS, LINHAS, {}), { resumo: JSON.stringify([{ coluna: "cliente", funcao: "soma" }]) }), ErroEntradaConsulta);
  assert.throws(() => prepararLista(COLUNAS, LINHAS, { calculadas: JSON.stringify([{ nome: "id", arvore: { t: "num", v: 1 } }]) }), ErroEntradaConsulta);
});
