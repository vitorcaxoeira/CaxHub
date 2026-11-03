import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  ColunaConsulta,
  condicoesDosFiltros,
  descreverColunas,
  ErroEntradaConsulta,
  lerFiltrosEOrdemConsulta,
  ordenacaoSql,
  usaAgregada,
  valoresDaColunaSql,
} from "./consultaColunas";
import { COLUNAS_OBRAS, COLUNAS_PECAS, colunasConsumoMateriais } from "./colunasExemplo.fixture";

const juntar = (partes: Prisma.Sql[]) => Prisma.join(partes, " AND ");
const sql = (p: Prisma.Sql) => p.text.replace(/\s+/g, " ").trim();

test("colunas descritas para a tela: operadores por tipo, vazio só em coluna opcional, sem aba Valores em agregada", () => {
  const d = descreverColunas(COLUNAS_OBRAS);
  const cod = d.find((c) => c.nome === "codObra")!;
  const sigla = d.find((c) => c.nome === "sigla")!;
  const pecas = d.find((c) => c.nome === "pecas")!;
  assert.ok(cod.operadores.includes("entre") && !cod.operadores.includes("vazio"), "chave obrigatória: sem vazio");
  assert.ok(sigla.operadores.includes("contém") && sigla.operadores.includes("vazio"));
  assert.equal(pecas.agregada, true);
  assert.equal(pecas.semAbaValores, true);
  assert.equal(sigla.semAbaValores, false);
  assert.ok(descreverColunas(colunasConsumoMateriais(1)).find((c) => c.nome === "origem")!.dominio!.length >= 5);
  // Consumo do ERP no período: agregadas (filtram no HAVING), sem aba de valores.
  const erp = descreverColunas(colunasConsumoMateriais(1)).filter((c) => c.nome === "consumoErp" || c.nome === "deltaErpPct");
  assert.deepEqual(erp.map((c) => [c.nome, c.agregada, c.semAbaValores]), [["consumoErp", true, true], ["deltaErpPct", true, true]]);
});

test("entrada: filtros e ordem inválidos viram erro de entrada; só nomes declarados valem", () => {
  const ok = lerFiltrosEOrdemConsulta(COLUNAS_PECAS, { filtros: JSON.stringify([{ coluna: "sigla", operador: "contém", valores: ["24"] }]), ordem: "sigla:desc,codigoControle" });
  assert.equal(ok.filtros.length, 1);
  assert.deepEqual(ok.ordem.map((o) => o.coluna), ["sigla", "codigoControle"]);
  assert.throws(() => lerFiltrosEOrdemConsulta(COLUNAS_PECAS, { filtros: "{quebrado" }), ErroEntradaConsulta);
  assert.throws(() => lerFiltrosEOrdemConsulta(COLUNAS_PECAS, { filtros: JSON.stringify([{ coluna: "p.senha", operador: "=", valores: ["x"] }]) }), /não existe/);
  assert.throws(() => lerFiltrosEOrdemConsulta(COLUNAS_PECAS, { ordem: "1; DROP TABLE plannix_pecas:asc" }), /não existe/);
  assert.throws(() => lerFiltrosEOrdemConsulta(COLUNAS_PECAS, { filtros: JSON.stringify([{ coluna: "revisao", operador: "contém", valores: ["1"] }]) }), /não vale/);
  assert.throws(() => lerFiltrosEOrdemConsulta(COLUNAS_PECAS, { filtros: JSON.stringify([{ coluna: "revisao", operador: "=", valores: ["abc"] }]) }), /inválido/);
});

