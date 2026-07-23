import { NextFunction, Response, Router } from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { podeExecutarAcao, resolverContextoConsultor } from "../domain/contextoProjeto";
import { Prisma } from "@prisma/client";

const INCLUDE_USUARIO = { usuario: { select: { nome: true, fotoUrl: true } } } as const;
type EventoComUsuario = Prisma.AuditEventoGetPayload<{ include: typeof INCLUDE_USUARIO }>;

export const auditoriaRouter = Router();

// admin sempre vê; qualquer papel com departamentosGerenciados.length > 0 (Líder
// Técnico/gestor de departamento) também — comercial e consultor comum ficam de fora
// nesta fase (decisão validada com o dono do produto). Mesmo padrão local de
// `contextoDoUsuario`, já duplicado em atividades.ts/alocacao.ts/apontamentos.ts, mas
// aqui a checagem é "acesso à tela/API inteira", não por atividade/depexe específico.
async function requireAcessoAuditoria(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user!.role === "admin") {
    next();
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }
  const contexto = await resolverContextoConsultor(user.email);
  if (contexto.departamentosGerenciados.length > 0) {
    next();
    return;
  }
  res.status(403).json({ error: "Sem permissão para acessar a auditoria" });
}

// RBAC fino (Fase 4): consultor comum não vê a tela principal (acima), mas pode ver o
// histórico contextual das PRÓPRIAS atividades (aba "Auditoria" dentro de
// AtividadeDetalhe.tsx) — mesmo recorte de "visualizar" já usado em atividades.ts/
// alocacao.ts (podeExecutarAcao). Proposta/proposta_item continuam só pra admin/gestor,
// mesmo via /entidade/:tipo/:id — "próprias atividades" no pedido original não inclui
// a proposta inteira.
async function podeVerEntidade(req: AuthenticatedRequest, entidadeTipo: string, entidadeId: string): Promise<boolean> {
  if (req.user!.role === "admin") return true;

  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return false;
  const contexto = await resolverContextoConsultor(user.email);
  if (contexto.departamentosGerenciados.length > 0) return true;

  if (!["atividade", "alocacao", "kanban_card"].includes(entidadeTipo)) return false;
  const atividadeId = Number(entidadeId);
  if (!Number.isFinite(atividadeId)) return false;

  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: atividadeId } });
  if (!atividade) return false;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) return false;

  return podeExecutarAcao(req.user!.role, contexto, "visualizar", { depexe: item.depexe, codfor: atividade.codfor });
}

