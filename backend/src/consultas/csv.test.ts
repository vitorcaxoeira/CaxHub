import assert from "node:assert/strict";
import { test } from "node:test";
import { celulaCsv, colunasDaExportacao, montarCsv } from "./csv";

test("célula: vírgula decimal, minutos em horas decimais, vazio, texto com separador e proteção contra fórmula", () => {
  assert.equal(celulaCsv(17359.1, "decimal"), "17359,10");
  assert.equal(celulaCsv(9854, "decimal", "horasMinutos"), "164,23");
  assert.equal(celulaCsv(-173, "decimal", "horasMinutos"), "-2,88");
  assert.equal(celulaCsv(null, "decimal"), "");
  assert.equal(celulaCsv(505, "inteiro"), "505");
  assert.equal(celulaCsv(true, "booleano"), "Sim");
  assert.equal(celulaCsv("a;b", "texto"), '"a;b"');
  assert.equal(celulaCsv("=1+1", "texto"), "'=1+1");
});

test("colunas da exportação: as visíveis na ordem da tela, com os títulos dela; sem pedido válido, todas", () => {
  const existe = (n: string) => ["consultor", "valor", "horas"].includes(n);
  const r = colunasDaExportacao({ colunasCsv: "valor,consultor,inventada", cabecalhos: JSON.stringify({ valor: "A provisionar" }) }, existe, ["consultor", "valor", "horas"]);
  assert.deepEqual(r.nomes, ["valor", "consultor"]);
  assert.equal(r.tituloDe("valor"), "A provisionar");
  assert.equal(r.tituloDe("consultor"), "consultor");
  assert.deepEqual(colunasDaExportacao({ cabecalhos: "{quebrado" }, existe, ["consultor", "valor"]).nomes, ["consultor", "valor"]);
});

test("arquivo: BOM, ';' e quebra de linha do Windows", () => {
  const tipos: Record<string, { tipo: "texto" | "decimal" }> = { consultor: { tipo: "texto" }, valor: { tipo: "decimal" } };
  const csv = montarCsv(["consultor", "valor"], (n) => (n === "valor" ? "Mês Anterior" : "Consultor"), (n) => tipos[n], [
    { consultor: "Fulano", valor: 10 },
    { consultor: "Beltrana", valor: 0.5 },
  ]);
  assert.equal(csv, "﻿Consultor;Mês Anterior\r\nFulano;10,00\r\nBeltrana;0,50");
});
