import { Router, Response } from "express";
import { Prisma, AcaoEficiencia } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria, diffCampos } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA, EventoAuditoriaTipo } from "../audit/taxonomia";
import { entidadeIdEficienciaAcao } from "../audit/identidadeEntidade";
import { codforsDoTime, consultoresFiltraveis, gerenciaDepartamento } from "../domain/contextoProjeto";
import { AcessoEficiencia, carregarPropostaNoEscopo, ehGestor, resolverAcesso } from "../domain/eficienciaAcesso";
import {
  ContagemAcoes,
  STATUS_ACAO,
  contarAcoes,
  estaAtrasada,
  filtroAcoesValido,
  hojeIso,
  passaFiltroAcao,
  rotuloStatusAcao,
  validarEdicaoAcao,
  validarNovaAcao,
  validarStatus,
} from "../domain/eficienciaAcoes";
import { notificarConsultorPorCodfor } from "../domain/notificacoes";

// Painel de Eficiência — Plano de ação: o que o gestor combinou a partir de um alerta, com responsável do time e prazo.
//
// Guarda POR HANDLER, não a de gestor/admin do painel: o responsável é um consultor do time (não gestor) e precisa ver e
// concluir a ação dele. Quem pode o quê:
//   criar        admin; gestor, só no escopo dele (proposta que enxerga) e com responsável do time dele
//   ver          admin, criador, responsável, gestor do departamento da ação
//   editar/excluir  admin, criador, gestor do departamento da ação
//   mudar status    quem edita + o responsável
// Ação que o usuário não vê responde 404 (não 403), pra não confirmar que existe.
export const eficienciaAcoesRouter = Router();
eficienciaAcoesRouter.use(requireAuth);

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[eficiencia-acoes:${label}]`, message);
  res.status(500).json({ error: message });
}

const meuCodfor = (a: AcessoEficiencia) => a.contexto.consultor?.codfor ?? null;
const isoDaData = (d: Date) => d.toISOString().slice(0, 10);
const formatarPrazo = (iso: string) => iso.split("-").reverse().join("/");

function podeVer(a: AcessoEficiencia, acao: AcaoEficiencia): boolean {
  return (
    a.admin ||
    acao.criadoPor === a.userId ||
    (meuCodfor(a) != null && acao.responsavelCodfor === meuCodfor(a)) ||
    (acao.depexe != null && gerenciaDepartamento(a.role, a.contexto, acao.depexe))
  );
}

function podeEditar(a: AcessoEficiencia, acao: AcaoEficiencia): boolean {
  return a.admin || acao.criadoPor === a.userId || (acao.depexe != null && gerenciaDepartamento(a.role, a.contexto, acao.depexe));
}

const souResponsavel = (a: AcessoEficiencia, acao: AcaoEficiencia) => meuCodfor(a) != null && acao.responsavelCodfor === meuCodfor(a);

// O que o usuário enxerga: o filtro vai no banco (não em memória) pra o `where` valer também na contagem do painel.
export function acoesVisiveisWhere(a: AcessoEficiencia): Prisma.AcaoEficienciaWhereInput {
  if (a.admin) return {};
  const ou: Prisma.AcaoEficienciaWhereInput[] = [{ criadoPor: a.userId }];
  if (meuCodfor(a) != null) ou.push({ responsavelCodfor: meuCodfor(a)! });
  if (a.contexto.departamentosGerenciados.length > 0) ou.push({ depexe: { in: a.contexto.departamentosGerenciados } });
  return { OR: ou };
}

// Contagem das ações visíveis (a barra de abas e o alerta do painel usam).
export async function contagemDeAcoes(a: AcessoEficiencia): Promise<ContagemAcoes> {
  const linhas = await prisma.acaoEficiencia.findMany({ where: acoesVisiveisWhere(a), select: { status: true, prazo: true } });
  return contarAcoes(linhas.map((l) => ({ status: l.status, prazo: isoDaData(l.prazo) })), hojeIso());
}

// ---------- DTO ----------

async function montarDtos(acoes: AcaoEficiencia[], a: AcessoEficiencia, hoje: string) {
  const codfors = [...new Set(acoes.flatMap((x) => [x.responsavelCodfor, x.codforAlvo]).filter((c): c is number => c != null))];
  const userIds = [...new Set(acoes.map((x) => x.criadoPor))];
  const pares = [...new Map(acoes.filter((x) => x.codemp != null && x.codpro != null).map((x) => [`${x.codemp}-${x.codpro}`, x])).values()];

  const [consultores, usuarios, propostas] = await Promise.all([
    codfors.length ? prisma.consultor.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true, nomcom: true, nomfor: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nome: true } }) : [],
    pares.length
      ? prisma.$queryRaw<{ codemp: number; codpro: number; cliente: string | null }[]>`
          SELECT p.codemp, p.codpro, COALESCE(NULLIF(TRIM(c.apecli), ''), c.nomcli) AS cliente
          FROM propostas p LEFT JOIN clientes c ON c.codcli = p.codcli
          WHERE (p.codemp, p.codpro) IN (${Prisma.join(pares.map((x) => Prisma.sql`(${x.codemp}, ${x.codpro})`))})`
      : [],
  ]);
  const nomeConsultor = new Map<number, string>();
  for (const c of consultores) if (c.codfor != null && !nomeConsultor.has(c.codfor)) nomeConsultor.set(c.codfor, c.nomcom ?? c.nomfor ?? `Consultor ${c.codfor}`);
  const nomeUsuario = new Map(usuarios.map((u) => [u.id, u.nome]));
  const clienteDe = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p.cliente]));

  return acoes.map((x) => {
    const prazo = isoDaData(x.prazo);
    const editar = podeEditar(a, x);
    return {
      id: x.id,
      titulo: x.titulo,
      observacao: x.observacao,
      codemp: x.codemp,
      codpro: x.codpro,
      cliente: x.codemp != null && x.codpro != null ? clienteDe.get(`${x.codemp}-${x.codpro}`) ?? null : null,
      codforAlvo: x.codforAlvo,
      alvoNome: x.codforAlvo != null ? nomeConsultor.get(x.codforAlvo) ?? null : null,
      origemAlerta: x.origemAlerta,
      responsavelCodfor: x.responsavelCodfor,
      responsavelNome: nomeConsultor.get(x.responsavelCodfor) ?? `Consultor ${x.responsavelCodfor}`,
      prazo,
      status: x.status,
      statusRotulo: rotuloStatusAcao(x.status),
      atrasada: estaAtrasada({ status: x.status, prazo }, hoje),
      concluidaEm: x.concluidaEm,
      criadoPorNome: nomeUsuario.get(x.criadoPor) ?? "—",
      criadoEm: x.criadoEm,
      podeEditar: editar,
      podeMudarStatus: editar || souResponsavel(a, x),
    };
  });
}

// Abertas primeiro, pelo prazo mais próximo; concluídas por último, as mais recentes antes.
function ordenarAcoes(acoes: AcaoEficiencia[]): AcaoEficiencia[] {
  return [...acoes].sort((x, y) => {
    const xc = x.status === "concluida" ? 1 : 0;
    const yc = y.status === "concluida" ? 1 : 0;
    if (xc !== yc) return xc - yc;
    if (xc === 1) return (y.concluidaEm?.getTime() ?? 0) - (x.concluidaEm?.getTime() ?? 0);
    return x.prazo.getTime() - y.prazo.getTime() || x.id - y.id;
  });
}

async function responder(res: Response, acoes: AcaoEficiencia[], a: AcessoEficiencia, filtroBruto: unknown) {
  const hoje = hojeIso();
  const filtro = filtroAcoesValido(filtroBruto);
  const dtos = await montarDtos(ordenarAcoes(acoes), a, hoje);
  res.json({
    hoje,
    status: STATUS_ACAO,
    contagens: contarAcoes(dtos, hoje),
    acoes: dtos.filter((d) => passaFiltroAcao(d, filtro, hoje)),
  });
}

// ---------- auditoria ----------

function auditar(tx: Prisma.TransactionClient, req: AuthenticatedRequest, acao: Pick<AcaoEficiencia, "id" | "titulo" | "codemp" | "codpro">, eventoTipo: EventoAuditoriaTipo, extra: { alteracoes?: ReturnType<typeof diffCampos>["alteracoes"]; metadata?: Record<string, unknown> } = {}) {
  return criarEventoAuditoria(
    {
      origem: "tela",
      usuarioId: req.user!.userId,
      codemp: acao.codemp,
      codpro: acao.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.EFICIENCIA_ACAO,
      entidadeId: entidadeIdEficienciaAcao(acao.id),
      entidadeRotulo: `Ação #${acao.id}: ${acao.titulo.slice(0, 120)}`,
      eventoTipo,
      alteracoes: extra.alteracoes ?? null,
      metadata: extra.metadata ?? null,
      correlationId: req.correlationId!,
    },
    tx
  );
}

