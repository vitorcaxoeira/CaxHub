import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";

const JOB_NAME = "outbox_senior-sync";

// Excedido esse número de tentativas, o item para de ser reprocessado sozinho e vira
// "bloqueado" — evita ficar tentando pra sempre contra um canal que ainda não existe.
const MAX_TENTATIVAS = 5;

// Enfileira uma mudança feita no CaxHub que precisa ser propagada de volta pro Senior.
// Só faz sentido enfileirar quando a atividade já tem `seqati` (veio do ERP originalmente)
// — sem isso não há registro no Senior pra atualizar.
export async function enfileirar(atividadeId: number, tipo: string, payload: Record<string, unknown>): Promise<void> {
  await prisma.sincronizacaoPendente.create({
    data: { atividadeId, tipo, payload: payload as Prisma.InputJsonValue },
  });
}

// Stub proposital — o serviço SOAP "Consulta Genérica" usado hoje (backend/src/soap/client.ts)
// só executa SELECT; não há operação de escrita confirmada do lado do Senior ainda.
// Quando esse canal existir, substituir o corpo desta função pela chamada real.
async function enviarParaSenior(item: { tipo: string; payload: unknown }): Promise<void> {
  throw new Error(
    `Canal de escrita do Senior ainda não confirmado/implementado (tipo="${item.tipo}") — ver comentário em outboxSenior.ts`
  );
}

// Processa a fila: tenta enviar cada item pendente, com no máximo MAX_TENTATIVAS.
export async function processarFilaSincronizacao(): Promise<void> {
  const pendentes = await prisma.sincronizacaoPendente.findMany({
    where: { status: "pendente", tentativas: { lt: MAX_TENTATIVAS } },
    orderBy: { criadoEm: "asc" },
  });

  let enviados = 0;
  let falhas = 0;

  for (const item of pendentes) {
    // Auditoria registra a TENTATIVA de envio, não só sucesso — o evento nasce aqui
    // (processamento assíncrono da fila), não no clique do usuário que originou o
    // SincronizacaoPendente: o correlationId é por item processado, não pela ação
    // original. codemp/codpro vêm da atividade (denormalização do proposta_id).
    const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: item.atividadeId } });
    const entidadeId = entidadeIdAtividade(item.atividadeId);
    const entidadeRotulo = atividade ? `Atividade — Proposta ${atividade.codpro}` : `Atividade ${item.atividadeId}`;
    const correlationId = randomUUID();
    const payloadResumo = JSON.stringify(item.payload).slice(0, 1000);
    const inicioEnvio = Date.now();

    try {
      await enviarParaSenior(item);
      const duracaoMs = Date.now() - inicioEnvio;
      await prisma.$transaction([
        prisma.sincronizacaoPendente.update({
          where: { id: item.id },
          data: { status: "enviado", processadoEm: new Date() },
        }),
        criarEventoAuditoria({
          origem: "job",
          codemp: atividade?.codemp ?? null,
          codpro: atividade?.codpro ?? null,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId,
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_ENVIADA_SENIOR,
          alteracoes: null,
          metadata: { tipo: item.tipo, payload: payloadResumo, sucesso: true, duracaoMs },
          correlationId,
        }),
      ]);
      enviados += 1;
    } catch (error) {
      const duracaoMs = Date.now() - inicioEnvio;
      const message = error instanceof Error ? error.message : String(error);
      const tentativas = item.tentativas + 1;
      await prisma.$transaction([
        prisma.sincronizacaoPendente.update({
          where: { id: item.id },
          data: {
            tentativas,
            ultimoErro: message,
            status: tentativas >= MAX_TENTATIVAS ? "bloqueado" : "pendente",
          },
        }),
        criarEventoAuditoria({
          origem: "job",
          codemp: atividade?.codemp ?? null,
          codpro: atividade?.codpro ?? null,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId,
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_ENVIADA_SENIOR,
          alteracoes: null,
          metadata: { tipo: item.tipo, payload: payloadResumo, sucesso: false, erro: message, duracaoMs },
          correlationId,
        }),
      ]);
      falhas += 1;
    }
  }

  if (pendentes.length > 0) {
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: `${pendentes.length} item(ns) na fila`,
        status: falhas > 0 ? "error" : "success",
        message: `${enviados} enviado(s), ${falhas} falha(s)`,
      },
    });
  }
}

// Reseta um item bloqueado pra pendente/0 tentativas, pra tentar de novo manualmente
// (usado pelo endpoint admin de reprocessar em backend/src/routes/sincronizacao.ts).
export async function reprocessar(id: number): Promise<void> {
  await prisma.sincronizacaoPendente.update({
    where: { id },
    data: { status: "pendente", tentativas: 0, ultimoErro: null },
  });
}

export function scheduleOutboxSeniorSync(): void {
  cron.schedule("*/15 * * * *", processarFilaSincronizacao);
}
