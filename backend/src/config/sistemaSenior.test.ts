import test from "node:test";
import assert from "node:assert/strict";
import { conexaoSenior, hcmConfigurado, nomeSemPrefixo, tabelaSenior, urlMascarada } from "./sistemaSenior";
import { literalData, predicadoCorteIncremental } from "../sync/dialetoSenior";
import { extrairTabela } from "../sync/consultaSenior";

const CHAVES = [
  "SOAP_URL", "SOAP_USER", "SOAP_PASSWORD",
  "SENIOR_HCM_SOAP_URL", "SENIOR_HCM_SOAP_USER", "SENIOR_HCM_SOAP_PASSWORD", "SENIOR_HCM_BANCO",
] as const;

function comEnv<T>(valores: Partial<Record<(typeof CHAVES)[number], string>>, fn: () => T): T {
  const antes = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]));
  for (const k of CHAVES) delete process.env[k];
  Object.assign(process.env, valores);
  try {
    return fn();
  } finally {
    for (const k of CHAVES) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
}

const ERP = { SOAP_URL: "https://erp.exemplo/g5?wsdl", SOAP_USER: "u-erp", SOAP_PASSWORD: "s-erp" };

test("ERP é o padrão e exige o trio", () => {
  comEnv(ERP, () => {
    const c = conexaoSenior();
    assert.equal(c.sistema, "erp");
    assert.equal(c.usuario, "u-erp");
    assert.equal(c.prefixo, "");
  });
  assert.throws(() => comEnv({ SOAP_URL: "x" }, () => conexaoSenior("erp")), /SOAP_URL, SOAP_USER e SOAP_PASSWORD/);
});

test("HCM sem URL própria herda o canal do ERP e usa o prefixo do banco do RH", () => {
  comEnv({ ...ERP, SENIOR_HCM_BANCO: "rhsenior.dbo" }, () => {
    const c = conexaoSenior("hcm");
    assert.equal(c.herdaDoErp, true);
    assert.equal(c.usuario, "u-erp");
    assert.equal(c.prefixo, "rhsenior.dbo.");
    assert.equal(tabelaSenior("r034fun", "hcm"), "rhsenior.dbo.r034fun");
    assert.equal(tabelaSenior("r034fun", "erp"), "r034fun");
  });
});

test("HCM com URL própria usa o trio dele inteiro, e a falta de um deles derruba", () => {
  comEnv({ ...ERP, SENIOR_HCM_SOAP_URL: "https://hcm.exemplo/g5", SENIOR_HCM_SOAP_USER: "u-hcm", SENIOR_HCM_SOAP_PASSWORD: "s-hcm" }, () => {
    const c = conexaoSenior("hcm");
    assert.equal(c.herdaDoErp, false);
    assert.equal(c.usuario, "u-hcm");
    assert.equal(c.prefixo, "");
  });
  assert.throws(
    () => comEnv({ ...ERP, SENIOR_HCM_SOAP_URL: "https://hcm.exemplo/g5", SENIOR_HCM_SOAP_USER: "u-hcm" }, () => conexaoSenior("hcm")),
    /SENIOR_HCM_SOAP_PASSWORD/
  );
  assert.equal(comEnv({}, hcmConfigurado), false);
  // Só o canal do ERP não basta: sem URL própria nem prefixo de banco, o HCM não sabe onde está.
  assert.equal(comEnv(ERP, hcmConfigurado), false);
  assert.equal(comEnv({ ...ERP, SENIOR_HCM_BANCO: "rhsenior.dbo." }, hcmConfigurado), true);
});

test("prefixo de banco inválido derruba em vez de montar SQL estranho", () => {
  assert.throws(() => comEnv({ ...ERP, SENIOR_HCM_BANCO: "rh; drop table" }, () => tabelaSenior("r034fun", "hcm")), /SENIOR_HCM_BANCO/);
});

test("nome qualificado perde o prefixo para o dicionário e a URL some as credenciais", () => {
  assert.equal(nomeSemPrefixo("rhsenior.dbo.r034fun"), "r034fun");
  assert.equal(nomeSemPrefixo("r034fun"), "r034fun");
  assert.equal(urlMascarada("https://user:pw@host:8083/g5/svc?wsdl"), "https://host:8083/g5/svc");
});

test("extrairTabela entende banco.schema.tabela", () => {
  assert.equal(extrairTabela("SELECT numemp AS numemp FROM rhsenior.dbo.r034fun WHERE numemp = 1"), "rhsenior.dbo.r034fun");
  assert.equal(extrairTabela("SELECT codemp AS codemp FROM e070emp"), "e070emp");
});

test("literal de data: ERP segue como sempre (aspas simples), HCM usa CONVERT estilo 23", () => {
  assert.equal(literalData("2026-10-09"), "'2026-10-09'");
  assert.equal(literalData("2026-10-09", "erp"), "'2026-10-09'");
  assert.equal(literalData("2026-10-09", "hcm"), "CONVERT(date, '2026-10-09', 23)");
  assert.equal(predicadoCorteIncremental("DatGer", new Date("2026-10-08T12:00:00Z")), "DatGer >= '2026-10-08'");
  assert.equal(predicadoCorteIncremental("datalt", new Date("2026-10-08T12:00:00Z"), "hcm"), "datalt >= CONVERT(date, '2026-10-08', 23)");
  assert.throws(() => predicadoCorteIncremental(null, new Date()), /sem campo de data/);
});
