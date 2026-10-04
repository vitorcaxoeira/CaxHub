import { describe, expect, it } from "vitest";
import { diasEntre, montarEscalaGantt, somarDias } from "./gantt";

describe("datas em UTC", () => {
  it("diasEntre e somarDias atravessam mês, ano e fevereiro bissexto", () => {
    expect(diasEntre("2026-10-01", "2026-10-31")).toBe(30);
    expect(diasEntre("2026-12-31", "2027-01-01")).toBe(1);
    expect(diasEntre("2028-02-28", "2028-03-01")).toBe(2);
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("montarEscalaGantt", () => {
  it("sem datas não há escala", () => {
    expect(montarEscalaGantt(null, "2026-10-01")).toBeNull();
    expect(montarEscalaGantt("2026-10-01", null)).toBeNull();
  });

  it("auto usa semanas até 120 dias e alinha de segunda a domingo", () => {
    // 01/10/2026 é quinta; 20/10/2026 é terça.
    const e = montarEscalaGantt("2026-10-01", "2026-10-20")!;
    expect(e.escala).toBe("semana");
    expect(e.inicio).toBe("2026-09-28"); // segunda
    expect(e.fim).toBe("2026-10-25"); // domingo
    expect(e.totalDias).toBe(28);
    expect(e.marcas.map((m) => m.rotulo)).toEqual(["28/09", "05/10", "12/10", "19/10"]);
    expect(e.marcas.every((m) => Math.abs(m.largura - 25) < 1e-9)).toBe(true);
  });

  it("auto passa pra meses acima de 120 dias e cobre os meses cheios", () => {
    const e = montarEscalaGantt("2026-10-15", "2027-03-10")!;
    expect(e.escala).toBe("mes");
    expect(e.inicio).toBe("2026-10-01");
    expect(e.fim).toBe("2027-03-31");
    expect(e.marcas.map((m) => m.rotulo)).toEqual(["out/26", "nov/26", "dez/26", "jan/27", "fev/27", "mar/27"]);
    // As fatias fecham 100% da largura.
    expect(e.marcas.reduce((soma, m) => soma + m.largura, 0)).toBeCloseTo(100, 6);
  });

  it("a escala pedida vence o auto", () => {
    expect(montarEscalaGantt("2026-10-01", "2026-10-20", "mes")!.escala).toBe("mes");
    expect(montarEscalaGantt("2026-01-01", "2026-12-31", "semana")!.escala).toBe("semana");
  });

  it("posiciona barras em % e garante largura mínima pra um dia só", () => {
    const e = montarEscalaGantt("2026-10-01", "2026-10-20")!; // 28 dias, de 28/09 a 25/10
    const b = e.barra("2026-10-05", "2026-10-11"); // semana inteira
    expect(b.esquerda).toBeCloseTo((7 / 28) * 100, 6);
    expect(b.largura).toBeCloseTo((7 / 28) * 100, 6);
    expect(e.barra("2026-10-05", "2026-10-05").largura).toBeGreaterThanOrEqual(0.5);
    // Datas invertidas viram o mesmo intervalo.
    expect(e.barra("2026-10-11", "2026-10-05")).toEqual(b);
    expect(e.posicao("2026-09-28")).toBe(0);
  });

  it("aceita ISO completo vindo da API", () => {
    const e = montarEscalaGantt("2026-10-01", "2026-10-20")!;
    expect(e.posicao("2026-10-05T00:00:00.000Z")).toBeCloseTo(e.posicao("2026-10-05"), 9);
  });
});