test("SQL: texto sem diferenciar maiúsculas, LIKE escapado, lista, data pelo dia de Brasília", () => {
  const f = (coluna: string, operador: string, valores: string[]) => condicoesDosFiltros(COLUNAS_OBRAS, [{ coluna, operador: operador as never, valores }]);

  const igual = f("sigla", "=", ["024/25"])[0];
  assert.equal(sql(igual), "lower(o.sigla) = lower($1)");
  assert.deepEqual(igual.values, ["024/25"]);

  const contem = f("nome", "contém", ["50%_x"])[0];
  assert.equal(sql(contem), "o.nome ILIKE $1");
  assert.deepEqual(contem.values, ["%50\\%\\_x%"]);

  const lista = f("status", "IN", ["contratada", "finalizada"])[0];
  assert.equal(sql(lista), "lower(o.status) IN (lower($1),lower($2))");

  const dia = f("dataInicial", "=", ["2026-08-24"])[0];
  assert.equal(sql(dia), "(o.data_inicial >= $1 AND o.data_inicial < $2)");
  assert.equal((dia.values[0] as Date).toISOString(), "2026-08-24T03:00:00.000Z");
  assert.equal((dia.values[1] as Date).toISOString(), "2026-08-25T03:00:00.000Z");

  const faixa = f("dataInicial", "entre", ["2026-01-01", "2026-01-31"])[0];
  assert.equal((faixa.values[1] as Date).toISOString(), "2026-02-01T03:00:00.000Z", "'entre' vai até o fim do dia final");

  assert.equal(sql(f("codObra", "≥", ["600"])[0]), "o.cod_obra >= $1");
  assert.deepEqual(f("codObra", "≥", ["600"])[0].values, [600]);
  assert.equal(sql(f("volumeTeorico", "entre", ["1.5", "9"])[0]), "(p.volume_teorico >= $1::numeric AND p.volume_teorico <= $2::numeric)");
  assert.equal(sql(f("nome", "vazio", [])[0]), "(o.nome IS NULL OR o.nome = '')");
  assert.equal(sql(f("dataInicial", "não vazio", [])[0]), "o.data_inicial IS NOT NULL");
});

test("SQL: tentativa de injeção só vira parâmetro, nunca texto da consulta", () => {
  const c = condicoesDosFiltros(COLUNAS_PECAS, [{ coluna: "sigla", operador: "=", valores: ["x' OR 1=1 --"] }])[0];
  assert.ok(!sql(c).includes("OR 1=1"));
  assert.deepEqual(c.values, ["x' OR 1=1 --"]);
});

test("SQL: colunas agregadas e comuns se separam (WHERE x HAVING/resumo), e semColuna tira o filtro da própria coluna", () => {
  const filtros = [
    { coluna: "status", operador: "=" as const, valores: ["CONTRATADA"] },
    { coluna: "pecas", operador: "≥" as const, valores: ["10"] },
  ];
  assert.equal(condicoesDosFiltros(COLUNAS_OBRAS, filtros, { agregadas: false }).length, 1);
  assert.equal(condicoesDosFiltros(COLUNAS_OBRAS, filtros, { agregadas: true }).length, 1);
  assert.equal(condicoesDosFiltros(COLUNAS_OBRAS, filtros).length, 2);
  assert.equal(condicoesDosFiltros(COLUNAS_OBRAS, filtros, { semColuna: "status" }).length, 1);
  assert.equal(usaAgregada(COLUNAS_OBRAS, [filtros[0]], [{ coluna: "codObra", direcao: "desc" }]), false);
  assert.equal(usaAgregada(COLUNAS_OBRAS, [filtros[0]], [{ coluna: "pecas", direcao: "asc" }]), true);
  assert.equal(usaAgregada(COLUNAS_OBRAS, filtros, []), true);
});

test("ordenação: critérios da tela, nulo por último e o padrão da tela no fim", () => {
  const o = ordenacaoSql(COLUNAS_OBRAS, [{ coluna: "status", direcao: "desc" }, { coluna: "codObra", direcao: "asc" }], Prisma.sql`o.cod_obra DESC`);
  assert.equal(sql(o), "o.status DESC NULLS LAST, o.cod_obra ASC NULLS LAST, o.cod_obra DESC");
  assert.equal(sql(ordenacaoSql(COLUNAS_OBRAS, [], Prisma.sql`o.cod_obra DESC`)), "o.cod_obra DESC");
  // coluna desconhecida é ignorada (a rota já validou antes; aqui é só defesa)
  assert.equal(sql(ordenacaoSql(COLUNAS_OBRAS, [{ coluna: "inexistente", direcao: "asc" }], Prisma.sql`o.cod_obra DESC`)), "o.cod_obra DESC");
});

