import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { reprocessar, processarFilaSincronizacao } from "../sync/outboxSenior";

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

// "Enviar para o Senior" na tela — não é só reagendar pro cron de 15 em 15 min: reseta
// tentativas/status E já tenta enviar na hora (mesmo disparo imediato que a confirmação de
// apontamento usa, restrito a este item via `apenasId`). Item que falhar de novo volta pro
// estado de erro normal (pendente ou bloqueado, conforme as tentativas) — a lista recarrega
// e mostra o resultado, sem precisar de resposta especial aqui.
sincronizacaoRouter.post("/:id/reprocessar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    await reprocessar(id);
    await processarFilaSincronizacao({ apenasId: id });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "reprocessar");
  }
});
