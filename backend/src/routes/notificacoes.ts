import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const notificacoesRouter = Router();
notificacoesRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[notificacoes:${label}]`, message);
  res.status(500).json({ error: message });
}

notificacoesRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const notificacoes = await prisma.notificacao.findMany({
      where: { userId: req.user!.userId },
      orderBy: { criadoEm: "desc" },
      take: 50,
    });
    const naoLidas = await prisma.notificacao.count({ where: { userId: req.user!.userId, lida: false } });
    res.json({ notificacoes, naoLidas });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

notificacoesRouter.patch("/:id/lida", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const notificacao = await prisma.notificacao.findUnique({ where: { id } });
    if (!notificacao || notificacao.userId !== req.user!.userId) {
      res.status(404).json({ error: "Notificação não encontrada" });
      return;
    }
    await prisma.notificacao.update({ where: { id }, data: { lida: true } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "marcar-lida");
  }
});

notificacoesRouter.patch("/marcar-todas-lidas", async (req: AuthenticatedRequest, res) => {
  try {
    await prisma.notificacao.updateMany({ where: { userId: req.user!.userId, lida: false }, data: { lida: true } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "marcar-todas-lidas");
  }
});
