import test from "node:test";
import assert from "node:assert/strict";
import { tabelaValida, validarCamposExtras, validarLayoutColunas } from "./layoutColunas";

test("tabelaValida: só minúsculas, dígitos, ponto, hífen e sublinhado, até 80", () => {
  assert.equal(tabelaValida("plannix.obra.materiais"), true);
  assert.equal(tabelaValida("Plannix"), false);
  assert.equal(tabelaValida("a/b"), false);
  assert.equal(tabelaValida(""), false);
  assert.equal(tabelaValida("x".repeat(81)), false);
  assert.equal(tabelaValida(undefined), false);
});

test("validarLayoutColunas: aceita ordem e ocultas de texto; sem larguras nem resumos vale {}", () => {
  assert.deepEqual(validarLayoutColunas({ ordem: ["codigo", "descricao"], ocultas: ["unidade"], extra: 1 }), {
    ordem: ["codigo", "descricao"],
    ocultas: ["unidade"],
    larguras: {},
    resumos: {},
    titulos: {},
    congeladaAte: null,
  });
  assert.deepEqual(validarLayoutColunas({ ordem: [], ocultas: [], larguras: { descricao: 280, codigo: 40 }, resumos: { quantidade: "soma" } }), {
    ordem: [],
    ocultas: [],
    larguras: { descricao: 280, codigo: 40 },
    resumos: { quantidade: "soma" },
    titulos: {},
    congeladaAte: null,
  });
});

test("validarLayoutColunas: resumo só com função conhecida, em objeto simples", () => {
  const com = (resumos: unknown) => validarLayoutColunas({ ordem: [], ocultas: [], resumos });
  assert.equal(com({ quantidade: "somatorio" }), null);
  assert.equal(com({ quantidade: 1 }), null);
  assert.equal(com(["soma"]), null);
  assert.equal(com({ ["x".repeat(61)]: "soma" }), null);
  assert.deepEqual(com({ data: "maximo", ativo: "pctSim" })?.resumos, { data: "maximo", ativo: "pctSim" });
});

test("validarLayoutColunas: largura só inteira, de 40 a 2000, em objeto simples", () => {
  const com = (larguras: unknown) => validarLayoutColunas({ ordem: [], ocultas: [], larguras });
  assert.equal(com({ descricao: 39 }), null);
  assert.equal(com({ descricao: 2001 }), null);
  assert.equal(com({ descricao: 120.5 }), null);
  assert.equal(com({ descricao: "120" }), null);
  assert.equal(com([120]), null);
  assert.equal(com(null), null);
  assert.equal(com({ ["x".repeat(61)]: 100 }), null);
});

test("validarLayoutColunas: congeladaAte ausente/null = padrão da tela, texto vazio = nenhuma, nome = o limite; o resto é inválido", () => {
  const com = (congeladaAte: unknown) => validarLayoutColunas({ ordem: ["a", "b"], ocultas: [], congeladaAte });
  assert.equal(com(undefined)?.congeladaAte, null);
  assert.equal(com(null)?.congeladaAte, null);
  assert.equal(com("")?.congeladaAte, "");
  assert.equal(com("cliente")?.congeladaAte, "cliente");
  assert.equal(com(5), null);
  assert.equal(com(["a"]), null);
  assert.equal(com({}), null);
  assert.equal(com("x".repeat(61)), null);
});

test("validarLayoutColunas: recusa formato errado, repetição e exagero", () => {
  assert.equal(validarLayoutColunas(null), null);
  assert.equal(validarLayoutColunas({ ordem: ["a"] }), null);
  assert.equal(validarLayoutColunas({ ordem: "a", ocultas: [] }), null);
  assert.equal(validarLayoutColunas({ ordem: ["a", 1], ocultas: [] }), null);
  assert.equal(validarLayoutColunas({ ordem: ["a", "a"], ocultas: [] }), null);
  assert.equal(validarLayoutColunas({ ordem: [""], ocultas: [] }), null);
  assert.equal(validarLayoutColunas({ ordem: ["x".repeat(61)], ocultas: [] }), null);
  assert.equal(validarLayoutColunas({ ordem: Array.from({ length: 101 }, (_, i) => `c${i}`), ocultas: [] }), null);
});

test("validarCamposExtras: nomes fonte__campo sem repetição, até o teto; o resto é inválido", () => {
  assert.deepEqual(validarCamposExtras([]), []);
  assert.deepEqual(validarCamposExtras(["cliente__cidcli", "proposta__tippro"]), ["cliente__cidcli", "proposta__tippro"]);
  assert.equal(validarCamposExtras(["cliente__cidcli", "cliente__cidcli"]), null, "repetido");
  assert.equal(validarCamposExtras(["cidcli"]), null, "sem fonte");
  assert.equal(validarCamposExtras(["Cliente__x"]), null, "fonte só minúscula");
  assert.equal(validarCamposExtras(["a__b c"]), null);
  assert.equal(validarCamposExtras(["cliente__x\"; DROP"]), null);
  assert.equal(validarCamposExtras("cliente__cidcli"), null, "precisa ser lista");
  assert.equal(validarCamposExtras(Array.from({ length: 41 }, (_, i) => "x__c" + i)), null, "acima do teto");
});

test("validarLayoutColunas: titulos próprios (1 a 60 caracteres, sem pontas em branco); ausente vale {}", () => {
  const base = { ordem: ["a", "b"], ocultas: [] as string[] };
  assert.deepEqual(validarLayoutColunas(base)?.titulos, {});
  assert.deepEqual(validarLayoutColunas({ ...base, titulos: { a: "Contato" } })?.titulos, { a: "Contato" });
  assert.equal(validarLayoutColunas({ ...base, titulos: { a: "" } }), null, "vazio não se guarda: volta ao original");
  assert.equal(validarLayoutColunas({ ...base, titulos: { a: " Contato" } }), null, "pontas em branco");
  assert.equal(validarLayoutColunas({ ...base, titulos: { a: "x".repeat(61) } }), null, "longo demais");
  assert.equal(validarLayoutColunas({ ...base, titulos: { a: 3 } }), null);
  assert.equal(validarLayoutColunas({ ...base, titulos: ["Contato"] }), null);
});
