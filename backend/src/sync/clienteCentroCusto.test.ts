import test from "node:test";
import assert from "node:assert/strict";
import { escolherCentroCustoPorCliente } from "./clienteCentroCusto";

test("1 rateio por cliente: devolve o código", () => {
  const mapa = escolherCentroCustoPorCliente([
    { codcli: 1, codccu: "90" },
    { codcli: 2, codccu: "1020" },
  ]);
  assert.equal(mapa.get(1), "90");
  assert.equal(mapa.get(2), "1020");
});

test("vários rateios: o MAIOR código, comparado como número (90 não vence 1176)", () => {
  const mapa = escolherCentroCustoPorCliente([
    { codcli: 7, codccu: "90" },
    { codcli: 7, codccu: "1176" },
    { codcli: 7, codccu: "1001" },
  ]);
  assert.equal(mapa.get(7), "1176");
});

test("ordem das linhas não muda o resultado", () => {
  const a = escolherCentroCustoPorCliente([
    { codcli: 1, codccu: "1001" },
    { codcli: 1, codccu: "1202" },
  ]);
  const b = escolherCentroCustoPorCliente([
    { codcli: 1, codccu: "1202" },
    { codcli: 1, codccu: "1001" },
  ]);
  assert.equal(a.get(1), "1202");
  assert.equal(b.get(1), "1202");
});

test("codccu vazio ou nulo é ignorado; cliente só com isso fica fora do mapa", () => {
  const mapa = escolherCentroCustoPorCliente([
    { codcli: 1, codccu: null },
    { codcli: 2, codccu: "  " },
    { codcli: 3, codccu: " 1021 " },
  ]);
  assert.equal(mapa.has(1), false);
  assert.equal(mapa.has(2), false);
  assert.equal(mapa.get(3), "1021");
});

test("código não numérico só vale se o cliente não tiver nenhum numérico", () => {
  const mapa = escolherCentroCustoPorCliente([
    { codcli: 1, codccu: "ABC" },
    { codcli: 1, codccu: "1001" },
    { codcli: 2, codccu: "ABC" },
    { codcli: 2, codccu: "ABD" },
  ]);
  assert.equal(mapa.get(1), "1001");
  assert.equal(mapa.get(2), "ABD");
});
