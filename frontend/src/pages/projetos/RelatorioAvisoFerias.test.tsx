import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type AvisoFerias, Folha } from "./RelatorioAvisoFerias";

const BASE: AvisoFerias = {
  emitidoEm: "2026-11-13",
  emitidoPor: "Administrador",
  empresa: { codemp: 1, nome: "SOELTECH DESENVOLVIMENTO E COMERCIO DE SISTEMAS EIRELI" },
  consultor: { codemp: 1, codfor: 305, nome: "Graciele Rodrigues", departamento: "Consultoria ERP" },
  aquisitivo: { inicio: "2026-01-01", fim: "2026-06-30", diasDireito: 10, saldoDepois: 0 },
  gozo: { id: 2, situacao: "programada", inicio: "2026-11-16", fim: "2026-11-25", diasCorridos: 10, retorno: "2026-11-26", observacao: null, competenciaPagamento: "2026-11-01" },
  calculo: {
    diasUteis: 7,
    horasDia: 8.5,
    mediaPct: 0.93,
    valorHora: 67.6715,
    horasFerias: 55.34,
    valorFerias: 3744.66,
    calculadoEm: "2026-11-13T13:08:43.456Z",
    meses: [
      { ano: 2026, mes: 1, minutos: 10710, pct: 1 },
      { ano: 2026, mes: 2, minutos: 9000, pct: 0.86 },
    ],
    mesesReconstituidos: false,
  },
};

// O espaço sem quebra que o Intl usa entre "R$" e o número vira espaço comum.
const html = (d: AvisoFerias) => renderToStaticMarkup(<Folha d={d} />).replace(/\u00a0/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Aviso de férias (folha)", () => {
  it("traz empresa, consultor, datas, retorno, pagamento e o demonstrativo com a conta", () => {
    const t = html(BASE);
    expect(t).toContain("SOELTECH DESENVOLVIMENTO");
    expect(t).toContain("Graciele Rodrigues");
    expect(t).toContain("16/11/2026 a 25/11/2026");
    expect(t).toContain("Retorno ao trabalho 26/11/2026");
    expect(t).toContain("Na nota referente ao mês Novembro/2026");
    expect(t).toContain("7 × 8,5 h × 93%");
    expect(t).toContain("55,34 h × R$ 67,67");
    expect(t).toContain("R$ 3.744,66");
    expect(t).toContain("Saldo do período aquisitivo após estas férias: 0 dia(s)");
    expect(t).toContain("01/2026");
    expect(t).toContain("178,5 h");
    expect(t).not.toContain("canceladas");
  });

  it("férias canceladas avisam que o documento não vale mais", () => {
    expect(html({ ...BASE, gozo: { ...BASE.gozo, situacao: "cancelada" } })).toContain("Férias canceladas");
  });

  it("gozo antigo (tabela refeita) avisa; sem meses fala em 100%; sem cálculo mostra traços sem quebrar", () => {
    expect(html({ ...BASE, calculo: { ...BASE.calculo, mesesReconstituidos: true } })).toContain("Tabela refeita com as horas de hoje");
    expect(html({ ...BASE, calculo: { ...BASE.calculo, meses: [] } })).toContain("média considerada de 100%");
    const vazio = html({ ...BASE, calculo: { diasUteis: null, horasDia: null, mediaPct: null, valorHora: null, horasFerias: null, valorFerias: null, calculadoEm: null, meses: [], mesesReconstituidos: false }, gozo: { ...BASE.gozo, competenciaPagamento: null } });
    expect(vazio).toContain("Mês de pagamento não informado");
    expect(vazio).toContain("—");
  });

  it("férias não remuneradas: sem demonstrativo nem pagamento, com o aviso de que não há valor", () => {
    const t = html({
      ...BASE,
      remunerado: false,
      gozo: { ...BASE.gozo, competenciaPagamento: null },
      calculo: { diasUteis: 7, horasDia: null, mediaPct: null, valorHora: null, horasFerias: null, valorFerias: null, calculadoEm: null, meses: [], mesesReconstituidos: false },
    });
    expect(t).toContain("Férias não remuneradas");
    expect(t).toContain("não há valor a pagar");
    expect(t).toContain("16/11/2026 a 25/11/2026");
    expect(t).toContain("Retorno ao trabalho 26/11/2026");
    expect(t).not.toContain("Demonstrativo do cálculo");
    expect(t).not.toContain("Valor das férias");
    expect(t).not.toContain("Na nota referente");
  });
});
