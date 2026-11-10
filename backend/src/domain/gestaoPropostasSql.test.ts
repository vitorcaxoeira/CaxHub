import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGREGADOS_DE_FATURAMENTO,
  COLUNAS_PESADAS_GESTAO_PROPOSTAS,
  consultaGestaoPropostas,
  precisaCalcularConjunto,
  SITRAT_BLOQUEIA_FINALIZAR,
  type FiltrosGestaoPropostas,
} from "./gestaoPropostasSql";
import { FATSER_FATURAVEL } from "./eficienciaPropostas";

const SEM_FILTROS: FiltrosGestaoPropostas = { tipo: "all", situacoes: null, depexes: null, modpros: null, busca: "" };
const sql = (filtros: Partial<FiltrosGestaoPropostas> = {}, opcoes = {}) => {
  const { com, interna } = consultaGestaoPropostas({ ...SEM_FILTROS, ...filtros }, opcoes);
  return { text: com.text + " " + interna.text, values: [...com.values, ...interna.values] };
};
const textoDe = (s: { text: string }) => s.text;

test("precisaCalcularConjunto: lista simples e filtro por colunas leves ficam no cálculo por linha", () => {
  assert.equal(precisaCalcularConjunto({}), false);
  assert.equal(precisaCalcularConjunto({ ordem: "cliente:asc" }), false);
  assert.equal(precisaCalcularConjunto({ filtros: JSON.stringify([{ coluna: "cliente", operador: "contém", valores: ["x"] }]) }), false);
  // horasProposta e totalItens saem da CTE `itens`, que é barata e sempre presente.
  assert.equal(precisaCalcularConjunto({ ordem: "horasProposta:desc" }), false);
  assert.equal(precisaCalcularConjunto({ resumo: JSON.stringify([{ coluna: "totalItens", funcao: "soma" }]) }), false);
});

test("precisaCalcularConjunto: filtro, ordem, resumo ou valores de QUALQUER coluna pesada pedem o cálculo do conjunto", () => {
  for (const c of COLUNAS_PESADAS_GESTAO_PROPOSTAS) {
    assert.equal(precisaCalcularConjunto({ ordem: `${c}:desc` }), true, `ordem por ${c}`);
    assert.equal(precisaCalcularConjunto({ filtros: JSON.stringify([{ coluna: c, operador: "≥", valores: ["1"] }]) }), true, `filtro por ${c}`);
    assert.equal(precisaCalcularConjunto({ resumo: JSON.stringify([{ coluna: c, funcao: "soma" }]) }), true, `resumo de ${c}`);
    assert.equal(precisaCalcularConjunto({ coluna: c }), true, `valores de ${c}`);
  }
});

test("precisaCalcularConjunto: coluna calculada por fórmula pode depender de qualquer coluna, então pede o conjunto", () => {
  assert.equal(precisaCalcularConjunto({ calculadas: "[...]", ordem: "calc_12:asc" }), true);
});

test("precisaCalcularConjunto: 'horasRatExtra' não é a coluna horasRat (fronteira de palavra)", () => {
  assert.equal(precisaCalcularConjunto({ ordem: "horasRatExtra:asc" }), false);
});

