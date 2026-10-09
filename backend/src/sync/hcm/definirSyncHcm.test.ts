import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { TABELAS_HCM } from "./tabelasHcm";
import { queryBaseHcm, valorParaUpsert } from "./definirSyncHcm";
import { extrairColunas, extrairTabela } from "../consultaSenior";

test("jobName e tabela local são únicos e todo job do HCM começa com hcm-", () => {
  const nomes = TABELAS_HCM.map((t) => t.jobName);
  assert.equal(new Set(nomes).size, nomes.length);
  assert.ok(nomes.every((n) => n.startsWith("hcm-") && n.endsWith("-sync")));
  const locais = TABELAS_HCM.map((t) => t.tabelaLocal);
  assert.equal(new Set(locais).size, locais.length);
});

test("o catálogo bate com o schema Prisma: toda coluna e toda chave existe no model", () => {
  for (const t of TABELAS_HCM) {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.dbName === t.tabelaLocal);
    assert.ok(model, `${t.tabelaLocal}: sem model Prisma`);
    const campos = new Set(model.fields.map((f) => f.name));
    for (const c of t.colunas) assert.ok(campos.has(c.origem), `${t.tabelaLocal}.${c.origem} não existe no model ${model.name}`);
    const pkModel = (model.primaryKey?.fields ?? model.fields.filter((f) => f.isId).map((f) => f.name)).slice().sort();
    const pkCatalogo = t.colunas.filter((c) => c.pk).map((c) => c.origem).sort();
    assert.deepEqual(pkCatalogo, pkModel, `${t.tabelaLocal}: chave do catálogo diferente da do model`);
    // colunas de controle de exclusão, usadas pela varredura
    assert.ok(campos.has("vistoEmSync") && campos.has("removidoEmSenior"), `${t.tabelaLocal}: sem colunas de varredura`);
    if (t.campoData) assert.ok(t.colunas.some((c) => c.origem === t.campoData), `${t.tabela}: campoData fora das colunas`);
  }
});

test("LGPD: nenhuma coluna de dado pessoal sensível entra nos jobs do HCM", () => {
  const proibidas = /^(numcpf|numpis|dcdpis|numctp|serctp|dexctp|dvlctp|docest|nomate|regcon|codban|codage|conban|digban|chvpix|tpcpix|endfun|numtel)$/;
  // No afastamento, CID e observação clínica são dado de saúde; em r030fil, codcid é a cidade da filial.
  const proibidasNoAfastamento = /^(codcid|coddoe|obsafa|codate|nomate|codcua)$/;
  for (const t of TABELAS_HCM) {
    for (const c of t.colunas) {
      // numcra (crachá) é a chave da marcação de ponto, não o cartão de identificação da pessoa
      if (t.tabela === "r070acc" && c.origem === "numcra") continue;
      assert.ok(!proibidas.test(c.origem), `${t.tabela}.${c.origem} é dado pessoal sensível`);
      if (t.tabela === "r038afa") assert.ok(!proibidasNoAfastamento.test(c.origem), `r038afa.${c.origem} é dado de saúde`);
    }
  }
});

test("a query do job usa o prefixo do banco do HCM e o parser de catálogo a entende", () => {
  const antes = process.env.SENIOR_HCM_BANCO;
  process.env.SENIOR_HCM_BANCO = "rhsenior.dbo.";
  try {
    const t = TABELAS_HCM.find((x) => x.tabela === "r034fun")!;
    const q = queryBaseHcm(t);
    assert.match(q, /FROM rhsenior\.dbo\.r034fun$/);
    assert.equal(extrairTabela(q), "rhsenior.dbo.r034fun");
    assert.equal(extrairColunas(q).length, t.colunas.length);
    assert.ok(extrairColunas(q).every((c) => c.origem === c.alias), "alias = origem em todo job do HCM");
  } finally {
    if (antes === undefined) delete process.env.SENIOR_HCM_BANCO;
    else process.env.SENIOR_HCM_BANCO = antes;
  }
});

test("valores: data 'sem data' do Senior vira NULL fora da chave e fica dentro dela", () => {
  const data = { origem: "datdem", cast: "date" as const };
  assert.equal(valorParaUpsert(data, "2026-03-04T00:00:00"), "2026-03-04");
  assert.equal(valorParaUpsert(data, "1900-12-31T00:00:00"), null);
  assert.equal(valorParaUpsert(data, "1899-12-30T00:00:00"), null);
  assert.equal(valorParaUpsert({ ...data, pk: true }, "1900-12-31T00:00:00"), "1900-12-31");
  assert.equal(valorParaUpsert(data, undefined), null);
  assert.equal(valorParaUpsert(data, "lixo"), null);
});

test("valores: números viram texto para o INSERT em lote e o NUL de texto livre é removido", () => {
  assert.equal(valorParaUpsert({ origem: "x", cast: "int" }, 12.9), "12");
  assert.equal(valorParaUpsert({ origem: "x", cast: "numeric" }, 1234.5), "1234.5");
  assert.equal(valorParaUpsert({ origem: "x", cast: "int" }, "abc"), null);
  assert.equal(valorParaUpsert({ origem: "x", cast: "text" }, "ab\u0000c"), "abc");
  assert.equal(valorParaUpsert({ origem: "x", cast: "text" }, ""), null);
});
