import { test } from "node:test";
import assert from "node:assert/strict";
import { casarCaminho, recursosGetDaDoc, schemaDoItem } from "./openapiRecursos";

// Spec mínimo no formato do openapi.json do Kyria (v1.2.0): parâmetros inline, envelopes por $ref, prefixo /api/v1.
const spec = {
  info: { version: "1.2.0" },
  paths: {
    "/api/v1/teams": {
      get: {
        summary: "List teams",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "inactive"] } },
        ],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/TeamCollectionEnvelope" } } } } },
      },
      post: { summary: "Create team" },
    },
    "/api/v1/tickets/{ticketId}": {
      get: {
        summary: "Get a workspace ticket",
        parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/TicketResourceEnvelope" } } } } },
      },
      patch: { summary: "Update ticket" },
    },
    "/api/v1/tickets/{ticketId}/messages": {
      get: {
        summary: "List ticket messages",
        parameters: [
          { name: "ticketId", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/TicketMessageCollectionEnvelope" } } } } },
      },
    },
    "/api/v1/reports/hours": {
      get: {
        summary: "Aggregate tracked minutes by one dimension",
        parameters: [
          { name: "from", in: "query", required: true, schema: { type: "string" } },
          { name: "to", in: "query", required: true, schema: { type: "string" } },
          { name: "groupBy", in: "query", required: true, schema: { type: "string", enum: ["user", "customer", "project"] } },
          { name: "includeOpen", in: "query", schema: { type: "string", enum: ["true", "false"], default: "false" } },
        ],
        responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/HoursReportEnvelope" } } } } },
      },
    },
    "/api/v1/tickets": { post: { summary: "Create ticket" } },
  },
  components: {
    schemas: {
      TeamCollectionEnvelope: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Team" } } } },
      TicketResourceEnvelope: { type: "object", properties: { data: { $ref: "#/components/schemas/Ticket" } } },
      TicketMessageCollectionEnvelope: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/TicketMessage" } } } },
      HoursReportEnvelope: { type: "object", properties: { data: { type: "object", properties: { rows: { type: "array" } } } } },
    },
  },
};

test("só os GETs entram, sem o prefixo /api/v1, agrupados pelo primeiro segmento", () => {
  const r = recursosGetDaDoc(spec);
  assert.deepEqual(r.map((x) => x.caminho), ["/reports/hours", "/teams", "/tickets/{ticketId}", "/tickets/{ticketId}/messages"]);
  assert.deepEqual(r.map((x) => x.grupo), ["reports", "teams", "tickets", "tickets"]);
  assert.equal(r.find((x) => x.caminho === "/tickets"), undefined); // /tickets só tem POST nesta doc de teste
});

test("limit e cursor ficam fora da query (paginação é do sistema), mas marcam o recurso como paginado", () => {
  const teams = recursosGetDaDoc(spec).find((x) => x.caminho === "/teams")!;
  assert.equal(teams.paginado, true);
  assert.deepEqual(teams.parametrosQuery.map((p) => p.nome), ["status"]);
  assert.deepEqual(teams.parametrosQuery[0].enumValores, ["active", "inactive"]);
  const ticket = recursosGetDaDoc(spec).find((x) => x.caminho === "/tickets/{ticketId}")!;
  assert.equal(ticket.paginado, false);
});

test("parâmetro de caminho é sempre obrigatório; query respeita o required da doc", () => {
  const msgs = recursosGetDaDoc(spec).find((x) => x.caminho === "/tickets/{ticketId}/messages")!;
  assert.deepEqual(msgs.parametrosCaminho.map((p) => [p.nome, p.obrigatorio]), [["ticketId", true]]);
  const horas = recursosGetDaDoc(spec).find((x) => x.caminho === "/reports/hours")!;
  assert.deepEqual(horas.parametrosQuery.map((p) => [p.nome, p.obrigatorio]), [["from", true], ["to", true], ["groupBy", true], ["includeOpen", false]]);
  assert.equal(horas.parametrosQuery.find((p) => p.nome === "includeOpen")!.padrao, "false");
});

test("from/to do relatório de horas são preenchidos pelo sistema; nos outros recursos não", () => {
  const horas = recursosGetDaDoc(spec).find((x) => x.caminho === "/reports/hours")!;
  assert.deepEqual(horas.parametrosQuery.filter((p) => p.preenchidoPeloSistema).map((p) => p.nome), ["from", "to"]);
  const teams = recursosGetDaDoc(spec).find((x) => x.caminho === "/teams")!;
  assert.equal(teams.parametrosQuery.some((p) => p.preenchidoPeloSistema), false);
});

test("schema do item: lista, registro único e agregado (sem nome)", () => {
  const por = (c: string) => recursosGetDaDoc(spec).find((x) => x.caminho === c)!.schemaItem;
  assert.equal(por("/teams"), "Team");
  assert.equal(por("/tickets/{ticketId}"), "Ticket");
  assert.equal(por("/tickets/{ticketId}/messages"), "TicketMessage");
  assert.equal(por("/reports/hours"), null);
  assert.equal(schemaDoItem(spec, { responses: {} }), null);
});

test("casar caminho salvo: query de identidade, parâmetro de caminho e rota que a doc não tem mais", () => {
  const r = recursosGetDaDoc(spec);
  const a = casarCaminho("/reports/hours?groupBy=customer", r)!;
  assert.equal(a.recurso.caminho, "/reports/hours");
  assert.deepEqual(a.valoresQuery, { groupBy: "customer" });
  const b = casarCaminho("/tickets/abc123/messages", r)!;
  assert.equal(b.recurso.caminho, "/tickets/{ticketId}/messages");
  assert.deepEqual(b.valoresCaminho, { ticketId: "abc123" });
  assert.equal(casarCaminho("/reports/hours", r)!.recurso.caminho, "/reports/hours"); // recurso salvo sem query (#8)
  assert.equal(casarCaminho("/rota-que-sumiu", r), null);
  assert.equal(casarCaminho("/teams/xyz", r), null); // mesmo número de segmentos de /tickets/{ticketId}, mas o literal não confere
});

test("entre um caminho literal e um com parâmetro, o mais específico ganha", () => {
  const recursos = recursosGetDaDoc({
    paths: {
      "/api/v1/tickets/{ticketId}": { get: { summary: "um" } },
      "/api/v1/tickets/stats": { get: { summary: "estatísticas" } },
    },
  });
  assert.equal(casarCaminho("/tickets/stats", recursos)!.recurso.resumo, "estatísticas");
  assert.equal(casarCaminho("/tickets/abc", recursos)!.recurso.resumo, "um");
});

test("spec inválido não derruba: devolve lista vazia", () => {
  assert.deepEqual(recursosGetDaDoc(null), []);
  assert.deepEqual(recursosGetDaDoc({}), []);
  assert.deepEqual(recursosGetDaDoc({ paths: "x" }), []);
});
