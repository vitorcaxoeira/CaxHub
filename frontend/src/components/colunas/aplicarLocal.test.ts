import { describe, expect, it } from "vitest";
import { aplicarFiltrosLocal, operadoresPorTipo, ordenarLocal, valoresLocais, type ColunaLocal } from "./aplicarLocal";

interface Linha {
  fase: string;
  pecas: number;
  volume: number | null;
  primeira: string | null;
  ativa?: boolean;
}

const COLUNAS: ColunaLocal[] = [
  { nome: "fase", tipo: "texto" },
  { nome: "pecas", tipo: "inteiro" },
  { nome: "volume", tipo: "decimal" },
  { nome: "primeira", tipo: "data" },
  { nome: "ativa", tipo: "booleano" },
];

const LINHAS: Linha[] = [
  { fase: "CONCRETAGEM", pecas: 30, volume: 38.76, primeira: "2026-08-24T03:00:00.000Z", ativa: true },
  { fase: "ARMAÇÃO", pecas: 33, volume: 61.65, primeira: "2026-08-19T03:00:00.000Z", ativa: false },
  { fase: "CORTE DOBRA", pecas: 33, volume: null, primeira: null },
  { fase: "Armação extra", pecas: 5, volume: 2, primeira: "2026-09-02T03:00:00.000Z" },
];
const fases = (l: Linha[]) => l.map((x) => x.fase);
const ultima = (l: Linha[]) => l[l.length - 1];

describe("aplicarFiltrosLocal", () => {
  it("texto: igual, contém e começa com sem diferenciar maiúsculas", () => {
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "fase", operador: "=", valores: ["armação"] }]))).toEqual(["ARMAÇÃO"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "fase", operador: "contém", valores: ["armação"] }]))).toEqual(["ARMAÇÃO", "Armação extra"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "fase", operador: "começa com", valores: ["co"] }]))).toEqual(["CONCRETAGEM", "CORTE DOBRA"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "fase", operador: "IN", valores: ["concretagem", "corte dobra"] }]))).toEqual(["CONCRETAGEM", "CORTE DOBRA"]);
  });

  it("número: comparação, faixa e diferente; nulo nunca casa", () => {
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "pecas", operador: "≥", valores: ["33"] }]))).toEqual(["ARMAÇÃO", "CORTE DOBRA"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "volume", operador: "entre", valores: ["2", "40"] }]))).toEqual(["CONCRETAGEM", "Armação extra"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "volume", operador: "≠", valores: ["2"] }]))).toEqual(["CONCRETAGEM", "ARMAÇÃO"]);
  });

  it("data: pelo dia inteiro (ISO da API), igual, intervalo e vazio", () => {
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "primeira", operador: "=", valores: ["2026-08-24"] }]))).toEqual(["CONCRETAGEM"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "primeira", operador: "entre", valores: ["2026-08-20", "2026-09-02"] }]))).toEqual(["CONCRETAGEM", "Armação extra"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "primeira", operador: "vazio", valores: [] }]))).toEqual(["CORTE DOBRA"]);
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "primeira", operador: "não vazio", valores: [] }]))).toHaveLength(3);
  });

  it("booleano e vários filtros em E; coluna desconhecida é ignorada", () => {
    expect(fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "ativa", operador: "=", valores: ["true"] }]))).toEqual(["CONCRETAGEM"]);
    expect(
      fases(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "pecas", operador: "≥", valores: ["30"] }, { coluna: "fase", operador: "contém", valores: ["co"] }])),
    ).toEqual(["CONCRETAGEM", "CORTE DOBRA"]);
    expect(aplicarFiltrosLocal(LINHAS, COLUNAS, [{ coluna: "inexistente", operador: "=", valores: ["x"] }])).toBe(LINHAS);
  });
});

