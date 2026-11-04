import { describe, expect, it } from "vitest";
import { alternarOculta, definirLargura, ehPadrao, moverColuna, moverPasso, resolverLayout } from "./layoutColunas";

const PADRAO = ["codigo", "descricao", "unidade", "origem", "faixa"];

describe("resolverLayout", () => {
  it("sem nada salvo, vale o padrão da tela", () => {
    expect(resolverLayout(PADRAO, null)).toEqual({ ordem: PADRAO, ocultas: [], visiveis: PADRAO, larguras: {}, resumos: {} });
  });

  it("resumos: só de coluna que a tela tem", () => {
    expect(resolverLayout(PADRAO, { ordem: [], ocultas: [], resumos: { [PADRAO[0]]: "soma", sumiu: "media" } }).resumos).toEqual({ [PADRAO[0]]: "soma" });
  });

  it("usa a ordem salva, tira as ocultas das visíveis e ignora coluna que a tela não tem mais", () => {
    const r = resolverLayout(PADRAO, { ordem: ["origem", "codigo", "removida", "descricao", "unidade", "faixa"], ocultas: ["unidade", "removida"] });
    expect(r.ordem).toEqual(["origem", "codigo", "descricao", "unidade", "faixa"]);
    expect(r.ocultas).toEqual(["unidade"]);
    expect(r.visiveis).toEqual(["origem", "codigo", "descricao", "faixa"]);
  });

  it("coluna nova entra logo depois da que vem antes dela no padrão (ou no começo)", () => {
    expect(resolverLayout(PADRAO, { ordem: ["faixa", "descricao", "origem"], ocultas: [] }).ordem).toEqual(["codigo", "faixa", "descricao", "unidade", "origem"]);
  });

  it("coluna obrigatória nunca fica oculta", () => {
    expect(resolverLayout(PADRAO, { ordem: PADRAO, ocultas: ["faixa", "origem"] }, ["faixa"]).ocultas).toEqual(["origem"]);
  });
});

describe("mover e ocultar", () => {
  it("arrastar para a direita fica depois do alvo, para a esquerda fica antes", () => {
    expect(moverColuna(PADRAO, "codigo", "unidade")).toEqual(["descricao", "unidade", "codigo", "origem", "faixa"]);
    expect(moverColuna(PADRAO, "origem", "descricao")).toEqual(["codigo", "origem", "descricao", "unidade", "faixa"]);
    expect(moverColuna(PADRAO, "origem", "nao-existe")).toBe(PADRAO);
  });

  it("subir e descer uma posição, sem passar da ponta", () => {
    expect(moverPasso(PADRAO, "descricao", -1)).toEqual(["descricao", "codigo", "unidade", "origem", "faixa"]);
    expect(moverPasso(PADRAO, "descricao", 1)).toEqual(["codigo", "unidade", "descricao", "origem", "faixa"]);
    expect(moverPasso(PADRAO, "codigo", -1)).toBe(PADRAO);
    expect(moverPasso(PADRAO, "faixa", 1)).toBe(PADRAO);
  });

  it("alterna oculta, menos a obrigatória", () => {
    expect(alternarOculta([], "unidade")).toEqual(["unidade"]);
    expect(alternarOculta(["unidade"], "unidade")).toEqual([]);
    expect(alternarOculta([], "faixa", ["faixa"])).toEqual([]);
  });

  it("reconhece o padrão", () => {
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: [] })).toBe(true);
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: ["unidade"] })).toBe(false);
    expect(ehPadrao(PADRAO, { ordem: moverPasso(PADRAO, "faixa", -1), ocultas: [] })).toBe(false);
  });
});

describe("larguras", () => {
  it("descarta largura de coluna que não existe e limita a 40–2000", () => {
    expect(resolverLayout(PADRAO, { ordem: [], ocultas: [], larguras: { codigo: 10, descricao: 280.4, origem: 9999, sumiu: 100 } }).larguras).toEqual({
      codigo: 40,
      descricao: 280,
      origem: 2000,
    });
  });

  it("primeiro ajuste guarda as medidas de todas as visíveis; os seguintes só mudam a coluna puxada", () => {
    const medidas = { codigo: 88.6, descricao: 412, faixa: 120 };
    const primeiro = definirLargura({}, "descricao", 300, medidas);
    expect(primeiro).toEqual({ codigo: 89, descricao: 300, faixa: 120 });
    expect(definirLargura(primeiro, "codigo", 20, medidas)).toEqual({ codigo: 40, descricao: 300, faixa: 120 });
  });

  it("largura ajustada deixa de ser o padrão", () => {
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: [], larguras: { codigo: 90 } })).toBe(false);
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: [], larguras: {} })).toBe(true);
  });
});
