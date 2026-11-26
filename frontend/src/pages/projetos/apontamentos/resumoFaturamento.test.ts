import { describe, expect, it } from "vitest";
import { SEM_FORMA, filtrarPorTipoDeProposta, resumoPorFormaDeFaturamento, sessoesDaCelula, totaisDasSessoes, type SessaoParaResumo } from "./resumoFaturamento";

const s = (forfat: number | null, forfatLabel: string | null, faturavel: boolean, duracaoMinutos: number, valorHoraItem?: number | null): SessaoParaResumo => ({
  forfat,
  forfatLabel,
  faturavel,
  duracaoMinutos,
  valorHoraItem,
});

describe("resumoPorFormaDeFaturamento", () => {
  it("sem sessões: sem linhas e total zerado", () => {
    const r = resumoPorFormaDeFaturamento([]);
    expect(r.linhas).toEqual([]);
    expect(r.total).toMatchObject({ forma: "Total", minutosFaturados: 0, valorFaturado: 0, minutosNaoFaturados: 0, valorNaoFaturado: 0 });
  });

  it("agrupa por forma de faturamento e separa faturada de não faturada pelo item", () => {
    const r = resumoPorFormaDeFaturamento([
      s(0, "Mediante RAT", true, 90, 200),
      s(0, "Mediante RAT", false, 30, 200),
      s(2, "Antecipado", true, 60, 100),
      s(0, "Mediante RAT", true, 30, 100),
    ]);
    expect(r.linhas.map((l) => l.forma)).toEqual(["Mediante RAT", "Antecipado"]);
    expect(r.linhas[0]).toMatchObject({ minutosFaturados: 120, valorFaturado: 350, minutosNaoFaturados: 30, valorNaoFaturado: 100 });
    expect(r.linhas[1]).toMatchObject({ minutosFaturados: 60, valorFaturado: 100, minutosNaoFaturados: 0, valorNaoFaturado: 0 });
    expect(r.total).toMatchObject({ minutosFaturados: 180, valorFaturado: 450, minutosNaoFaturados: 30, valorNaoFaturado: 100 });
  });

  it("ordena pelo código da forma e deixa a sessão sem forma por último", () => {
    const r = resumoPorFormaDeFaturamento([s(null, null, true, 10, 60), s(5, "Faturamento Via Contrato", true, 10, 60), s(1, "Finalização", true, 10, 60)]);
    expect(r.linhas.map((l) => l.forma)).toEqual(["Finalização", "Faturamento Via Contrato", SEM_FORMA]);
  });

  it("sem valor-hora (quem não vê valores, ou item sem preço) conta as horas e zera os valores", () => {
    const r = resumoPorFormaDeFaturamento([s(0, "Mediante RAT", true, 60), s(0, "Mediante RAT", false, 60, null)]);
    expect(r.linhas[0]).toMatchObject({ minutosFaturados: 60, valorFaturado: 0, minutosNaoFaturados: 60, valorNaoFaturado: 0 });
  });

  it("arredonda só no fim: o total vem das sessões, não das linhas já arredondadas", () => {
    // 1 min a R$ 100/h = 1,666... por sessão; três formas diferentes
    const r = resumoPorFormaDeFaturamento([s(0, "Mediante RAT", true, 1, 100), s(1, "Finalização", true, 1, 100), s(2, "Antecipado", true, 1, 100)]);
    expect(r.linhas.map((l) => l.valorFaturado)).toEqual([1.67, 1.67, 1.67]);
    expect(r.total.valorFaturado).toBe(5);
  });
});

describe("sessoesDaCelula", () => {
  const com = (inicio: string, x: SessaoParaResumo) => ({ ...x, inicio });
  const lista = [
    com("2026-11-01T10:00:00Z", s(0, "Mediante RAT", true, 90, 200)),
    com("2026-11-03T10:00:00Z", s(0, "Mediante RAT", false, 30, 200)),
    com("2026-11-02T10:00:00Z", s(2, "Antecipado", true, 60, 100)),
    com("2026-11-04T10:00:00Z", s(null, null, true, 15, 100)),
  ];

  it("a soma das sessões de cada célula é exatamente a célula do resumo (inclusive Total e sem forma)", () => {
    const r = resumoPorFormaDeFaturamento(lista);
    for (const l of [...r.linhas, r.total]) {
      const forma = l === r.total ? null : l.forma;
      expect(totaisDasSessoes(sessoesDaCelula(lista, forma, true))).toEqual({ minutos: l.minutosFaturados, valor: l.valorFaturado });
      expect(totaisDasSessoes(sessoesDaCelula(lista, forma, false))).toEqual({ minutos: l.minutosNaoFaturados, valor: l.valorNaoFaturado });
    }
  });

  it("mais recentes primeiro e filtra por faturável", () => {
    expect(sessoesDaCelula(lista, null, true).map((x) => x.inicio.slice(8, 10))).toEqual(["04", "02", "01"]);
    expect(sessoesDaCelula(lista, SEM_FORMA, true)).toHaveLength(1);
    expect(sessoesDaCelula(lista, "Antecipado", false)).toEqual([]);
  });
});

describe("filtrarPorTipoDeProposta (filtro Propostas)", () => {
  const lista = [
    { id: "cli", interna: false },
    { id: "int", interna: true },
    { id: "sem cliente", interna: null },
  ];

  it("Todas mantém tudo, inclusive a sem cliente", () => {
    expect(filtrarPorTipoDeProposta(lista, "all").map((x) => x.id)).toEqual(["cli", "int", "sem cliente"]);
  });

  it("De clientes e Internas separam pela empresa própria; sem cliente não entra em nenhuma (como no SQL da Gestão Propostas)", () => {
    expect(filtrarPorTipoDeProposta(lista, "cli").map((x) => x.id)).toEqual(["cli"]);
    expect(filtrarPorTipoDeProposta(lista, "int").map((x) => x.id)).toEqual(["int"]);
  });
});

describe("valor médio da hora", () => {
  it("é o valor ÷ horas da linha, e nulo quando não há horas", () => {
    // 2h a R$ 200 + 1h a R$ 100 faturadas = R$ 500 / 3h = 166,67
    const r = resumoPorFormaDeFaturamento([s(0, "Mediante RAT", true, 120, 200), s(0, "Mediante RAT", true, 60, 100)]);
    expect(r.linhas[0].valorHoraMedioFaturado).toBe(166.67);
    expect(r.linhas[0].valorHoraMedioNaoFaturado).toBeNull();
  });

  it("a do Total é ponderada pelas horas de todas as linhas, não a média das médias", () => {
    // Mediante RAT: 10h a R$ 100; Antecipado: 1h a R$ 300 -> total R$ 1.300 / 11h = 118,18 (a média das médias seria 200)
    const r = resumoPorFormaDeFaturamento([s(0, "Mediante RAT", true, 600, 100), s(2, "Antecipado", true, 60, 300)]);
    expect(r.total.valorHoraMedioFaturado).toBe(118.18);
  });

  it("sai do valor sem arredondar (1 min a R$ 100/h continua R$ 100 de média)", () => {
    const r = resumoPorFormaDeFaturamento([s(0, "Mediante RAT", true, 1, 100)]);
    expect(r.linhas[0].valorFaturado).toBe(1.67);
    expect(r.linhas[0].valorHoraMedioFaturado).toBe(100);
  });
});
