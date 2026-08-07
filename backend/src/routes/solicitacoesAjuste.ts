import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, gerenciaDepartamento } from "../domain/contextoProjeto";
import { conflitosDoIntervalo, mensagemDeConflito } from "../domain/conflitoApontamento";
import { saldoDaAtividade, formatarMinutos } from "../domain/tetoAtividade";
import { paraHoraBrasil } from "../domain/fusoBrasil";
import { notificarConsultorDaAtividade, notificarGestoresDoDepartamento } from "../domain/notificacoes";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { processarFilaSincronizacao } from "../sync/outboxSenior";
import { depexeLabel } from "../domain/propostasDominio";
import { diaBrasilComoData } from "./apontamentos";

// Correção de horário de um apontamento JÁ confirmado. O consultor pede, o gestor decide.
//
// Enquanto o pedido está pendente, o envio ao Senior fica RETIDO (ver
// RetidoPorAjusteError em sync/outboxSenior.ts). Sem isso a funcionalidade não existiria:
// confirmar dispara o envio na hora, o `numrat` chega em segundos, e aí a regra de "nunca
// alterar o que já está no ERP" recusaria qualquer ajuste. Com a retenção, o Senior recebe
// só o valor final.
export const solicitacoesAjusteRouter = Router();
solicitacoesAjusteRouter.use(requireAuth);

const STATUS_PENDENTE = "pendente";

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[solicitacoes-ajuste:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

// Sessão + atividade + item (pro depexe) + RatItem — tudo que as duas rotas precisam.
async function carregarSessao(sessaoId: number) {
  const sessao = await prisma.atividadeSessaoExecucao.findUnique({
    where: { id: sessaoId },
    include: { atividade: true, ratItem: true },
  });
  if (!sessao) return null;
  const item = await prisma.propostaItem.findUnique({
    where: {
      codemp_codpro_seqite: {
        codemp: sessao.atividade.codemp,
        codpro: sessao.atividade.codpro,
        seqite: sessao.atividade.seqite,
      },
    },
  });
  if (!item || item.depexe == null) return null;
  return { sessao, atividade: sessao.atividade, depexe: item.depexe };
}

function lerData(valor: unknown): Date | null {
  if (typeof valor !== "string" || valor === "") return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function descreverIntervalo(inicio: Date, fim: Date): string {
  const hhmm = (d: Date) => {
    const h = paraHoraBrasil(d);
    return `${String(Math.trunc(h.minutosDoDia / 60)).padStart(2, "0")}:${String(h.minutosDoDia % 60).padStart(2, "0")}`;
  };
  const i = paraHoraBrasil(inicio);
  const duracao = Math.round((fim.getTime() - inicio.getTime()) / 60000);
  return `${String(i.dia).padStart(2, "0")}/${String(i.mes).padStart(2, "0")} ${hhmm(inicio)}–${hhmm(fim)} (${formatarMinutos(duracao)})`;
}

// POST /solicitacoes-ajuste
solicitacoesAjusteRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.body?.sessaoId);
    const inicio = lerData(req.body?.inicio);
    const fim = lerData(req.body?.fim);
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";

    if (!Number.isFinite(sessaoId) || !inicio || !fim) {
      res.status(400).json({ error: "sessaoId, inicio e fim são obrigatórios" });
      return;
    }
    if (fim.getTime() <= inicio.getTime()) {
      res.status(400).json({ error: "O fim precisa ser depois do início" });
      return;
    }
    if (motivo === "") {
      res.status(400).json({ error: "Informe o motivo da correção" });
      return;
    }

    const resolvido = await carregarSessao(sessaoId);
    if (!resolvido) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    const { sessao, atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto } = ctx;

    const meuCodfor = contexto.consultor?.codfor;
    if (meuCodfor == null || meuCodfor <= 0 || meuCodfor !== atividade.codfor) {
      res.status(403).json({ error: "Só quem executou o apontamento pode pedir ajuste nele" });
      return;
    }
    if (sessao.excluidaEm != null) {
      res.status(400).json({ error: "Apontamento excluído — não há o que ajustar" });
      return;
    }
    // A regra do fluxo: nada que já esteja no Senior é alterado. Depois do `numrat` a
    // correção precisa acontecer no ERP.
    if (sessao.ratItem?.numrat != null) {
      res.status(400).json({ error: "Já registrado no Senior — o horário não pode mais ser corrigido por aqui" });
      return;
    }

    const conflitos = await conflitosDoIntervalo(atividade.codemp, atividade.codfor, inicio, fim, {
      ignorarSessaoId: sessaoId,
      ignorarRatItemId: sessao.ratItemId ?? undefined,
    });
    if (conflitos.length > 0) {
      res.status(409).json({ error: mensagemDeConflito(conflitos), conflitos });
      return;
    }

    const fato = `pediu ajuste do apontamento de ${descreverIntervalo(sessao.inicio, sessao.fim!)} para ${descreverIntervalo(inicio, fim)}`;

    let criada;
    try {
      criada = await prisma.$transaction(async (tx) => {
        const nova = await tx.solicitacaoAjusteApontamento.create({
          data: { sessaoId, solicitanteId: user.id, inicioSolicitado: inicio, fimSolicitado: fim, motivo },
        });
        await tx.atividadeHistoricoMovimentacao.create({
          data: { atividadeId: atividade.id, tipo: "ajuste_solicitado", descricao: fato, userId: user.id },
        });
        await criarEventoAuditoria(
          {
            origem: "tela",
            usuarioId: user.id,
            codemp: atividade.codemp,
            codpro: atividade.codpro,
            entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
            entidadeId: entidadeIdAtividade(atividade.id),
            entidadeRotulo: `Atividade — Proposta ${atividade.codpro}`,
            eventoTipo: EVENTOS_AUDITORIA.AJUSTE_SOLICITADO,
            alteracoes: null,
            metadata: {
              inicioAtual: sessao.inicio.toISOString(),
              fimAtual: sessao.fim?.toISOString() ?? null,
              inicioSolicitado: inicio.toISOString(),
              fimSolicitado: fim.toISOString(),
              motivo,
            },
            correlationId: req.correlationId!,
          },
          tx
        );
        return nova;
      });
    } catch (erro) {
      // Índice único parcial: um pendente por apontamento (ver a migration).
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        res.status(409).json({ error: "Já existe um pedido de ajuste pendente para este apontamento" });
        return;
      }
      throw erro;
    }

    await notificarGestoresDoDepartamento(
      atividade.codemp,
      depexe,
      "ajuste_solicitado",
      `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}`,
      atividade.id,
      user.id
    );

    res.status(201).json({ id: criada.id, status: criada.status });
  } catch (error) {
    handleError(res, error, "criar");
  }
});