const CAMPOS_AUDITADOS: Record<string, string> = { titulo: "Título", observacao: "Observação", prazo: "Prazo", responsavelCodfor: "Responsável" };

// Aviso ao responsável: nunca derruba a ação que o disparou (a ação já está gravada).
async function avisarResponsavel(responsavelCodfor: number, titulo: string, prazoIso: string, autorUserId: number) {
  try {
    await notificarConsultorPorCodfor(responsavelCodfor, "acao_eficiencia_atribuida", `Nova ação do plano de eficiência para você: “${titulo}”. Prazo: ${formatarPrazo(prazoIso)}.`, autorUserId);
  } catch (error) {
    console.error("[eficiencia-acoes:aviso]", error instanceof Error ? error.message : error);
  }
}

function idDaRota(req: AuthenticatedRequest): number | null {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function acaoVisivel(req: AuthenticatedRequest, a: AcessoEficiencia): Promise<AcaoEficiencia | null> {
  const id = idDaRota(req);
  if (id == null) return null;
  const acao = await prisma.acaoEficiencia.findUnique({ where: { id } });
  return acao && podeVer(a, acao) ? acao : null;
}

// ======================================================================================================
// Rotas
// ======================================================================================================

// Todas as ações que o gestor/admin enxerga (a aba "Plano de ação" do painel).
eficienciaAcoesRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    if (!a.admin && !ehGestor(a)) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    const acoes = await prisma.acaoEficiencia.findMany({ where: acoesVisiveisWhere(a) });
    await responder(res, acoes, a, req.query.filtro);
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// As ações em que EU sou o responsável (página "Minhas ações", aberta a qualquer consultor).
eficienciaAcoesRouter.get("/minhas", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    const codfor = meuCodfor(a);
    const acoes = codfor == null ? [] : await prisma.acaoEficiencia.findMany({ where: { responsavelCodfor: codfor } });
    await responder(res, acoes, a, req.query.filtro);
  } catch (error) {
    handleError(res, error, "minhas");
  }
});

