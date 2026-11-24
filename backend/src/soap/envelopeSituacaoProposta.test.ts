import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEnvelopeManterSituacaoProposta } from "./client";

test("envelope de ManterSituacaoProposta: operação, parâmetros e sem criptografia", () => {
  const xml = montarEnvelopeManterSituacaoProposta({ codEmp: 1, codPro: 8638, sitPro: 8 }, "usuario", "senha");
  assert.match(xml, /<ser:ManterSituacaoProposta>/);
  assert.match(xml, /<\/ser:ManterSituacaoProposta>/);
  assert.match(xml, /<encryption>0<\/encryption>/);
  assert.match(xml, /<parameters><codEmp>1<\/codEmp><codPro>8638<\/codPro><sitPro>8<\/sitPro><\/parameters>/);
});

test("envelope de ManterSituacaoProposta: usuário e senha são escapados (nunca viram XML)", () => {
  const xml = montarEnvelopeManterSituacaoProposta({ codEmp: 1, codPro: 1, sitPro: 7 }, "a<b>&c", "p\"w'<");
  assert.match(xml, /<user>a&lt;b&gt;&amp;c<\/user>/);
  assert.doesNotMatch(xml, /<user>a<b>/);
  assert.match(xml, /<password>p&quot;w&apos;&lt;<\/password>|<password>p"w'&lt;<\/password>/);
});

test("o preview mascara as credenciais (é o que as telas de Sincronização mostram)", () => {
  const xml = montarEnvelopeManterSituacaoProposta({ codEmp: 1, codPro: 1, sitPro: 7 }, "***", "***");
  assert.match(xml, /<user>\*\*\*<\/user>/);
  assert.match(xml, /<password>\*\*\*<\/password>/);
});

test("envelope de ManterSituacaoProposta: o motivo vai em obsSit (escapado) e só quando preenchido", () => {
  const com = montarEnvelopeManterSituacaoProposta({ codEmp: 1, codPro: 8638, sitPro: 9, obsSit: "  Cliente <declinou> & saiu  " }, "u", "p");
  assert.match(com, /<sitPro>9<\/sitPro><obsSit>Cliente &lt;declinou&gt; &amp; saiu<\/obsSit><\/parameters>/);
  for (const vazio of [undefined, null, "", "   "]) {
    const sem = montarEnvelopeManterSituacaoProposta({ codEmp: 1, codPro: 8638, sitPro: 8, obsSit: vazio }, "u", "p");
    assert.doesNotMatch(sem, /obsSit/);
  }
});
