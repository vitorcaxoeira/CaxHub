import { describe, expect, it } from "vitest";
import { ariaSort, lerFiltros, lerOrdem, MAX_ORDEM, ordemParaTexto, posicaoNaOrdem, proximaOrdem, textoDoChip, type OrdemColuna } from "./estadoColunas";

const asc = (coluna: string): OrdemColuna => ({ coluna, direcao: "asc" });
const desc = (coluna: string): OrdemColuna => ({ coluna, direcao: "desc" });

describe("lerFiltros", () => {
  it("lê o JSON da URL e descarta o que não é filtro", () => {
    const f = [{ coluna: "status", operador: "=", valores: ["CONTRATADA"] }];
    expect(lerFiltros(JSON.stringify(f))).toEqual(f);
    expect(lerFiltros(null)).toEqual([]);
    expect(lerFiltros("{não é json")).toEqual([]);
    expect(lerFiltros('{"a":1}')).toEqual([]);
    expect(lerFiltros(JSON.stringify([{ coluna: "x" }, f[0], { coluna: "y", operador: "=", valores: [1] }]))).toEqual(f);
  });
});

describe("lerOrdem / ordemParaTexto", () => {
  it("ida e volta, direção omitida = crescente", () => {
    expect(lerOrdem("status:desc,sigla")).toEqual([desc("status"), asc("sigla")]);
    expect(ordemParaTexto([desc("status"), asc("sigla")])).toBe("status:desc,sigla:asc");
    expect(lerOrdem(ordemParaTexto([desc("a"), asc("b")]))).toEqual([desc("a"), asc("b")]);
  });

  it("descarta parte inválida, coluna repetida e o excesso", () => {
    expect(lerOrdem(null)).toEqual([]);
    expect(lerOrdem("a:cima,b:desc,b:asc,:asc,c:desc:x")).toEqual([desc("b")]);
    expect(lerOrdem("a,b,c,d,e,f")).toHaveLength(MAX_ORDEM);
  });
});

describe("proximaOrdem", () => {
  it("sem Shift: a coluna vira o único critério e alterna crescente, decrescente, sem ordem", () => {
    expect(proximaOrdem([], "a", false)).toEqual([asc("a")]);
    expect(proximaOrdem([asc("a")], "a", false)).toEqual([desc("a")]);
    expect(proximaOrdem([desc("a")], "a", false)).toEqual([]);
    expect(proximaOrdem([asc("b")], "a", false)).toEqual([asc("a")]);
    // havendo vários critérios, o clique simples recomeça só com a coluna clicada
    expect(proximaOrdem([asc("a"), desc("b")], "a", false)).toEqual([asc("a")]);
  });

  it("com Shift: soma a coluna, alterna a direção dela e a tira depois do decrescente", () => {
    expect(proximaOrdem([asc("a")], "b", true)).toEqual([asc("a"), asc("b")]);
    expect(proximaOrdem([asc("a"), asc("b")], "b", true)).toEqual([asc("a"), desc("b")]);
    expect(proximaOrdem([asc("a"), desc("b")], "b", true)).toEqual([asc("a")]);
    expect(proximaOrdem([], "a", true)).toEqual([asc("a")]);
  });

  it("com Shift, no teto de critérios não soma mais uma", () => {
    const cheia = ["a", "b", "c", "d"].map(asc);
    expect(proximaOrdem(cheia, "e", true)).toEqual(cheia);
  });
});

describe("posicaoNaOrdem / ariaSort", () => {
  it("dá direção e prioridade (1, 2...)", () => {
    const o = [desc("b"), asc("a")];
    expect(posicaoNaOrdem(o, "b")).toEqual({ direcao: "desc", prioridade: 1 });
    expect(posicaoNaOrdem(o, "a")).toEqual({ direcao: "asc", prioridade: 2 });
    expect(posicaoNaOrdem(o, "z")).toBeNull();
    expect(ariaSort(o, "b")).toBe("descending");
    expect(ariaSort(o, "a")).toBe("ascending");
    expect(ariaSort(o, "z")).toBe("none");
  });
});

describe("textoDoChip", () => {
  it("monta o texto por operador, com data em dd/mm/aaaa, domínio com rótulo e IN encurtado", () => {
    expect(textoDoChip({ coluna: "datlct", operador: "entre", valores: ["2026-01-01", "2026-03-31"] }, { tipo: "data" })).toBe("datlct entre 01/01/2026 e 31/03/2026");
    expect(textoDoChip({ coluna: "tipfor", operador: "=", valores: ["J"] }, { tipo: "texto", dominio: [{ valor: "J", rotulo: "Pessoa Jurídica" }] })).toBe("tipfor = J · Pessoa Jurídica");
    expect(textoDoChip({ coluna: "x", operador: "IN", valores: ["a", "b", "c", "d", "e"] }, { tipo: "texto" })).toBe("x em a, b, c +2");
    expect(textoDoChip({ coluna: "nome", operador: "vazio", valores: [] }, undefined)).toBe("nome vazio");
    expect(textoDoChip({ coluna: "ativo", operador: "=", valores: ["true"] }, { tipo: "booleano", titulo: "Ativa" })).toBe("Ativa = sim");
  });
});
