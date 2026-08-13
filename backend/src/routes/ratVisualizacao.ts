import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { sitratLabel, sitratTone } from "../domain/ratDominio";
import { sitproLabel, sitproTone } from "../domain/propostasDominio";
import { resolverContextoConsultor } from "../domain/contextoProjeto";
import { simNaoLabel, tipdesLabel, moddesLabel } from "../domain/rdvDominio";

// Tela de visualização somente-leitura de uma RAT — mesmo espírito de
// propostaVisualizacao.ts/pedidoVisualizacao.ts, mas sem restrição de papel: a
// visibilidade aqui segue a mesma regra de backend/src/routes/rats.ts (só a própria
// RAT, a do time gerenciado, ou tudo pra admin), já que RAT é dado sensível por
// consultor — diferente de Proposta/Pedido, que qualquer autenticado pode abrir.
export const ratVisualizacaoRouter = Router();
ratVisualizacaoRouter.use(requireAuth);

function podeVerRat(
  role: string,
  contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>,
  rat: { codfor: number; depexe: number | null }
): boolean {
  if (role === "admin") return true;
  if (contexto.consultor?.codfor === rat.codfor) return true;
  return rat.depexe != null && contexto.departamentosGerenciados.includes(rat.depexe);
}

ratVisualizacaoRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const contexto = await resolverContextoConsultor(user.email);
    const role = req.user!.role as string;

    const rat = await prisma.rat.findUnique({ where: { id } });
    if (!rat || !podeVerRat(role, contexto, rat)) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }

    const [cliente, proposta, consultor, itens, despesasViagem] = await Promise.all([
      rat.codcli != null ? prisma.cliente.findUnique({ where: { codcli: rat.codcli } }) : null,
      rat.codpro != null
        ? prisma.proposta.findUnique({ where: { codemp_codpro: { codemp: rat.codemp, codpro: rat.codpro } } })
        : null,
      prisma.consultor.findFirst({ where: { codemp: rat.codemp, codfor: rat.codfor } }),
      prisma.ratItem.findMany({ where: { ratId: id }, orderBy: { id: "asc" } }),
      // Só existe despesa de viagem depois que o Senior confirma a RAT (RegistroDespesaViagem
      // casa por codemp+numrat, igual RatItem.numrat — enquanto isso é null não há o que buscar).
      rat.numrat != null
        ? prisma.registroDespesaViagem.findMany({
            where: { codemp: rat.codemp, numrat: rat.numrat },
            // `seqrdv` fica NULL numa despesa lançada pelo CaxHub e ainda não confirmada
            // pelo Senior (ver comentário do model) — ordenar por ele deixaria essas linhas
            // numa posição arbitrária. Data + id (ordem de chegada) é estável nos dois casos.
            orderBy: [{ datemi: "asc" }, { id: "asc" }],
          })
        : [],
    ]);

    const chavesItem = itens
      .filter((i): i is typeof i & { seqite: number } => i.seqite != null && i.codpro != null)
      .map((i) => ({ codemp: i.codemp, codpro: i.codpro!, seqite: i.seqite }));
    const propostaItens = chavesItem.length > 0 ? await prisma.propostaItem.findMany({ where: { OR: chavesItem } }) : [];
    const itemPorChave = new Map(propostaItens.map((pi) => [`${pi.codemp}-${pi.codpro}-${pi.seqite}`, pi]));

    res.json({
      rat: {
        id: rat.id,
        codemp: rat.codemp,
        numrat: rat.numrat,
        numprj: rat.numprj,
        cliente: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : null,
        codpro: rat.codpro,
        propostaSitproLabel: proposta ? sitproLabel(proposta.sitpro) : null,
        propostaSitproTone: proposta ? sitproTone(proposta.sitpro) : null,
        consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${rat.codfor}`,
        datemi: rat.datemi,
        dataApr: rat.dataApr,
        sitratLabel: sitratLabel(rat.sitrat),
        sitratTone: sitratTone(rat.sitrat),
        obsrat: rat.obsrat?.trim() || null,
        origemCaxHub: rat.origemCaxHub,
      },
      itens: itens.map((item) => {
        const propostaItem =
          item.seqite != null && item.codpro != null ? itemPorChave.get(`${item.codemp}-${item.codpro}-${item.seqite}`) : undefined;
        return {
          id: item.id,
          codser: propostaItem?.codser ?? null,
          itemDescricao: propostaItem?.despro ?? null,
          datati: item.datati,
          horini: item.horini,
          horfim: item.horfim,
          duracaoMinutos: item.horini != null && item.horfim != null ? item.horfim - item.horini : null,
          desati: item.desati,
          confirmadoNoSenior: item.numrat != null,
        };
      }),
      despesasViagem: despesasViagem.map((d) => ({
        id: d.id,
        datemi: d.datemi,
        desrdv: d.desrdv?.trim() || null,
        tipdesLabel: tipdesLabel(d.tipdes),
        moddesLabel: d.moddes != null ? moddesLabel(d.moddes) : null,
        qtdrdv: d.qtdrdv,
        vlrunt: d.vlrunt,
        vlrtot: d.vlrtot,
        fatrdvLabel: simNaoLabel(d.fatrdv),
        pendenteDeEnvio: d.origemCaxHub && d.enviadoEmSenior == null,
      })),
      totalDespesasViagem: despesasViagem.reduce((soma, d) => soma + Number(d.vlrtot ?? 0), 0),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[rat-visualizacao]", message);
    res.status(500).json({ error: message });
  }
});