// Quem pode ser responsável: o time do gestor (e ele mesmo); admin, qualquer consultor habilitado.
eficienciaAcoesRouter.get("/responsaveis", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    if (!a.admin && !ehGestor(a)) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    res.json({ responsaveis: await consultoresFiltraveis(a.admin ? "admin" : "gestor", a.contexto) });
  } catch (error) {
    handleError(res, error, "responsaveis");
  }
});

// Departamento que enxerga a ação: o da proposta de referência (ou de um item dela que o gestor gerencia); sem proposta, o
// primeiro que o gestor gerencia. Admin sem proposta não fixa departamento (a ação fica com ele, o responsável e o criador).
function depexeDaAcao(a: AcessoEficiencia, proposta: { depexe: number | null; itens: { depexe: number | null }[] } | null): number | null {
  const deps = a.contexto.departamentosGerenciados;
  if (a.admin) return proposta?.depexe ?? proposta?.itens.find((i) => i.depexe != null)?.depexe ?? null;
  if (proposta?.depexe != null && deps.includes(proposta.depexe)) return proposta.depexe;
  const doItem = proposta?.itens.find((i) => i.depexe != null && deps.includes(i.depexe))?.depexe;
  return doItem ?? deps[0] ?? null;
}

eficienciaAcoesRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    if (!a.admin && !ehGestor(a)) {
      res.status(403).json({ error: "Só gestor de departamento ou administrador cria ações" });
      return;
    }
    const v = validarNovaAcao(req.body, hojeIso());
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const nova = v.dados;

    const visiveis = await codforsDoTime(a.admin ? "admin" : "gestor", a.contexto);
    if (visiveis != null && !visiveis.has(nova.responsavelCodfor)) {
      res.status(403).json({ error: "O responsável precisa ser do seu time" });
      return;
    }
    if (nova.codforAlvo != null && visiveis != null && !visiveis.has(nova.codforAlvo)) {
      res.status(403).json({ error: "O consultor de referência precisa ser do seu time" });
      return;
    }
    const responsavel = await prisma.consultor.findFirst({ where: { codfor: nova.responsavelCodfor }, select: { nomcom: true, nomfor: true } });
    if (!responsavel) {
      res.status(400).json({ error: "Responsável não encontrado" });
      return;
    }

    let proposta: { depexe: number | null; itens: { depexe: number | null }[] } | null = null;
    if (nova.codemp != null && nova.codpro != null) {
      const alvo = await carregarPropostaNoEscopo(nova.codemp, nova.codpro, a);
      if (!alvo) {
        res.status(404).json({ error: "Proposta não encontrada no seu escopo" });
        return;
      }
      proposta = alvo.p;
    }
    const depexe = depexeDaAcao(a, proposta);

    const criada = await prisma.$transaction(async (tx) => {
      const row = await tx.acaoEficiencia.create({
        data: {
          titulo: nova.titulo,
          observacao: nova.observacao,
          codemp: nova.codemp,
          codpro: nova.codpro,
          codforAlvo: nova.codforAlvo,
          origemAlerta: nova.origemAlerta,
          depexe,
          responsavelCodfor: nova.responsavelCodfor,
          prazo: new Date(`${nova.prazo}T00:00:00.000Z`),
          criadoPor: a.userId,
        },
      });
      await auditar(tx, req, row, EVENTOS_AUDITORIA.EFICIENCIA_ACAO_CRIADA, {
        metadata: { responsavel: responsavel.nomcom ?? responsavel.nomfor, responsavelCodfor: row.responsavelCodfor, prazo: nova.prazo, origemAlerta: nova.origemAlerta },
      });
      return row;
    });

    await avisarResponsavel(criada.responsavelCodfor, criada.titulo, nova.prazo, a.userId);
    const [dto] = await montarDtos([criada], a, hojeIso());
    res.status(201).json(dto);
  } catch (error) {
    handleError(res, error, "criar");
  }
});

