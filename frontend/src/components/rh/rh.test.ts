import { describe, expect, it } from "vitest";
import { fmtCompacto, fmtData, fmtHoras, fmtInt, fmtMoeda, fmtPct, fmtPessoas, fmtVariacao } from "./formato";
import { paramsDoFiltro, periodoDoPreset, recortesAtivos } from "./filtroStore";
import type { FiltroRhEstado } from "./filtroStore";

describe("períodos pré-definidos", () => {
  const hoje = new Date(2026, 9, 9); // 09/10/2026

  it("últimos 12 meses começam no dia 1 do mês de 11 meses atrás", () => {
    expect(periodoDoPreset("12m", hoje)).toEqual({ de: "2025-11-01", ate: "2026-10-09" });
  });

  it("mês anterior vai do dia 1 ao último dia, mesmo em mês de 30 dias", () => {
    expect(periodoDoPreset("mesAnterior", hoje)).toEqual({ de: "2026-09-01", ate: "2026-09-30" });
  });

  it("este ano e trimestre", () => {
    expect(periodoDoPreset("ano", hoje)).toEqual({ de: "2026-01-01", ate: "2026-10-09" });
    expect(periodoDoPreset("3m", hoje)).toEqual({ de: "2026-08-01", ate: "2026-10-09" });
  });
});

describe("filtro enviado à API", () => {
  const base: FiltroRhEstado = { preset: "12m", de: "2025-11-01", ate: "2026-10-09", empresa: null, filial: null, tipcol: [], ccu: null, local: null, cargo: null };

  it("só manda o que foi escolhido", () => {
    expect(paramsDoFiltro(base)).toEqual({ de: "2025-11-01", ate: "2026-10-09" });
    expect(paramsDoFiltro({ ...base, empresa: 1, tipcol: [1, 3], ccu: "77205", cargo: "1:ANA" })).toEqual({
      de: "2025-11-01", ate: "2026-10-09", empresa: "1", tipcol: "1,3", ccu: "77205", cargo: "1:ANA",
    });
  });

  it("conta os recortes de cadastro ativos (o período não conta)", () => {
    expect(recortesAtivos(base)).toBe(0);
    expect(recortesAtivos({ ...base, empresa: 1, tipcol: [1], local: 3 })).toBe(3);
  });
});

describe("formatadores", () => {
  it("null é traço, nunca zero", () => {
    expect(fmtInt(null)).toBe("—");
    expect(fmtPct(null)).toBe("—");
    expect(fmtMoeda(undefined)).toBe("—");
    expect(fmtHoras(null)).toBe("—");
  });

  it("percentual, horas e variação com vírgula decimal", () => {
    expect(fmtPct(3.54, 2)).toBe("3,54%");
    expect(fmtHoras(1234.5)).toBe("1.234,5 h");
    expect(fmtVariacao(8.8)).toBe("+8,8%");
    expect(fmtVariacao(-2.7)).toBe("-2,7%");
  });

  it("valor compacto para eixo de gráfico", () => {
    expect(fmtCompacto(145062)).toBe("145 mil");
    expect(fmtCompacto(1763753)).toBe("1,8 mi");
    expect(fmtCompacto(950)).toBe("950");
  });

  it("data do Senior é só data: não escorrega de dia por fuso", () => {
    expect(fmtData("2026-04-13T00:00:00.000Z")).toBe("13/04/2026");
  });

  it("pessoa no singular e no plural", () => {
    expect(fmtPessoas(1)).toBe("1 pessoa");
    expect(fmtPessoas(5)).toBe("5 pessoas");
  });
});
