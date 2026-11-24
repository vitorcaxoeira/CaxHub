import assert from "node:assert/strict";
import test from "node:test";
import { catalogoDaFonte, extrasDaConsulta, type FonteCampos } from "../consultas/camposRelacionados";
import * as F from "./fontesDeCampos";

const todas = Object.entries(F).filter(([, v]) => Array.isArray(v)) as [string, FonteCampos[]][];

test("cada lista declara ao menos uma fonte, e cada fonte existe no schema com ao menos um campo", () => {
  assert.ok(todas.length >= 12);
  for (const [nome, fontes] of todas) {
    assert.ok(fontes.length > 0, nome);
    for (const f of fontes) {
      const campos = catalogoDaFonte(f); // lança se a tabela não for um model do schema
      assert.ok(campos.length > 0, `${nome}/${f.id}`);
    }
  }
});

test("dentro de uma lista, id e alias de fonte não se repetem", () => {
  for (const [nome, fontes] of todas) {
    assert.equal(new Set(fontes.map((f) => f.id)).size, fontes.length, `${nome}: ids repetidos`);
    assert.equal(new Set(fontes.map((f) => f.alias)).size, fontes.length, `${nome}: aliases repetidos`);
  }
});

test("a senha do cliente (sencli) nunca é oferecida", () => {
  for (const [, fontes] of todas) {
    for (const f of fontes) assert.ok(!catalogoDaFonte(f).some((c) => c.campo === "sencli"));
  }
});

test("campo pedido de uma fonte vira SELECT com o alias da lista; fora do catálogo é ignorado", () => {
  const extras = extrasDaConsulta(F.FONTES_TITULOS_RECEBER, { campos: "tipotitulo__abrtpt,empresa__nomemp,nao__existe" });
  assert.deepEqual(extras.colunas.map((c) => c.nome), ["tipotitulo__abrtpt", "empresa__nomemp"]);
});
