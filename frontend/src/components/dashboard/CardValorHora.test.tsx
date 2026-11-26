import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiValorFixo } from "./CardValorHora";

// Normaliza o espaço sem quebra que o Intl usa entre "R$" e o número.
const html = (el: JSX.Element) => renderToStaticMarkup(el).replace(/\u00a0/g, " ");

describe("KpiValorFixo", () => {
  it("mostra o total, a conta valor-hora × quantidade e não mostra desconto quando não há", () => {
    const out = html(<KpiValorFixo contratoFixo={{ qtd: 150, valorMensal: 11004.5, meses: 1, deslocamento: 0, total: 11004.5 }} valorHora={73.3633} rotuloPeriodoDescontos="Descontos do mês" />);
    expect(out).toContain("Valor fixo do contrato");
    expect(out).toContain("R$ 11.004,50");
    expect(out).toContain("R$ 73,36/h × 150 h");
    expect(out).not.toContain("meses");
    expect(out).not.toContain("+ deslocamento");
    expect(out).not.toContain("Líquido");
  });

  it("período de vários meses e deslocamento aparecem na conta", () => {
    const out = html(<KpiValorFixo contratoFixo={{ qtd: 191.4, valorMensal: 8500.07, meses: 2, deslocamento: 120.5, total: 17120.64 }} valorHora={44.41} rotuloPeriodoDescontos="Descontos do período" />);
    expect(out).toContain("R$ 17.120,64");
    expect(out).toContain("191,4 h × 2 meses + deslocamento R$ 120,50");
  });

  it("com descontos mostra o desconto e o líquido sobre o total do fixo", () => {
    const out = html(
      <KpiValorFixo
        contratoFixo={{ qtd: 150, valorMensal: 14084.55, meses: 1, deslocamento: 0, total: 14084.55 }}
        valorHora={93.897}
        descontos={{ total: 1500, parcial: false }}
        rotuloPeriodoDescontos="Descontos do mês"
      />,
    );
    expect(out).toContain("Descontos do mês");
    expect(out).toContain("−R$ 1.500,00");
    expect(out).toContain("Líquido");
    expect(out).toContain("R$ 12.584,55");
    expect(out).not.toContain("desconto parcial");
  });

  it("com férias na competência mostra a linha de férias somada ao líquido, sem KPI próprio", () => {
    const out = html(
      <KpiValorFixo
        contratoFixo={{ qtd: 150, valorMensal: 14084.55, meses: 1, deslocamento: 0, total: 14084.55 }}
        valorHora={93.897}
        ferias={{ valor: 3744.66, itens: [{ gozoId: 2, inicio: "2026-11-16", fim: "2026-11-25", competencia: "2026-11-01", valor: 3744.66, competenciaIniciada: true }] }}
        rotuloPeriodoDescontos="Descontos do mês"
      />,
    );
    expect(out).toContain("Férias na nota");
    expect(out).toContain("+R$ 3.744,66");
    expect(out).toContain("Líquido");
    expect(out).toContain("R$ 17.829,21");
    expect(out).toContain("16/11/2026 a 25/11/2026 (nota de 11/2026)");
  });

  it("férias e descontos juntos: líquido = fixo + férias − descontos", () => {
    const out = html(
      <KpiValorFixo
        contratoFixo={{ qtd: 150, valorMensal: 10000, meses: 1, deslocamento: 0, total: 10000 }}
        valorHora={66.67}
        descontos={{ total: 1500, parcial: false }}
        ferias={{ valor: 3000, itens: [] }}
        rotuloPeriodoDescontos="Descontos do mês"
      />,
    );
    expect(out).toContain("−R$ 1.500,00");
    expect(out).toContain("+R$ 3.000,00");
    expect(out).toContain("R$ 11.500,00");
    expect(out).not.toContain("desconto parcial");
  });

  it("desconto maior que a nota: líquido zera e avisa desconto parcial", () => {
    const out = html(
      <KpiValorFixo contratoFixo={{ qtd: 10, valorMensal: 1000, meses: 1, deslocamento: 0, total: 1000 }} valorHora={100} descontos={{ total: 1800, parcial: true }} rotuloPeriodoDescontos="Descontos do mês" />,
    );
    expect(out).toContain("Líquido");
    expect(out).toContain("R$ 0,00");
    expect(out).toContain("desconto parcial");
  });
  it("com bonificação que compõe a nota mostra a linha clicável e soma ao líquido", () => {
    const out = html(
      <KpiValorFixo
        contratoFixo={{ qtd: 150, valorMensal: 10000, meses: 1, deslocamento: 0, total: 10000 }}
        valorHora={66.67}
        bonificacao={1440}
        rotuloPeriodoDescontos="Descontos do mês"
      />,
    );
    expect(out).toContain("Bonificação na nota");
    expect(out).toContain("+R$ 1.440,00");
    expect(out).toContain("Ver as bonificações somadas à nota");
    expect(out).toContain("Líquido");
    expect(out).toContain("R$ 11.440,00");
  });

  it("bonificação + férias − descontos: líquido soma as duas e deduz os descontos", () => {
    const out = html(
      <KpiValorFixo
        contratoFixo={{ qtd: 150, valorMensal: 10000, meses: 1, deslocamento: 0, total: 10000 }}
        valorHora={66.67}
        ferias={{ valor: 2000, itens: [{ gozoId: 3, inicio: "2026-11-02", fim: "2026-11-11", competencia: "2026-11-01", valor: 2000, competenciaIniciada: true }] }}
        bonificacao={1440}
        descontos={{ total: 500, parcial: false }}
        rotuloPeriodoDescontos="Descontos do mês"
      />,
    );
    expect(out).toContain("−R$ 500,00");
    expect(out).toContain("+R$ 2.000,00");
    expect(out).toContain("+R$ 1.440,00");
    // 10000 + 2000 + 1440 − 500
    expect(out).toContain("R$ 12.940,00");
    expect(out).not.toContain("desconto parcial");
  });

  it("a bonificação entra na conta do 'cobre o desconto': desconto maior que o bruto, mas coberto pela bonificação, não é parcial", () => {
    const out = html(
      <KpiValorFixo
        contratoFixo={{ qtd: 10, valorMensal: 1000, meses: 1, deslocamento: 0, total: 1000 }}
        valorHora={100}
        bonificacao={600}
        descontos={{ total: 1500, parcial: false }}
        rotuloPeriodoDescontos="Descontos do mês"
      />,
    );
    expect(out).not.toContain("desconto parcial");
    expect(out).toContain("R$ 100,00");
  });

  it("sem bonificação, não mostra a linha", () => {
    const out = html(<KpiValorFixo contratoFixo={{ qtd: 10, valorMensal: 1000, meses: 1, deslocamento: 0, total: 1000 }} valorHora={100} descontos={{ total: 100, parcial: false }} rotuloPeriodoDescontos="Descontos do mês" />);
    expect(out).not.toContain("Bonificação na nota");
  });
});