const INCLUDE_LISTA = {
  solicitante: { select: { nome: true } },
  decididoPor: { select: { nome: true } },
  sessao: { include: { atividade: true, ratItem: { select: { numrat: true } } } },
} as const;

type AjusteComRelacoes = Prisma.SolicitacaoAjusteApontamentoGetPayload<{ include: typeof INCLUDE_LISTA }>;

function serializar(s: AjusteComRelacoes, depexe: number | null, podeDecidir: boolean) {
  return {
    id: s.id,
    sessaoId: s.sessaoId,
    atividadeId: s.sessao.atividadeId,
    status: s.status,
    inicioAtual: s.sessao.inicio,
    fimAtual: s.sessao.fim,
    inicioSolicitado: s.inicioSolicitado,
    fimSolicitado: s.fimSolicitado,
    motivo: s.motivo,
    inicioAprovado: s.inicioAprovado,
    fimAprovado: s.fimAprovado,
    inicioAnterior: s.inicioAnterior,
    fimAnterior: s.fimAnterior,
    observacaoDecisao: s.observacaoDecisao,
    criadoEm: s.criadoEm,
    decididoEm: s.decididoEm,
    solicitanteNome: s.solicitante?.nome ?? "Usuário removido",
    decisorNome: s.decididoPor?.nome ?? null,
    codemp: s.sessao.atividade.codemp,
    codpro: s.sessao.atividade.codpro,
    seqite: s.sessao.atividade.seqite,
    depexe,
    depexeLabel: depexeLabel(depexe),
    podeDecidir,
  };
}

