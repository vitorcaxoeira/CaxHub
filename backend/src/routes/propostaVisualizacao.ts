import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  depexeLabel,
  modproLabel,
  sisproLabel,
  tipvenLabel,
  claproLabel,
  priproLabel,
  tipprjLabel,
  frmprjLabel,
  sitmotLabel,
  sitproLabel,
  sitproTone,
  forfatLabel,
  forateLabel,
  simNaoLabel,
  fatserLabel,
  sitprzLabel,
} from "../domain/propostasDominio";

// Tela de visualização somente-leitura de uma proposta — pensada pra ser aberta a
// partir de qualquer lugar do CaxHub que já mostra um número de proposta (hoje: lista
// de Alocação de Atividades), sem repetir a modelagem/rbac específica de cada tela de
// origem. Não tem ação de escrita, então não precisa de restrição de papel além de
// estar autenticado — os dados aqui já são visíveis em outras telas (Pipeline
// Comercial, Alocação) pros papéis que acessam essas telas.
export const propostaVisualizacaoRouter = Router();
propostaVisualizacaoRouter.use(requireAuth);

function nomeCliente(cliente: { codcli: number; nomcli: string } | null): string | null {
  if (!cliente) return null;
  return `${cliente.codcli} - ${cliente.nomcli}`;
}

// Vários campos de texto livre do Senior vêm preenchidos só com espaço (" ") em vez de
// nulo quando "vazios" — sem isso, a tela mostraria seções/linhas em branco.
function textoOuNulo(valor: string | null): string | null {
  if (valor == null) return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

propostaVisualizacaoRouter.get("/:codemp/:codpro", async (req, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "codemp/codpro inválidos" });
      return;
    }

    const proposta = await prisma.proposta.findUnique({
      where: { codemp_codpro: { codemp, codpro } },
      include: { cliente: true },
    });
    if (!proposta) {
      res.status(404).json({ error: "Proposta não encontrada" });
      return;
    }

    const [clienteFaturamento, representante, centroCusto, itens] = await Promise.all([
      proposta.clifat != null ? prisma.cliente.findUnique({ where: { codcli: proposta.clifat } }) : null,
      prisma.representante.findUnique({ where: { codrep: proposta.codrep } }),
      proposta.codccu != null
        ? prisma.centroCusto.findUnique({ where: { codemp_codccu: { codemp, codccu: proposta.codccu } } })
        : null,
      prisma.propostaItem.findMany({ where: { codemp, codpro }, orderBy: { seqite: "asc" } }),
    ]);

    const itensResp = itens.map((item) => {
      const horas = (item.qtdhor ?? 0) / 60;
      const valhor = item.valhor != null ? Number(item.valhor) : 0;
      return {
        seqite: item.seqite,
        codser: item.codser,
        despro: textoOuNulo(item.despro),
        entpro: textoOuNulo(item.entpro),
        depexeLabel: depexeLabel(item.depexe),
        qtdhor: item.qtdhor,
        valhor,
        valorTotal: horas * valhor,
        fatserLabel: fatserLabel(item.fatser),
        sitprzLabel: sitprzLabel(item.sitprz),
      };
    });

    const totais = itensResp.reduce(
      (acc, item) => ({
        horas: acc.horas + (item.qtdhor ?? 0),
        valor: acc.valor + item.valorTotal,
      }),
      { horas: 0, valor: 0 }
    );

    res.json({
      proposta: {
        codemp: proposta.codemp,
        codpro: proposta.codpro,
        numprj: proposta.numprj,
        cliente: nomeCliente(proposta.cliente),
        clienteFaturamento: nomeCliente(clienteFaturamento),
        despro: textoOuNulo(proposta.despro),
        dessol: textoOuNulo(proposta.dessol),
        consol: textoOuNulo(proposta.consol),
        sitproLabel: sitproLabel(proposta.sitpro),
        sitproTone: sitproTone(proposta.sitpro),
        depexeLabel: depexeLabel(proposta.depexe),
        modproLabel: modproLabel(proposta.modpro),
        sisproLabel: sisproLabel(proposta.sispro),
        tipvenLabel: tipvenLabel(proposta.tipven),
        claproLabel: claproLabel(proposta.clapro),
        priproLabel: priproLabel(proposta.pripro),
        tipprjLabel: tipprjLabel(proposta.tipprj),
        frmprjLabel: frmprjLabel(proposta.frmprj),
        sitmotLabel: sitmotLabel(proposta.sitmot),
        forateLabel: forateLabel(proposta.forate),
        forfatLabel: forfatLabel(proposta.forfat),
        obrfasLabel: simNaoLabel(proposta.obrfas),
        exipedcliLabel: simNaoLabel(proposta.exipedcli),
        liqbruLabel: simNaoLabel(proposta.liqbru),
        pedcli: textoOuNulo(proposta.pedcli),
        dscfpg: textoOuNulo(proposta.dscfpg),
        prarea: textoOuNulo(proposta.prarea),
        datpro: proposta.datpro,
        datenv: proposta.datenv,
        datret: proposta.datret,
        datval: proposta.datval,
        preent: proposta.preent,
        representanteNome: representante ? `${representante.codrep} - ${representante.nomrep}` : null,
        centroCustoNome: centroCusto ? `${centroCusto.codccu} - ${centroCusto.desccu}` : null,
        qtdhor: proposta.qtdhor,
        numped: proposta.numped,
        codlev2: proposta.codlev2,
        obssit: textoOuNulo(proposta.obssit),
        obspro: textoOuNulo(proposta.obspro),
        hispro: textoOuNulo(proposta.hispro),
      },
      itens: itensResp,
      totais,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[proposta-visualizacao]", message);
    res.status(500).json({ error: message });
  }
});
