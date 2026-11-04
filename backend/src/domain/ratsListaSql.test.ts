import assert from "node:assert/strict";
import { test } from "node:test";
import { consultaRatsLista, precisaCalcularConjunto, ORDEM_PADRAO_RATS, ROTULOS_INTEGRACAO, ROTULOS_SITRAT, type FiltrosTopoRats, type VisibilidadeRats } from "./ratsListaSql";

const SEM_FILTROS: FiltrosTopoRats = { codfors: [], sitrats: [], busca: "", buscaItem: "", integracao: [] };
const tudo: VisibilidadeRats = { todas: true, codfor: null, depexes: [] };
const sql = (vis = tudo, filtros: Partial<FiltrosTopoRats> = {}, opcoes = {}) => {
  const { com, interna } = consultaRatsLista(vis, { ...SEM_FILTROS, ...filtros }, opcoes);
  return { text: com.text + " " + interna.text, values: [...com.values, ...interna.values] };
};

test("precisaCalcularConjunto: lista simples e filtro por colunas leves ficam no cálculo por linha", () => {
  assert.equal(precisaCalcularConjunto({}, SEM_FILTROS), false);
  assert.equal(precisaCalcularConjunto({ ordem: "cliente:asc" }, SEM_FILTROS), false);
  assert.equal(precisaCalcularConjunto({ filtros: JSON.stringify([{ coluna: "cliente", operador: "contém", valores: ["x"] }]) }, SEM_FILTROS), false);
  assert.equal(precisaCalcularConjunto({ resumo: JSON.stringify([{ coluna: "id", funcao: "contagem" }]) }, SEM_FILTROS), false);
});

test("precisaCalcularConjunto: filtro, ordem, resumo ou valores das colunas pesadas pedem o cálculo do conjunto", () => {
  assert.equal(precisaCalcularConjunto({ ordem: "totalMinutos:desc" }, SEM_FILTROS), true);
  assert.equal(precisaCalcularConjunto({ filtros: JSON.stringify([{ coluna: "integracaoLabel", operador: "IN", valores: ["Pendente"] }]) }, SEM_FILTROS), true);
  assert.equal(precisaCalcularConjunto({ resumo: JSON.stringify([{ coluna: "totalItens", funcao: "soma" }]) }, SEM_FILTROS), true);
  assert.equal(precisaCalcularConjunto({ coluna: "totalMinutos" }, SEM_FILTROS), true);
  // Filtro de sincronização do topo olha a integração de todas as RATs.
  assert.equal(precisaCalcularConjunto({}, { ...SEM_FILTROS, integracao: ["falha"] }), true);
});

test("precisaCalcularConjunto: coluna calculada por fórmula pode depender de qualquer coluna, então pede o conjunto", () => {
  assert.equal(precisaCalcularConjunto({ calculadas: "[...]", ordem: "calc_12:asc" }, SEM_FILTROS), true);
  assert.equal(precisaCalcularConjunto({ filtros: JSON.stringify([{ coluna: "calc_3", operador: "≥", valores: ["1"] }]) }, SEM_FILTROS), true);
});

test("precisaCalcularConjunto: 'totalItensX' não é a coluna totalItens (fronteira de palavra)", () => {
  assert.equal(precisaCalcularConjunto({ ordem: "totalItensExtra:asc" }, SEM_FILTROS), false);
});

test("visibilidade: admin não restringe; consultor comum vê só as próprias; gestor soma os departamentos", () => {
  assert.doesNotMatch(sql().text, /r\.codfor = \$|r\.depexe IN/);
  const consultor = sql({ todas: false, codfor: 350, depexes: [] });
  assert.match(consultor.text, /\(r\.codfor = \$\d+\)/);
  assert.ok(consultor.values.includes(350));
  const gestor = sql({ todas: false, codfor: 6, depexes: [11, 12] });
  assert.match(gestor.text, /\(r\.codfor = \$\d+ OR r\.depexe IN \(\$\d+,\$\d+\)\)/);
  assert.ok([6, 11, 12].every((v) => gestor.values.includes(v)));
});

