import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, gerenciaDepartamento, gestorNomePorDepartamento } from "../domain/contextoProjeto";
import { conflitosDoIntervalo, mensagemDeConflito } from "../domain/conflitoApontamento";
import { formatarMinutos } from "../domain/tetoAtividade";
import { paraHoraBrasil } from "../domain/fusoBrasil";
import { notificarConsultorDaAtividade, notificarGestoresDoDepartamento } from "../domain/notificacoes";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { criarSessaoManualPendente, recusarSeEstourarTeto } from "./apontamentos";
import { depexeLabel, modproLabel } from "../domain/propostasDominio";
import { configBloqueioPropostasEmLote, resolverBloqueioApontamento, resolverBloqueioComConfig } from "../domain/bloqueioApontamento";

// Apontamento avulso: o consultor trabalhou e esqueceu de mover o card, então pede o tempo
// aqui, dizendo o motivo e o que foi feito. O gestor aprova (podendo corrigir horário e
// descrição) ou reprova.
//
// ENQUANTO PENDENTE NÃO EXISTE SESSÃO — a sessão nasce só na aprovação, via
// registrarApontamentoAvulso. É isso que faz "só conta depois de aprovado" ser verdade no
// dado, e não uma regra que a tela promete e o cálculo de realizado desmente.
export const solicitacoesApontamentoRouter = Router();
solicitacoesApontamentoRouter.use(requireAuth);

const STATUS_PENDENTE = "pendente";
const STATUS_APROVADA = "aprovada";
const STATUS_REPROVADA = "reprovada";

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[solicitacoes-apontamento:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

async function carregarAtividadeComDepexe(id: number) {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
  if (!atividade) return null;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) return null;
  return { atividade, depexe: item.depexe };
}

