import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { reprocessar } from "../sync/outboxSenior";

// Painel de administração da fila de sincronização CaxHub -> Senior (outbox). Só admin,
// já que é uma tela operacional/infra, não de negócio.
export const sincronizacaoRouter = Router();
sincronizacaoRouter.use(requireAuth, requireRole("admin"));

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sincronizacao:${label}]`, message);
  res.status(500).json({ error: message });
}

sincronizacaoRouter.get("/", async (_req, res) => {
  try {
    const itens = await prisma.sincronizacaoPendente.findMany({
      orderBy: { criadoEm: "desc" },
      take: 200,
      include: { atividade: { select: { codpro: true, seqite: true, codemp: true } } },
    });
    res.json({
      itens: itens.map((i) => ({
        id: i.id,
        atividadeId: i.atividadeId,
        codpro: i.atividade.codpro,
        tipo: i.tipo,
        payload: i.payload,
        status: i.status,
        tentativas: i.tentativas,
        ultimoErro: i.ultimoErro,
        criadoEm: i.criadoEm,
        processadoEm: i.processadoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

sincronizacaoRouter.post("/:id/reprocessar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    await reprocessar(id);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "reprocessar");
  }
});
