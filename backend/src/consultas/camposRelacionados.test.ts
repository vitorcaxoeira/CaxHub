import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogoDaFonte, extrasDaConsulta, lerCamposPedidos, MAX_CAMPOS_EXTRAS, type FonteCampos } from "./camposRelacionados";
import { descreverColunas } from "./consultaColunas";

const PROPOSTA: FonteCampos = { id: "proposta", titulo: "Proposta", tabela: "propostas", alias: "p" };
const CLIENTE: FonteCampos = { id: "cliente", titulo: "Cliente", tabela: "clientes", alias: "c", omitir: ["sencli"] };
const FONTES = [PROPOSTA, CLIENTE];

test("catálogo: campos escalares do schema, com tipo, sem controle do espelho, sem relações e sem os omitidos", () => {
  const cliente = catalogoDaFonte(CLIENTE);
  const nomes = cliente.map((c) => c.nome);
  assert.ok(nomes.includes("cliente__cidcli"));
  assert.ok(!nomes.includes("cliente__sencli"), "omitido");
  assert.ok(!nomes.includes("cliente__vistoEmSync") && !nomes.includes("cliente__removidoEmSenior"), "controle do espelho");
  assert.ok(!nomes.some((n) => n.includes("propostas") || n.includes("titulosReceber")), "relações não são campos");
  assert.equal(cliente.find((c) => c.nome === "cliente__nomcli")?.tipo, "texto");
  assert.equal(cliente.find((c) => c.nome === "cliente__cgccpf")?.tipo, "inteiro", "BigInt é inteiro");
  assert.equal(cliente.find((c) => c.nome === "cliente__cidcli")?.coluna, "cidcli");
});

test("catálogo: tipos e domínio da proposta (data, inteiro, domínio documentado, nulável)", () => {
  const proposta = catalogoDaFonte(PROPOSTA);
  const por = (n: string) => proposta.find((c) => c.nome === `proposta__${n}`)!;
  assert.equal(por("datpro").tipo, "data");
  assert.equal(por("qtdhor").tipo, "inteiro");
  assert.equal(por("qtdhor").obrigatoria, false);
  assert.equal(por("codcli").obrigatoria, true);
  assert.deepEqual(por("sitpro").dominio?.find((d) => d.valor === "7"), { valor: "7", rotulo: "Em Execução" });
});

test("catálogo: fonte opcional (LEFT JOIN) não tem campo obrigatório; id inválido e tabela inexistente são erro de programação", () => {
  assert.ok(catalogoDaFonte({ ...CLIENTE, id: "clienteopc", opcional: true }).every((c) => !c.obrigatoria));
  assert.throws(() => catalogoDaFonte({ ...CLIENTE, id: "Cli__ente" }), /Id de fonte inválido/);
  assert.throws(() => catalogoDaFonte({ ...CLIENTE, id: "x", tabela: "nao_existe" }), /Model Prisma não encontrado/);
});

test("lerCamposPedidos: só nomes do catálogo, sem repetição, na ordem pedida, e no máximo o teto", () => {
  const lidos = lerCamposPedidos(FONTES, "cliente__cidcli, proposta__qtdhor,cliente__cidcli,cliente__sencli,inventado,x__y,proposta__vistoEmSync");
  assert.deepEqual(lidos.map((c) => c.nome), ["cliente__cidcli", "proposta__qtdhor"]);
  assert.deepEqual(lerCamposPedidos(FONTES, undefined), []);
  assert.deepEqual(lerCamposPedidos(FONTES, ["cliente__cidcli"]), [], "só texto (query repetida vira array)");
  const todos = catalogoDaFonte(PROPOSTA).map((c) => c.nome).join(",");
  assert.equal(lerCamposPedidos(FONTES, todos).length, Math.min(MAX_CAMPOS_EXTRAS, catalogoDaFonte(PROPOSTA).length));
});

test("extrasDaConsulta: sem pedido a consulta não muda; com pedido monta SELECT com a coluna do schema e repasse pela camada de fora", () => {
  const vazio = extrasDaConsulta(FONTES, {});
  assert.equal(vazio.selecao.text, "");
  assert.equal(vazio.repasse.text, "");
  assert.deepEqual(vazio.colunas, []);

  const e = extrasDaConsulta(FONTES, { campos: "cliente__cidcli,proposta__datpro" });
  assert.equal(e.selecao.text, ', c."cidcli" AS "cliente__cidcli",p."datpro" AS "proposta__datpro"');
  assert.equal(e.repasse.text, ', b."cliente__cidcli",b."proposta__datpro"');
  assert.deepEqual(e.selecao.values, [], "nada do cliente vira parâmetro nem texto livre");
  assert.deepEqual(e.colunas.map((c) => [c.nome, c.tipo, c.fonte]), [
    ["cliente__cidcli", "texto", "cliente"],
    ["proposta__datpro", "data", "proposta"],
  ]);
  assert.match(e.colunas[1].expr.text, /x\."proposta__datpro"::timestamp AT TIME ZONE 'America\/Sao_Paulo'/, "data pelo dia de Brasília");
});

test("extrasDaConsulta: tentativa de injeção por nome de campo é ignorada", () => {
  const e = extrasDaConsulta(FONTES, { campos: 'cliente__cidcli" FROM usuarios --,cliente__cidcli;DROP TABLE x' });
  assert.equal(e.selecao.text, "");
  assert.deepEqual(e.colunas, []);
});

test("descreverColunas: a coluna extra leva fonte e título; as da tela não ganham campos novos", () => {
  const [extra] = extrasDaConsulta(FONTES, { campos: "cliente__cidcli" }).colunas;
  const d = descreverColunas([extra]);
  assert.equal(d[0].fonte, "cliente");
  assert.equal(d[0].titulo, "cidcli");
});
