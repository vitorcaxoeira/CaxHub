import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { COLUNAS, linhasPorTime, type AcoesHoras, type LinhaHoras } from "./BonificacaoHorasKyria";
import { fmtHorasMinutos } from "./comum";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const LINHA: LinhaHoras = {
  processoId: 1,
  processo: "Atendentes",
  codemp: 1,
  codfor: 513,
  codusu: 118,
  consultor: "Daniel Hoepers",
  minutosPonto: 10659,
  saldoBanco: -173,
  minutosExtras: 0,
  minutosTotal: 10659,
  minutosKyria: 1872,
  minutosOcioso: 8787,
  percentual: 17.5626,
  pdiHoras: null,
  pdiConcluido: null,
  motivo: null,
  porTime: [
    {
      time: "SUPORTE TI",
      minutos: 1872,
      porArea: [
        { area: "ERP | Gestão Empresarial", minutos: 1404 },
        { area: "(sem área)", minutos: 468 },
      ],
    },
  ],
};

// Sem ações (ctx ausente) a célula é só o número; com ações, os três números comprováveis viram link.
const celula = (nome: string, linha: LinhaHoras = LINHA, acoes?: AcoesHoras) => renderToStaticMarkup(<>{COLUNAS.find((c) => c.nome === nome)!.render(linha, acoes as AcoesHoras, false)}</>);
const ACOES: AcoesHoras = { abrir: () => undefined };

describe("Horas Kyria x Trabalhadas", () => {
  it("HH:MM aceita saldo negativo", () => {
    expect(fmtHorasMinutos(-173)).toBe("-02:53");
    expect(fmtHorasMinutos(148)).toBe("02:28");
    expect(fmtHorasMinutos(-0.2)).toBe("00:00");
    expect(fmtHorasMinutos(null)).toBe("—");
  });

  it("colunas na ordem: trabalhadas, banco de horas, extras, total, Kyria, ocioso e %", () => {
    expect(COLUNAS.map((c) => c.titulo).slice(2, 9)).toEqual(["Horas trabalhadas", "Banco de horas", "Extras", "Total do mês", "Horas Kyria", "Ocioso", "%"]);
  });

  it("saldo negativo aparece com o aviso de que não entrou no cálculo", () => {
    const out = celula("saldoBanco");
    expect(out).toContain("-02:53");
    expect(out).toContain("não entrou no cálculo");
    expect(celula("minutosExtras")).toContain("00:00");
    expect(celula("minutosTotal")).toContain("177:39");
    expect(celula("minutosOcioso")).toContain("146:27");
  });

  it("saldo positivo não leva aviso; sem dado vira traço", () => {
    expect(celula("saldoBanco", { ...LINHA, saldoBanco: 148 })).toBe("02:28");
    expect(celula("saldoBanco", { ...LINHA, saldoBanco: null })).toBe("—");
    expect(celula("minutosOcioso", { ...LINHA, minutosOcioso: null })).toBe("—");
  });

  it("Horas trabalhadas, Banco de horas e Horas Kyria viram link para o comprovante; as outras colunas, não", () => {
    for (const [nome, rotulo] of [["minutosPonto", "horas trabalhadas"], ["saldoBanco", "lançamentos do banco de horas"], ["minutosKyria", "apontamentos do Kyria"]]) {
      const out = celula(nome, LINHA, ACOES);
      expect(out).toContain("<button");
      expect(out).toContain(`Ver o comprovante: ${rotulo} de Daniel Hoepers`);
    }
    expect(celula("saldoBanco", LINHA, ACOES)).toContain("não entrou no cálculo");
    for (const nome of ["minutosExtras", "minutosTotal", "minutosOcioso"]) expect(celula(nome, LINHA, ACOES)).not.toContain("<button");
  });

  it("zero ou sem dado não vira link; banco com saldo zero ainda tem lançamentos para ver", () => {
    expect(celula("minutosPonto", { ...LINHA, minutosPonto: 0 }, ACOES)).toBe("00:00");
    expect(celula("minutosKyria", { ...LINHA, minutosKyria: null }, ACOES)).toBe("—");
    expect(celula("saldoBanco", { ...LINHA, saldoBanco: null }, ACOES)).toBe("—");
    expect(celula("saldoBanco", { ...LINHA, saldoBanco: 0 }, ACOES)).toContain("<button");
  });

  it("detalhe: o time e, logo abaixo, as áreas dele, com horas e % sobre o Kyria do atendente", () => {
    const linhas = linhasPorTime(LINHA);
    expect(linhas.map((l) => l.chave)).toEqual(["SUPORTE TI", "SUPORTE TI|ERP | Gestão Empresarial", "SUPORTE TI|(sem área)"]);
    const out = linhas.map((l) => renderToStaticMarkup(<>{l.valores.consultor}{l.valores.minutosKyria}{l.valores.percentual}</>));
    expect(out[0]).toContain("31:12");
    expect(out[0]).toContain("100%");
    expect(out[1]).toContain("ERP | Gestão Empresarial");
    expect(out[1]).toContain("23:24");
    expect(out[1]).toContain("75%");
    expect(out[2]).toContain("(sem área)");
  });
});