async function depexePorAtividade(
  atividades: { id: number; codemp: number; codpro: number; seqite: number }[]
): Promise<Map<number, number | null>> {
  const mapa = new Map<number, number | null>();
  if (atividades.length === 0) return mapa;
  const itens = await prisma.propostaItem.findMany({
    where: { OR: atividades.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite })) },
    select: { codemp: true, codpro: true, seqite: true, depexe: true },
  });
  const porChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i.depexe]));
  for (const a of atividades) mapa.set(a.id, porChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`) ?? null);
  return mapa;
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
    // "1234 - Nome do cliente" — mesmo formato já usado em atividades.ts/alocacao.ts/apontamentos.ts.
    mapa.set(`${p.codemp}-${p.codpro}`, {
      clienteNome: p.cliente ? `${p.cliente.codcli} - ${p.cliente.nomcli}` : null,
      despro: p.despro ?? null,
      modproLabel: modproLabel(p.modpro),
    });
  }
  return mapa;
}

function lerData(valor: unknown): Date | null {
  if (typeof valor !== "string" || valor === "") return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "03/08 09:00–10:30 (1:30)" — hora de parede brasileira, nunca o relógio do servidor.
function descreverIntervalo(inicio: Date, fim: Date): string {
  const i = paraHoraBrasil(inicio);
  const f = paraHoraBrasil(fim);
  const hhmm = (h: { minutosDoDia: number }) =>
    `${String(Math.trunc(h.minutosDoDia / 60)).padStart(2, "0")}:${String(h.minutosDoDia % 60).padStart(2, "0")}`;
  const duracao = Math.round((fim.getTime() - inicio.getTime()) / 60000);
  return `${String(i.dia).padStart(2, "0")}/${String(i.mes).padStart(2, "0")} ${hhmm(i)}–${hhmm(f)} (${formatarMinutos(duracao)})`;
}

// POST /solicitacoes-apontamento
solicitacoesApontamentoRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const atividadeId = Number(req.body?.atividadeId);
    const inicio = lerData(req.body?.inicio);
    const fim = lerData(req.body?.fim);
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    const descricao = typeof req.body?.descricao === "string" ? req.body.descricao.trim() : "";

    if (!Number.isFinite(atividadeId) || !inicio || !fim) {
      res.status(400).json({ error: "atividadeId, inicio e fim são obrigatórios" });
      return;
    }
    if (fim.getTime() <= inicio.getTime()) {
      res.status(400).json({ error: "O fim precisa ser depois do início" });
      return;
    }
    if (motivo === "") {
      res.status(400).json({ error: "Informe o motivo — é por que este tempo não foi registrado no quadro" });
      return;
    }
    // A descrição vira RatItem.desati, que a aprovação da RAT exige em todo item (ver
    // PATCH /rats/:id/aprovar). Deixar entrar vazia aqui só empurra o bloqueio pra frente.
    if (descricao === "") {
      res.status(400).json({ error: "Descreva o trabalho realizado" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(atividadeId);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const { atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto } = ctx;

    // Apontar é ato de quem executou. `> 0` porque codfor 0 circula como sentinela.
    const meuCodfor = contexto.consultor?.codfor;
    if (meuCodfor == null || meuCodfor <= 0 || meuCodfor !== atividade.codfor) {
      res.status(403).json({ error: "Só quem executa a atividade pode solicitar apontamento nela" });
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

    const conflitos = await conflitosDoIntervalo(atividade.codemp, atividade.codfor, inicio, fim);
    if (conflitos.length > 0) {
      res.status(409).json({ error: mensagemDeConflito(conflitos), conflitos });
      return;
    }

    // Não deixa nem registrar o pedido se ele já estoura o teto (alocado + excedentes) —
    // antes disso só era recusado na hora do gestor aprovar (criarSessaoManualPendente),
    // deixando o consultor pedir algo que nunca poderia ser concedido como pediu.
    const recusaTeto = await recusarSeEstourarTeto(atividade, inicio, fim);
    if (recusaTeto) {
      res.status(recusaTeto.status).json(recusaTeto.body);
      return;
    }

    const fato = `solicitou apontamento de ${descreverIntervalo(inicio, fim)}`;

    const criada = await prisma.$transaction(async (tx) => {
      const nova = await tx.solicitacaoApontamento.create({
        data: {
          atividadeId,
          solicitanteId: user.id,
          inicioSolicitado: inicio,
          fimSolicitado: fim,
          motivo,
          descricao,
        },
      });
      await tx.atividadeHistoricoMovimentacao.create({
        data: { atividadeId, tipo: "apontamento_solicitado", descricao: fato, userId: user.id },
      });
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: user.id,
          codemp: atividade.codemp,
          codpro: atividade.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId: entidadeIdAtividade(atividadeId),
          entidadeRotulo: `Atividade — Proposta ${atividade.codpro}`,
          eventoTipo: EVENTOS_AUDITORIA.APONTAMENTO_SOLICITADO,
          alteracoes: null,
          metadata: { inicio: inicio.toISOString(), fim: fim.toISOString(), motivo, descricao },
          correlationId: req.correlationId!,
        },
        tx
      );
      return nova;
    });

    await notificarGestoresDoDepartamento(
      atividade.codemp,
      depexe,
      "apontamento_solicitado",
      `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}`,
      atividadeId,
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
  atividade: {
    select: {
      codemp: true,
      codpro: true,
      seqite: true,
      qtdhor: true,
      horasExcedentes: true,
      codfor: true,
      bloqueiaApontamento: true,
      bloqueiaExcedente: true,
    },
  },
} as const;

type SolicitacaoComRelacoes = Prisma.SolicitacaoApontamentoGetPayload<{ include: typeof INCLUDE_LISTA }>;

function serializar(
  s: SolicitacaoComRelacoes,
  depexe: number | null,
  gestorNome: string | null,
  podeDecidir: boolean,
  bloqueadoApontamentoEfetivo: boolean,
  propostaInfo?: PropostaInfo
) {
  return {
    id: s.id,
    atividadeId: s.atividadeId,
    status: s.status,
    inicioSolicitado: s.inicioSolicitado,
    fimSolicitado: s.fimSolicitado,
    motivo: s.motivo,
    descricao: s.descricao,
    inicioAprovado: s.inicioAprovado,
    fimAprovado: s.fimAprovado,
    descricaoAprovada: s.descricaoAprovada,
    observacaoDecisao: s.observacaoDecisao,
    criadoEm: s.criadoEm,
    decididoEm: s.decididoEm,
    solicitanteNome: s.solicitante?.nome ?? "Usuário removido",
    decisorNome: s.decididoPor?.nome ?? null,
    codemp: s.atividade.codemp,
    codpro: s.atividade.codpro,
    seqite: s.atividade.seqite,
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

// GET /solicitacoes-apontamento?status=pendente — mesmo recorte do painel de excedentes:
// o gestor vê os pedidos dos departamentos que gerencia, qualquer um vê os próprios.
solicitacoesApontamentoRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;
    const status = typeof req.query.status === "string" && req.query.status !== "" ? req.query.status : null;

    const where: Prisma.SolicitacaoApontamentoWhereInput = {};
    if (status) where.status = status;

    const todas = await prisma.solicitacaoApontamento.findMany({
      where,
      include: INCLUDE_LISTA,
      orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
    });

    const mapaDepexe = await depexePorAtividade(todas.map((s) => ({ id: s.atividadeId, ...s.atividade })));
    const mapaProposta = await propostaInfoPorAtividades(todas.map((s) => s.atividade));
    const mapaGestor = await gestorNomePorDepartamento(
      todas
        .map((s) => ({ codemp: s.atividade.codemp, depexe: mapaDepexe.get(s.atividadeId) ?? null }))
        .filter((p): p is { codemp: number; depexe: number } => p.depexe != null)
    );

    // 1 query em lote pra todas as propostas envolvidas (nunca 1 por solicitação no map
    // abaixo) — ver domain/bloqueioApontamento.ts.
    const cfgBloqueioPorProposta = await configBloqueioPropostasEmLote(
      todas.map((s) => ({ codemp: s.atividade.codemp, codpro: s.atividade.codpro }))
    );

    const visiveis = todas
      .map((s) => {
        const depexe = mapaDepexe.get(s.atividadeId) ?? null;
        const gerencia = depexe != null && gerenciaDepartamento(role, contexto, depexe);
        const minha = s.solicitanteId === user.id;
        if (!gerencia && !minha) return null;
        const propostaInfo = mapaProposta.get(`${s.atividade.codemp}-${s.atividade.codpro}`);
        const gestorNome = depexe != null ? mapaGestor.get(`${s.atividade.codemp}-${depexe}`) ?? null : null;
        const cfg = cfgBloqueioPorProposta.get(`${s.atividade.codemp}-${s.atividade.codpro}`) ?? {
          bloqueiaApontamento: false,
          bloqueiaExcedente: true,
        };
        const bloqueadoApontamentoEfetivo = resolverBloqueioComConfig(cfg, s.atividade).bloqueadoApontamento;
        return serializar(s, depexe, gestorNome, gerencia, bloqueadoApontamentoEfetivo, propostaInfo);
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    res.json({ solicitacoes: visiveis });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// GET /solicitacoes-apontamento/atividade/:atividadeId — o que o drawer mostra.
solicitacoesApontamentoRouter.get("/atividade/:atividadeId", async (req: AuthenticatedRequest, res) => {
  try {
    const atividadeId = Number(req.params.atividadeId);
    if (!Number.isFinite(atividadeId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const resolvido = await carregarAtividadeComDepexe(atividadeId);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const gerencia = gerenciaDepartamento(role, contexto, resolvido.depexe);
    const meuCodfor = contexto.consultor?.codfor;
    const souOExecutor = meuCodfor != null && meuCodfor > 0 && meuCodfor === resolvido.atividade.codfor;
    if (!gerencia && !souOExecutor) {
      res.status(403).json({ error: "Sem permissão para ver as solicitações desta atividade" });
      return;
    }

    const solicitacoes = await prisma.solicitacaoApontamento.findMany({
      where: { atividadeId },
      include: INCLUDE_LISTA,
      orderBy: { criadoEm: "desc" },
    });

    const propostaInfo = (await propostaInfoPorAtividades([resolvido.atividade])).get(
      `${resolvido.atividade.codemp}-${resolvido.atividade.codpro}`
    );
    const gestorNome =
      (await gestorNomePorDepartamento([{ codemp: resolvido.atividade.codemp, depexe: resolvido.depexe }])).get(
        `${resolvido.atividade.codemp}-${resolvido.depexe}`
      ) ?? null;

    const bloqueadoApontamentoEfetivo = (await resolverBloqueioApontamento(resolvido.atividade)).bloqueadoApontamento;

    res.json({
      solicitacoes: solicitacoes.map((s) =>
        serializar(s, resolvido.depexe, gestorNome, gerencia, bloqueadoApontamentoEfetivo, propostaInfo)
      ),
    });
  } catch (error) {
    handleError(res, error, "por-atividade");
  }
});

interface OpcoesDecisao {
  aprovar: boolean;
  // Sempre `unknown` porque tanto vêm direto de req.body (rota individual) quanto já
  // tipados (rota em lote, que nunca manda estes três — ver POST /decidir-lote).
  inicio?: unknown;
  fim?: unknown;
  descricao?: unknown;
  observacao?: unknown;
}

// Miolo de "decidir uma solicitação" — extraído pra ser a MESMA lógica usada tanto por
// POST /:id/decidir quanto por POST /decidir-lote (por item). Nunca decide sucesso/fracasso
// olhando pra `res` — só devolve { status, body } pro chamador responder (individual) ou
// acumular (lote). Comportamento idêntico ao que já existia antes desta extração.
async function decidirUma(id: number, opts: OpcoesDecisao, req: AuthenticatedRequest): Promise<{ status: number; body: unknown }> {
  if (!Number.isFinite(id)) return { status: 400, body: { error: "Id inválido" } };
  const { aprovar } = opts;
  const observacao = typeof opts.observacao === "string" ? opts.observacao.trim() : "";

  const solicitacao = await prisma.solicitacaoApontamento.findUnique({ where: { id } });
  if (!solicitacao) return { status: 404, body: { error: "Solicitação não encontrada" } };
  if (solicitacao.status !== STATUS_PENDENTE) {
    return { status: 409, body: { error: `Esta solicitação já foi ${solicitacao.status}` } };
  }

  const resolvido = await carregarAtividadeComDepexe(solicitacao.atividadeId);
  if (!resolvido) return { status: 404, body: { error: "Atividade não encontrada" } };
  const { atividade, depexe } = resolvido;

  const ctx = await contextoDoUsuario(req);
  if (!ctx) return { status: 404, body: { error: "Usuário não encontrado" } };
  const { user, contexto, role } = ctx;
  if (!gerenciaDepartamento(role, contexto, depexe)) {
    return { status: 403, body: { error: "Só o gestor do departamento pode decidir esta solicitação" } };
  }

  // O gestor pode corrigir os três campos. Ausentes, valem os solicitados — é o caminho que
  // POST /decidir-lote usa sempre, já que não tem UI pra editar por item.
  const inicio = opts.inicio !== undefined ? lerData(opts.inicio) : solicitacao.inicioSolicitado;
  const fim = opts.fim !== undefined ? lerData(opts.fim) : solicitacao.fimSolicitado;
  const descricao =
    typeof opts.descricao === "string" && opts.descricao.trim() !== "" ? opts.descricao.trim() : solicitacao.descricao;

  if (aprovar) {
    if (!inicio || !fim) return { status: 400, body: { error: "inicio e fim inválidos" } };
    if (fim.getTime() <= inicio.getTime()) return { status: 400, body: { error: "O fim precisa ser depois do início" } };
    // Revalidado com os valores FINAIS: sem isto o gestor aprovaria pra dentro de um
    // conflito que o consultor não conseguiu enviar.
    const conflitos = await conflitosDoIntervalo(atividade.codemp, atividade.codfor, inicio, fim, {
      ignorarSolicitacaoId: id,
    });
    if (conflitos.length > 0) return { status: 409, body: { error: mensagemDeConflito(conflitos), conflitos } };
  }

  // Aprovar NÃO confirma o apontamento: cria a sessão fechada e não confirmada, que cai
  // na lista "a confirmar" do consultor em Meus Apontamentos. Quem fecha o apontamento e
  // dispara o envio ao Senior continua sendo quem executou — o gestor autoriza o tempo,
  // não lança no lugar dele.
  //
  // Antes da sessão existir a solicitação não é marcada como aprovada: a criação ainda
  // pode recusar por teto (alocado + excedentes), e uma solicitação "aprovada" sem
  // sessão nenhuma seria o pior dos dois mundos — o consultor veria deferido e as horas
  // não estariam em lugar nenhum. Recusou, a solicitação continua pendente e o gestor lê
  // o motivo: pra liberar, ele autoriza horas excedentes antes.
  let sessaoId: number | undefined;
  if (aprovar) {
    const resultado = await criarSessaoManualPendente(solicitacao.atividadeId, inicio!, fim!, descricao);
    if (resultado.status >= 400) return { status: resultado.status, body: resultado.body };
    sessaoId = resultado.sessaoId;
  }

  const fato = !aprovar
    ? `reprovou o apontamento de ${descreverIntervalo(solicitacao.inicioSolicitado, solicitacao.fimSolicitado)}`
    : inicio!.getTime() === solicitacao.inicioSolicitado.getTime() && fim!.getTime() === solicitacao.fimSolicitado.getTime()
      ? `aprovou o apontamento de ${descreverIntervalo(inicio!, fim!)}`
      : `aprovou o apontamento como ${descreverIntervalo(inicio!, fim!)}, no lugar de ${descreverIntervalo(solicitacao.inicioSolicitado, solicitacao.fimSolicitado)}`;

  const atualizada = await prisma.$transaction(async (tx) => {
    const s = await tx.solicitacaoApontamento.update({
      where: { id },
      data: {
        status: aprovar ? STATUS_APROVADA : STATUS_REPROVADA,
        decididoPorId: user.id,
        decididoEm: new Date(),
        inicioAprovado: aprovar ? inicio : null,
        fimAprovado: aprovar ? fim : null,
        descricaoAprovada: aprovar ? descricao : null,
        observacaoDecisao: observacao === "" ? null : observacao,
        sessaoId: sessaoId ?? null,
      },
    });
    await tx.atividadeHistoricoMovimentacao.create({
      data: { atividadeId: atividade.id, tipo: "apontamento_decidido", descricao: fato, userId: user.id },
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
        eventoTipo: aprovar ? EVENTOS_AUDITORIA.APONTAMENTO_APROVADO : EVENTOS_AUDITORIA.APONTAMENTO_REPROVADO,
        alteracoes: null,
        metadata: {
          inicioSolicitado: solicitacao.inicioSolicitado.toISOString(),
          fimSolicitado: solicitacao.fimSolicitado.toISOString(),
          inicioAprovado: aprovar ? inicio!.toISOString() : null,
          fimAprovado: aprovar ? fim!.toISOString() : null,
          motivo: solicitacao.motivo,
          descricao,
          observacaoDecisao: observacao === "" ? null : observacao,
        },
        correlationId: req.correlationId!,
      },
      tx
    );
    return s;
  });

  // A notificação carrega o mesmo `fato` do histórico mais o próximo passo — o consultor
  // precisa saber que ainda tem de confirmar, senão o apontamento fica parado esperando
  // uma ação que ele não sabe que existe.
  await notificarConsultorDaAtividade(
    atividade,
    "apontamento_decidido",
    `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}${aprovar ? " — confirme em Meus Apontamentos" : ""}`,
    user.id
  );

  return { status: 200, body: { id: atualizada.id, status: atualizada.status, sessaoId: atualizada.sessaoId } };
}

// POST /solicitacoes-apontamento/:id/decidir
solicitacoesApontamentoRouter.post("/:id/decidir", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const aprovar = req.body?.aprovar;
    if (!Number.isFinite(id) || typeof aprovar !== "boolean") {
      res.status(400).json({ error: "aprovar (true/false) é obrigatório" });
      return;
    }
    const resultado = await decidirUma(
      id,
      { aprovar, inicio: req.body?.inicio, fim: req.body?.fim, descricao: req.body?.descricao, observacao: req.body?.observacao },
      req
    );
    res.status(resultado.status).json(resultado.body);
  } catch (error) {
    handleError(res, error, "decidir");
  }
});

// POST /solicitacoes-apontamento/decidir-lote — "Aprovar todos"/"Reprovar todos" da tela de
// Aprovações. Sem edição por item (não tem UI pra isso em lote): aprovar sempre aceita
// exatamente o horário/descrição SOLICITADOS. Roda um por vez (não Promise.all) pra não
// disputar a mesma checagem de teto/conflito de uma atividade que apareça mais de uma vez no
// lote; uma falha específica (ex.: teto excedido) não impede as outras.
solicitacoesApontamentoRouter.post("/decidir-lote", async (req: AuthenticatedRequest, res) => {
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
