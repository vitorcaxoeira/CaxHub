import { describe, expect, it } from "vitest";
import { alternarRegra, contasComFilhos, contasVisiveis, planoComAncestrais, type ContaDoPlano, type RegraConta } from "./rentabilidade";

const conta = { codemp: 1, ctared: 224 };

describe("alternarRegra", () => {
  it("conta sem regra: acrescenta com a ação pedida", () => {
    expect(alternarRegra([], conta, "incluir")).toEqual([{ codemp: 1, ctared: 224, acao: "incluir" }]);
  });
  it("mesma ação de novo: remove (clicar duas vezes desfaz)", () => {
    const regras: RegraConta[] = [{ codemp: 1, ctared: 224, acao: "incluir" }];
    expect(alternarRegra(regras, conta, "incluir")).toEqual([]);
  });
  it("outra ação: troca, sem duplicar a conta", () => {
    const r = alternarRegra([{ codemp: 1, ctared: 224, acao: "incluir" }], conta, "excluir");
    expect(r).toEqual([{ codemp: 1, ctared: 224, acao: "excluir" }]);
  });
  it("não mexe nas regras das outras contas", () => {
    const regras: RegraConta[] = [
      { codemp: 1, ctared: 226, acao: "incluir" },
      { codemp: 1, ctared: 235, acao: "excluir" },
    ];
    const r = alternarRegra(regras, conta, "incluir");
    expect(r).toHaveLength(3);
    expect(r.filter((x) => x.ctared === 224)).toHaveLength(1);
    expect(alternarRegra(r, conta, "incluir")).toEqual(regras);
  });
  it("não altera a lista de entrada", () => {
    const regras: RegraConta[] = [{ codemp: 1, ctared: 226, acao: "incluir" }];
    alternarRegra(regras, conta, "incluir");
    expect(regras).toHaveLength(1);
  });
});

// Plano de teste em pré-ordem: 1 > 1.1 > 1.1.1 (analítica) e 1.2 (analítica); 2 (raiz) > 2.1 (analítica).
const c = (ctared: number, clacta: string, paiCtared: number | null, anasin = "S"): ContaDoPlano => ({
  codemp: 1, ctared, clacta, descta: `Conta ${clacta}`, anasin, nivcta: clacta.split(".").length, paiCtared, despar: null,
});
const PLANO = [c(1, "1", null), c(11, "1.1", 1), c(111, "1.1.1", 11, "A"), c(12, "1.2", 1, "A"), c(2, "2", null), c(21, "2.1", 2, "A")];
const ids = (l: ContaDoPlano[]) => l.map((x) => x.ctared);

describe("árvore do plano no seletor de contas", () => {
  it("contas com filhos ganham a seta", () => {
    expect([...contasComFilhos(PLANO)].sort()).toEqual(["1:1", "1:11", "1:2"]);
  });
  it("recolhido: só as raízes", () => {
    expect(ids(contasVisiveis(PLANO, new Set()))).toEqual([1, 2]);
  });
  it("expandir uma raiz mostra só as filhas diretas", () => {
    expect(ids(contasVisiveis(PLANO, new Set(["1:1"])))).toEqual([1, 11, 12, 2]);
  });
  it("expandir tudo mostra todas, na ordem do plano", () => {
    expect(ids(contasVisiveis(PLANO, contasComFilhos(PLANO)))).toEqual([1, 11, 111, 12, 2, 21]);
  });
  it("filha expandida sob pai recolhido continua oculta", () => {
    expect(ids(contasVisiveis(PLANO, new Set(["1:11"])))).toEqual([1, 2]);
  });
  it("recorte: a conta usada e todas as sintéticas acima dela", () => {
    expect(ids(planoComAncestrais(PLANO, new Set(["1:111"])))).toEqual([1, 11, 111]);
    expect(ids(planoComAncestrais(PLANO, new Set(["1:111", "1:21"])))).toEqual([1, 11, 111, 2, 21]);
  });
  it("recorte: conta fora do plano é ignorada", () => {
    expect(ids(planoComAncestrais(PLANO, new Set(["1:999"])))).toEqual([]);
  });
});
