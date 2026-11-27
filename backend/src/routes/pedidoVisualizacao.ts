import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { sitpedLabel, sitpedTone, tippedLabel, prcpedLabel } from "../domain/pedidoDominio";
import { forfatLabel, sitproLabel, sitproTone } from "../domain/propostasDominio";
import { resolverRatEProposta, resolverFormaECondicaoPagamento } from "./pedidos";

// Tela de visualização somente-leitura de um Pedido — mesmo espírito de
// propostaVisualizacao.ts, só que restrita a admin (mesma regra do resto de
// backend/src/routes/pedidos.ts, já que hoje o único ponto de entrada é a tela
// Mercado > Listar Pedidos, admin-only).
export const pedidoVisualizacaoRouter = Router();
pedidoVisualizacaoRouter.use(requireAuth, requireRole("admin"));

// Vários campos de texto livre do Senior vêm preenchidos só com espaço (" ") em vez de
// nulo quando "vazios" — mesmo comportamento já visto no pedidoSync (obsmot é quase
// sempre " ") — sem isso, a tela mostraria a seção de Observações em branco.
function textoOuNulo(valor: string | null): string | null {
  if (valor == null) return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

const numero = (valor: { toString(): string } | null): number | null => (valor == null ? null : Number(valor));

// Itens do pedido (E120IPD e E120ISP) com a descrição do cadastro e o símbolo da moeda de cada item (o campo é por item no Senior).
// Item removido no Senior fica de fora; se o PEDIDO inteiro foi removido, mostra o último retrato dos itens (mesma ideia do cabeçalho).
async function itensDoPedido(codemp: number, codfil: number, numped: number, pedidoRemovido: boolean) {
  const where = { codemp, codfil, numped, ...(pedidoRemovido ? {} : { removidoEmSenior: null }) };
  const [produtoLinhas, servicoLinhas] = await Promise.all([
    prisma.pedidoItemProduto.findMany({ where, orderBy: { seqipd: "asc" } }),
    prisma.pedidoItemServico.findMany({ where, orderBy: { seqisp: "asc" } }),
  ]);

  const unicos = (valores: (string | null)[]) => [...new Set(valores.filter((v): v is string => textoOuNulo(v) != null))];
  const [produtos, servicos, moedas] = await Promise.all([
    prisma.produto.findMany({ where: { codemp, codpro: { in: unicos(produtoLinhas.map((i) => i.codpro)) } }, select: { codpro: true, despro: true } }),
    prisma.servico.findMany({ where: { codemp, codser: { in: unicos(servicoLinhas.map((i) => i.codser)) } }, select: { codser: true, desser: true } }),
    prisma.moeda.findMany({ where: { codmoe: { in: unicos([...produtoLinhas, ...servicoLinhas].map((i) => i.codmoe)) } }, select: { codmoe: true, sigmoe: true } }),
  ]);
  const descricaoProduto = new Map(produtos.map((p) => [p.codpro, p.despro]));
  const descricaoServico = new Map(servicos.map((s) => [s.codser, s.desser]));
  const sigla = new Map(moedas.map((m) => [m.codmoe, m.sigmoe]));
  const rotulo = (codigo: string | null, descricoes: Map<string, string>) => (codigo != null ? descricoes.get(codigo) ?? codigo : "—");
  // 31/12/1900 é o "sem data" do Senior.
  const dataOuNula = (data: Date | null) => (data == null || data.getUTCFullYear() <= 1900 ? null : data);

  return {
    produto: produtoLinhas.map((i) => ({
      seqipd: i.seqipd,
      codpro: i.codpro,
      produtoLabel: rotulo(i.codpro, descricaoProduto),
      codder: textoOuNulo(i.codder),
      complemento: textoOuNulo(i.cplipd),
      qtdped: Number(i.qtdped),
      qtdaen: numero(i.qtdaen),
      qtdfat: numero(i.qtdfat),
      qtdcan: numero(i.qtdcan),
      qtdabe: numero(i.qtdabe),
      unimed: textoOuNulo(i.unimed),
      preuni: numero(i.preuni),
      moedaSigla: i.codmoe != null ? sigla.get(i.codmoe) ?? null : null,
      vlrliq: numero(i.vlrliq),
      datent: dataOuNula(i.datent),
      sitipdLabel: sitpedLabel(i.sitipd),
      sitipdTone: sitpedTone(i.sitipd),
    })),
    servico: servicoLinhas.map((i) => ({
      seqisp: i.seqisp,
      codser: i.codser,
      servicoLabel: rotulo(i.codser, descricaoServico),
      complemento: textoOuNulo(i.cplisp),
      qtdped: Number(i.qtdped),
      qtdrea: numero(i.qtdrea),
      qtdfat: numero(i.qtdfat),
      qtdcan: numero(i.qtdcan),
      qtdabe: numero(i.qtdabe),
      unimed: textoOuNulo(i.unimed),
      preuni: Number(i.preuni),
      moedaSigla: i.codmoe != null ? sigla.get(i.codmoe) ?? null : null,
      vlrliq: numero(i.vlrliq),
      datent: dataOuNula(i.datent),
      sitispLabel: sitpedLabel(i.sitisp),
      sitispTone: sitpedTone(i.sitisp),
    })),
  };
}

pedidoVisualizacaoRouter.get("/:codemp/:codfil/:numped", async (req, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codfil = Number(req.params.codfil);
    const numped = Number(req.params.numped);
    if (!Number.isFinite(codemp) || !Number.isFinite(codfil) || !Number.isFinite(numped)) {
      res.status(400).json({ error: "codemp/codfil/numped inválidos" });
      return;
    }

    // Sem filtro de `removidoEmSenior` aqui, diferente das listagens: quem chega nesta
    // tela veio de um link direto e transformar isso em 404 esconderia a informação mais
    // útil, que é "este pedido existia e sumiu do ERP". O registro vem normalmente, com a
    // data de remoção, e a tela mostra uma tarja.
    const pedido = await prisma.pedido.findUnique({ where: { codemp_codfil_numped: { codemp, codfil, numped } } });
    if (!pedido) {
      res.status(404).json({ error: "Pedido não encontrado" });
      return;
    }

    const [cliente, { ratPorChave, propostaPorChave }, { formaPagamentoPorChave, condicaoPagamentoPorChave }, itens] = await Promise.all([
      prisma.cliente.findUnique({ where: { codcli: pedido.codcli } }),
      resolverRatEProposta([pedido]),
      resolverFormaECondicaoPagamento([pedido]),
      itensDoPedido(codemp, codfil, numped, pedido.removidoEmSenior != null),
    ]);

    const rat = pedido.numrat != null ? ratPorChave.get(`${pedido.codemp}-${Number(pedido.numrat)}`) : undefined;
    const proposta = rat?.codpro != null ? propostaPorChave.get(`${rat.codemp}-${rat.codpro}`) : undefined;
    const formaPagamento = pedido.codfpg != null ? formaPagamentoPorChave.get(`${pedido.codemp}-${pedido.codfpg}`) : undefined;
    const condicaoPagamento = condicaoPagamentoPorChave.get(`${pedido.codemp}-${pedido.codcpg}`);

    res.json({
      pedido: {
        codemp: pedido.codemp,
        codfil: pedido.codfil,
        numped: pedido.numped,
        cliente: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : String(pedido.codcli),
        sitpedLabel: sitpedLabel(pedido.sitped),
        sitpedTone: sitpedTone(pedido.sitped),
        tippedLabel: tippedLabel(pedido.tipped),
        prcpedLabel: prcpedLabel(pedido.prcped),
        tnspro: textoOuNulo(pedido.tnspro),
        tnsser: textoOuNulo(pedido.tnsser),
        datemi: pedido.datemi,
        horemi: pedido.horemi,
        datprv: pedido.datprv,
        vlrliq: pedido.vlrliq != null ? Number(pedido.vlrliq) : null,
        formaPagamentoLabel: formaPagamento?.desfpg ?? null,
        condicaoPagamentoLabel: condicaoPagamento?.descpg ?? null,
        numrat: pedido.numrat != null ? pedido.numrat.toString() : null,
        ratId: rat?.id ?? null,
        propostaCodpro: rat?.codpro ?? null,
        propostaSitproLabel: proposta ? sitproLabel(proposta.sitpro) : null,
        propostaSitproTone: proposta ? sitproTone(proposta.sitpro) : null,
        faturamentoLabel: proposta ? forfatLabel(proposta.forfat) : null,
        faturamentoRdvLabel: proposta ? forfatLabel(proposta.forfatrdv) : null,
        obsped: textoOuNulo(pedido.obsped),
        obsmot: textoOuNulo(pedido.obsmot),
        pedcli: textoOuNulo(pedido.pedcli),
        // null = pedido vivo no Senior. Preenchido = sumiu de lá e já não aparece nas
        // listagens; os dados abaixo são o último retrato conhecido.
        removidoEmSenior: pedido.removidoEmSenior,
      },
      itensProduto: itens.produto,
      itensServico: itens.servico,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[pedido-visualizacao]", message);
    res.status(500).json({ error: message });
  }
});
