import { describe, expect, it } from "vitest";
import { normalizarPorPagina, opcoesDePorPagina, POR_PAGINA_PADRAO } from "./porPagina";

describe("Por página único", () => {
  it("as opções são 5, 10, 15, 25, 50, 100 e 200", () => {
    expect([...POR_PAGINA_PADRAO]).toEqual([5, 10, 15, 25, 50, 100, 200]);
  });
  it("tamanho inicial que está na lista fica como está", () => {
    for (const n of POR_PAGINA_PADRAO) expect(normalizarPorPagina(n)).toBe(n);
  });
  it("fora da lista vira o maior que cabe", () => {
    expect(normalizarPorPagina(30)).toBe(25);
    expect(normalizarPorPagina(20)).toBe(15);
    expect(normalizarPorPagina(75)).toBe(50);
    expect(normalizarPorPagina(500)).toBe(200);
    expect(normalizarPorPagina(1000)).toBe(200);
  });
  it("abaixo do menor, o menor; valor inválido, 25", () => {
    expect(normalizarPorPagina(3)).toBe(5);
    expect(normalizarPorPagina(Number.NaN)).toBe(25);
  });
  it("as opções do seletor incluem a atual quando ela não é da lista", () => {
    expect(opcoesDePorPagina()).toEqual([5, 10, 15, 25, 50, 100, 200]);
    expect(opcoesDePorPagina(30)).toEqual([5, 10, 15, 25, 30, 50, 100, 200]);
    expect(opcoesDePorPagina(25)).toEqual([5, 10, 15, 25, 50, 100, 200]);
  });
});
