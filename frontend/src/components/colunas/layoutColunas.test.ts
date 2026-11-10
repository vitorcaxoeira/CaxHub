import { describe, expect, it } from "vitest";
import {
  alternarOculta,
  colunasCongeladas,
  definirLargura,
  deslocamentosCongeladas,
  ehPadrao,
  moverColuna,
  moverPasso,
  quantasCongeladasCabem,
  resolverLayout,
} from "./layoutColunas";

const PADRAO = ["codigo", "descricao", "unidade", "origem", "faixa"];

describe("resolverLayout", () => {
  it("sem nada salvo, vale o padrão da tela", () => {
    expect(resolverLayout(PADRAO, null)).toEqual({ ordem: PADRAO, ocultas: [], visiveis: PADRAO, larguras: {}, resumos: {}, congeladaAte: "", congeladas: [] });
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

describe("colunas ocultas por padrão (04/11/2026)", () => {
  it("sem nada salvo, as ocultas por padrão nascem ocultas (obrigatória nunca)", () => {
    const r = resolverLayout(PADRAO, null, ["codigo"], ["origem", "codigo", "sumiu"]);
    expect(r.ocultas).toEqual(["origem"]);
    expect(r.visiveis).toEqual(["codigo", "descricao", "unidade", "faixa"]);
  });

  it("a resposta 'nada salvo' da API ({ ordem: [], ocultas: [] }) também usa as ocultas por padrão", () => {
    expect(resolverLayout(PADRAO, { ordem: [], ocultas: [], larguras: {}, resumos: {} }, [], ["origem"]).ocultas).toEqual(["origem"]);
  });

  it("com arrumação salva, vale o que o usuário escolheu (inclusive mostrar a que nasce oculta)", () => {
    expect(resolverLayout(PADRAO, { ordem: PADRAO, ocultas: [] }, [], ["origem"]).ocultas).toEqual([]);
    expect(resolverLayout(PADRAO, { ordem: PADRAO, ocultas: ["unidade"] }, [], ["origem"]).ocultas).toEqual(["unidade"]);
  });

  it("padrão = exatamente as ocultas por padrão ocultas; mostrar uma delas deixa de ser o padrão", () => {
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: ["origem"] }, ["origem"])).toBe(true);
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: [] }, ["origem"])).toBe(false);
    expect(ehPadrao(PADRAO, { ordem: PADRAO, ocultas: ["origem", "faixa"] }, ["origem"])).toBe(false);
  });
});

describe("colunas paradas ao rolar (congelar até aqui)", () => {
  it("colunasCongeladas: as visíveis da primeira até o limite, na ordem; limite vazio ou inexistente = nenhuma", () => {
    expect(colunasCongeladas(PADRAO, [], "descricao")).toEqual(["codigo", "descricao"]);
    expect(colunasCongeladas(PADRAO, [], "faixa")).toEqual(PADRAO);
    expect(colunasCongeladas(PADRAO, [], "")).toEqual([]);
    expect(colunasCongeladas(PADRAO, [], "nao-existe")).toEqual([]);
  });

  it("colunasCongeladas: oculta no meio do trecho não para; limite oculto vale as visíveis antes dele", () => {
    expect(colunasCongeladas(PADRAO, ["descricao"], "unidade")).toEqual(["codigo", "unidade"]);
    expect(colunasCongeladas(PADRAO, ["unidade"], "unidade")).toEqual(["codigo", "descricao"]);
  });

  it("colunasCongeladas acompanha a ordem: mover uma coluna para dentro ou para fora do trecho muda quem fica parada", () => {
    expect(colunasCongeladas(moverColuna(PADRAO, "origem", "codigo"), [], "descricao")).toEqual(["origem", "codigo", "descricao"]);
    expect(colunasCongeladas(moverColuna(PADRAO, "codigo", "faixa"), [], "descricao")).toEqual(["descricao"]);
  });

  it("resolverLayout: sem escolha vale o padrão da tela; a escolha do usuário (inclusive nenhuma) vence", () => {
    const r = (salvo: Parameters<typeof resolverLayout>[1]) => resolverLayout(PADRAO, salvo, [], [], "codigo");
    expect(r(null).congeladas).toEqual(["codigo"]);
    expect(r({ ordem: PADRAO, ocultas: [] }).congeladaAte).toBe("codigo");
    expect(r({ ordem: PADRAO, ocultas: [], congeladaAte: null }).congeladaAte).toBe("codigo");
    expect(r({ ordem: PADRAO, ocultas: [], congeladaAte: "unidade" }).congeladas).toEqual(["codigo", "descricao", "unidade"]);
    expect(r({ ordem: PADRAO, ocultas: [], congeladaAte: "" })).toMatchObject({ congeladaAte: "", congeladas: [] });
  });

  it("resolverLayout: limite salvo de coluna que a tela não tem mais volta ao padrão; padrão que não existe vale nenhuma", () => {
    expect(resolverLayout(PADRAO, { ordem: PADRAO, ocultas: [], congeladaAte: "sumiu" }, [], [], "codigo").congeladaAte).toBe("codigo");
    expect(resolverLayout(PADRAO, null, [], [], "sumiu").congeladas).toEqual([]);
  });

  it("ehPadrao: sem escolha ou escolha igual ao padrão da tela não é personalização; outra escolha (ou nenhuma) é", () => {
    const base = { ordem: PADRAO, ocultas: [] as string[] };
    expect(ehPadrao(PADRAO, base, [], "codigo")).toBe(true);
    expect(ehPadrao(PADRAO, { ...base, congeladaAte: null }, [], "codigo")).toBe(true);
    expect(ehPadrao(PADRAO, { ...base, congeladaAte: "codigo" }, [], "codigo")).toBe(true);
    expect(ehPadrao(PADRAO, { ...base, congeladaAte: "descricao" }, [], "codigo")).toBe(false);
    expect(ehPadrao(PADRAO, { ...base, congeladaAte: "" }, [], "codigo")).toBe(false);
    // Tela sem padrão de coluna parada: "nenhuma" é o padrão.
    expect(ehPadrao(PADRAO, base)).toBe(true);
    expect(ehPadrao(PADRAO, { ...base, congeladaAte: "" })).toBe(true);
    expect(ehPadrao(PADRAO, { ...base, congeladaAte: "codigo" })).toBe(false);
  });

  it("quantasCongeladasCabem: só as primeiras que cabem em 60% da largura visível; sem largura medida, todas", () => {
    expect(quantasCongeladasCabem([100, 100, 100], 1000)).toBe(3);
    expect(quantasCongeladasCabem([300, 200, 200], 1000)).toBe(2); // 500 cabe, 700 passa de 600
    expect(quantasCongeladasCabem([700, 100], 1000)).toBe(0); // a primeira sozinha já passa do teto
    expect(quantasCongeladasCabem([300, 300], 1000)).toBe(2); // 600 exatos ainda cabem
    expect(quantasCongeladasCabem([300, 400], 0)).toBe(2);
    expect(quantasCongeladasCabem([], 1000)).toBe(0);
  });

  it("deslocamentosCongeladas: cada coluna parada começa onde a anterior termina, depois da coluna do ícone", () => {
    expect(deslocamentosCongeladas(["a", "b", "c"], { a: 120, b: 80, c: 200 }, 28)).toEqual({ a: 28, b: 148, c: 228 });
    expect(deslocamentosCongeladas([], {}, 28)).toEqual({});
    expect(deslocamentosCongeladas(["a", "b"], { a: 50 }, 28)).toEqual({ a: 28, b: 78 });
  });
});
