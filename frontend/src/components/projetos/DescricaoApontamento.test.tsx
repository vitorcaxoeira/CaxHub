import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { erroDeDescricao, textoInicialDaDescricao } from "../../lib/descricao-apontamento";
import { ModalObservacaoAtividade } from "./ModalObservacaoAtividade";
import { ModalDescricaoPendente } from "./useRecusaDeInicio";

const ATIVIDADE = "Apoio para consultoria HCM";
const BOA = "Ajustei a regra de cálculo de hora extra noturna do cliente";

// O botão cujo texto é `rotulo`, como saiu no HTML.
const botao = (html: string, rotulo: string) => html.match(new RegExp(`<button[^>]*>${rotulo}</button>`))?.[0] ?? "";
const conteudoDoCampo = (html: string) => html.match(/<textarea[^>]*>([^<]*)<\/textarea>/)?.[1] ?? "";

const modal = (nota: string | null) =>
  renderToStaticMarkup(
    <ModalObservacaoAtividade titulo="Proposta 8480" descricaoAtividade={ATIVIDADE} nota={nota} onConfirmar={() => {}} onCancelar={() => {}} />
  );

describe("regra da descrição (espelho do servidor)", () => {
  it("exige 30 caracteres, diferentes da descrição da atividade", () => {
    expect(erroDeDescricao("", [ATIVIDADE])).toMatch("obrigatória");
    expect(erroDeDescricao("a".repeat(29))).toMatch("faltam 1");
    expect(erroDeDescricao("a".repeat(30))).toBeNull();
    expect(erroDeDescricao("APOIO  para consultoria-HCM.", [ATIVIDADE])).toMatch("não pode repetir");
    expect(erroDeDescricao(BOA, [ATIVIDADE])).toBeNull();
  });

  it("o campo abre com a nota do consultor, mas nunca com a repetição da atividade", () => {
    expect(textoInicialDaDescricao(BOA, [ATIVIDADE])).toBe(BOA);
    expect(textoInicialDaDescricao("apoio para consultoria hcm", [ATIVIDADE])).toBe("");
    expect(textoInicialDaDescricao(null, [ATIVIDADE])).toBe("");
  });
});

describe("O que foi feito?", () => {
  it("abre vazio, com a atividade só como informação, Salvar desligado e sem Pular", () => {
    const html = modal(null);
    expect(html).toContain(">Atividade</p>");
    expect(html).toContain(ATIVIDADE);
    expect(conteudoDoCampo(html)).toBe("");
    expect(html).toContain("0/30");
    expect(botao(html, "Salvar")).toMatch(/\sdisabled=""/);
    expect(botao(html, "Cancelar")).not.toBe("");
    expect(html).not.toContain("Pular");
  });

  it("não carrega a descrição da atividade herdada do preenchimento antigo", () => {
    expect(conteudoDoCampo(modal(ATIVIDADE))).toBe("");
  });

  it("com a nota válida já salva, o campo vem com ela e Salvar fica ligado", () => {
    const html = modal(BOA);
    expect(conteudoDoCampo(html)).toBe(BOA);
    expect(botao(html, "Salvar")).not.toMatch(/\sdisabled=""/);
  });

  it("com nota curta, mantém o texto e Salvar desligado", () => {
    const html = modal("Reunião com o cliente");
    expect(html).toContain("21/30");
    expect(botao(html, "Salvar")).toMatch(/\sdisabled=""/);
  });
});

describe("bloqueio por apontamento sem descrição", () => {
  it("o consultor recebe o botão para Meus Apontamentos; quem age por ele, não", () => {
    const dono = renderToStaticMarkup(<ModalDescricaoPendente mensagem="Você tem 2 apontamentos sem descrição." onAjustar={() => {}} onFechar={() => {}} />);
    expect(dono).toContain("Você tem 2 apontamentos sem descrição.");
    expect(botao(dono, "Ajustar em Meus Apontamentos")).not.toBe("");
    const outro = renderToStaticMarkup(<ModalDescricaoPendente mensagem="O consultor desta atividade tem 2." onFechar={() => {}} />);
    expect(outro).not.toContain("Ajustar em Meus Apontamentos");
  });
});

describe("proposta interna", () => {
  const interno = (nota: string | null) =>
    renderToStaticMarkup(
      <ModalObservacaoAtividade titulo="Proposta 1" descricaoAtividade={ATIVIDADE} interna nota={nota} onConfirmar={() => {}} onCancelar={() => {}} />
    );

  it("a regra obrigatória não vale", () => {
    for (const t of ["", "ok", ATIVIDADE]) expect(erroDeDescricao(t, [ATIVIDADE], true)).toBeNull();
    expect(erroDeDescricao("a".repeat(1001), [ATIVIDADE], true)).toMatch("no máximo");
    expect(erroDeDescricao("", [null], true)).toMatch("obrigatória");
  });

  it("o campo abre com a nota salva ou, sem ela, com a descrição da atividade (cortada em 1000)", () => {
    expect(textoInicialDaDescricao(null, [ATIVIDADE], true)).toBe(ATIVIDADE);
    expect(textoInicialDaDescricao("reunião", [ATIVIDADE], true)).toBe("reunião");
    expect(textoInicialDaDescricao(null, [null, "x".repeat(1833)], true)).toHaveLength(1000);
    expect(conteudoDoCampo(interno(null))).toBe(ATIVIDADE);
  });

  it("Salvar já vem ligado, sem o aviso de mínimo nem o contador", () => {
    const html = interno(null);
    expect(botao(html, "Salvar")).not.toContain('disabled=""');
    expect(html).toContain("Proposta interna");
    expect(html).not.toContain("no mínimo 30");
    expect(html).not.toMatch(/\d+<!-- -->\/<!-- -->\d+/);
  });
});