auditoriaRouter.use(requireAuth);

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[auditoria:${label}]`, message);
  res.status(500).json({ error: message });
}

function parseIntParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value.split(",").filter((v) => v !== "");
  return items.length > 0 ? items : null;
}

function parseDateTimeParam(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const data = new Date(value);
  return Number.isNaN(data.getTime()) ? null : data;
}

// BigInt/Decimal não serializam em JSON.stringify nativo, e correlationId(uuid)/datas já
// vêm como string/Date do client — só id precisa de conversão explícita. `usuario` (join)
// é achatado em usuarioNome/usuarioFotoUrl — nulo quando origem é job/integracao_senior
// (sem usuário interativo) ou quando o usuário foi excluído depois (SetNull).
function serializarEvento(evento: EventoComUsuario) {
  const { usuario, ...resto } = evento;
  return {
    ...resto,
    id: evento.id.toString(),
    usuarioNome: usuario?.nome ?? null,
    usuarioFotoUrl: usuario?.fotoUrl ?? null,
  };
}

interface FiltrosAuditoria {
  where: Prisma.AuditEventoWhereInput;
  limit: number;
  cursor: bigint | null;
  agrupar: boolean;
}

function montarFiltros(query: AuthenticatedRequest["query"]): FiltrosAuditoria {
  const codemp = parseIntParam(query.codemp);
  const codpro = parseIntParam(query.codpro);
  const entidadeTipo = typeof query.entidadeTipo === "string" ? query.entidadeTipo : null;
  const entidadeId = typeof query.entidadeId === "string" ? query.entidadeId : null;
  const eventoTipo = parseStringListParam(query.eventoTipo);
  const origem = parseStringListParam(query.origem);
  const usuarioId = parseIntParam(query.usuarioId);
  const de = parseDateTimeParam(query.de);
  const ate = parseDateTimeParam(query.ate);

  const where: Prisma.AuditEventoWhereInput = {};
  if (codemp !== null && codpro !== null) {
    where.codemp = codemp;
    where.codpro = codpro;
  }
  if (entidadeTipo) where.entidadeTipo = entidadeTipo;
  if (entidadeId) where.entidadeId = entidadeId;
  if (eventoTipo) where.eventoTipo = { in: eventoTipo };
  if (origem) where.origem = { in: origem };
  if (usuarioId !== null) where.usuarioId = usuarioId;
  if (de || ate) {
    where.ocorridoEm = {};
    if (de) where.ocorridoEm.gte = de;
    if (ate) where.ocorridoEm.lte = ate;
  }

  const limitBruto = parseIntParam(query.limit) ?? 50;
  const limit = Math.min(200, Math.max(1, limitBruto));
  const cursorParam = typeof query.cursor === "string" && query.cursor !== "" ? query.cursor : null;
  let cursor: bigint | null = null;
  try {
    cursor = cursorParam ? BigInt(cursorParam) : null;
  } catch {
    cursor = null;
  }

  return { where, limit, cursor, agrupar: query.agrupar === "true" };
}

async function buscarPagina(filtros: FiltrosAuditoria) {
  const rows = await prisma.auditEvento.findMany({
    where: filtros.where,
    orderBy: [{ ocorridoEm: "desc" }, { id: "desc" }],
    take: filtros.limit + 1,
    include: INCLUDE_USUARIO,
    ...(filtros.cursor !== null ? { cursor: { id: filtros.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > filtros.limit;
  const pagina = hasMore ? rows.slice(0, filtros.limit) : rows;
  const nextCursor = hasMore ? pagina[pagina.length - 1].id.toString() : null;

  if (!filtros.agrupar) {
    return { rows: pagina.map(serializarEvento), nextCursor };
  }

  // Agrupa eventos consecutivos com mesmo correlationId dentro da página já buscada.
  // Limitação aceita: um grupo pode ficar cortado entre duas páginas em casos raros de
  // borda — cada linha de sync gera no máximo 2 eventos, sempre adjacentes por id.
  const grupos: { correlationId: string; ocorridoEm: string; origem: string; eventos: ReturnType<typeof serializarEvento>[] }[] = [];
  for (const evento of pagina) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.correlationId === evento.correlationId) {
      ultimo.eventos.push(serializarEvento(evento));
    } else {
      grupos.push({
        correlationId: evento.correlationId,
        ocorridoEm: evento.ocorridoEm.toISOString(),
        origem: evento.origem,
        eventos: [serializarEvento(evento)],
      });
    }
  }
  return { rows: grupos, nextCursor };
}

auditoriaRouter.get("/", requireAcessoAuditoria, async (req: AuthenticatedRequest, res) => {
  try {
    const filtros = montarFiltros(req.query);
    const resultado = await buscarPagina(filtros);
    res.json(resultado);
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// Máximo de linhas por exportação — evita uma query descontrolada; o filtro de período/
// proposta já aplicado na tela é o jeito de restringir mais. Só admin/gestor (mesmo
// recorte da tela principal, não do histórico contextual por entidade).
const LIMITE_EXPORT_CSV = 5000;

function csvEscape(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  if (/[",\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

auditoriaRouter.get("/export", requireAcessoAuditoria, async (req: AuthenticatedRequest, res) => {
  try {
    const filtros = montarFiltros(req.query);
    const linhas = await prisma.auditEvento.findMany({
      where: filtros.where,
      orderBy: [{ ocorridoEm: "desc" }, { id: "desc" }],
      take: LIMITE_EXPORT_CSV,
      include: INCLUDE_USUARIO,
    });

    const cabecalho = [
      "id",
      "ocorrido_em",
      "usuario",
      "origem",
      "codemp",
      "codpro",
      "entidade_tipo",
      "entidade_id",
      "entidade_rotulo",
      "evento_tipo",
      "alteracoes",
      "metadata",
      "correlation_id",
    ];
    const corpo = linhas.map((e) =>
      [
        e.id.toString(),
        e.ocorridoEm.toISOString(),
        e.usuario?.nome ?? "",
        e.origem,
        e.codemp ?? "",
        e.codpro ?? "",
        e.entidadeTipo,
        e.entidadeId,
        e.entidadeRotulo ?? "",
        e.eventoTipo,
        e.alteracoes ?? "",
        e.metadata ?? "",
        e.correlationId,
      ]
        .map(csvEscape)
        .join(",")
    );
    const csv = [cabecalho.join(","), ...corpo].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="auditoria_${Date.now()}.csv"`);
    res.send(`﻿${csv}`); // BOM: Excel no Windows abre UTF-8 corretamente com acentos
  } catch (error) {
    handleError(res, error, "export");
  }
});

auditoriaRouter.get("/entidade/:tipo/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const permitido = await podeVerEntidade(req, req.params.tipo, req.params.id);
    if (!permitido) {
      res.status(403).json({ error: "Sem permissão para ver o histórico desta entidade" });
      return;
    }
    const filtros = montarFiltros(req.query);
    filtros.where.entidadeTipo = req.params.tipo;
    filtros.where.entidadeId = req.params.id;
    const resultado = await buscarPagina(filtros);
    res.json(resultado);
  } catch (error) {
    handleError(res, error, "entidade");
  }
});
