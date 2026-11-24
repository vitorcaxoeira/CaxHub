import { describe, expect, it } from "vitest";
import { distribuirPorPesos, fmtPct, fmtValor, lerNumero, numParaCampo, PESOS_PADRAO, rotuloPeriodo, somaPesos } from "./metasComercial";

describe("lerNumero", () => {
  it("aceita vírgula decimal e ponto de milhar", () => {
    expect(lerNumero("1.234,56")).toBe(1234.56);
    expect(lerNumero("1234,56")).toBe(1234.56);
    expect(lerNumero("R$ 948.672,34")).toBe(948672.34);
  });
  it("ponto sozinho: milhar quando são grupos de 3, decimal nos demais casos", () => {
    expect(lerNumero("1.500")).toBe(1500);
    expect(lerNumero("1234.56")).toBe(1234.56);
    expect(lerNumero("12.5")).toBe(12.5);
  });
  it("vazio vira null; lixo e negativo viram NaN", () => {
    expect(lerNumero("")).toBeNull();
    expect(lerNumero("   ")).toBeNull();
    expect(Number.isNaN(lerNumero("abc"))).toBe(true);
    expect(Number.isNaN(lerNumero("-5"))).toBe(true);
    expect(Number.isNaN(lerNumero("1,2,3"))).toBe(true);
  });
  it("numParaCampo e lerNumero são inversos", () => {
    for (const v of [0, 8376.31, 1193.83, 948672.34, 1500]) expect(lerNumero(numParaCampo(v))).toBe(v);
  });
});

describe("distribuirPorPesos (espelho do servidor)", () => {
  it("Cati: 43.200 de jul a dez → 8.640 e 5.760", () => {
    const m = distribuirPorPesos(43200, PESOS_PADRAO, [7, 8, 9, 10, 11, 12]);
    expect(m.slice(6)).toEqual([8640, 8640, 8640, 5760, 5760, 5760]);
    expect(m.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("soma exatamente o valor", () => {
    const m = distribuirPorPesos(100, PESOS_PADRAO, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Math.round(m.reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
  });
  it("pesos padrão somam 100", () => {
    expect(somaPesos(PESOS_PADRAO)).toBeCloseTo(100, 4);
  });
});

describe("formatação", () => {
  it("valor por unidade", () => {
    expect(fmtValor("BRL", 1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(fmtValor("HORAS", 10999.8)).toBe("10.999,8 h");
    expect(fmtValor("QTD", 424)).toBe("424");
    expect(fmtValor("BRL", null)).toBe("—");
  });
  it("percentual", () => {
    expect(fmtPct(0.5936666667)).toBe("59,4%");
    expect(fmtPct(null)).toBe("—");
  });
  it("rótulo do período", () => {
    expect(rotuloPeriodo("s2")).toBe("2º semestre");
    expect(rotuloPeriodo("mes-3")).toBe("Março");
    expect(rotuloPeriodo("ate-6")).toBe("Acumulado até junho");
  });
});

describe("quadro no estilo da planilha", () => {
  it("Licenças: falta e % que falta como as colunas J e K da planilha", async () => {
    const { colunasQuadro } = await import("./metasComercial");
    const q = colunasQuadro({ meta: 840000, realizado: 503561.84, atingimento: 503561.84 / 840000 });
    expect(q.falta).toBe(336438.16);
    expect(q.superou).toBeNull();
    expect(Math.round(q.pctFalta! * 10000) / 100).toBe(40.05);
  });
  it("superou a meta: mostra quanto passou e 0% faltando", async () => {
    const { colunasQuadro } = await import("./metasComercial");
    const q = colunasQuadro({ meta: 98400, realizado: 141782.74, atingimento: 141782.74 / 98400 });
    expect(q.falta).toBeNull();
    expect(q.superou).toBe(43382.74);
    expect(q.pctFalta).toBe(0);
  });
  it("sem meta: nada a mostrar", async () => {
    const { colunasQuadro } = await import("./metasComercial");
    expect(colunasQuadro({ meta: 0, realizado: 5, atingimento: null })).toEqual({ falta: null, superou: null, pctFalta: null });
  });
  it("desafio geral = 100% − realizado geral (planilha 64,10% → 35,90%)", async () => {
    const { desafioGeral } = await import("./metasComercial");
    expect(Math.round(desafioGeral(0.641)! * 10000) / 100).toBe(35.9);
    expect(desafioGeral(null)).toBeNull();
    expect(desafioGeral(1.1482)).toBe(0);
  });
  it("série do mês a mês: SOMA acumula até o último mês com realizado; SALDO é a posição", async () => {
    const { serieDe } = await import("./metasComercial");
    const mensal = [
      { mes: 1, meta: 10, realizado: 5, atingimento: 0.5 },
      { mes: 2, meta: 10, realizado: 7, atingimento: 0.7 },
      { mes: 3, meta: 10, realizado: null, atingimento: null },
    ];
    expect(serieDe(mensal, "SOMA").map((p) => [p.meta, p.realizado])).toEqual([[10, 5], [20, 12], [30, null]]);
    expect(serieDe(mensal, "SALDO").map((p) => p.realizado)).toEqual([5, 7, null]);
  });
});
