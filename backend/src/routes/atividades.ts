import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel, priproLabel } from "../domain/propostasDominio";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";

// Router à parte de `projetosRouter` (que hoje é admin+comercial só, por causa de
// Propostas) — aqui a tela é aberta a qualquer usuário autenticado; quem pode ver/mover
// cada atividade é decidido caso a caso por `podeExecutarAcao` (ação, não tela).
export const atividadesRouter = Router();
atividadesRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[atividades:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role };
}

atividadesRouter.get("/quadro-colunas", async (_req, res) => {
  try {
    const colunas = await prisma.quadroColuna.findMany({ orderBy: { ordem: "asc" } });
    res.json({ colunas });
  } catch (error) {
    handleError(res, error, "quadro-colunas");
  }
});

atividadesRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    const [atividades, primeiraColuna] = await Promise.all([
      prisma.atividadeConsultor.findMany({
        where: { sitreg: "A" },
        include: { coluna: true },
        orderBy: { id: "asc" },
      }),
      prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } }),
    ]);

    const chavesItem = atividades.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite }));
    const itens =
      chavesItem.length > 0
        ? await prisma.propostaItem.findMany({
            where: { OR: chavesItem },
            select: { codemp: true, codpro: true, seqite: true, depexe: true },
          })
        : [];
    const depexePorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i.depexe]));

    const chavesPropostaUnicas = [...new Set(atividades.map((a) => `${a.codemp}-${a.codpro}`))];
    const propostas =
      chavesPropostaUnicas.length > 0
        ? await prisma.proposta.findMany({
            where: {
              OR: chavesPropostaUnicas.map((chave) => {
                const [codemp, codpro] = chave.split("-").map(Number);
                return { codemp, codpro };
              }),
            },
            include: { cliente: true },
          })
        : [];
    const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    const codforUnicos = [...new Set(atividades.map((a) => a.codfor))];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

    const rows = atividades
      .map((a) => {
        const depexe = depexePorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`);
        const proposta = propostaPorChave.get(`${a.codemp}-${a.codpro}`);
        // Sem item/proposta correspondente (órfão) — não dá pra saber departamento/cliente, não exibe.
        if (depexe == null || !proposta) return null;

        if (!podeExecutarAcao(role, contexto, "visualizar", { depexe, codfor: a.codfor })) return null;

        const consultor = consultorPorCodfor.get(a.codfor);
        return {
          id: a.id,
          codemp: a.codemp,
          codpro: a.codpro,
          seqite: a.seqite,
          numprj: proposta.numprj,
          cliente: proposta.cliente.nomcli,
          pripro: proposta.pripro,
          priproLabel: priproLabel(proposta.pripro),
          datval: proposta.datval,
          depexe,
          depexeLabel: depexeLabel(depexe),
          consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${a.codfor}`,
          qtdhorPrevisto: a.qtdhor,
          colunaId: a.colunaId ?? primeiraColuna?.id ?? null,
          coluna: a.coluna ?? primeiraColuna ?? null,
          podeMover: podeExecutarAcao(role, contexto, "mover", { depexe, codfor: a.codfor }),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    res.json({
      rows,
      contexto: {
        role,
        departamentosGerenciados: contexto.departamentosGerenciados,
        departamentosTime: contexto.departamentosTime,
      },
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

atividadesRouter.patch("/:id/mover", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const colunaIdNovo = Number(req.body?.colunaId);
    if (!Number.isFinite(colunaIdNovo)) {
      res.status(400).json({ error: "colunaId é obrigatório" });
      return;
    }

    const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
    if (!atividade) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }

    const colunaNova = await prisma.quadroColuna.findUnique({ where: { id: colunaIdNovo } });
    if (!colunaNova) {
      res.status(400).json({ error: "Coluna não encontrada" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({
      where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
    });
    if (!item || item.depexe == null) {
      res.status(400).json({ error: "Item de proposta correspondente não encontrado" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "mover", { depexe: item.depexe, codfor: atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para mover esta atividade" });
      return;
    }

    const [atividadeAtualizada] = await prisma.$transaction([
      prisma.atividadeConsultor.update({ where: { id }, data: { colunaId: colunaIdNovo } }),
      prisma.atividadeHistoricoMovimentacao.create({
        data: {
          atividadeId: id,
          colunaAnteriorId: atividade.colunaId,
          colunaNovaId: colunaIdNovo,
          userId: user.id,
        },
      }),
    ]);

    res.json({ id: atividadeAtualizada.id, colunaId: atividadeAtualizada.colunaId });
  } catch (error) {
    handleError(res, error, "mover");
  }
});
