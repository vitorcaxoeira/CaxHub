import { describe, expect, it } from "vitest";
import { agruparOpcoesVinculo, contarSugestoesSeguras, formatarDia, formatarReais, GRUPO_LIVRES, GRUPO_OCUPADOS, type OpcaoVinculo } from "./vinculoConsultores";

const opcoes: OpcaoVinculo[] = [
  { value: "a", label: "Ana", vinculadoA: 10 },
  { value: "b", label: "Bia", vinculadoA: null },
  { value: "c", label: "Caio · DEMITIDO em 31/01/2024", vinculadoA: null },
  { value: "d", label: "Duda", vinculadoA: 99 },
  { value: "e", label: "Edu", vinculadoA: null },
];

describe("agruparOpcoesVinculo", () => {
  it("livres primeiro, por último os já vinculados a outro", () => {
    const g = agruparOpcoesVinculo(opcoes, 1);
    expect(g.map((o) => o.grupo)).toEqual([GRUPO_LIVRES, GRUPO_LIVRES, GRUPO_LIVRES, GRUPO_OCUPADOS, GRUPO_OCUPADOS]);
    expect(g.map((o) => o.value)).toEqual(["b", "c", "e", "a", "d"]);
  });
  it("o demitido aparece na lista como os demais (sem grupo próprio)", () => {
    expect(agruparOpcoesVinculo(opcoes, 1).find((o) => o.value === "c")?.grupo).toBe(GRUPO_LIVRES);
  });
  it("a opção que já é DESTE consultor fica entre as livres (é a escolha dele)", () => {
    const g = agruparOpcoesVinculo(opcoes, 10);
    expect(g.find((o) => o.value === "a")?.grupo).toBe(GRUPO_LIVRES);
    expect(g.find((o) => o.value === "d")?.grupo).toBe(GRUPO_OCUPADOS);
  });
  it("lista vazia", () => {
    expect(agruparOpcoesVinculo([], 1)).toEqual([]);
  });
});

describe("contarSugestoesSeguras", () => {
  const s = (valor: string, confianca: "alta" | "media") => ({ valor, confianca, motivo: "x" });
  it("conta só confiança alta", () => {
    expect(contarSugestoesSeguras([s("a", "alta"), s("b", "media"), null])).toBe(1);
  });
  it("duas linhas disputando o mesmo atendente não entram em lote", () => {
    expect(contarSugestoesSeguras([s("a", "alta"), s("a", "alta"), s("b", "alta")])).toBe(1);
  });
  it("vazio", () => {
    expect(contarSugestoesSeguras([])).toBe(0);
  });
});

describe("formatação", () => {
  it("dia sem deslocar pelo fuso", () => {
    expect(formatarDia("2026-06-01")).toBe("01/06/2026");
    expect(formatarDia("2026-06-01T00:00:00.000Z")).toBe("01/06/2026");
    expect(formatarDia(null)).toBe("—");
  });
  it("reais com duas casas", () => {
    expect(formatarReais(105.39186).replace(/\s/g, " ")).toBe("R$ 105,39");
    expect(formatarReais(null)).toBe("—");
  });
});
