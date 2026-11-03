import { describe, expect, it } from "vitest";
import { estadoPadrao, mesmoValorFiltro, regras, valorDoPeriodo } from "./regras";

describe("estadoPadrao", () => {
  it("diferencia sem padrão, igual e diferente; a ordem da seleção não importa", () => {
    expect(estadoPadrao(undefined, [])).toBe("nenhum");
    expect(estadoPadrao(["1:2", "1:1"], ["1:1", "1:2"])).toBe("igual");
    expect(estadoPadrao([2026], [2025])).toBe("diferente");
    expect(estadoPadrao(" aço ", "aço")).toBe("igual");
  });
  it("'Todos' salvo (lista vazia) é um padrão de verdade, diferente de não ter padrão", () => {
    expect(estadoPadrao([], [])).toBe("igual");
    expect(estadoPadrao([], ["01"])).toBe("diferente");
    expect(mesmoValorFiltro([], undefined)).toBe(false);
  });
  it("null (Todas num select) é um padrão; tuplas respeitam a ordem; objetos comparam por conteúdo", () => {
    expect(estadoPadrao(null, null)).toBe("igual");
    expect(estadoPadrao(null, "x")).toBe("diferente");
    expect(mesmoValorFiltro(["", "2026-03-01"], ["2026-03-01", ""])).toBe(true);
    expect(mesmoValorFiltro(["", "2026-03-01"], ["2026-03-01", ""], true)).toBe(false);
    expect(estadoPadrao([{ cod: 1, nome: "A" }], [{ nome: "A", cod: 1 }])).toBe("igual");
    expect(estadoPadrao([{ cod: 1, nome: "A" }], [{ cod: 2, nome: "B" }])).toBe("diferente");
    expect(estadoPadrao(false, false)).toBe("igual");
  });
});

describe("regras.lista", () => {
  it("aplica o que ainda existe; vazio vale ('Todos'), a não ser que vazioOk=false", () => {
    expect(regras.lista("string", ["1:2", "1:1"])(["1:2"])).toEqual({ ok: true, valor: ["1:2"] });
    expect(regras.lista("number", [2026, 2025])([2026])).toEqual({ ok: true, valor: [2026] });
    expect(regras.lista("string", ["a"])([])).toEqual({ ok: true, valor: [] });
    expect(regras.lista("number", [2026], { vazioOk: false })([])).toEqual({ ok: false });
  });
  it("não força item que sumiu (nem metade da escolha) nem formato errado", () => {
    expect(regras.lista("string", ["1:2"])(["1:2", "9:9"])).toEqual({ ok: false });
    expect(regras.lista("number", [2026])([2019])).toEqual({ ok: false });
    expect(regras.lista("string", ["20"])("20")).toEqual({ ok: false });
    expect(regras.lista("number", [1])(["1"])).toEqual({ ok: false });
  });
  it("sem lista de existentes confere só o formato", () => {
    expect(regras.lista("string")(["qualquer"])).toEqual({ ok: true, valor: ["qualquer"] });
  });
});

describe("demais regras", () => {
  it("valorUnico: um dos existentes; null só com nuloOk", () => {
    expect(regras.valorUnico("string", ["", "30"])("30")).toEqual({ ok: true, valor: "30" });
    expect(regras.valorUnico("string", ["", "30"])("45")).toEqual({ ok: false });
    expect(regras.valorUnico("number", [1], { nuloOk: true })(null)).toEqual({ ok: true, valor: null });
    expect(regras.valorUnico("number", [1])(null)).toEqual({ ok: false });
  });
  it("texto, numero, booleano e data", () => {
    expect(regras.texto()(" cimento ")).toEqual({ ok: true, valor: "cimento" });
    expect(regras.texto()(3)).toEqual({ ok: false });
    expect(regras.numero({ min: 0 })(-1)).toEqual({ ok: false });
    expect(regras.numero({ min: 0 })(30)).toEqual({ ok: true, valor: 30 });
    expect(regras.booleano()(false)).toEqual({ ok: true, valor: false });
    expect(regras.booleano()("sim")).toEqual({ ok: false });
    expect(regras.data()(null)).toEqual({ ok: true, valor: null });
    expect(regras.data()("2026-02-30x")).toEqual({ ok: false });
  });
  it("parDatas: cada ponta vazia ou data, início não passa do fim", () => {
    expect(regras.parDatas()(["", "2026-03-01"])).toEqual({ ok: true, valor: ["", "2026-03-01"] });
    expect(regras.parDatas()(["2026-03-02", "2026-03-01"])).toEqual({ ok: false });
    expect(regras.parDatas()(["2026-03-01"])).toEqual({ ok: false });
  });
  it("periodo: preset relativo ou personalizado com as duas datas", () => {
    const v = regras.periodo(["mesAtual", "3m", "personalizado"]);
    expect(v(["3m"])).toEqual({ ok: true, valor: { preset: "3m" } });
    expect(v(["personalizado", "2026-01-01", "2026-02-01"])).toEqual({ ok: true, valor: { preset: "personalizado", de: "2026-01-01", ate: "2026-02-01" } });
    expect(v(["personalizado", "2026-03-01", "2026-02-01"])).toEqual({ ok: false });
    expect(v(["ano"])).toEqual({ ok: false });
    expect(v(["3m", "2026-01-01", "2026-02-01"])).toEqual({ ok: false });
    expect(valorDoPeriodo({ preset: "3m", de: "x", ate: "y" })).toEqual(["3m"]);
    expect(valorDoPeriodo({ preset: "personalizado", de: "2026-01-01", ate: "2026-02-01" })).toEqual(["personalizado", "2026-01-01", "2026-02-01"]);
  });
  it("listaObjetos exige a chave em cada item", () => {
    expect(regras.listaObjetos("cod")([{ cod: 1, nome: "A" }])).toEqual({ ok: true, valor: [{ cod: 1, nome: "A" }] });
    expect(regras.listaObjetos("cod")([{ nome: "A" }])).toEqual({ ok: false });
    expect(regras.listaObjetos("cod")(["x"])).toEqual({ ok: false });
  });
});
