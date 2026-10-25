import test from "node:test";
import assert from "node:assert/strict";
import { catalogoDeDominios, dominioDoCampo, lerDominio } from "./dominioDoSchema";

test("domínio inteiro separado por vírgula", () => {
  const d = lerDominio('Domínio "LSitLot": 1=A Contabilizar, 2=Contabilizado, 3=Excluído, 4=Desativado', "Int");
  assert.equal(d?.nome, "LSitLot");
  assert.deepEqual(d?.opcoes, [
    { valor: "1", rotulo: "A Contabilizar" },
    { valor: "2", rotulo: "Contabilizado" },
    { valor: "3", rotulo: "Excluído" },
    { valor: "4", rotulo: "Desativado" },
  ]);
});

test("domínio texto com ' - ' e parênteses no rótulo", () => {
  const d = lerDominio('Domínio "LOriLct": MAN=Manual, VEN=Mercado - NF de Saída, CPR=Suprimentos - NF de Entrada, X=Ambas (Contábil - Devedora)', "String");
  assert.deepEqual(d?.opcoes.map((o) => o.valor), ["MAN", "VEN", "CPR", "X"]);
  assert.equal(d?.opcoes[1].rotulo, "Mercado - NF de Saída");
  assert.equal(d?.opcoes[3].rotulo, "Ambas (Contábil - Devedora)");
});

test("itens separados só por espaço", () => {
  const d = lerDominio('Domínio "USU_LSITRAT": 9=Digitado 8=Impresso 6=Aprovado 5=Cancelado 4=Faturado 2=Faturado Parcial 1=Fechado', "Int");
  assert.deepEqual(
    d?.opcoes.map((o) => `${o.valor}:${o.rotulo}`),
    ["9:Digitado", "8:Impresso", "6:Aprovado", "5:Cancelado", "4:Faturado", "2:Faturado Parcial", "1:Fechado"]
  );
});

test("código com zero à esquerda vira número em coluna inteira e fica como texto em coluna texto", () => {
  const doc = 'Domínio "USU_LDepExe": 00=Diretoria, 01=Administrativo, 08=Consultoria ERP';
  assert.deepEqual(lerDominio(doc, "Int")?.opcoes.map((o) => o.valor), ["0", "1", "8"]);
  assert.deepEqual(lerDominio(doc, "String")?.opcoes.map((o) => o.valor), ["00", "01", "08"]);
});

test("várias linhas com \\n literal e observação final entre parênteses descartada", () => {
  const doc =
    'Domínio "USU_TipUsuRat": 1=Adm. Pleno, 2=Comercial, 3=Consultor de Serviços,\\n4=Gerente de Serviços, 5=Consultor Suporte,\\n8=Gerente Dev. SoelX, 9=Desenvolvedor SoelX (0 = não classificado, fora do domínio oficial)';
  const d = lerDominio(doc, "Int");
  assert.deepEqual(d?.opcoes.map((o) => o.valor), ["1", "2", "3", "4", "5", "8", "9"]);
  assert.equal(d?.opcoes.at(-1)?.rotulo, "Desenvolvedor SoelX");
  assert.equal(d?.opcoes[2].rotulo, "Consultor de Serviços");
});

test("sem domínio, ou sem item válido, devolve null", () => {
  assert.equal(lerDominio(undefined, "Int"), null);
  assert.equal(lerDominio("Código do histórico padrão", "Int"), null);
  assert.equal(lerDominio('Domínio "X": sem itens', "Int"), null);
  assert.equal(lerDominio('Domínio "X": A=Ativo, I=Inativo', "Int"), null, "código não numérico em coluna inteira");
});

test("comentário depois do último item (travessão) não entra no rótulo", () => {
  const d = lerDominio('Domínio "LSimNao": S=Sim, N=Não — indicativo se o movimento foi lançado no plano financeiro', "String");
  assert.deepEqual(d?.opcoes, [{ valor: "S", rotulo: "Sim" }, { valor: "N", rotulo: "Não" }]);
});

test("campo que só cita o nome do domínio usa o catálogo dos outros campos", () => {
  const catalogo = catalogoDeDominios([
    'Domínio "LSitTit": AB=Aberto Normal, LQ=Liquidado',
    'Domínio "LSimNao": S=Sim, N=Não',
    'Domínio "LSitTit": mesmo domínio de TituloReceber.sittit',
  ]);
  assert.deepEqual(dominioDoCampo('Domínio "LSitTit": mesmo domínio de TituloReceber.sittit', "String", catalogo)?.opcoes.map((o) => o.valor), ["AB", "LQ"]);
  assert.deepEqual(dominioDoCampo('Domínio "LSimNao"', "String", catalogo)?.opcoes.map((o) => o.valor), ["S", "N"]);
  assert.equal(dominioDoCampo('Domínio "LTipHpd"', "String", catalogo), null, "nome sem itens em lugar nenhum");
});