test("visibilidade: sem consultor vinculado e sem departamento, não enxerga nenhuma RAT", () => {
  assert.match(sql({ todas: false, codfor: null, depexes: [] }).text, /WHERE FALSE/);
});

test("filtros do topo: consultor e situação vão como parâmetros; só Digitado ativa exclui as removidas no Senior", () => {
  const s = sql(tudo, { codfors: [281, 777], sitrats: [9, 6] });
  assert.match(s.text, /r\.codfor IN \(\$\d+,\$\d+\)/);
  assert.match(s.text, /r\.sitrat IN \(\$\d+,\$\d+\)/);
  assert.ok(s.values.includes(281) && s.values.includes(777));
  // Nada do que a pessoa digitou entra no texto do SQL: tudo vai como parâmetro.
  assert.doesNotMatch(s.text, /281|777/);
  assert.match(sql(tudo, {}, { somenteDigitadasAtivas: true }).text, /r\.sitrat = 9 AND r\.removido_em_senior IS NULL/);
});

test("busca: cliente, proposta e nº da RAT em minúsculas por trecho; observação do item só quando preenchida, id da atividade só se numérico", () => {
  const busca = sql(tudo, { busca: "  LAVEBRAS " });
  assert.ok(busca.values.includes("lavebras"));
  const semBusca = sql(tudo, { busca: "   ", buscaItem: "" });
  assert.doesNotMatch(semBusca.text, /position\(/);
  assert.doesNotMatch(semBusca.text, /EXISTS \(\s*SELECT 1 FROM rat_itens ri/);
  const texto = sql(tudo, { buscaItem: "reunião" });
  assert.match(texto.text, /EXISTS \(\s*SELECT 1 FROM rat_itens ri/);
  assert.doesNotMatch(texto.text, /atividade_sessoes_execucao/);
  const numerico = sql(tudo, { buscaItem: "100" });
  assert.match(numerico.text, /atividade_sessoes_execucao/);
  assert.ok(numerico.values.includes(100));
  // Número grande demais para ser id (Int) não vira consulta numérica.
  assert.doesNotMatch(sql(tudo, { buscaItem: "12345678901" }).text, /atividade_sessoes_execucao/);
});

test("integração: filtro do topo vira WHERE sobre a coluna calculada; os dois modos calculam o mesmo pior caso", () => {
  const porLinha = sql(tudo, { integracao: ["falha", "pendente"] }, { conjunto: false });
  const conjunto = sql(tudo, { integracao: ["falha", "pendente"] }, { conjunto: true });
  for (const s of [porLinha, conjunto]) {
    assert.match(s.text, /b\.integracao IN \(\$\d+,\$\d+\)/);
    assert.ok(s.values.includes("falha") && s.values.includes("pendente"));
    // falha > enviando > pendente > sincronizado, na mesma regra de classificarItemIntegracao.
    assert.match(s.text, /WHEN 3 THEN 'falha' WHEN 2 THEN 'enviando' WHEN 0 THEN 'sincronizado' ELSE 'pendente'/);
    assert.match(s.text, /p\.status = 'invalido' OR COALESCE\(p\."ultimoErro", ''\) <> ''/);
  }
  assert.match(conjunto.text, /ia AS \(/);
  assert.doesNotMatch(porLinha.text, /ia AS \(/);
});

test("domínios do funil: rótulos de situação (com Excluída) e de sincronização na ordem da tela", () => {
  assert.deepEqual(ROTULOS_SITRAT, ["Digitado", "Impresso", "Aprovado", "Cancelado", "Faturado", "Faturado Parcial", "Fechado", "Excluída"]);
  assert.deepEqual(ROTULOS_INTEGRACAO, ["Falha no envio", "Enviando", "Pendente", "Sincronizado"]);
});

test("ordem padrão: Digitado primeiro, emissão mais recente, proposta crescente, id decrescente", () => {
  assert.match(ORDEM_PADRAO_RATS.text, /CASE WHEN x\."sitrat" = 9 THEN 0 ELSE 1 END.*x\."datemi" DESC NULLS LAST.*COALESCE\(x\."codpro", 0\).*x\."id" DESC/);
});