test("os dois modos expõem exatamente as mesmas colunas", () => {
  const colunas = (conjunto: boolean, comValores = true) => {
    const s = sql({}, { conjunto, comValores });
    // A camada de fora é a última consulta: lista de colunas entre o último SELECT e o FROM (b).
    const m = s.text.match(/SELECT b\.codemp[\s\S]*?FROM \(/);
    assert.ok(m, "camada de fora não encontrada");
    return m[0].replace(/\s+/g, " ");
  };
  assert.equal(colunas(true), colunas(false));
  assert.equal(colunas(true, false), colunas(false, false));
});

test("Forma de Faturamento da proposta (forfat) sai como rótulo, nos dois modos", () => {
  for (const conjunto of [false, true]) {
    const s = sql({}, { conjunto });
    assert.match(s.text, /p\.forfat IS NULL/);
    assert.match(s.text, /AS "forfatLabel"/);
    assert.ok(s.values.includes("Mediante RAT") && s.values.includes("Antecipado Saldo Finalização"), "os rótulos vêm de FORFAT_LABELS");
  }
});

test("Proposta Relacionada (codlev2): 0 do Senior vira nulo, nos dois modos", () => {
  for (const conjunto of [false, true]) {
    const s = sql({}, { conjunto });
    assert.match(s.text, /NULLIF\(p\.codlev2, 0\) AS codlev2/);
    assert.match(s.text, /b\.codlev2/);
  }
});

test("Modalidade da proposta e da relacionada: a relacionada vem de um LEFT JOIN em propostas pelo codlev2 (sem duplicar linha)", () => {
  for (const conjunto of [false, true]) {
    const s = sql({}, { conjunto });
    assert.match(s.text, /LEFT JOIN propostas rel ON rel\.codemp = p\.codemp AND rel\.codpro = NULLIF\(p\.codlev2, 0\)/);
    assert.match(s.text, /AS "modproRelacLabel"/);
    assert.match(s.text, /b\."modproRelac"/);
    assert.match(s.text, /b\.modpro,/);
  }
});

test("comValores:false não calcula nem devolve as colunas em R$ (quem não pode ver valor nem recebe o número)", () => {
  const sem = sql({}, { comValores: false });
  assert.doesNotMatch(sem.text, /valorFaturamento|valorNaoFaturado|val_fat|val_nfat/);
  const com = sql({}, { comValores: true });
  assert.match(com.text, /"valorFaturamento"/);
  assert.match(com.text, /"valorNaoFaturado"/);
  // padrão: com valores
  assert.match(sql().text, /"valorFaturamento"/);
});

test("o faturável é DERIVADO de FATSER_FATURAVEL e normaliza maiúscula/espaço/nulo", () => {
  const s = sql({}, { conjunto: true });
  assert.match(s.text, /UPPER\(BTRIM\(COALESCE\(pi\.fatser, ''\)\)\) IN/);
  for (const f of FATSER_FATURAVEL) assert.ok(s.values.includes(f), `valor ${f} deve entrar como parâmetro`);
  // Nenhum literal 'S'/'A' fixo no texto do SQL: tudo vai por parâmetro, a constante manda.
  assert.doesNotMatch(s.text, /IN \('S'/);
  const duracao = AGREGADOS_DE_FATURAMENTO.valorFaturavel.text;
  // numeric ANTES da divisão: minuto / 60 em inteiro truncaria.
  assert.match(duracao, /::numeric \/ 60 \* COALESCE\(pi\.valhor, 0\)/);
});

test("a duração do apontamento só entra pelo filtro de RAT válida (RAT_ITEM_VALIDO)", () => {
  for (const conjunto of [false, true]) {
    const s = sql({}, { conjunto });
    assert.match(s.text, /ri\.removido_em_senior IS NULL AND r\.removido_em_senior IS NULL/);
    assert.match(s.text, /r\.sitrat IS DISTINCT FROM/);
    assert.match(s.text, /ri\.horfim > ri\.horini/);
  }
});

test("as colunas derivadas ficam na camada de fora, então as somas fecham por construção", () => {
  const s = sql();
  assert.match(s.text, /\(b\.min_rat - b\.min_fat\)::numeric \/ 60\)::float8 AS "horasNaoFaturadas"/);
  assert.match(s.text, /\(b\.min_proposta - b\.min_rat\)::numeric \/ 60\)::float8 AS "saldoHoras"/);
});

test("RATs que bloqueiam o Finalizar: Digitado (9) e Fechado (1)", () => {
  assert.deepEqual([...SITRAT_BLOQUEIA_FINALIZAR], [9, 1]);
  const s = sql({}, { conjunto: true });
  assert.match(s.text, /sitrat IN \(\$\d+,\s*\$\d+\)/);
  assert.ok(s.values.includes(9) && s.values.includes(1));
});

test("filtros do topo viram parâmetros, nunca texto no SQL", () => {
  const s = sql({ situacoes: [7, 8], depexes: [8], modpros: [0], busca: "Acme' OR 1=1 --" });
  assert.match(textoDe(s), /p\.sitpro = ANY\(\$\d+::int\[\]\)/);
  assert.match(textoDe(s), /p\.depexe = ANY\(\$\d+::int\[\]\)/);
  assert.match(textoDe(s), /p\.modpro = ANY\(\$\d+::int\[\]\)/);
  assert.doesNotMatch(textoDe(s), /OR 1=1/);
  assert.ok(s.values.some((v) => Array.isArray(v) && v.length === 2 && v[0] === 7 && v[1] === 8));
  // 0 é um valor válido de modalidade (Serviço) e não pode ser tratado como "sem filtro".
  assert.ok(s.values.some((v) => Array.isArray(v) && v.length === 1 && v[0] === 0));
});

test("busca escapa curingas do LIKE", () => {
  const s = sql({ busca: "100%_x" });
  assert.ok(s.values.includes("%100\\%\\_x%"));
});

test("Propostas (tipo): De clientes exclui a própria empresa, Internas só ela, Todas não filtra", () => {
  const cli = sql({ tipo: "cli" });
  assert.match(cli.text, /p\.codcli <> \$\d+/);
  assert.doesNotMatch(cli.text, /p\.codcli = \$\d+/);
  assert.ok(cli.values.includes(1), "o código da empresa própria entra como parâmetro");
  const int = sql({ tipo: "int" });
  assert.match(int.text, /p\.codcli = \$\d+/);
  assert.doesNotMatch(int.text, /p\.codcli <> \$\d+/);
  const todas = sql({ tipo: "all" });
  assert.doesNotMatch(todas.text, /p\.codcli (<>|=) \$\d+/);
});

test("sem filtro nenhum não há WHERE de situação nem de busca", () => {
  const s = sql();
  assert.doesNotMatch(s.text, /p\.sitpro = ANY/);
  assert.doesNotMatch(s.text, /lower\(c\.nomcli\) LIKE/);
});