// Edição completa (título, observação, prazo, responsável): quem edita. Responsável comum só muda o status (rota abaixo).
eficienciaAcoesRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    const acao = await acaoVisivel(req, a);
    if (!acao) {
      res.status(404).json({ error: "Ação não encontrada" });
      return;
    }
    if (!podeEditar(a, acao)) {
      res.status(403).json({ error: "Você pode mudar o status desta ação, mas não editá-la" });
      return;
    }
    const v = validarEdicaoAcao(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const e = v.dados;
    const prazoAtual = isoDaData(acao.prazo);
    const prazoMudou = e.prazo != null && e.prazo !== prazoAtual;
    if (prazoMudou && e.prazo! < hojeIso()) {
      res.status(400).json({ error: "O prazo não pode ser anterior a hoje" });
      return;
    }
    const responsavelMudou = e.responsavelCodfor != null && e.responsavelCodfor !== acao.responsavelCodfor;
    if (responsavelMudou) {
      const visiveis = await codforsDoTime(a.admin ? "admin" : "gestor", a.contexto);
      if (visiveis != null && !visiveis.has(e.responsavelCodfor!)) {
        res.status(403).json({ error: "O responsável precisa ser do seu time" });
        return;
      }
      if (!(await prisma.consultor.findFirst({ where: { codfor: e.responsavelCodfor! }, select: { codfor: true } }))) {
        res.status(400).json({ error: "Responsável não encontrado" });
        return;
      }
    }

    const depois = await prisma.$transaction(async (tx) => {
      const row = await tx.acaoEficiencia.update({
        where: { id: acao.id },
        data: {
          ...(e.titulo !== undefined ? { titulo: e.titulo } : {}),
          ...(e.observacao !== undefined ? { observacao: e.observacao } : {}),
          ...(prazoMudou ? { prazo: new Date(`${e.prazo}T00:00:00.000Z`) } : {}),
          ...(responsavelMudou ? { responsavelCodfor: e.responsavelCodfor } : {}),
          // Prazo ou dono novos reabrem o aviso de vencida: a ação pode vencer de novo (ou ser de outra pessoa).
          ...(prazoMudou || responsavelMudou ? { avisoVencidaEm: null } : {}),
          atualizadoPor: a.userId,
        },
      });
      const diff = diffCampos(CAMPOS_AUDITADOS, { ...acao, prazo: prazoAtual }, { ...row, prazo: isoDaData(row.prazo) });
      if (diff.algumaMudanca) await auditar(tx, req, row, EVENTOS_AUDITORIA.EFICIENCIA_ACAO_ALTERADA, { alteracoes: diff.alteracoes });
      return row;
    });

    if (responsavelMudou) await avisarResponsavel(depois.responsavelCodfor, depois.titulo, isoDaData(depois.prazo), a.userId);
    const [dto] = await montarDtos([depois], a, hojeIso());
    res.json(dto);
  } catch (error) {
    handleError(res, error, "editar");
  }
});

