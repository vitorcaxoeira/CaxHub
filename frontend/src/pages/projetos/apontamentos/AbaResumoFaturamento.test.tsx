import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/ui/Toast";
import { AbaResumoFaturamento } from "./AbaResumoFaturamento";
import { ModalApontamentosDoResumo } from "./ModalApontamentosDoResumo";
import type { SessaoDetalhe } from "./resumoFaturamento";

// A tabela guarda a arrumação das colunas por usuário: no teste não há usuário logado.
vi.mock("../../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

// Normaliza o espaço sem quebra que o Intl pode usar.
const html = (el: JSX.Element) => renderToStaticMarkup(<ToastProvider>{el}</ToastProvider>).replace(/ /g, " ");

const base = { codemp: 1, codpro: 1234, cliente: "Cliente A", seqite: 2, itemDescricao: "Consultoria", consultorNome: "Fulano", observacao: "ajuste de regra" };
const SESSOES: SessaoDetalhe[] = [
  { ...base, id: 1, inicio: "2026-11-10T12:00:00.000Z", fim: "2026-11-10T13:30:00.000Z", forfat: 0, forfatLabel: "Mediante RAT", faturavel: true, duracaoMinutos: 90, valorHoraItem: 200 },
  { ...base, id: 2, inicio: "2026-11-11T12:00:00.000Z", fim: "2026-11-11T12:30:00.000Z", forfat: 0, forfatLabel: "Mediante RAT", faturavel: false, duracaoMinutos: 30, valorHoraItem: 200, observacao: "so nao faturada" },
  { ...base, id: 3, inicio: "2026-11-12T12:00:00.000Z", fim: "2026-11-12T13:00:00.000Z", forfat: 3, forfatLabel: "Sem Faturamento", faturavel: false, duracaoMinutos: 60, valorHoraItem: 100, codpro: 999, cliente: "Cliente B" },
];

describe("AbaResumoFaturamento", () => {
  it("mostra uma linha por forma de faturamento, horas, valores e o total", () => {
    const out = html(<AbaResumoFaturamento sessoes={SESSOES} podeVerValores loading={false} />);
    expect(out).toContain("Forma de Faturamento");
    expect(out).toContain("Hrs. Fat.");
    expect(out).toContain("Vlr. Fat.");
    expect(out).toContain("Hrs. Não Fat.");
    expect(out).toContain("Vlr. Não Fat.");
    expect(out).toContain("Mediante RAT");
    expect(out).toContain("Sem Faturamento");
    expect(out).toContain("Total");
    // Mediante RAT: 1:30 h faturadas x R$ 200 = 300,00; 0:30 h não faturadas = 100,00; total não faturado = 100,00 + 100,00
    expect(out).toContain("1:30 h");
    expect(out).toContain("300,00");
    expect(out).toContain("200,00");
  });

  it("sem permissão de valores, não mostra nenhuma coluna de valor", () => {
    const out = html(<AbaResumoFaturamento sessoes={SESSOES} podeVerValores={false} loading={false} />);
    expect(out).toContain("Hrs. Fat.");
    expect(out).toContain("Hrs. Não Fat.");
    expect(out).not.toContain("Vlr. Fat.");
    expect(out).not.toContain("Vlr. Não Fat.");
    expect(out).not.toContain("300,00");
  });

  it("sem sessões, mostra a mensagem de vazio", () => {
    const out = html(<AbaResumoFaturamento sessoes={[]} podeVerValores loading={false} />);
    expect(out).toContain("Nenhuma sessão pendente para resumir com os filtros atuais.");
  });
});

describe("links das horas e modal de apontamentos", () => {
  it("as horas diferentes de zero viram link; as zeradas, não", () => {
    const out = html(<AbaResumoFaturamento sessoes={SESSOES} podeVerValores loading={false} />);
    expect(out).toContain("Ver os apontamentos das horas faturadas (Mediante RAT)");
    expect(out).toContain("Ver os apontamentos das horas não faturadas (Mediante RAT)");
    expect(out).toContain("Ver os apontamentos das horas não faturadas (Sem Faturamento)");
    expect(out).toContain("Ver os apontamentos das horas faturadas (todas as formas)");
    // "Sem Faturamento" não tem hora faturada: sem link
    expect(out).not.toContain("Ver os apontamentos das horas faturadas (Sem Faturamento)");
  });

  const modal = (forma: string | null, faturavel: boolean, valores = true) =>
    html(
      <MemoryRouter>
        <ModalApontamentosDoResumo celula={{ forma, faturavel }} sessoes={SESSOES} podeVerValores={valores} onFechar={() => undefined} />
      </MemoryRouter>
    );

  it("o modal lista só os apontamentos que formam a célula, com a soma no subtítulo", () => {
    const out = modal("Mediante RAT", true);
    expect(out).toContain("Apontamentos · Mediante RAT · Horas Faturadas");
    expect(out).toContain("1 apontamento(s) · 1:30 h · R$ 300,00");
    expect(out).toContain("ajuste de regra");
    expect(out).not.toContain("so nao faturada");
    expect(out).toContain("1234");
  });

  it("na linha de Total o modal junta todas as formas", () => {
    const out = modal(null, false);
    expect(out).toContain("Todas as formas · Horas Não Faturadas");
    expect(out).toContain("2 apontamento(s) · 1:30 h · R$ 200,00");
    expect(out).toContain("999");
    expect(out).toContain("Cliente B");
  });

  it("sem permissão de valores o modal não mostra R$ nem colunas de valor", () => {
    const out = modal(null, false, false);
    expect(out).toContain("2 apontamento(s) · 1:30 h");
    // "R$" sozinho aparece no painel de colunas calculadas do kit ("Moeda (R$)"); o que não pode é valor nenhum.
    expect(out).not.toContain("R$ 200,00");
    expect(out).not.toContain(">200,00<");
    expect(out).not.toContain(">100,00<");
    expect(out).not.toContain("Vlr. hora");
    expect(out).not.toContain(">Valor<");
  });
});

describe("coluna de valor médio da hora", () => {
  it("fica entre as horas e o valor, nos dois pares, e mostra o valor ÷ horas", () => {
    const out = html(<AbaResumoFaturamento sessoes={SESSOES} podeVerValores loading={false} />);
    const pos = (t: string) => out.indexOf(`>${t}<`);
    const ordem = ["Hrs. Fat.", "Méd./h Fat.", "Vlr. Fat.", "Hrs. Não Fat.", "Méd./h Não Fat.", "Vlr. Não Fat."].map(pos);
    expect(ordem.every((p) => p >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    // Total não faturado: R$ 200,00 em 1:30 h = R$ 133,33/h
    expect(out).toContain("133,33");
  });

  it("sem permissão de valores, a média não aparece", () => {
    const out = html(<AbaResumoFaturamento sessoes={SESSOES} podeVerValores={false} loading={false} />);
    expect(out).not.toContain("Méd./h");
  });
});