// GET /solicitacoes-ajuste?status= — mesmo recorte das outras abas de Aprovações: o gestor
// vê os pedidos dos departamentos que gerencia, qualquer um vê os próprios.
solicitacoesAjusteRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;
    const status = typeof req.query.status === "string" && req.query.status !== "" ? req.query.status : null;

    const todas = await prisma.solicitacaoAjusteApontamento.findMany({
      where: status ? { status } : {},
      include: INCLUDE_LISTA,
      orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
    });

    const itens = await prisma.propostaItem.findMany({
      where: {
        OR: todas.map((s) => ({
          codemp: s.sessao.atividade.codemp,
          codpro: s.sessao.atividade.codpro,
          seqite: s.sessao.atividade.seqite,
        })),
      },
      select: { codemp: true, codpro: true, seqite: true, depexe: true },
    });
    const depexePorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i.depexe]));

    const visiveis = todas
      .map((s) => {
        const a = s.sessao.atividade;
        const depexe = depexePorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`) ?? null;
        const gerencia = depexe != null && gerenciaDepartamento(role, contexto, depexe);
        const minha = s.solicitanteId === user.id;
        if (!gerencia && !minha) return null;
        return serializar(s, depexe, gerencia);
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    res.json({ solicitacoes: visiveis });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// GET /solicitacoes-ajuste/sessao/:sessaoId — o que Meus Apontamentos mostra por linha.
solicitacoesAjusteRouter.get("/sessao/:sessaoId", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.params.sessaoId);
    if (!Number.isFinite(sessaoId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const solicitacoes = await prisma.solicitacaoAjusteApontamento.findMany({
      where: { sessaoId },
      include: INCLUDE_LISTA,
      orderBy: { criadoEm: "desc" },
    });
    res.json({ solicitacoes: solicitacoes.map((s) => serializar(s, null, false)) });
  } catch (error) {
    handleError(res, error, "por-sessao");
  }
});

// POST /solicitacoes-ajuste/:id/decidir
solicitacoesAjusteRouter.post("/:id/decidir", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const aprovar = req.body?.aprovar;
    if (!Number.isFinite(id) || typeof aprovar !== "boolean") {
      res.status(400).json({ error: "aprovar (true/false) é obrigatório" });
      return;
    }
    const observacao = typeof req.body?.observacao === "string" ? req.body.observacao.trim() : "";

    const solicitacao = await prisma.solicitacaoAjusteApontamento.findUnique({ where: { id } });
    if (!solicitacao) {
      res.status(404).json({ error: "Solicitação não encontrada" });
      return;
    }
    if (solicitacao.status !== STATUS_PENDENTE) {
      res.status(409).json({ error: `Esta solicitação já foi ${solicitacao.status}` });
      return;
    }

    const resolvido = await carregarSessao(solicitacao.sessaoId);
    if (!resolvido) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    const { sessao, atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;
    if (!gerenciaDepartamento(role, contexto, depexe)) {
      res.status(403).json({ error: "Só o gestor do departamento pode decidir esta solicitação" });
      return;
    }

    // O gestor pode gravar horário diferente do pedido. Ausentes, valem os solicitados.
    const inicio = req.body?.inicio !== undefined ? lerData(req.body.inicio) : solicitacao.inicioSolicitado;
    const fim = req.body?.fim !== undefined ? lerData(req.body.fim) : solicitacao.fimSolicitado;

    if (aprovar) {
      if (!inicio || !fim) {
        res.status(400).json({ error: "inicio e fim inválidos" });
        return;
      }
      if (fim.getTime() <= inicio.getTime()) {
        res.status(400).json({ error: "O fim precisa ser depois do início" });
        return;
      }
      // Revalida com os valores FINAIS: sem isto o gestor aprovaria pra dentro de um
      // conflito, ou estourando o teto, que o consultor não conseguiu enviar.
      const conflitos = await conflitosDoIntervalo(atividade.codemp, atividade.codfor, inicio, fim, {
        ignorarSessaoId: sessao.id,
        ignorarRatItemId: sessao.ratItemId ?? undefined,
      });
      if (conflitos.length > 0) {
        res.status(409).json({ error: mensagemDeConflito(conflitos), conflitos });
        return;
      }
      const duracaoNova = Math.round((fim.getTime() - inicio.getTime()) / 60000);
      const duracaoAtual = sessao.fim ? Math.round((sessao.fim.getTime() - sessao.inicio.getTime()) / 60000) : 0;
      const { teto, realizado } = await saldoDaAtividade(atividade);
      const realizadoSemEsta = realizado - duracaoAtual;
      if (teto > 0 && realizadoSemEsta + duracaoNova > teto) {
        res.status(409).json({
          error: `O horário novo (${formatarMinutos(duracaoNova)}) estoura o teto da atividade: ${formatarMinutos(teto)} (alocado + excedentes), com ${formatarMinutos(realizadoSemEsta)} já realizados. Libere horas excedentes antes de aprovar.`,
        });
        return;
      }
    }

    const fato = !aprovar
      ? `reprovou o ajuste do apontamento de ${descreverIntervalo(solicitacao.inicioSolicitado, solicitacao.fimSolicitado)}`
      : inicio!.getTime() === solicitacao.inicioSolicitado.getTime() && fim!.getTime() === solicitacao.fimSolicitado.getTime()
        ? `aprovou o ajuste do apontamento para ${descreverIntervalo(inicio!, fim!)}`
        : `aprovou o ajuste como ${descreverIntervalo(inicio!, fim!)}, no lugar de ${descreverIntervalo(solicitacao.inicioSolicitado, solicitacao.fimSolicitado)}`;

    await prisma.$transaction(async (tx) => {
      await tx.solicitacaoAjusteApontamento.update({
        where: { id },
        data: {
          status: aprovar ? "aprovada" : "reprovada",
          decididoPorId: user.id,
          decididoEm: new Date(),
          inicioAprovado: aprovar ? inicio : null,
          fimAprovado: aprovar ? fim : null,
          // O valor que a sessão tinha antes — histórico do dado substituído.
          inicioAnterior: aprovar ? sessao.inicio : null,
          fimAnterior: aprovar ? sessao.fim : null,
          observacaoDecisao: observacao === "" ? null : observacao,
        },
      });

      if (aprovar) {
        // Sessão e RatItem andam JUNTOS: a sessão é a fonte do realizado, o RatItem é o que
        // viaja pro Senior. Mover só um deixaria os dois discordando.
        await tx.atividadeSessaoExecucao.update({
          where: { id: sessao.id },
          data: { inicio: inicio!, fim: fim! },
        });
        if (sessao.ratItem) {
          await tx.ratItem.update({
            where: { id: sessao.ratItem.id },
            data: {
              datati: diaBrasilComoData(inicio!),
              horini: paraHoraBrasil(inicio!).minutosDoDia,
              horfim: paraHoraBrasil(fim!).minutosDoDia,
            },
          });
        }
      }

      await tx.atividadeHistoricoMovimentacao.create({
        data: { atividadeId: atividade.id, tipo: "ajuste_decidido", descricao: fato, userId: user.id },
      });
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: user.id,
          codemp: atividade.codemp,
          codpro: atividade.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId: entidadeIdAtividade(atividade.id),
          entidadeRotulo: `Atividade — Proposta ${atividade.codpro}`,
          eventoTipo: aprovar ? EVENTOS_AUDITORIA.AJUSTE_APROVADO : EVENTOS_AUDITORIA.AJUSTE_REPROVADO,
          alteracoes: aprovar
            ? {
                inicio: { de: sessao.inicio.toISOString(), para: inicio!.toISOString(), rotulo: "Início" },
                fim: { de: sessao.fim?.toISOString() ?? null, para: fim!.toISOString(), rotulo: "Fim" },
              }
            : null,
          metadata: {
            inicioSolicitado: solicitacao.inicioSolicitado.toISOString(),
            fimSolicitado: solicitacao.fimSolicitado.toISOString(),
            motivo: solicitacao.motivo,
            observacaoDecisao: observacao === "" ? null : observacao,
          },
          correlationId: req.correlationId!,
        },
        tx
      );
    });

    await notificarConsultorDaAtividade(
      atividade,
      "ajuste_decidido",
      `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}`,
      user.id
    );

    // Decidido, a retenção some e o apontamento pode seguir pro Senior com o valor final.
    // Fire-and-forget, igual à confirmação — quem espera é a fila, não a resposta HTTP.
    const pendencia = await prisma.sincronizacaoPendente.findFirst({
      where: { tipo: "criar_apontamento", atividadeId: atividade.id, status: "pendente" },
      orderBy: { id: "desc" },
    });
    if (pendencia) {
      processarFilaSincronizacao({ apenasId: pendencia.id }).catch((erro) => {
        console.error("[solicitacoes-ajuste] envio pós-decisão falhou:", erro);
      });
    }

    res.json({ id, status: aprovar ? "aprovada" : "reprovada" });
  } catch (error) {
    handleError(res, error, "decidir");
  }
});
