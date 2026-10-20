import { describe, expect, it } from "vitest";
import { visaoInicial, visaoPadraoDe } from "./atividadesVisao";

describe("visão inicial de Atividades", () => {
  it("?visao= válida na URL manda, mesmo com outra preferência", () => {
    expect(visaoInicial("quadro", "lista")).toBe("quadro");
    expect(visaoInicial("workload", null)).toBe("workload");
  });
  it("sem parâmetro ou com parâmetro inválido, vale a preferência do usuário", () => {
    expect(visaoInicial(null, "lista")).toBe("lista");
    expect(visaoInicial("kanban", "timeline")).toBe("timeline");
  });
  it("sem preferência (ou preferência estranha), abre no Quadro", () => {
    expect(visaoInicial(null, undefined)).toBe("quadro");
    expect(visaoPadraoDe("xyz")).toBe("quadro");
  });
});
