import { describe, expect, it } from "vitest";
import { calcularResumo, formatarResumo, funcoesDaColuna } from "./resumo";

describe("funcoesDaColuna", () => {
  it("as do tipo, limitadas pela coluna", () => {
    expect(funcoesDaColuna("decimal")).toContain("soma");
    expect(funcoesDaColuna("texto")).toEqual(["contagem", "distintos", "vazios"]);
    expect(funcoesDaColuna("decimal", ["media", "minimo", "maximo"])).toEqual(["media", "minimo", "maximo"]);
    expect(funcoesDaColuna("json")).toEqual([]);
    expect(funcoesDaColuna(undefined)).toEqual([]);
  });
});

describe("calcularResumo (mesma regra do SQL: vazio não conta)", () => {
  const ns = [10, null, 5, "", 25];
  it("números", () => {
    expect(calcularResumo(ns, "soma", "decimal")).toBe(40);
    expect(calcularResumo(ns, "media", "decimal")).toBeCloseTo(13.333, 3);
    expect(calcularResumo(ns, "minimo", "decimal")).toBe(5);
    expect(calcularResumo(ns, "maximo", "decimal")).toBe(25);
    expect(calcularResumo(ns, "mediana", "decimal")).toBe(10);
    expect(calcularResumo([1, 2, 3, 4], "mediana", "inteiro")).toBe(2.5);
    expect(calcularResumo(ns, "contagem", "decimal")).toBe(3);
    expect(calcularResumo([1, 1, 2], "distintos", "inteiro")).toBe(2);
    expect(calcularResumo([null, ""], "soma", "decimal")).toBeNull();
  });
  it("texto e datas", () => {
    expect(calcularResumo(["Aço", "aço ", "", null, "Cimento"], "distintos", "texto")).toBe(2);
    expect(calcularResumo(["Aço", "", null], "vazios", "texto")).toBe(2);
    expect(calcularResumo(["2026-03-01T03:00:00Z", null, "2025-12-31T03:00:00Z"], "minimo", "data")).toBe("2025-12-31T03:00:00Z");
  });
  it("sim/não", () => {
    const bs = [true, false, true, null];
    expect(calcularResumo(bs, "sim", "booleano")).toBe(2);
    expect(calcularResumo(bs, "nao", "booleano")).toBe(1);
    expect(calcularResumo(bs, "pctSim", "booleano")).toBeCloseTo(66.667, 2);
  });
});

describe("formatarResumo", () => {
  it("na unidade da coluna só para soma/média/mín/máx/mediana", () => {
    const real = (v: number) => `R$ ${v}`;
    expect(formatarResumo(10, "soma", "decimal", real)).toBe("R$ 10");
    expect(formatarResumo(3, "contagem", "decimal", real)).toBe("3");
    expect(formatarResumo(1234.5, "soma", "decimal")).toBe("1.234,50");
    expect(formatarResumo(1234, "soma", "inteiro")).toBe("1.234");
    expect(formatarResumo(12.345, "pctSim", "booleano")).toBe("12,3%");
    expect(formatarResumo(null, "soma", "decimal")).toBe("—");
    expect(formatarResumo("2026-03-01T03:00:00Z", "maximo", "data")).toBe("01/03/2026");
  });
});
