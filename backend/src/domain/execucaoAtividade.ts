import { AtividadeConsultor, Prisma, QuadroColuna } from "@prisma/client";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";

// Nomes reais das raias do quadro (ver backend/prisma/seed.ts) — mesma regra de negócio
// espelhada em frontend/src/lib/atividade-acoes.ts. Duas runtimes diferentes (sem pacote
// compartilhado neste monorepo), mas é UMA regra só: mudar aqui exige mudar lá também.
export const RAIA_A_FAZER = "A Fazer";
export const RAIA_EM_ANDAMENTO = "Em Andamento";

export function podeIniciar(nomeColunaAtual: string | null | undefined): boolean {
  return nomeColunaAtual === RAIA_A_FAZER;
}

export function podeParar(nomeColunaAtual: string | null | undefined): boolean {
  return nomeColunaAtual === RAIA_EM_ANDAMENTO;
}

export interface ContextoMovimentacao {
  atividade: AtividadeConsultor;
  colunaAnterior: QuadroColuna | null;
  colunaNova: QuadroColuna;
  usuarioId: number;
  // Fonte da sessão de execução aberta/fechada (AtividadeSessaoExecucao.origem) — não
  // confundir com o `origem` do evento de auditoria (sempre "tela" aqui: as duas fontes
  // nascem de uma ação do usuário numa tela, seja arrastar o card ou clicar Iniciar/Parar).
  origemSessao: "movimentacao_kanban" | "manual";
  correlationId: string;
  agora: Date;
}

export interface ResultadoMovimentacao {
  operacoes: Prisma.PrismaPromise<unknown>[];
  duracaoSessaoFechadaMin: number | null;
}

// Monta as operações Prisma de uma movimentação de card (atualizar coluna, log de
// histórico, fechar sessão aberta / abrir sessão nova conforme
// QuadroColuna.contaComoExecucao, eventos de auditoria) — usado tanto por
// PATCH /:id/mover (drag-and-drop, origemSessao "movimentacao_kanban") quanto por
// POST /:id/start e /:id/stop (origemSessao "manual"). Só monta as operações — quem
// chama decide quando/como executar (um array próprio, ou combinado com outra chamada
// desta mesma função, ex.: pausar uma atividade pra iniciar outra na mesma transação).
export async function montarOperacoesMovimentacao(ctx: ContextoMovimentacao): Promise<ResultadoMovimentacao> {
  const { atividade, colunaAnterior, colunaNova, usuarioId, origemSessao, correlationId, agora } = ctx;

  const sessaoAbertaAntes = await prisma.atividadeSessaoExecucao.findFirst({
    where: { atividadeId: atividade.id, fim: null },
  });
  const duracaoSessaoFechadaMin = sessaoAbertaAntes
    ? Math.round((agora.getTime() - sessaoAbertaAntes.inicio.getTime()) / 60000)
    : null;

  const entidadeId = entidadeIdAtividade(atividade.id);
  const entidadeRotulo = `Atividade — Proposta ${atividade.codpro}`;
  const ctxEvento = {
    origem: "tela" as const,
    usuarioId,
    codemp: atividade.codemp,
    codpro: atividade.codpro,
    entidadeId,
    correlationId,
  };

  const operacoes: Prisma.PrismaPromise<unknown>[] = [
    prisma.atividadeConsultor.update({ where: { id: atividade.id }, data: { colunaId: colunaNova.id } }),
    prisma.atividadeHistoricoMovimentacao.create({
      data: {
        atividadeId: atividade.id,
        colunaAnteriorId: atividade.colunaId,
        colunaNovaId: colunaNova.id,
        userId: usuarioId,
      },
    }),
    prisma.atividadeSessaoExecucao.updateMany({
      where: { atividadeId: atividade.id, fim: null },
      data: { fim: agora },
    }),
    ...(colunaNova.contaComoExecucao
      ? [
          prisma.atividadeSessaoExecucao.create({
            data: { atividadeId: atividade.id, colunaId: colunaNova.id, inicio: agora, origem: origemSessao },
          }),
        ]
      : []),
    criarEventoAuditoria({
      ...ctxEvento,
      entidadeTipo: ENTIDADES_AUDITORIA.KANBAN_CARD,
      entidadeRotulo,
      eventoTipo: EVENTOS_AUDITORIA.KANBAN_RAIA_ALTERADA,
      alteracoes: { colunaId: { de: atividade.colunaId, para: colunaNova.id, rotulo: "Coluna" } },
      metadata: { raia_de: colunaAnterior?.nome ?? null, raia_para: colunaNova.nome },
    }),
    ...(sessaoAbertaAntes
      ? [
          criarEventoAuditoria({
            ...ctxEvento,
            entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
            entidadeRotulo,
            eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_PARADA,
            alteracoes: null,
            metadata: { coluna: colunaAnterior?.nome ?? null, duracaoMinutos: duracaoSessaoFechadaMin },
          }),
        ]
      : []),
    ...(colunaNova.contaComoExecucao
      ? [
          criarEventoAuditoria({
            ...ctxEvento,
            entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
            entidadeRotulo,
            eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_INICIADA,
            alteracoes: null,
            metadata: { coluna: colunaNova.nome },
          }),
        ]
      : []),
  ];

  return { operacoes, duracaoSessaoFechadaMin };
}