// Mudança de status: quem edita E o responsável (é o que o consultor faz na página "Minhas ações").
eficienciaAcoesRouter.patch("/:id/status", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    const acao = await acaoVisivel(req, a);
    if (!acao) {
      res.status(404).json({ error: "Ação não encontrada" });
      return;
    }
    if (!podeEditar(a, acao) && !souResponsavel(a, acao)) {
      res.status(403).json({ error: "Só o responsável ou quem criou a ação muda o status" });
      return;
    }
    const v = validarStatus(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const status = v.dados;
    if (status === acao.status) {
      const [dto] = await montarDtos([acao], a, hojeIso());
      res.json(dto);
      return;
    }
    const depois = await prisma.$transaction(async (tx) => {
      const row = await tx.acaoEficiencia.update({
        where: { id: acao.id },
        data: { status, concluidaEm: status === "concluida" ? new Date() : null, atualizadoPor: a.userId },
      });
      await auditar(tx, req, row, EVENTOS_AUDITORIA.EFICIENCIA_ACAO_STATUS_ALTERADO, {
        alteracoes: { status: { de: acao.status, para: status, rotulo: "Status" } },
        metadata: { status, statusRotulo: rotuloStatusAcao(status), de: acao.status },
      });
      return row;
    });
    const [dto] = await montarDtos([depois], a, hojeIso());
    res.json(dto);
  } catch (error) {
    handleError(res, error, "status");
  }
});

eficienciaAcoesRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const a = await resolverAcesso(req.user!.userId, req.user!.role);
    const acao = await acaoVisivel(req, a);
    if (!acao) {
      res.status(404).json({ error: "Ação não encontrada" });
      return;
    }
    if (!podeEditar(a, acao)) {
      res.status(403).json({ error: "Só quem criou a ação (ou o gestor do departamento) pode excluí-la" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.acaoEficiencia.delete({ where: { id: acao.id } });
      await auditar(tx, req, acao, EVENTOS_AUDITORIA.EFICIENCIA_ACAO_EXCLUIDA, { metadata: { titulo: acao.titulo, status: acao.status, responsavelCodfor: acao.responsavelCodfor } });
    });
    res.json({ id: acao.id, excluida: true });
  } catch (error) {
    handleError(res, error, "excluir");
  }
});
