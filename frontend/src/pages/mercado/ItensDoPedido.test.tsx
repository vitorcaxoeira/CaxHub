import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { ItensDoPedido, type ItemProdutoDto, type ItemServicoDto } from "./ItensDoPedido";

// A tabela guarda a arrumação das colunas por usuário: no teste não há usuário logado.
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

// Normaliza o espaço sem quebra que o Intl pode usar.
const html = (el: JSX.Element) => renderToStaticMarkup(<ToastProvider>{el}</ToastProvider>).replace(/ /g, " ");

const comum = { qtdped: 2, qtdfat: 0, qtdcan: 0, qtdabe: 2, unimed: "UN", moedaSigla: "R$", datent: "2026-11-16T00:00:00.000Z" };
const PRODUTO: ItemProdutoDto = { ...comum, seqipd: 1, codpro: "SI0001", produtoLabel: "Atualização de sistema", codder: null, complemento: "complemento do produto", qtdaen: 2, preuni: 100, vlrliq: 200, sitipdLabel: "Aberto Total", sitipdTone: "warning" };
const SERVICO: ItemServicoDto = { ...comum, seqisp: 1, codser: "SC035", servicoLabel: "Serviço de Consultoria", complemento: "RAT nº 1", qtdrea: 0, preuni: 215, vlrliq: 430, sitispLabel: "Liquidado", sitispTone: "success" };

describe("ItensDoPedido", () => {
  it("mostra as duas abas e abre em Itens de Produto, com os dados do item", () => {
    const out = html(<ItensDoPedido produto={[PRODUTO]} servico={[SERVICO]} />);
    expect(out).toContain("Itens de Produto");
    expect(out).toContain("Itens de Serviço");
    for (const titulo of ["Seq.", "Pedida", "A Entregar", "Faturada", "Cancelada", "Em Aberto", "Preço Unit.", "Valor Líquido", "Entrega", "Situação"]) expect(out).toContain(titulo);
    expect(out).toContain("SI0001");
    expect(out).toContain("complemento do produto");
    expect(out).toContain("R$ 100,00");
    expect(out).toContain("R$ 200,00");
    expect(out).toContain("16/11/2026");
    expect(out).toContain("Aberto Total");
    expect(out).not.toContain("SC035");
  });

  it("pedido que só tem serviço abre direto em Itens de Serviço", () => {
    const out = html(<ItensDoPedido produto={[]} servico={[SERVICO]} />);
    expect(out).toContain("Realizada");
    expect(out).toContain("SC035");
    expect(out).toContain("R$ 215,00");
    expect(out).toContain("R$ 430,00");
    expect(out).toContain("Liquidado");
    expect(out).not.toContain("A Entregar");
  });

  it("pedido sem item nenhum fica em Produto com a mensagem de vazio", () => {
    expect(html(<ItensDoPedido produto={[]} servico={[]} />)).toContain("Nenhum item de produto neste pedido.");
  });

  it("campo que ainda não veio do sync aparece como traço", () => {
    const out = html(<ItensDoPedido produto={[]} servico={[{ ...SERVICO, unimed: null, datent: null, qtdrea: null, vlrliq: null }]} />);
    expect(out).toContain("—");
    expect(out).not.toContain("31/12/1969");
  });
});