test("valores da coluna: agrupa por posição, porque a expressão pode ter parâmetro ligado (status do item de NF)", async () => {
  // A expressão da coluna entra no SELECT com um `$n`; repetida no GROUP BY viraria outro `$m` e o Postgres não a reconheceria como a mesma.
  const colunas = [{ nome: "status", tipo: "texto" as const, expr: Prisma.sql`(CASE WHEN x.a = ANY(${["1", "2"]}::text[]) THEN 'sim' ELSE 'nao' END)` }];
  let enviado: Prisma.Sql | undefined;
  await valoresDaColunaSql(async (s) => ((enviado = s), []), colunas, "status", { de: Prisma.sql`FROM t x`, base: [], filtros: [], termo: "" });
  const q = sql(enviado!);
  assert.match(q, /GROUP BY 1 ORDER BY/);
  assert.equal((q.match(/ANY\(/g) ?? []).length, 1, "a expressão (e seus parâmetros) aparece uma vez só");
});

test("consumo por material: 'por m³' leva o volume como parâmetro e fica no HAVING", () => {
  const cols = colunasConsumoMateriais(120.5);
  const c = condicoesDosFiltros(cols, [{ coluna: "porM3", operador: "≥", valores: ["2"] }], { agregadas: true })[0];
  assert.match(sql(c), /CASE WHEN c\.origem::text = 'concreto' AND \$1::numeric > 0 THEN sum\(c\.quantidade\) \/ \$2::numeric END >= \$3::numeric/);
  assert.deepEqual(c.values, [120.5, 120.5, "2"]);
});

test("valores da coluna: monta o SQL sem o filtro da própria coluna e com o termo; recusa coluna agregada", async () => {
  const chamadas: Prisma.Sql[] = [];
  const executar = async (s: Prisma.Sql) => {
    chamadas.push(s);
    return [
      { valor: "CONTRATADA", quantidade: BigInt(215) },
      { valor: null, quantidade: BigInt(3) },
    ];
  };
  const r = await valoresDaColunaSql(executar, COLUNAS_OBRAS, "status", {
    de: Prisma.sql`FROM plannix_obras o`,
    base: [Prisma.sql`o.removido_em_plannix IS NULL`],
    filtros: [
      { coluna: "status", operador: "=", valores: ["X"] },
      { coluna: "sigla", operador: "contém", valores: ["/25"] },
    ],
    termo: "contr",
  });
  const q = sql(chamadas[0]);
  assert.match(q, /WHERE o\.removido_em_plannix IS NULL AND o\.sigla ILIKE \$1 AND o\.status ILIKE \$2 GROUP BY 1 ORDER BY quantidade DESC/);
  assert.ok(!q.includes("lower(o.status)"), "o filtro da própria coluna ficou de fora");
  assert.deepEqual(r.valores, [{ valor: "CONTRATADA", quantidade: 215 }, { valor: null, quantidade: 3 }]);
  assert.equal(r.temMais, false);
  await assert.rejects(valoresDaColunaSql(executar, COLUNAS_OBRAS, "pecas", { de: Prisma.sql`FROM x`, base: [], filtros: [], termo: "" }), /não tem lista de valores/);
  await assert.rejects(valoresDaColunaSql(executar, COLUNAS_OBRAS, "naoExiste", { de: Prisma.sql`FROM x`, base: [], filtros: [], termo: "" }), ErroEntradaConsulta);
  void juntar;
});

test("valores da coluna: acima de 200 valores avisa que há mais", async () => {
  const muitos = Array.from({ length: 201 }, (_, i) => ({ valor: `V${i}`, quantidade: BigInt(1) }));
  const r = await valoresDaColunaSql(async () => muitos, COLUNAS_PECAS, "produto", { de: Prisma.sql`FROM plannix_pecas p`, base: [], filtros: [], termo: "" });
  assert.equal(r.valores.length, 200);
  assert.equal(r.temMais, true);
});
