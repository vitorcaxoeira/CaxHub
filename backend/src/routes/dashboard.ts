import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel } from "../domain/propostasDominio";
import { resolverContextoConsultor } from "../domain/contextoProjeto";

export const dashboardRouter = Router();

dashboardRouter.get("/ping", requireAuth, (req, res) => {
  res.json({ ok: true, message: "Dashboard API online" });
});

// Casa o e-mail do usuário logado com a tabela de consultores (view USU_VBI00Cons do
// Senior) pra personalizar as boas-vindas e, se ele for gestor de algum departamento
// executor (USU_TDepExeCfg), listar os departamentos e o time de cada um (USU_TDepExeTim).
dashboardRouter.get("/meu-perfil", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const contexto = await resolverContextoConsultor(user.email);
    const { consultor } = contexto;

    if (!consultor) {
      res.json({ consultor: null, departamentosGerenciados: [] });
      return;
    }

    const departamentosGerenciados = await Promise.all(
      contexto.departamentosGerenciados
        .slice()
        .sort((a, b) => a - b)
        .map(async (depexe) => {
          const integrantes = await prisma.departamentoTime.findMany({
            where: { codemp: consultor.codemp, depexe, sitreg: "A" },
          });
          const codusuList = integrantes.map((i) => Number(i.codusu));
          const consultoresDoTime = await prisma.consultor.findMany({
            where: { codemp: consultor.codemp, codusu: { in: codusuList } },
          });
          const nomeParaCodusu = new Map(
            consultoresDoTime.map((c) => [c.codusu, c.nomcom ?? c.nomfor ?? `Usuário ${c.codusu}`])
          );

          return {
            depexe,
            depexeLabel: depexeLabel(depexe),
            integrantes: codusuList
              .map((codusu) => ({ codusu, nome: nomeParaCodusu.get(codusu) ?? `Usuário ${codusu}` }))
              .sort((a, b) => a.nome.localeCompare(b.nome)),
          };
        })
    );

    res.json({
      consultor: {
        nome: consultor.nomcom ?? consultor.nomfor ?? user.nome,
        depexe: consultor.depexe,
        depexeLabel: depexeLabel(consultor.depexe),
      },
      departamentosGerenciados,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dashboard:meu-perfil]", message);
    res.status(500).json({ error: message });
  }
});
