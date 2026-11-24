import { describe, expect, it } from "vitest";
import { agruparPorAno, formatarPercentual, formatoVariacaoDaUrl, periodoDaUrl, recortarAno, variacao, variacaoPercentual, variacaoValor } from "./orcadoRealizado";

const txt = (s: string) => s.replace(/\s/g, " ");

describe("variação do orçado x realizado", () => {
  it("em reais: realizado − orçado, com o sinal da convenção (despesa negativa)", () => {
    expect(variacaoValor(1200, 1000)).toBe(200);
    expect(variacaoValor(-1200, -1000)).toBe(-200); // gastou mais que o orçado
  });
  it("em %: sobre o |orçado|; sem orçado não há percentual", () => {
    expect(variacaoPercentual(1200, 1000)).toBe(20);
    expect(variacaoPercentual(-1200, -1000)).toBe(-20);
    expect(variacaoPercentual(500, 0)).toBeNull();
  });
  it("escolhe pelo formato", () => {
    expect(variacao(1500, 1000, "valor")).toBe(500);
    expect(variacao(1500, 1000, "pct")).toBe(50);
  });
  it("formata o percentual com uma casa", () => {
    expect(txt(formatarPercentual(12.345))).toBe("12,3%");
    expect(txt(formatarPercentual(-5))).toBe("-5,0%");
  });
  it("lê o formato da URL (R$ é o padrão)", () => {
    expect(formatoVariacaoDaUrl("pct")).toBe("pct");
    expect(formatoVariacaoDaUrl(null)).toBe("valor");
    expect(formatoVariacaoDaUrl("xyz")).toBe("valor");
  });
});

describe("visão Mês / Ano do orçado x realizado", () => {
  it("lê o periodo da URL: só 'ano' muda o padrão (mês)", () => {
    expect(periodoDaUrl("ano")).toBe("ano");
    expect(periodoDaUrl("mes")).toBe("mes");
    expect(periodoDaUrl("qualquer")).toBe("mes");
    expect(periodoDaUrl(null)).toBe("mes");
  });

  const meses = ["2025-11", "2025-12", "2026-01", "2026-02"];
  const serie = (r: number[], o: number[]) => ({
    valoresRealizado: r,
    valoresOrcado: o,
    totalRealizado: r.reduce((s, v) => s + v, 0),
    totalOrcado: o.reduce((s, v) => s + v, 0),
  });
  const tot = serie([10, 20, 30, 40], [1, 2, 3, 4]);
  const linhaA = { chave: "a", chavePai: null, ...serie([10, 20, 30, 40], [1, 2, 3, 4]) };
  const linhaFilha = { chave: "a1", chavePai: "a", ...serie([0, 0, 30, 0], [0, 0, 3, 0]) };
  const linhaVazia = { chave: "b", chavePai: null, ...serie([0, 0, 0, 0], [0, 0, 0, 0]) };

  it("agrupa por ano: soma os meses de cada ano e mantém os totais do período", () => {
    const r = agruparPorAno(meses, [linhaA], tot);
    expect(r.meses).toEqual(["2025", "2026"]);
    expect(r.linhas[0].valoresRealizado).toEqual([30, 70]);
    expect(r.linhas[0].valoresOrcado).toEqual([3, 7]);
    expect(r.totalGeral.valoresRealizado).toEqual([30, 70]);
    expect(r.totalGeral.totalRealizado).toBe(100);
    expect(r.totalGeral.totalOrcado).toBe(10);
  });

  it("recorte do ano: os totais batem com a coluna do ano na visão anual", () => {
    const anual = agruparPorAno(meses, [linhaA], tot);
    const r2026 = recortarAno("2026", meses, [linhaA], tot);
    expect(r2026.meses).toEqual(["2026-01", "2026-02"]);
    expect(r2026.totalGeral.totalRealizado).toBe(anual.totalGeral.valoresRealizado[1]);
    expect(r2026.totalGeral.totalOrcado).toBe(anual.totalGeral.valoresOrcado[1]);
    expect(r2026.linhas[0].totalRealizado).toBe(70);
  });

  it("recorte do ano tira a linha zerada no ano, mas mantém o pai com filho que fica", () => {
    // Em 2025 a filha só tem zero (o 30 cai em 2026-01): sai; a folha e o pai ficam pelos valores de 2025.
    const r = recortarAno("2025", meses, [linhaA, linhaFilha, linhaVazia], tot);
    expect(r.linhas.map((l) => l.chave)).toEqual(["a"]);
    const r2 = recortarAno("2026", meses, [linhaA, linhaFilha, linhaVazia], tot);
    expect(r2.linhas.map((l) => l.chave)).toEqual(["a", "a1"]);
    const so = recortarAno("2025", meses, [linhaVazia, { ...linhaFilha, chave: "c", chavePai: "b" }], tot);
    expect(so.linhas.map((l) => l.chave)).toEqual([]);
  });
});
