import { describe, expect, it } from "vitest";
import { colunasParaFormula, ehCalculada, formatarCalculada, nomeDaCalculada, problemaDaCalculada } from "./colunasCalculadas";

describe("colunas calculadas", () => {
  it("nome na arrumação", () => {
    expect(nomeDaCalculada(12)).toBe("calc_12");
    expect(ehCalculada("calc_12")).toBe(true);
    expect(ehCalculada("calculo")).toBe(false);
  });
  it("formato do valor", () => {
    expect(formatarCalculada(1234.5, "numero", 2)).toBe("1.234,50");
    expect(formatarCalculada(1234.5, "moeda", 2)).toBe("R$ 1.234,50");
    expect(formatarCalculada(12.345, "percentual", 1)).toBe("12,3%");
    expect(formatarCalculada(null, "numero", 2)).toBe("—");
    expect(formatarCalculada(7, "numero", 0)).toBe("7");
  });
  it("fórmula que perdeu a coluna avisa em vez de quebrar", () => {
    const arvore = { t: "bin" as const, op: "+" as const, a: { t: "col" as const, nome: "a" }, b: { t: "num" as const, v: 1 } };
    expect(problemaDaCalculada(arvore, new Map([["a", "decimal" as const]]))).toBeNull();
    expect(problemaDaCalculada(arvore, new Map())).toMatch(/não existe/);
    expect(problemaDaCalculada(arvore, new Map([["a", "texto" as const]]))).toMatch(/texto/);
  });
  it("colunas que entram em fórmula: sem as calculadas e sem json", () => {
    expect(
      colunasParaFormula(
        [
          { nome: "a", tipo: "decimal" },
          { nome: "calc_1", tipo: "decimal" },
          { nome: "j", tipo: "json" },
        ],
        { a: "Coluna A" },
      ),
    ).toEqual([{ nome: "a", titulo: "Coluna A", tipo: "decimal" }]);
  });
});
