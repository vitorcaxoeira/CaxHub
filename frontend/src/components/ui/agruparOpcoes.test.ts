import { describe, expect, it } from "vitest";
import { agruparOpcoes, grupoEstaAberto, marcadasDoGrupo, rotuloComGrupo, type OpcaoAgrupavel } from "./agruparOpcoes";

const opcoes: OpcaoAgrupavel[] = [
  { value: "a1", label: "ERP | Gestão Empresarial", grupo: "Área" },
  { value: "a2", label: "HCM | Gestão de Pessoas", grupo: "Área" },
  { value: "m1", label: "Implementação", grupo: "Motivo" },
  { value: "x1", label: "Sem grupo nenhum" },
];

describe("agruparOpcoes", () => {
  it("agrupa preservando a ordem de chegada dos grupos e das opções", () => {
    const g = agruparOpcoes(opcoes);
    expect(g.map(([nome]) => nome)).toEqual(["Área", "Motivo", "Sem grupo"]);
    expect(g[0][1].map((o) => o.value)).toEqual(["a1", "a2"]);
  });
  it("lista vazia não gera grupo", () => {
    expect(agruparOpcoes([])).toEqual([]);
  });
});

describe("grupoEstaAberto", () => {
  it("sem busca e sem clique, todo grupo começa contraído", () => {
    for (const nome of ["Área", "Motivo", "Sem grupo"]) expect(grupoEstaAberto(false, new Set(), nome)).toBe(false);
  });
  it("só o grupo expandido pela pessoa fica aberto", () => {
    const abertos = new Set(["Motivo"]);
    expect(grupoEstaAberto(false, abertos, "Motivo")).toBe(true);
    expect(grupoEstaAberto(false, abertos, "Área")).toBe(false);
  });
  it("com busca digitada todo grupo que sobrou aparece aberto", () => {
    expect(grupoEstaAberto(true, new Set(), "Área")).toBe(true);
  });
});

describe("marcadasDoGrupo", () => {
  it("conta só as marcadas daquele grupo", () => {
    expect(marcadasDoGrupo(opcoes, "Área", ["a1", "m1"])).toBe(1);
    expect(marcadasDoGrupo(opcoes, "Área", ["a1", "a2"])).toBe(2);
    expect(marcadasDoGrupo(opcoes, "Motivo", [])).toBe(0);
    expect(marcadasDoGrupo(opcoes, "Sem grupo", ["x1"])).toBe(1);
  });
});

describe("rotuloComGrupo", () => {
  it("agrupado, o gatilho mostra o grupo junto; sem agrupar, só o rótulo", () => {
    expect(rotuloComGrupo(opcoes[0], true)).toBe("Área · ERP | Gestão Empresarial");
    expect(rotuloComGrupo(opcoes[0], false)).toBe("ERP | Gestão Empresarial");
    expect(rotuloComGrupo(opcoes[3], true)).toBe("Sem grupo nenhum");
    expect(rotuloComGrupo(undefined, true)).toBeUndefined();
  });
});
