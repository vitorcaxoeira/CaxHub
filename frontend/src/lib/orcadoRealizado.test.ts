import { describe, expect, it } from "vitest";
import { formatarPercentual, formatoVariacaoDaUrl, variacao, variacaoPercentual, variacaoValor } from "./orcadoRealizado";

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
