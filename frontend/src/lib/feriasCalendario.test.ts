import { describe, expect, it } from "vitest";
import { hhhmm, hhhmmDeHoras, lerHoras } from "./feriasCalendario";

describe("horas em hhh:mm das férias", () => {
  it("hhhmm e hhhmmDeHoras usam 3 dígitos de hora", () => {
    expect(hhhmm(9922)).toBe("165:22");
    expect(hhhmm(0)).toBe("000:00");
    expect(hhhmmDeHoras(8.5)).toBe("008:30");
    expect(hhhmmDeHoras(66.61)).toBe("066:37");
  });

  it("lerHoras aceita hh:mm e decimal (vírgula ou ponto); vazio ou inválido é null", () => {
    expect(lerHoras("8:30")).toBeCloseTo(8.5, 9);
    expect(lerHoras("008:30")).toBeCloseTo(8.5, 9);
    expect(lerHoras("8,5")).toBe(8.5);
    expect(lerHoras("8.5")).toBe(8.5);
    expect(lerHoras("")).toBeNull();
    expect(lerHoras("  ")).toBeNull();
    expect(lerHoras("8:75")).toBeNull();
    expect(lerHoras("abc")).toBeNull();
  });
});