describe("ordenarLocal", () => {
  it("uma coluna, crescente e decrescente, sem mexer no array original", () => {
    const copia = [...LINHAS];
    expect(fases(ordenarLocal(LINHAS, COLUNAS, [{ coluna: "pecas", direcao: "desc" }]))).toEqual(["ARMAÇÃO", "CORTE DOBRA", "CONCRETAGEM", "Armação extra"]);
    expect(LINHAS).toEqual(copia);
  });

  it("várias colunas: o segundo critério desempata o primeiro", () => {
    expect(
      fases(ordenarLocal(LINHAS, COLUNAS, [{ coluna: "pecas", direcao: "desc" }, { coluna: "fase", direcao: "desc" }])),
    ).toEqual(["CORTE DOBRA", "ARMAÇÃO", "CONCRETAGEM", "Armação extra"]);
  });

  it("nulo vai por último nas duas direções; datas e textos comparam certo", () => {
    expect(ultima(ordenarLocal(LINHAS, COLUNAS, [{ coluna: "volume", direcao: "asc" }])).fase).toBe("CORTE DOBRA");
    expect(ultima(ordenarLocal(LINHAS, COLUNAS, [{ coluna: "volume", direcao: "desc" }])).fase).toBe("CORTE DOBRA");
    expect(fases(ordenarLocal(LINHAS, COLUNAS, [{ coluna: "primeira", direcao: "asc" }]))).toEqual(["ARMAÇÃO", "CONCRETAGEM", "Armação extra", "CORTE DOBRA"]);
    expect(fases(ordenarLocal(LINHAS, COLUNAS, [{ coluna: "fase", direcao: "asc" }]))).toEqual(["ARMAÇÃO", "Armação extra", "CONCRETAGEM", "CORTE DOBRA"]);
  });

  it("sem critério devolve a própria lista", () => {
    expect(ordenarLocal(LINHAS, COLUNAS, [])).toBe(LINHAS);
  });
});

describe("valoresLocais", () => {
  it("valores distintos com a quantidade, mais frequentes primeiro, e o vazio como null", () => {
    const r = valoresLocais(LINHAS, COLUNAS, [], "pecas", "");
    expect(r.valores).toEqual([
      { valor: 33, quantidade: 2 },
      { valor: 5, quantidade: 1 },
      { valor: 30, quantidade: 1 },
    ]);
    expect(valoresLocais(LINHAS, COLUNAS, [], "primeira", "").valores.some((v) => v.valor === null)).toBe(true);
  });

  it("ignora o filtro da própria coluna e respeita o das outras", () => {
    const so33 = [{ coluna: "pecas", operador: "=" as const, valores: ["33"] }];
    expect(valoresLocais(LINHAS, COLUNAS, so33, "pecas", "").valores).toHaveLength(3);
    expect(valoresLocais(LINHAS, COLUNAS, so33, "fase", "").valores.map((v) => v.valor).sort()).toEqual(["ARMAÇÃO", "CORTE DOBRA"]);
  });

  it("o termo restringe por texto, sem diferenciar maiúsculas", () => {
    expect(valoresLocais(LINHAS, COLUNAS, [], "fase", "ARM").valores.map((v) => v.valor).sort()).toEqual(["ARMAÇÃO", "Armação extra"]);
  });
});

describe("operadoresPorTipo", () => {
  it("oferece vazio e não vazio só quando a coluna aceita nulo", () => {
    expect(operadoresPorTipo("texto")).toEqual(["=", "≠", "IN", "contém", "começa com", "vazio", "não vazio"]);
    expect(operadoresPorTipo("texto", true)).toEqual(["=", "≠", "IN", "contém", "começa com"]);
    expect(operadoresPorTipo("booleano", true)).toEqual(["="]);
  });
});

describe("dia de uma data", () => {
  const linhas = [{ id: 1, quando: "2026-10-10T02:30:00.000Z" }, { id: 2, quando: "2026-10-10T12:00:00.000Z" }];

  it("carimbo com hora conta o dia de Brasília (UTC-3)", () => {
    const col: ColunaLocal[] = [{ nome: "quando", tipo: "data" }];
    const r = aplicarFiltrosLocal(linhas, col, [{ coluna: "quando", operador: "=", valores: ["2026-10-09"] }]);
    expect(r.map((l) => l.id)).toEqual([1]); // 02:30Z ainda é 09/10 em Brasília
  });

  it("data pura (utc) usa o dia da própria data", () => {
    const col: ColunaLocal[] = [{ nome: "quando", tipo: "data", utc: true }];
    const r = aplicarFiltrosLocal(linhas, col, [{ coluna: "quando", operador: "=", valores: ["2026-10-10"] }]);
    expect(r.map((l) => l.id)).toEqual([1, 2]);
  });
});
