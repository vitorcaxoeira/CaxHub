import { describe, expect, it } from "vitest";
import { faltaPreencher, montarCaminho, queryDaPessoa, urlCompleta, type ParametroDoc, type RecursoDoc } from "./kyriaCaminho";

const param = (nome: string, extra: Partial<ParametroDoc> = {}): ParametroDoc => ({
  nome,
  local: "query",
  obrigatorio: false,
  tipo: "string",
  enumValores: null,
  padrao: null,
  descricao: null,
  preenchidoPeloSistema: false,
  ...extra,
});

const recurso = (caminho: string, parametrosCaminho: ParametroDoc[], parametrosQuery: ParametroDoc[]): RecursoDoc => ({
  caminho,
  resumo: "",
  grupo: "x",
  parametrosCaminho,
  parametrosQuery,
  paginado: true,
  schemaItem: null,
  registrados: [],
});

const mensagens = recurso("/tickets/{ticketId}/messages", [param("ticketId", { local: "path", obrigatorio: true })], []);
const horas = recurso("/reports/hours", [], [
  param("from", { obrigatorio: true, preenchidoPeloSistema: true }),
  param("to", { obrigatorio: true, preenchidoPeloSistema: true }),
  param("groupBy", { obrigatorio: true, enumValores: ["user", "customer"] }),
  param("source"),
]);

describe("montarCaminho", () => {
  it("troca o parâmetro de caminho pelo valor, codificado", () => {
    expect(montarCaminho(mensagens, { ticketId: "abc 123/x" }, {})).toBe("/tickets/abc%20123%2Fx/messages");
  });
  it("deixa o {parametro} à vista enquanto não for preenchido", () => {
    expect(montarCaminho(mensagens, {}, {})).toBe("/tickets/{ticketId}/messages");
    expect(montarCaminho(mensagens, { ticketId: "  " }, {})).toBe("/tickets/{ticketId}/messages");
  });
  it("só leva à query o que foi preenchido, na ordem da documentação, e nunca o que o sistema preenche", () => {
    expect(montarCaminho(horas, {}, { groupBy: "customer", source: "manual", from: "2026-01-01" })).toBe("/reports/hours?groupBy=customer&source=manual");
    expect(montarCaminho(horas, {}, { groupBy: "customer", source: "" })).toBe("/reports/hours?groupBy=customer");
    expect(montarCaminho(horas, {}, {})).toBe("/reports/hours");
  });
});

describe("faltaPreencher", () => {
  it("lista os obrigatórios em branco, sem contar os que o sistema preenche", () => {
    expect(faltaPreencher(horas, {}, {})).toEqual(["groupBy"]);
    expect(faltaPreencher(horas, {}, { groupBy: "user" })).toEqual([]);
    expect(faltaPreencher(mensagens, {}, {})).toEqual(["ticketId"]);
    expect(faltaPreencher(mensagens, { ticketId: "t1" }, {})).toEqual([]);
  });
});

describe("queryDaPessoa e urlCompleta", () => {
  it("tira da query o que o sistema preenche", () => {
    expect(queryDaPessoa(horas).map((p) => p.nome)).toEqual(["groupBy", "source"]);
  });
  it("junta a base da API e o caminho sem barra dupla", () => {
    expect(urlCompleta("https://x.test/api/v1/", "/teams?status=active")).toBe("https://x.test/api/v1/teams?status=active");
    expect(urlCompleta("https://x.test/api/v1", "/teams")).toBe("https://x.test/api/v1/teams");
  });
});
