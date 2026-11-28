import assert from "node:assert/strict";
import { test } from "node:test";
import { chaveDeComparacao, erroDeDescricao, podeDescreverApontamento, repeteDescricaoDaAtividade, respostaDescricaoPendente, textoDaDescricao } from "./descricaoApontamento";

const ATIVIDADE = "Apoio para consultoria HCM: parametrização de folha";
const BOA = "Ajustei a regra de cálculo de hora extra noturna do cliente";

test("vazia ou só espaços: obrigatória", () => {
  for (const t of [null, undefined, "", "   ", "\n\t"]) assert.match(erroDeDescricao(t, [ATIVIDADE])!, /obrigatória/);
});

test("mínimo de 30 caracteres, com espaços repetidos contando um", () => {
  assert.match(erroDeDescricao("a".repeat(29), [])!, /faltam 1/);
  assert.equal(erroDeDescricao("a".repeat(30), []), null);
  assert.equal(textoDaDescricao("  ajuste     de     regra  "), "ajuste de regra");
  assert.match(erroDeDescricao("ajuste" + " ".repeat(60) + "ok", [])!, /pelo menos 30/);
});

test("não pode repetir a descrição da atividade, mesmo mudando caixa, acento, espaço e pontuação", () => {
  for (const t of [ATIVIDADE, ATIVIDADE.toUpperCase(), "apoio para consultoria hcm - parametrizacao de folha.", `  ${ATIVIDADE}  !!`]) {
    assert.match(erroDeDescricao(t, [ATIVIDADE])!, /não pode repetir/, t);
  }
  // vale contra qualquer uma das referências (nó do cronograma e item da proposta)
  assert.match(erroDeDescricao(BOA, ["outra coisa", BOA])!, /não pode repetir/);
  assert.equal(erroDeDescricao(BOA, [ATIVIDADE]), null);
  // acrescentar contexto à descrição da atividade é aceito
  assert.equal(erroDeDescricao(`${ATIVIDADE}: revisei os eventos de férias`, [ATIVIDADE]), null);
});

test("preenchimento automático antigo, cortado em 1000 caracteres, também conta como repetição", () => {
  const longa = "x".repeat(1500);
  assert.equal(repeteDescricaoDaAtividade("x".repeat(1000), [longa]), true);
});

test("máximo de 1000 caracteres; sem referência não há repetição", () => {
  assert.match(erroDeDescricao("ab ".repeat(400), [])!, /no máximo 1000/);
  assert.equal(repeteDescricaoDaAtividade("qualquer", [null, undefined, ""]), false);
  assert.equal(chaveDeComparacao("Férias — 2026!"), "ferias2026");
});

test("mensagem do bloqueio distingue o próprio consultor de quem age por ele", () => {
  assert.match(respostaDescricaoPendente(1, true).error, /^Você tem 1 apontamento sem descrição/);
  assert.match(respostaDescricaoPendente(3, false).error, /^O consultor desta atividade tem 3 apontamentos sem descrição/);
});

test("quem escreve a descrição: dono, admin e gestor (do item, da RAT ou do time); colega e estranho não", () => {
  const contexto = (codfor: number | null, gerenciados: number[] = [], time: number[] = []) => ({
    consultor: codfor == null ? null : ({ codfor } as never),
    departamentosGerenciados: gerenciados,
    departamentosTime: time,
  });
  const alvo = { codfor: 10, depexes: [8, null] };

  assert.equal(podeDescreverApontamento("consultor", contexto(10), alvo, new Set([10])), true, "dono");
  assert.equal(podeDescreverApontamento("admin", contexto(null), alvo, null), true, "admin sem cadastro de consultor");
  assert.equal(podeDescreverApontamento("consultor", contexto(20, [8]), alvo, new Set([20])), true, "gestor do departamento do item");
  assert.equal(podeDescreverApontamento("consultor", contexto(20, [9]), { codfor: 10, depexes: [8, 9] }, new Set([20])), true, "gestor do departamento da RAT");
  assert.equal(podeDescreverApontamento("consultor", contexto(20, [9]), alvo, new Set([20, 10])), true, "gestor do time do consultor");
  assert.equal(podeDescreverApontamento("consultor", contexto(20, [], [8]), alvo, new Set([20])), false, "colega do mesmo departamento");
  assert.equal(podeDescreverApontamento("consultor", contexto(20, [9]), alvo, new Set([20])), false, "gestor de outro departamento");
  assert.equal(podeDescreverApontamento("consultor", contexto(null), alvo, new Set()), false, "usuário sem cadastro de consultor");
  assert.equal(podeDescreverApontamento("consultor", contexto(20, [8]), { codfor: 10, depexes: [] }, new Set([20])), false, "sem departamento conhecido");
});
