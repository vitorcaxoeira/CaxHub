import { describe, expect, it } from "vitest";
import { descreverDetalhe, mesAnterior, resumirResultado, rotuloCompetencia } from "./custoHora";

describe("competência", () => {
  it("rótulo MM/AAAA", () => {
    expect(rotuloCompetencia("2026-10-01")).toBe("10/2026");
    expect(rotuloCompetencia(null)).toBe("—");
  });
  it("mês anterior, inclusive na virada do ano", () => {
    expect(mesAnterior(new Date(2026, 10, 18))).toBe("2026-10");
    expect(mesAnterior(new Date(2026, 0, 5))).toBe("2025-12");
  });
});

describe("resumirResultado", () => {
  it("conta por origem e só os ATIVOS sem custo", () => {
    const r = resumirResultado([
      { ativo: true, origem: "clt_folha", custoHora: 40 },
      { ativo: true, origem: "pj_contrato", custoHora: 90 },
      { ativo: false, origem: "pj_contrato", custoHora: 90 },
      { ativo: true, origem: "manual", custoHora: 10 },
      { ativo: true, origem: null, custoHora: null },
      { ativo: false, origem: null, custoHora: null },
    ]);
    expect(r).toEqual({ clt_folha: 1, pj_contrato: 2, manual: 1, semCusto: 1 });
  });
});

describe("descreverDetalhe", () => {
  const brl = (s: string) => s.replace(/\s/g, " ");
  it("CLT: custo contabilizado no mês ÷ horas, com folha e provisões quando há", () => {
    expect(brl(descreverDetalhe("clt_folha", { custoMensal: 7616.5, folha: 7616.5, provisoes: 0, horasMes: 200 }))).toBe("R$ 7.616,50 contabilizado no mês ÷ 200 h");
    expect(brl(descreverDetalhe("clt_folha", { custoMensal: 7616.5, folha: 6800, provisoes: 816.5, horasMes: 200 }))).toBe("R$ 7.616,50 contabilizado no mês (folha R$ 6.800,00 + provisões R$ 816,50) ÷ 200 h");
  });
  it("PJ mensal e PJ por hora", () => {
    expect(brl(descreverDetalhe("pj_contrato", { mensal: true, precoContrato: 12360, horasMes: 200 }))).toBe("R$ 12.360,00 (preço mensal) ÷ 200 h");
    expect(brl(descreverDetalhe("pj_contrato", { mensal: false, precoContrato: 119.58 }))).toBe("R$ 119,58 por hora (contrato)");
  });
  it("PJ de valor fixo: o valor-hora e o que a quantidade fixa rende por mês", () => {
    expect(brl(descreverDetalhe("pj_contrato", { mensal: false, precoContrato: 93.897, fixo: { qtd: 150, valorMensal: 14084.55 } }))).toBe("R$ 93,90 por hora · contrato fixo (150 h = R$ 14.084,55/mês)");
  });
  it("manual ou sem detalhe: vazio", () => {
    expect(descreverDetalhe("manual", null)).toBe("");
  });
});
