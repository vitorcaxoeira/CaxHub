import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, gerenciaDepartamento, gestorNomePorDepartamento } from "../domain/contextoProjeto";
import { conflitosDoIntervalo, mensagemDeConflito } from "../domain/conflitoApontamento";
import { saldoDaAtividade, formatarMinutos } from "../domain/tetoAtividade";
import { paraHoraBrasil } from "../domain/fusoBrasil";
import { notificarConsultorDaAtividade, notificarGestoresDoDepartamento } from "../domain/notificacoes";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { processarFilaSincronizacao } from "../sync/outboxSenior";
import { depexeLabel, modproLabel } from "../domain/propostasDominio";
import { configBloqueioPropostasEmLote, resolverBloqueioApontamento, resolverBloqueioComConfig } from "../domain/bloqueioApontamento";
import { diaBrasilComoData, recusarSeEstourarTeto } from "./apontamentos";

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

interface PropostaInfo {
  clienteNome: string | null;
  despro: string | null;
  modproLabel: string;
}

// Cliente, descrição e modalidade da proposta pra dar contexto no card de Aprovações — mesmo
// caminho (Proposta.cliente.nomcli) já usado em atividades.ts/alocacao.ts/apontamentos.ts.
// Modalidade no mesmo estilo badge da coluna Modalidade de Alocacao.tsx (24/08/2026).
async function propostaInfoPorAtividades(atividades: { codemp: number; codpro: number }[]): Promise<Map<string, PropostaInfo>> {
  const mapa = new Map<string, PropostaInfo>();
  if (atividades.length === 0) return mapa;
  const pares = [...new Map(atividades.map((a) => [`${a.codemp}-${a.codpro}`, a])).values()];
  const propostas = await prisma.proposta.findMany({
    where: { OR: pares.map((p) => ({ codemp: p.codemp, codpro: p.codpro })) },
    select: { codemp: true, codpro: true, despro: true, modpro: true, cliente: { select: { codcli: true, nomcli: true } } },
  });
  for (const p of propostas) {
    mapa.set(`${p.codemp}-${p.codpro}`, {
      clienteNome: p.cliente ? `${p.cliente.codcli} - ${p.cliente.nomcli}` : null,
      despro: p.despro ?? null,
      modproLabel: modproLabel(p.modpro),
    });
  }
  return mapa;
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

    // Bloqueio de apontamento (proposta ou atividade) — ver domain/bloqueioApontamento.ts.
    const bloqueio = await resolverBloqueioApontamento(atividade);
    if (bloqueio.bloqueadoApontamento) {
      res.status(409).json({
        error:
          bloqueio.origemBloqueioApontamento === "proposta"
            ? "Apontamento bloqueado nesta proposta pelo gestor."
            : "Apontamento bloqueado nesta atividade pelo gestor.",
      });
      return;
    }

    if (sessao.excluidaEm != null) {
      res.status(400).json({ error: "Apontamento excluído — não há o que ajustar" });
      return;
    }
    // O ajuste é ANTES de confirmar. Depois de confirmado o apontamento já é um RatItem
    // dentro de uma RAT e, em segundos, um registro no Senior — e a regra do fluxo é nunca
    // alterar o que já foi pro ERP. Quem confirmou com o horário errado exclui e refaz.
    //
    // É o que faz a trava viver na confirmação (ver confirmarSessao em routes/apontamentos.ts)
    // em vez de na integração: o apontamento em discussão nem chega a entrar na RAT.
    if (sessao.confirmada || sessao.ratItemId != null) {
      res.status(400).json({ error: "Apontamento já confirmado — o ajuste precisa ser pedido antes de confirmar" });
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

    // Não deixa nem registrar o pedido se o novo horário estoura o teto (alocado +
    // excedentes) — antes disso só era recusado na hora do gestor aprovar (decidirUma).
    // A sessão atual já entra no `realizado`, então tira a duração dela antes de somar a
    // nova — senão a mesma hora contaria duas vezes.
    const duracaoAtualDaSessao = sessao.fim ? Math.round((sessao.fim.getTime() - sessao.inicio.getTime()) / 60000) : 0;
    const recusaTeto = await recusarSeEstourarTeto(atividade, inicio, fim, duracaoAtualDaSessao);
    if (recusaTeto) {
      res.status(recusaTeto.status).json(recusaTeto.body);
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

function serializar(
  s: AjusteComRelacoes,
  depexe: number | null,
  gestorNome: string | null,
  podeDecidir: boolean,
  bloqueadoApontamentoEfetivo: boolean,
  propostaInfo?: PropostaInfo
) {
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
    gestorNome,
    modproLabel: propostaInfo?.modproLabel ?? "—",
    clienteNome: propostaInfo?.clienteNome ?? null,
    despro: propostaInfo?.despro ?? null,
    podeDecidir,
    // Aprovar essa solicitação vai recusar 409 se a proposta/atividade estiver com
    // apontamento bloqueado (ver domain/bloqueioApontamento.ts) — a tela desabilita só
    // "Aprovar", "Reprovar" continua sempre disponível.
    bloqueadoApontamentoEfetivo,
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
    const mapaProposta = await propostaInfoPorAtividades(todas.map((s) => s.sessao.atividade));
    const mapaGestor = await gestorNomePorDepartamento(
      todas
        .map((s) => {
          const a = s.sessao.atividade;
          return { codemp: a.codemp, depexe: depexePorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`) ?? null };
        })
        .filter((p): p is { codemp: number; depexe: number } => p.depexe != null)
    );

    // 1 query em lote pra todas as propostas envolvidas (nunca 1 por solicitação no map
    // abaixo) — ver domain/bloqueioApontamento.ts.
    const cfgBloqueioPorProposta = await configBloqueioPropostasEmLote(
      todas.map((s) => ({ codemp: s.sessao.atividade.codemp, codpro: s.sessao.atividade.codpro }))
    );

    const visiveis = todas
      .map((s) => {
        const a = s.sessao.atividade;
        const depexe = depexePorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`) ?? null;
        const gerencia = depexe != null && gerenciaDepartamento(role, contexto, depexe);
        const minha = s.solicitanteId === user.id;
        if (!gerencia && !minha) return null;
        const propostaInfo = mapaProposta.get(`${a.codemp}-${a.codpro}`);
        const gestorNome = depexe != null ? mapaGestor.get(`${a.codemp}-${depexe}`) ?? null : null;
        const cfg = cfgBloqueioPorProposta.get(`${a.codemp}-${a.codpro}`) ?? { bloqueiaApontamento: false, bloqueiaExcedente: true };
        const bloqueadoApontamentoEfetivo = resolverBloqueioComConfig(cfg, a).bloqueadoApontamento;
        return serializar(s, depexe, gestorNome, gerencia, bloqueadoApontamentoEfetivo, propostaInfo);
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
    res.json({ solicitacoes: solicitacoes.map((s) => serializar(s, null, null, false, false)) });
  } catch (error) {
    handleError(res, error, "por-sessao");
  }
});

// Miolo de "decidir uma solicitação" — extraído pra ser a MESMA lógica usada tanto por
// POST /:id/decidir quanto por POST /decidir-lote (por item). Ausentes, `inicio`/`fim` valem
// os solicitados — é o que o lote sempre usa, já que não tem UI pra editar por item.
async function decidirUma(
  id: number,
  opts: { aprovar: boolean; inicio?: unknown; fim?: unknown; observacao?: unknown },
  req: AuthenticatedRequest
): Promise<{ status: number; body: unknown }> {
  if (!Number.isFinite(id)) return { status: 400, body: { error: "Id inválido" } };
  const { aprovar } = opts;
  const observacao = typeof opts.observacao === "string" ? opts.observacao.trim() : "";

  const solicitacao = await prisma.solicitacaoAjusteApontamento.findUnique({ where: { id } });
  if (!solicitacao) return { status: 404, body: { error: "Solicitação não encontrada" } };
  if (solicitacao.status !== STATUS_PENDENTE) {
    return { status: 409, body: { error: `Esta solicitação já foi ${solicitacao.status}` } };
  }

  const resolvido = await carregarSessao(solicitacao.sessaoId);
  if (!resolvido) return { status: 404, body: { error: "Apontamento não encontrado" } };
  const { sessao, atividade, depexe } = resolvido;

  const ctx = await contextoDoUsuario(req);
  if (!ctx) return { status: 404, body: { error: "Usuário não encontrado" } };
  const { user, contexto, role } = ctx;
  if (!gerenciaDepartamento(role, contexto, depexe)) {
    return { status: 403, body: { error: "Só o gestor do departamento pode decidir esta solicitação" } };
  }

  // Bloqueio de apontamento (proposta ou atividade) — só barra APROVAR (aprovar = de fato
  // confirmar o novo horário); reprovar continua sempre livre, pra limpar a fila mesmo com
  // o bloqueio ativo. Ver domain/bloqueioApontamento.ts.
  if (aprovar) {
    const bloqueio = await resolverBloqueioApontamento(atividade);
    if (bloqueio.bloqueadoApontamento) {
      return {
        status: 409,
        body: {
          error:
            bloqueio.origemBloqueioApontamento === "proposta"
              ? "Apontamento bloqueado nesta proposta pelo gestor."
              : "Apontamento bloqueado nesta atividade pelo gestor.",
        },
      };
    }
  }

  // O gestor pode gravar horário diferente do pedido. Ausentes, valem os solicitados.
  const inicio = opts.inicio !== undefined ? lerData(opts.inicio) : solicitacao.inicioSolicitado;
  const fim = opts.fim !== undefined ? lerData(opts.fim) : solicitacao.fimSolicitado;

  if (aprovar) {
    if (!inicio || !fim) return { status: 400, body: { error: "inicio e fim inválidos" } };
    if (fim.getTime() <= inicio.getTime()) return { status: 400, body: { error: "O fim precisa ser depois do início" } };
    // Revalida com os valores FINAIS: sem isto o gestor aprovaria pra dentro de um
    // conflito, ou estourando o teto, que o consultor não conseguiu enviar.
    const conflitos = await conflitosDoIntervalo(atividade.codemp, atividade.codfor, inicio, fim, {
      ignorarSessaoId: sessao.id,
      ignorarRatItemId: sessao.ratItemId ?? undefined,
    });
    if (conflitos.length > 0) return { status: 409, body: { error: mensagemDeConflito(conflitos), conflitos } };
    const duracaoNova = Math.round((fim.getTime() - inicio.getTime()) / 60000);
    const duracaoAtual = sessao.fim ? Math.round((sessao.fim.getTime() - sessao.inicio.getTime()) / 60000) : 0;
    const { teto, realizado } = await saldoDaAtividade(atividade);
    const realizadoSemEsta = realizado - duracaoAtual;
    if (teto > 0 && realizadoSemEsta + duracaoNova > teto) {
      return {
        status: 409,
        body: {
          error: `O horário novo (${formatarMinutos(duracaoNova)}) estoura o teto da atividade: ${formatarMinutos(teto)} (alocado + excedentes), com ${formatarMinutos(realizadoSemEsta)} já realizados. Libere horas excedentes antes de aprovar.`,
        },
      };
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
      // Só a sessão: o pedido só existe antes de confirmar, então não há RatItem pra
      // acertar junto. O horário aprovado é o que a confirmação vai levar pra RAT.
      await tx.atividadeSessaoExecucao.update({
        where: { id: sessao.id },
        data: { inicio: inicio!, fim: fim! },
      });
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

  // Nada a liberar na fila: o apontamento ainda não foi confirmado, então não existe
  // pendência de envio. Quem leva o horário final pro Senior é a confirmação, que volta
  // a ser permitida agora que o pedido foi decidido.
  return { status: 200, body: { id, status: aprovar ? "aprovada" : "reprovada" } };
}

// POST /solicitacoes-ajuste/:id/decidir
solicitacoesAjusteRouter.post("/:id/decidir", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const aprovar = req.body?.aprovar;
    if (!Number.isFinite(id) || typeof aprovar !== "boolean") {
      res.status(400).json({ error: "aprovar (true/false) é obrigatório" });
      return;
    }
    const resultado = await decidirUma(id, { aprovar, inicio: req.body?.inicio, fim: req.body?.fim, observacao: req.body?.observacao }, req);
    res.status(resultado.status).json(resultado.body);
  } catch (error) {
    handleError(res, error, "decidir");
  }
});

// POST /solicitacoes-ajuste/decidir-lote — "Aprovar todos"/"Reprovar todos" da tela de
// Aprovações. Sem edição por item: aprovar sempre grava exatamente o horário SOLICITADO.
// Roda um por vez (não Promise.all) — uma falha específica (conflito, teto) não impede as
// outras.
solicitacoesAjusteRouter.post("/decidir-lote", async (req: AuthenticatedRequest, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
    const aprovar = req.body?.aprovar;
    if (ids.length === 0 || typeof aprovar !== "boolean") {
      res.status(400).json({ error: "ids (lista não vazia) e aprovar (true/false) são obrigatórios" });
      return;
    }
    const observacao = req.body?.observacao;

    const sucesso: number[] = [];
    const falhas: { id: number; erro: string }[] = [];
    for (const id of ids) {
      const resultado = await decidirUma(id, { aprovar, observacao }, req);
      if (resultado.status >= 400) {
        const erro = (resultado.body as { error?: string })?.error ?? `Falhou com status ${resultado.status}`;
        falhas.push({ id, erro });
      } else {
        sucesso.push(id);
      }
    }

    res.json({ sucesso, falhas });
  } catch (error) {
    handleError(res, error, "decidir-lote");
  }
});
