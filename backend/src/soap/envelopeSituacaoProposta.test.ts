import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEnvelopeAlterarSituacaoProposta } from "./client";

test("envelope de alterarSituacaoProposta: operação, parâmetros e sem criptografia", () => {
  const xml = montarEnvelopeAlterarSituacaoProposta({ codEmp: 1, codPro: 8638, sitPro: 8 }, "usuario", "senha");
  assert.match(xml, /<ser:alterarSituacaoProposta>/);
  assert.match(xml, /<\/ser:alterarSituacaoProposta>/);
  assert.match(xml, /<encryption>0<\/encryption>/);
  assert.match(xml, /<parameters><codEmp>1<\/codEmp><codPro>8638<\/codPro><sitPro>8<\/sitPro><\/parameters>/);
});

test("envelope de alterarSituacaoProposta: usuário e senha são escapados (nunca viram XML)", () => {
  const xml = montarEnvelopeAlterarSituacaoProposta({ codEmp: 1, codPro: 1, sitPro: 7 }, "a<b>&c", "p\"w'<");
  assert.match(xml, /<user>a&lt;b&gt;&amp;c<\/user>/);
  assert.doesNotMatch(xml, /<user>a<b>/);
  assert.match(xml, /<password>p&quot;w&apos;&lt;<\/password>|<password>p"w'&lt;<\/password>/);
});

test("o preview mascara as credenciais (é o que as telas de Sincronização mostram)", () => {
  const xml = montarEnvelopeAlterarSituacaoProposta({ codEmp: 1, codPro: 1, sitPro: 7 }, "***", "***");
  assert.match(xml, /<user>\*\*\*<\/user>/);
  assert.match(xml, /<password>\*\*\*<\/password>/);
});
