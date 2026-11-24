import { describe, expect, it } from "vitest";
import { descreverDetalhe, linhaDaConta, mesAnterior, ordenarLancamentos, resumirResultado, rotuloCompetencia, type LancamentoOrigem } from "./custoHora";

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
    expect(brl(descreverDetalhe("clt_folha", { custoMensal: 7616.5, folha: 7616.5, provisoes: 0, horasMes: 200 }))).toBe("R$ 7.616,50 contabilizado a débito no mês ÷ 200 h");
    expect(brl(descreverDetalhe("clt_folha", { custoMensal: 7616.5, folha: 6800, provisoes: 816.5, horasMes: 200 }))).toBe("R$ 7.616,50 contabilizado a débito no mês (folha R$ 6.800,00 + provisões R$ 816,50) ÷ 200 h");
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

describe("linhaDaConta", () => {
  const brl = (s: string) => s.replace(/\s/g, " ");
  it("CLT: o custo contabilizado ÷ horas = custo-hora gravado", () => {
    expect(brl(linhaDaConta({ origem: "clt_folha", custoHora: 1.5305, detalhe: { custoMensal: 336.72, folha: 336.72, provisoes: 0, horasMes: 220 } }))).toBe("R$ 336,72 contabilizado a débito no mês ÷ 220 h = R$ 1,53 por hora");
  });
  it("PJ por hora: o preço do contrato e desde quando vale", () => {
    expect(brl(linhaDaConta({ origem: "pj_contrato", custoHora: 105.39, detalhe: { precoContrato: 105.39, mensal: false, fixo: null }, vigenteDesde: "2026-06-01" }))).toBe("Preço do contrato no mês: R$ 105,39 por hora (vigente desde 01/06/2026)");
  });
  it("PJ mensal: preço do mês ÷ horas", () => {
    expect(brl(linhaDaConta({ origem: "pj_contrato", custoHora: 61.8, detalhe: { precoContrato: 12360, mensal: true, horasMes: 200, fixo: null } }))).toBe("Preço mensal do contrato R$ 12.360,00 ÷ 200 h = R$ 61,80 por hora");
  });
  it("PJ de valor fixo: a quantidade fixa e o que rende por mês", () => {
    expect(brl(linhaDaConta({ origem: "pj_contrato", custoHora: 93.897, detalhe: { precoContrato: 93.897, mensal: false, fixo: { qtd: 150, valorMensal: 14084.55 } } }))).toBe("Contrato de valor fixo: 150 h = R$ 14.084,55 por mês · valor-hora do contrato R$ 93,90 por hora");
  });
  it("manual: o valor e a vigência", () => {
    expect(brl(linhaDaConta({ origem: "manual", custoHora: 78, detalhe: null, vigenteDesde: "2026-06-01" }))).toBe("Valor-hora manual vigente desde 01/06/2026: R$ 78,00 por hora");
  });
  it("origem desconhecida: vazio", () => {
    expect(linhaDaConta({ origem: "x", custoHora: 1, detalhe: null })).toBe("");
  });
});

describe("ordenarLancamentos", () => {
  const l = (o: Partial<LancamentoOrigem>): LancamentoOrigem => ({ ctared: 1, clacta: "A", descta: "x", opcctb: 1, codclc: 1, historico: null, debcre: "D", valor: 1, considerado: false, ...o });
  it("os considerados primeiro; dentro do grupo, pela classificação da conta e pelo código", () => {
    const r = ordenarLancamentos([l({ ctared: 1, clacta: "B", considerado: false }), l({ ctared: 2, clacta: "Z", considerado: true }), l({ ctared: 3, clacta: "A", considerado: true }), l({ ctared: 4, clacta: "A", considerado: false })]);
    expect(r.map((x) => x.ctared)).toEqual([3, 2, 4, 1]);
  });
  it("não altera a lista de entrada", () => {
    const e = [l({ considerado: false }), l({ considerado: true })];
    ordenarLancamentos(e);
    expect(e[0].considerado).toBe(false);
  });
});
