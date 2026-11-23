import { describe, expect, it } from "vitest";
import { alternarRegra, type RegraConta } from "./rentabilidade";

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
