import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { divergeDaTela, resumoDoComprovante, TabelaComprovante, type Comprovante } from "./ModalComprovanteHoras";

// A tabela guarda a arrumação das colunas por usuário: no teste não há usuário logado.
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const html = (c: Comprovante) => renderToStaticMarkup(
  <ToastProvider>
    <TabelaComprovante comprovante={c} />
  </ToastProvider>
);

const PONTO: Comprovante = {
  tipo: "ponto",
  linhas: [
    { data: "2026-10-01", codsit: 1, situacao: "Trabalhando", minutos: 528 },
    { data: "2026-10-02", codsit: 1, situacao: "Trabalhando", minutos: 510 },
  ],
};
const BANCO: Comprovante = {
  tipo: "banco",
  linhas: [
    { data: "2026-10-01", banco: 10, codsit: 103, situacao: "Atraso", origem: "A", minutos: -46, acumulado: -46 },
    { data: "2026-10-01", banco: 10, codsit: 901, situacao: "Crédito BH Normal", origem: "A", minutos: 22, acumulado: -24 },
  ],
  banco: { creditos: 22, debitos: 46, saldo: -24, extras: 0 },
};
const KYRIA: Comprovante = {
  tipo: "kyria",
  linhas: [
    { id: "a", inicio: "2026-10-05T12:00:00.000Z", fim: "2026-10-05T13:30:00.000Z", minutos: 90, chamado: "TI-1", titulo: "Erro no relatório", time: "SUPORTE TI", area: "ERP | Gestão Empresarial", origem: "manual", motivo: "ajuste" },
  ],
};

describe("comprovante das horas", () => {
  it("subtítulo: quantidade e soma", () => {
    expect(resumoDoComprovante(PONTO)).toBe("2 dia(s) · total 17:18");
    expect(resumoDoComprovante(KYRIA)).toBe("1 apontamento(s) · total 01:30");
  });

  it("banco: créditos, débitos, saldo e se entrou no cálculo", () => {
    expect(resumoDoComprovante(BANCO)).toBe("2 lançamento(s) no mês · créditos 00:22 · débitos -00:46 · saldo -00:24 (saldo negativo: não entrou no cálculo)");
    expect(resumoDoComprovante({ ...BANCO, banco: { creditos: 50, debitos: 10, saldo: 40, extras: 40 } })).toContain("saldo 00:40 (entrou como extra)");
    expect(resumoDoComprovante({ ...BANCO, banco: { creditos: 10, debitos: 10, saldo: 0, extras: 0 } })).toContain("saldo zerado");
  });

  it("avisa quando a soma das linhas não bate com o número da lista (compara o minuto que a tela mostra)", () => {
    expect(divergeDaTela(PONTO, 1038)).toBe(false);
    expect(divergeDaTela(PONTO, 1000)).toBe(true);
    expect(divergeDaTela(BANCO, -24)).toBe(false);
    expect(divergeDaTela(KYRIA, 90.2)).toBe(false);
  });

  it("cada tipo mostra as suas colunas e os lançamentos", () => {
    const ponto = html(PONTO);
    expect(ponto).toContain("01/10/2026");
    expect(ponto).toContain("Trabalhando");
    expect(ponto).toContain("08:48");

    const banco = html(BANCO);
    for (const x of ["Origem", "Acumulado no mês", "Atraso", "-00:46", "00:22", "-00:24"]) expect(banco).toContain(x);

    const kyria = html(KYRIA);
    for (const x of ["TI-1", "Erro no relatório", "SUPORTE TI", "ERP | Gestão Empresarial", "Manual", "01:30", "ajuste"]) expect(kyria).toContain(x);
    expect(kyria).toContain("05/10/2026"); // 12:00Z = 09:00 em Brasília, mesmo dia
  });
});
