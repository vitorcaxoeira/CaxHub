import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { casoSql, col, registrarListaConsultavel, sqlPosicional } from "./listaConsultavel";

test("sqlPosicional: cada $n vira um parâmetro, na ordem em que aparece (inclusive repetido)", () => {
  const sql = sqlPosicional("SELECT 1 WHERE a = $1 AND b = ANY($2::int[]) AND c = $1", ["x", [1, 2]]);
  assert.equal(sql.text, "SELECT 1 WHERE a = $1 AND b = ANY($2::int[]) AND c = $3");
  assert.deepEqual(sql.values, ["x", [1, 2], "x"]);
});

test("sqlPosicional: compõe com outro Prisma.sql sem trocar a numeração", () => {
  const interna = sqlPosicional("SELECT a FROM t WHERE k = $1", [7]);
  const sql = Prisma.sql`SELECT x.* FROM (${interna}) x WHERE x.b = ${"y"}`;
  assert.equal(sql.text, "SELECT x.* FROM (SELECT a FROM t WHERE k = $1) x WHERE x.b = $2");
  assert.deepEqual(sql.values, [7, "y"]);
});

test("casoSql: rótulo de domínio como CASE parametrizado; sem valores devolve o padrão", () => {
  const sql = casoSql(Prisma.raw("b.sit"), ["1", "2"], (v) => `Situação ${v}`, Prisma.sql`'?'`);
  assert.match(sql.text, /CASE WHEN b\.sit = \$1 THEN \$2 WHEN b\.sit = \$3 THEN \$4 ELSE '\?' END/);
  assert.deepEqual(sql.values, ["1", "Situação 1", "2", "Situação 2"]);
  assert.equal(casoSql(Prisma.raw("b.sit"), [], () => "", Prisma.sql`NULL`).text, "NULL");
});

test("col: a expressão da coluna é o nome na subconsulta x; data compara pelo dia de Brasília", () => {
  assert.equal(col.texto("cliente").expr.text, 'x."cliente"');
  assert.match(col.data("datemi").expr.text, /x\."datemi"::timestamp AT TIME ZONE 'America\/Sao_Paulo'/);
  assert.equal(col.decimal("valor", { obrigatoria: true }).obrigatoria, true);
});

test("registrarListaConsultavel recusa caminho que o router já atende (rota antiga engoliria o resumo do rodapé)", () => {
  const ler = () => ({ interna: Prisma.sql`SELECT 1 AS a`, colunas: [col.inteiro("a")], ordemPadrao: Prisma.sql`x."a"` });
  const comResumo = Router();
  comResumo.get("/resumo", (_req, res) => res.json({}));
  assert.throws(() => registrarListaConsultavel(comResumo, "/", ler, "teste"), /GET \/resumo já existe/);
  const livre = Router();
  livre.get("/kpis", (_req, res) => res.json({}));
  assert.doesNotThrow(() => registrarListaConsultavel(livre, "/", ler, "teste"));
  assert.throws(() => registrarListaConsultavel(livre, "/", ler, "de novo"), /GET \/resumo já existe/);
});

test("nenhum router da aplicação tem dois GET em .../resumo ou .../valores (o segundo nunca responde)", async () => {
  // Pega também a rota registrada DEPOIS da lista, que a trava do registro não vê. O caminho da lista em si pode repetir de propósito
  // (rota de exportação CSV antes dela, que chama next()).
  const arquivos = ["./financeiro", "./projetos", "./pedidos", "./syncErp"];
  const repetidos: string[] = [];
  for (const arq of arquivos) {
    const mod = (await import(arq)) as Record<string, unknown>;
    for (const [nome, valor] of Object.entries(mod)) {
      const pilha = (valor as { stack?: { route?: { path?: unknown; methods?: Record<string, boolean> } }[] } | null)?.stack;
      if (typeof valor !== "function" || !Array.isArray(pilha)) continue;
      const vistos = new Set<string>();
      for (const camada of pilha) {
        const caminho = camada.route?.path;
        if (typeof caminho !== "string" || !camada.route?.methods?.get || !/\/(resumo|valores)$/.test(caminho)) continue;
        if (vistos.has(caminho)) repetidos.push(`${arq} ${nome}: GET ${caminho}`);
        vistos.add(caminho);
      }
    }
  }
  assert.deepEqual(repetidos, []);
});
