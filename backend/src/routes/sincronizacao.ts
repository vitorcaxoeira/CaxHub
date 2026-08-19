import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { reprocessar, processarFilaSincronizacao, previewEnvioSenior } from "../sync/outboxSenior";

// Painel de administração da fila de sincronização CaxHub -> Senior (outbox). Só admin,
// já que é uma tela operacional/infra, não de negócio.
export const sincronizacaoRouter = Router();
sincronizacaoRouter.use(requireAuth, requireRole("admin"));

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sincronizacao:${label}]`, message);
  res.status(500).json({ error: message });
}

// Lista separada por vírgula ("criar_atividade,editar_atividade") -> array de números,
// descartando o que não converte. Mesmo espírito de parseStringListParam em auditoria.ts,
// só que pra número (usado no filtro de Proposta).
function parseIntListParam(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const numeros = value
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n));
  return numeros.length > 0 ? numeros : null;
}

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const itens = value.split(",").filter((v) => v !== "");
  return itens.length > 0 ? itens : null;
}

// Situações possíveis de SincronizacaoPendente.status (ver model no schema.prisma).
const STATUS_VALIDOS = ["pendente", "enviando", "enviado", "bloqueado", "invalido"] as const;

// GET / — lista paginada, com filtro de situação (um valor, vem do clique num KPI da tela),
// tipo (multi-select) e proposta (lista de números). `codpro` não é coluna própria desta
// tabela — vem de AtividadeConsultor.codpro pela relação já incluída abaixo, por isso o
// filtro é via `atividade: { codpro: { in } }`.
sincronizacaoRouter.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const status =
      typeof req.query.status === "string" && (STATUS_VALIDOS as readonly string[]).includes(req.query.status)
        ? req.query.status
        : null;
    const tipos = parseStringListParam(req.query.tipo);
    const codpros = parseIntListParam(req.query.codpro);

    const where: Prisma.SincronizacaoPendenteWhereInput = {};
    if (status) where.status = status;
    if (tipos) where.tipo = { in: tipos };
    if (codpros) where.atividade = { codpro: { in: codpros } };

    const [total, itens] = await Promise.all([
      prisma.sincronizacaoPendente.count({ where }),
      prisma.sincronizacaoPendente.findMany({
        where,
        orderBy: { criadoEm: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { atividade: { select: { codpro: true, seqite: true, codemp: true } } },
      }),
    ]);

    res.json({
      total,
      itens: itens.map((i) => ({
        id: i.id,
        atividadeId: i.atividadeId,
        codemp: i.atividade.codemp,
        codpro: i.atividade.codpro,
        seqite: i.atividade.seqite,
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

// Totais por situação da fila INTEIRA, sem nenhum filtro da tela — mesma decisão já tomada
// em GET /pedidos/indicadores: o KPI mostra sempre o todo, só a lista abaixo dele reage aos
// filtros. Carregado uma vez pela tela, não a cada mudança de filtro.
sincronizacaoRouter.get("/indicadores", async (_req, res) => {
  try {
    const grupos = await prisma.sincronizacaoPendente.groupBy({ by: ["status"], _count: true });
    const totais: Record<string, number> = { pendente: 0, enviando: 0, enviado: 0, bloqueado: 0, invalido: 0 };
    for (const g of grupos) {
      if (g.status in totais) totais[g.status] = g._count;
    }
    res.json(totais);
  } catch (error) {
    handleError(res, error, "indicadores");
  }
});

// Prévia do que seria de fato enviado ao Senior agora, sem enviar nada — relê o dado vivo
// (mesma fonte que o envio real usa), nunca a coluna `payload` (que é só um retrato interno
// tirado no momento em que a pendência foi criada). É o que a tela usa pra mostrar o XML de
// verdade em "Ver payload", em vez do retrato, que não representa o contrato do Senior.
sincronizacaoRouter.get("/:id/preview", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const item = await prisma.sincronizacaoPendente.findUnique({ where: { id } });
    if (!item) {
      res.status(404).json({ error: "Pendência não encontrada" });
      return;
    }
    const preview = await previewEnvioSenior(item);
    res.json(preview);
  } catch (error) {
    handleError(res, error, "preview");
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

// "Marcar como inválido" — desistência manual, pra item que já falhou (pendente com erro, ou
// bloqueado) e o admin decidiu que não faz sentido continuar tentando. Diferente da
// invalidação automática de payloadDeAlocacaoInvalido (outboxSenior.ts, qtdhor ausente): essa
// aqui é uma decisão humana com motivo — gravado no mesmo campo `ultimoErro` que já mostra o
// erro técnico, pra não duplicar coluna. `status` continua fora de STATUS_VALIDOS de origem
// (só pendente/bloqueado entram) — de "invalido" pra frente só dá pra sair reprocessando de
// novo? Não: hoje não há ação de "reverter", intencional, é decisão definitiva.
sincronizacaoRouter.post("/:id/invalidar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (!motivo) {
      res.status(400).json({ error: "Motivo é obrigatório" });
      return;
    }
    const item = await prisma.sincronizacaoPendente.findUnique({ where: { id } });
    if (!item) {
      res.status(404).json({ error: "Pendência não encontrada" });
      return;
    }
    if (item.status !== "pendente" && item.status !== "bloqueado") {
      res.status(400).json({ error: "Só é possível invalidar um item pendente ou bloqueado" });
      return;
    }
    await prisma.sincronizacaoPendente.update({
      where: { id },
      data: { status: "invalido", ultimoErro: motivo },
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "invalidar");
  }
});
