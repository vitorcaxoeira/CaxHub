import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { Home } from "../Home";
import { colunasProvisionamento, mesCorrente, OCULTO, type LinhaProvisionamento } from "./AbaProvisionamento";

const usuario = { atual: { id: 1, nome: "Fulano", role: "admin" } };
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: usuario.atual }) }));

const LINHA: LinhaProvisionamento = {
  chave: "1-505",
  codemp: 1,
  codfor: 505,
  consultor: "Consultor Teste",
  departamento: "Consultoria ERP",
  contrato: "Hora",
  valorHora: 105.39,
  fixoMensal: null,
  minutosAteHoje: 9854,
  deslocamentoMinutos: 90,
  deslocamentoValor: 79.04,
  realizado: 17387.9,
  projecao: 19000,
  ferias: 0,
  feriasAteAgora: 0,
  bonificacao: 100,
  descontos: 250.5,
  descontosPrevistos: true,
  liquidoAteAgora: 17237.4,
  liquidoProjetado: 18849.5,
  mesAnterior: 17359.1,
};

const celula = (visivel: boolean, nome: string, linha: LinhaProvisionamento = LINHA) =>
  renderToStaticMarkup(<>{colunasProvisionamento(visivel).find((c) => c.nome === nome)!.render(linha, undefined, false)}</>).replace(/ /g, " ");

describe("aba Provisionamento", () => {
  it("colunas na ordem da nota do mês: o valor a provisionar e, depois dele, o do mês anterior", () => {
    expect(colunasProvisionamento(true).map((c) => c.titulo)).toEqual([
      "Consultor", "Departamento", "Contrato", "Valor/hora", "Fixo mensal", "Horas", "Desloc. (h)", "Desloc. (R$)",
      "Realizado", "Projeção", "Férias", "Bonificação", "Descontos", "Líquido até agora", "A provisionar", "Mês Anterior",
    ]);
  });

  it("com os valores ocultos nenhum R$ aparece, nem no resumo nem no funil; nomes e horas continuam", () => {
    for (const nome of ["valorHora", "realizado", "projecao", "bonificacao", "liquidoAteAgora", "liquidoProjetado", "mesAnterior"]) expect(celula(false, nome)).toBe(OCULTO);
    expect(celula(false, "descontos")).toContain(OCULTO);
    expect(celula(false, "descontos")).not.toContain("250,50");
    for (const c of colunasProvisionamento(false)) {
      if (["consultor", "departamento", "contrato", "minutosAteHoje", "deslocamentoMinutos"].includes(c.nome)) continue;
      expect(c.formatarResumo!(1234.5)).toBe(OCULTO);
      expect(c.formatarValor!(1234.5)).toBe(OCULTO);
    }
    expect(celula(false, "consultor")).toContain("Consultor Teste");
    expect(celula(false, "minutosAteHoje")).toBe("164:14");
  });

  it("visível: moeda, desconto negativo com 'previsto' e campo sem valor como traço", () => {
    expect(celula(true, "realizado")).toBe("R$ 17.387,90");
    expect(celula(true, "liquidoProjetado")).toBe("R$ 18.849,50");
    expect(celula(true, "mesAnterior")).toBe("R$ 17.359,10");
    expect(celula(true, "descontos")).toContain("−R$ 250,50");
    expect(celula(true, "descontos")).toContain("previsto");
    expect(celula(true, "descontos", { ...LINHA, descontos: 0 })).not.toContain("previsto");
    expect(celula(true, "fixoMensal")).toBe("—");
    expect(celula(true, "contrato")).toContain("Hora");
  });

  it("mês corrente no relógio local", () => {
    expect(mesCorrente(new Date(2026, 10, 30, 23, 30))).toBe("2026-11");
  });
});

describe("abas da Home", () => {
  const home = (rota: string) =>
    renderToStaticMarkup(
      <ToastProvider>
        <MemoryRouter initialEntries={[rota]}>
          <Home />
        </MemoryRouter>
      </ToastProvider>
    );

  it("admin vê Principal e Provisionamento; a aba vem da URL", () => {
    usuario.atual = { id: 1, nome: "Admin", role: "admin" };
    const principal = home("/");
    expect(principal).toContain("Principal");
    expect(principal).toContain("Provisionamento");
    expect(principal).not.toContain('aria-label="Competência"');
    expect(home("/?aba=provisionamento")).toContain('aria-label="Competência"');
  });

  it("consultor comum não vê abas, nem pela URL", () => {
    usuario.atual = { id: 2, nome: "Consultor", role: "consultoria" };
    const out = home("/?aba=provisionamento");
    expect(out).not.toContain("Provisionamento");
    expect(out).not.toContain('aria-label="Competência"');
    expect(out).toContain("Bem-vindo");
  });
});
