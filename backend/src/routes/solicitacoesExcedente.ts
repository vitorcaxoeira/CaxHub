import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, gerenciaDepartamento } from "../domain/contextoProjeto";
import { formatarMinutos } from "../domain/tetoAtividade";
import { notificarConsultorDaAtividade, notificarGestoresDoDepartamento } from "../domain/notificacoes";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { depexeLabel } from "../domain/propostasDominio";

// Pedido de horas excedentes: quem executa pede, o gestor do departamento decide.
//
// O teto NÃO sai daqui — continua em AtividadeConsultor.horasExcedentes (ver
// domain/tetoAtividade.ts). Aprovar SOMA o valor liberado lá. Duas fontes de verdade pro
// mesmo teto divergiriam no primeiro ajuste manual do gestor, e o teto é o que trava a
// execução, então ele tem de ter um dono só.
export const solicitacoesExcedenteRouter = Router();
solicitacoesExcedenteRouter.use(requireAuth);

const STATUS_PENDENTE = "pendente";
const STATUS_APROVADA = "aprovada";
const STATUS_REPROVADA = "reprovada";

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[solicitacoes-excedente:${label}]`, message);
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
  return { atividade, item, depexe: item.depexe };
}

// AtividadeConsultor não tem relação Prisma com PropostaItem (a chave é composta e o
// schema espelha o Senior), então o departamento de um lote de atividades é resolvido em
// duas consultas e casado em memória — mesmo caminho já usado nas listagens de
// routes/atividades.ts.
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

function lerMinutos(valor: unknown): number | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

// POST /solicitacoes-excedente — quem executa pede mais horas.
solicitacoesExcedenteRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const atividadeId = Number(req.body?.atividadeId);
    const horasSolicitadas = lerMinutos(req.body?.horasSolicitadas);
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (!Number.isFinite(atividadeId)) {
      res.status(400).json({ error: "atividadeId é obrigatório" });
      return;
    }
    if (horasSolicitadas == null) {
      res.status(400).json({ error: "Informe a quantidade de horas (em minutos, maior que zero)" });
      return;
    }
    // O motivo é o ponto da funcionalidade — sem ele o gestor decide no escuro, que é
    // exatamente a situação de hoje, com o pedido acontecendo fora do sistema.
    if (motivo === "") {
      res.status(400).json({ error: "Informe o motivo da solicitação" });
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

    // Pedir horas é ato de quem executa — nem o gestor pede em nome de outro (ele tem o
    // campo direto pra liberar). `> 0` porque codfor 0 circula como sentinela de "não se
    // aplica a um consultor específico" em alocacao.ts.
    const meuCodfor = contexto.consultor?.codfor;
    if (meuCodfor == null || meuCodfor <= 0 || meuCodfor !== atividade.codfor) {
      res.status(403).json({ error: "Só quem executa a atividade pode solicitar horas excedentes" });
      return;
    }

    const fato = `solicitou ${formatarMinutos(horasSolicitadas)} de horas excedentes`;

    let criada;
    try {
      criada = await prisma.$transaction(async (tx) => {
        const nova = await tx.solicitacaoHorasExcedentes.create({
          data: { atividadeId, solicitanteId: user.id, horasSolicitadas, motivo },
        });
        await tx.atividadeHistoricoMovimentacao.create({
          data: { atividadeId, tipo: "excedente_solicitado", descricao: fato, userId: user.id },
        });
        await criarEventoAuditoria(
          {
            origem: "tela",
            usuarioId: user.id,
            codemp: atividade.codemp,
            codpro: atividade.codpro,
            entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
            entidadeId: entidadeIdAtividade(atividadeId),
            entidadeRotulo: `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`,
            eventoTipo: EVENTOS_AUDITORIA.EXCEDENTE_SOLICITADO,
            alteracoes: null,
            metadata: { horasSolicitadas, motivo },
            correlationId: req.correlationId!,
          },
          tx
        );
        return nova;
      });
    } catch (erro) {
      // Índice único parcial (uma pendente por atividade) — ver a migration. É o caminho
      // do duplo clique, então merece uma frase e não um 500.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        res.status(409).json({ error: "Já existe uma solicitação pendente para esta atividade" });
        return;
      }
      throw erro;
    }

    await notificarGestoresDoDepartamento(
      atividade.codemp,
      depexe,
      "excedente_solicitado",
      `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}`,
      atividadeId,
      user.id
    );

    res.status(201).json({ id: criada.id, status: criada.status });
  } catch (error) {
    handleError(res, error, "criar");
  }
});

interface SolicitacaoParaLista {
  id: number;
  atividadeId: number;
  status: string;
  horasSolicitadas: number;
  horasAprovadas: number | null;
  motivo: string;
  observacaoDecisao: string | null;
  criadoEm: Date;
  decididoEm: Date | null;
  solicitante: { nome: string } | null;
  decididoPor: { nome: string } | null;
  atividade: { codemp: number; codpro: number; seqite: number; qtdhor: number | null; horasExcedentes: number; codfor: number };
}

function serializar(s: SolicitacaoParaLista, depexe: number | null, podeDecidir: boolean) {
  return {
    id: s.id,
    atividadeId: s.atividadeId,
    status: s.status,
    horasSolicitadas: s.horasSolicitadas,
    horasAprovadas: s.horasAprovadas,
    motivo: s.motivo,
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
    // Contexto pro gestor decidir sem sair da tela: quanto já está alocado e quanto de
    // excedente a atividade já carrega.
    qtdhor: s.atividade.qtdhor,
    horasExcedentesAtuais: s.atividade.horasExcedentes,
    podeDecidir,
  };
}

const INCLUDE_LISTA = {
  solicitante: { select: { nome: true } },
  decididoPor: { select: { nome: true } },
  atividade: { select: { codemp: true, codpro: true, seqite: true, qtdhor: true, horasExcedentes: true, codfor: true } },
} as const;

// GET /solicitacoes-excedente?status=pendente — o painel.
//
// Uma tela, dois recortes: o gestor vê os pedidos das atividades dos departamentos que
// gerencia; qualquer pessoa vê os próprios. Quem é as duas coisas vê a união.
solicitacoesExcedenteRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;
    const status = typeof req.query.status === "string" && req.query.status !== "" ? req.query.status : null;

    const where: Prisma.SolicitacaoHorasExcedentesWhereInput = {};
    if (status) where.status = status;

    const todas = await prisma.solicitacaoHorasExcedentes.findMany({
      where,
      include: INCLUDE_LISTA,
      orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
    });

    const mapaDepexe = await depexePorAtividade(
      todas.map((s) => ({ id: s.atividadeId, ...s.atividade }))
    );

    const visiveis = todas
      .map((s) => {
        const depexe = mapaDepexe.get(s.atividadeId) ?? null;
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

// GET /solicitacoes-excedente/atividade/:atividadeId — o que o drawer da atividade mostra.
solicitacoesExcedenteRouter.get("/atividade/:atividadeId", async (req: AuthenticatedRequest, res) => {
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

    const solicitacoes = await prisma.solicitacaoHorasExcedentes.findMany({
      where: { atividadeId },
      include: INCLUDE_LISTA,
      orderBy: { criadoEm: "desc" },
    });

    res.json({ solicitacoes: solicitacoes.map((s) => serializar(s, resolvido.depexe, gerencia)) });
  } catch (error) {
    handleError(res, error, "por-atividade");
  }
});

// POST /solicitacoes-excedente/:id/decidir — aprovar ou reprovar.
solicitacoesExcedenteRouter.post("/:id/decidir", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const aprovar = req.body?.aprovar;
    if (!Number.isFinite(id) || typeof aprovar !== "boolean") {
      res.status(400).json({ error: "aprovar (true/false) é obrigatório" });
      return;
    }
    const observacao = typeof req.body?.observacao === "string" ? req.body.observacao.trim() : "";

    const solicitacao = await prisma.solicitacaoHorasExcedentes.findUnique({ where: { id } });
    if (!solicitacao) {
      res.status(404).json({ error: "Solicitação não encontrada" });
      return;
    }
    // Não é corrida teórica: dois gestores do mesmo departamento com o painel aberto
    // aprovariam o mesmo pedido e o teto somaria duas vezes.
    if (solicitacao.status !== STATUS_PENDENTE) {
      res.status(409).json({ error: `Esta solicitação já foi ${solicitacao.status}` });
      return;
    }

    // Ausente = libera o que foi pedido. É o caminho comum, e o campo da tela já nasce
    // preenchido com o valor pedido.
    const horasAprovadas = aprovar
      ? req.body?.horasAprovadas === undefined
        ? solicitacao.horasSolicitadas
        : lerMinutos(req.body.horasAprovadas)
      : null;
    if (aprovar && horasAprovadas == null) {
      res.status(400).json({ error: "horasAprovadas precisa ser um número de minutos maior que zero" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(solicitacao.atividadeId);
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
    const { user, contexto, role } = ctx;
    if (!gerenciaDepartamento(role, contexto, depexe)) {
      res.status(403).json({ error: "Só o gestor do departamento pode decidir esta solicitação" });
      return;
    }

    // UMA frase pro histórico, pra auditoria e pra notificação. Em minúscula porque os
    // dois primeiros a emendam depois do nome de quem decidiu.
    //
    // Aprovar valor diferente do pedido precisa dizer os dois números: é a informação que
    // a pessoa não consegue adivinhar, e a que muda o que ela pode fazer.
    const fato = !aprovar
      ? `reprovou o pedido de ${formatarMinutos(solicitacao.horasSolicitadas)} de horas excedentes`
      : horasAprovadas === solicitacao.horasSolicitadas
        ? `aprovou ${formatarMinutos(horasAprovadas!)} de horas excedentes`
        : `aprovou ${formatarMinutos(horasAprovadas!)} das ${formatarMinutos(solicitacao.horasSolicitadas)} de horas excedentes solicitadas`;

    const excedenteAntes = atividade.horasExcedentes;
    // Aprovação ACUMULA: cada pedido é "preciso de mais X". Substituir faria um pedido de
    // 1:00 derrubar um teto de 4:00 já concedido.
    const excedenteDepois = aprovar ? excedenteAntes + horasAprovadas! : excedenteAntes;

    // Tudo junto: a decisão, o teto novo, o rastro e a linha do tempo. Um teto que sobe
    // sem a solicitação virar "aprovada" ficaria pronto pra ser aprovado de novo.
    const atualizada = await prisma.$transaction(async (tx) => {
      const s = await tx.solicitacaoHorasExcedentes.update({
        where: { id },
        data: {
          status: aprovar ? STATUS_APROVADA : STATUS_REPROVADA,
          decididoPorId: user.id,
          decididoEm: new Date(),
          horasAprovadas,
          observacaoDecisao: observacao === "" ? null : observacao,
        },
      });
      if (aprovar) {
        await tx.atividadeConsultor.update({
          where: { id: atividade.id },
          data: { horasExcedentes: excedenteDepois },
        });
      }
      await tx.atividadeHistoricoMovimentacao.create({
        data: { atividadeId: atividade.id, tipo: "excedente_decidido", descricao: fato, userId: user.id },
      });
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: user.id,
          codemp: atividade.codemp,
          codpro: atividade.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
          entidadeId: entidadeIdAtividade(atividade.id),
          entidadeRotulo: `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`,
          eventoTipo: aprovar ? EVENTOS_AUDITORIA.EXCEDENTE_APROVADO : EVENTOS_AUDITORIA.EXCEDENTE_REPROVADO,
          alteracoes: aprovar
            ? { horasExcedentes: { de: excedenteAntes, para: excedenteDepois, rotulo: "Horas Excedentes" } }
            : null,
          metadata: {
            horasSolicitadas: solicitacao.horasSolicitadas,
            horasAprovadas,
            motivo: solicitacao.motivo,
            observacaoDecisao: observacao === "" ? null : observacao,
          },
          correlationId: req.correlationId!,
        },
        tx
      );
      return s;
    });

    // Fora da transação: falha de notificação não desfaz a decisão do gestor.
    await notificarConsultorDaAtividade(
      atividade,
      "excedente_decidido",
      `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}`,
      user.id
    );

    res.json({
      id: atualizada.id,
      status: atualizada.status,
      horasAprovadas: atualizada.horasAprovadas,
      horasExcedentes: excedenteDepois,
    });
  } catch (error) {
    handleError(res, error, "decidir");
  }
});
