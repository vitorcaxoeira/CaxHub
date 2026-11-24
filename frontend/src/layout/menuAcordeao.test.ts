import { describe, expect, it } from "vitest";
import { abrirCaminho, abrirNoAcordeao, alternarNoAcordeao, irmaosDoMenu } from "./menuAcordeao";

const IRMAOS = irmaosDoMenu([
  { label: "Comercial", subgrupos: ["Gestão de Metas"] },
  { label: "Gestão de Projetos", subgrupos: [] },
  { label: "Administração", subgrupos: ["Integração Kyria", "Outro Sub"] },
]);
const S = (...r: string[]) => new Set(r);

describe("menu em acordeão", () => {
  it("abrir um grupo de topo fecha o outro grupo de topo aberto", () => {
    expect(abrirNoAcordeao(S("Comercial"), "Gestão de Projetos", IRMAOS)).toEqual(S("Gestão de Projetos"));
  });

  it("abrir um subgrupo fecha só o subgrupo irmão (mesmo pai), não o grupo pai", () => {
    expect(abrirNoAcordeao(S("Administração", "Outro Sub"), "Integração Kyria", IRMAOS)).toEqual(S("Administração", "Integração Kyria"));
  });

  it("o subgrupo aberto fica guardado quando o pai fecha e volta quando ele reabre", () => {
    const fechouPai = abrirNoAcordeao(S("Comercial", "Gestão de Metas"), "Administração", IRMAOS);
    expect(fechouPai).toEqual(S("Gestão de Metas", "Administração"));
    expect(abrirNoAcordeao(fechouPai, "Comercial", IRMAOS).has("Gestão de Metas")).toBe(true);
  });

  it("clique em grupo aberto fecha; fechado abre em acordeão", () => {
    expect(alternarNoAcordeao(S("Comercial"), "Comercial", IRMAOS)).toEqual(S());
    expect(alternarNoAcordeao(S("Comercial"), "Administração", IRMAOS)).toEqual(S("Administração"));
  });

  it("navegar abre o caminho da tela (grupo e subgrupo) e fecha os vizinhos; sem mudança devolve o mesmo Set", () => {
    expect(abrirCaminho(S("Gestão de Projetos"), ["Administração", "Integração Kyria"], IRMAOS)).toEqual(S("Administração", "Integração Kyria"));
    const atual = S("Comercial", "Gestão de Metas");
    expect(abrirCaminho(atual, ["Comercial", "Gestão de Metas"], IRMAOS)).toBe(atual);
  });

  it("rótulo desconhecido só abre, sem fechar nada", () => {
    expect(abrirNoAcordeao(S("Comercial"), "Início", IRMAOS)).toEqual(S("Comercial", "Início"));
  });
});
