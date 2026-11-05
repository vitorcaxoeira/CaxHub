import { NextFunction, Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { diffCampos, paraDiff } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { nomeConsultor } from "../domain/contextoProjeto";
import {
  MODO_ROTULO,
  SITUACAO_PARCELA_ROTULO,
  STATUS_PROCESSO_ROTULO,
  competenciaDe,
  numeroDoProcesso,
  saldoDevedor,
  totalDescontado,
  validarProcesso,
  type DadosDoProcesso,
  type ModoDesconto,
  type SituacaoParcela,
  type StatusProcesso,
} from "../domain/descontos";
import { escopoDoUsuario, escopoSql, podeAdministrarDescontos, podeVerConsultor, type EscopoDescontos } from "../domain/descontosAcesso";
import {
  auditarDesconto,
  dec,
  descontosPorCompetencia,
  hojeBrasil,
  isoCompetencia,
  isoDia,
  proximaSequencia,
  recalcularStatusDoProcesso,
  rotuloDoProcesso,
} from "../domain/descontosDados";
import { fecharCompetencia } from "../sync/fechamentoDescontos";
import { col, registrarListaConsultavel } from "./listaConsultavel";

// Gestão de Descontos (Gestão de Projetos › Gestão de Descontos, 05/11/2026): descontos abatidos da nota dos consultores. Regras de cálculo
// em domain/descontos.ts; acesso em domain/descontosAcesso.ts (admin e administrativo administram; gestor vê o time; consultor vê os
// próprios). Tudo local: nada daqui vai ao Senior.
export const descontosRouter = Router();
descontosRouter.use(requireAuth);

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[descontos:${label}]`, message);
  res.status(500).json({ error: message });
}

// O escopo é resolvido uma vez por requisição (a lista consulta 3 rotas: lista, resumo e valores).
const escopos = new WeakMap<Request, Promise<EscopoDescontos | null>>();
function escopoDe(req: Request): Promise<EscopoDescontos | null> {
  let p = escopos.get(req);
  if (!p) {
    const r = req as AuthenticatedRequest;
    p = escopoDoUsuario(r.user!.userId, r.user!.role as string);
    escopos.set(req, p);
  }
  return p;
}
async function escopoOuErro(req: Request, res: Response): Promise<EscopoDescontos | null> {
  const e = await escopoDe(req);
  if (!e) res.status(404).json({ error: "Usuário não encontrado" });
  return e;
}
function exigirAdministra(req: Request, res: Response, next: NextFunction) {
  if (!podeAdministrarDescontos((req as AuthenticatedRequest).user!.role as string)) {
    res.status(403).json({ error: "Sem permissão: apenas administrador e administrativo gerenciam descontos" });
    return;
  }
  next();
}

// ---------------------------------------------------------------- leitura de entrada
const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;
function lerData(v: unknown): Date | null {
  if (typeof v !== "string" || !ISO_DIA.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}
/** "AAAA-MM" ou "AAAA-MM-DD": sempre o dia 1 do mês. */
function lerCompetencia(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  if (/^\d{4}-\d{2}$/.test(v)) return lerData(`${v}-01`);
  const d = lerData(v);
  return d ? competenciaDe(d) : null;
}
function lerValor(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}
function lerInteiro(v: unknown): number | null {
  const n = lerValor(v);
  return n != null && Number.isInteger(n) ? n : null;
}
const qTexto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const qInteiro = (v: unknown) => (typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : null);
const qCompetencia = (v: unknown) => {
  const d = lerCompetencia(v);
  return d ? isoDia(d) : null;
};
function lerJustificativa(body: unknown): string | null {
  const t = typeof (body as { justificativa?: unknown })?.justificativa === "string" ? (body as { justificativa: string }).justificativa.trim() : "";
  return t.length >= 3 && t.length <= 500 ? t : null;
}

// Acesso da pessoa ao módulo (o menu decide o que mostrar): administra = admin/administrativo; gestao = administra ou gestor de área
// (vê o time, fechamentos); visualiza = qualquer um que tenha o que ver (inclui o consultor, só os próprios).
descontosRouter.get("/meu-acesso", async (req, res) => {
  try {
    const escopo = await escopoOuErro(req, res);
    if (!escopo) return;
    res.json({
      administra: escopo.administra,
      gestao: escopo.administra || escopo.ehGestor,
      visualiza: escopo.administra || escopo.ehGestor || escopo.proprio != null,
      proprioCodfor: escopo.proprio?.codfor ?? null,
    });
  } catch (error) {
    handleError(res, error, "meu-acesso");
  }
});

// ---------------------------------------------------------------- consultores
// Quem a pessoa pode escolher no seletor/filtro: quem administra, todos os habilitados; gestor, o time; consultor, ele mesmo.
descontosRouter.get("/consultores", async (req, res) => {
  try {
    const escopo = await escopoOuErro(req, res);
    if (!escopo) return;
    res.json({ consultores: await escopo.consultores(), administra: escopo.administra, ehGestor: escopo.ehGestor, proprioCodfor: escopo.proprio?.codfor ?? null });
  } catch (error) {
    handleError(res, error, "consultores");
  }
});

// ---------------------------------------------------------------- tipos
const CAMPOS_TIPO: Record<string, string> = {
  nome: "Nome",
  descricao: "Descrição",
  ativo: "Ativo",
  permiteParcelamento: "Permite parcelamento",
  maxParcelas: "Máximo de parcelas",
  valorMinimo: "Valor mínimo",
  valorMaximo: "Valor máximo",
  exigeObservacao: "Exige observação",
  ordem: "Ordem",
};

interface DadosTipo {
  nome: string;
  descricao: string | null;
  ativo: boolean;
  permiteParcelamento: boolean;
  maxParcelas: number | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  exigeObservacao: boolean;
  ordem: number;
}

function lerTipo(body: Record<string, unknown>): { ok: true; dados: DadosTipo } | { ok: false; erro: string } {
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  if (!nome) return { ok: false, erro: "Informe o nome do tipo de desconto" };
  if (nome.length > 80) return { ok: false, erro: "O nome deve ter até 80 caracteres" };
  const descricao = typeof body.descricao === "string" && body.descricao.trim() ? body.descricao.trim() : null;
  if (descricao && descricao.length > 250) return { ok: false, erro: "A descrição deve ter até 250 caracteres" };
  const opcional = (v: unknown) => (v === null || v === undefined || v === "" ? null : lerValor(v));
  const maxParcelas = body.maxParcelas === null || body.maxParcelas === undefined || body.maxParcelas === "" ? null : lerInteiro(body.maxParcelas);
  if (body.maxParcelas !== null && body.maxParcelas !== undefined && body.maxParcelas !== "" && (maxParcelas == null || maxParcelas < 1)) {
    return { ok: false, erro: "O limite de parcelas deve ser um inteiro maior que zero" };
  }
  const valorMinimo = opcional(body.valorMinimo);
  const valorMaximo = opcional(body.valorMaximo);
  if ((body.valorMinimo ?? "") !== "" && (valorMinimo == null || valorMinimo < 0)) return { ok: false, erro: "Valor mínimo inválido" };
  if ((body.valorMaximo ?? "") !== "" && (valorMaximo == null || valorMaximo <= 0)) return { ok: false, erro: "Valor máximo inválido" };
  if (valorMinimo != null && valorMaximo != null && valorMinimo > valorMaximo) return { ok: false, erro: "O valor mínimo não pode ser maior que o máximo" };
  const ordem = body.ordem === undefined || body.ordem === null || body.ordem === "" ? 0 : lerInteiro(body.ordem);
  if (ordem == null) return { ok: false, erro: "Ordem inválida" };
  return {
    ok: true,
    dados: {
      nome,
      descricao,
      ativo: body.ativo === undefined ? true : body.ativo === true,
      permiteParcelamento: body.permiteParcelamento === undefined ? true : body.permiteParcelamento === true,
      maxParcelas,
      valorMinimo,
      valorMaximo,
      exigeObservacao: body.exigeObservacao === true,
      ordem,
    },
  };
}

function tipoParaResposta(t: Prisma.DescontoTipoGetPayload<{ include: { _count: { select: { processos: true } } } }>) {
  return {
    id: t.id,
    nome: t.nome,
    descricao: t.descricao,
    ativo: t.ativo,
    permiteParcelamento: t.permiteParcelamento,
    maxParcelas: t.maxParcelas,
    valorMinimo: t.valorMinimo == null ? null : dec(t.valorMinimo),
    valorMaximo: t.valorMaximo == null ? null : dec(t.valorMaximo),
    exigeObservacao: t.exigeObservacao,
    ordem: t.ordem,
    criadoEm: t.criadoEm,
    emUso: t._count.processos,
  };
}

const diffDoTipo = (t: DadosTipo) => paraDiff({ ...t });

descontosRouter.get("/tipos", async (req, res) => {
  try {
    const busca = qTexto(req.query.busca);
    const situacao = qTexto(req.query.ativo);
    const tipos = await prisma.descontoTipo.findMany({
      where: {
        ...(busca ? { nome: { contains: busca, mode: "insensitive" as const } } : {}),
        ...(situacao === "true" ? { ativo: true } : situacao === "false" ? { ativo: false } : {}),
      },
      include: { _count: { select: { processos: true } } },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    });
    res.json({ tipos: tipos.map(tipoParaResposta) });
  } catch (error) {
    handleError(res, error, "tipos");
  }
});

async function nomeDeTipoEmUso(nome: string, ignorarId?: number) {
  return prisma.descontoTipo.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
}

descontosRouter.post("/tipos", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const lido = lerTipo(req.body ?? {});
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    if (await nomeDeTipoEmUso(lido.dados.nome)) {
      res.status(409).json({ error: "Já existe um tipo de desconto com este nome" });
      return;
    }
    const criado = await prisma.$transaction(async (tx) => {
      const t = await tx.descontoTipo.create({ data: { ...lido.dados, criadoPorId: req.user!.userId }, include: { _count: { select: { processos: true } } } });
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_TIPO,
        entidadeId: String(t.id),
        rotulo: `Tipo de desconto ${t.nome}`,
        evento: "DESCONTO_TIPO_CRIADO",
        alteracoes: diffCampos(CAMPOS_TIPO, null, diffDoTipo(lido.dados)).alteracoes,
      });
      return t;
    });
    res.status(201).json({ tipo: tipoParaResposta(criado) });
  } catch (error) {
    handleError(res, error, "tipo-criar");
  }
});

descontosRouter.put("/tipos/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = qInteiro(req.params.id);
    const atual = id == null ? null : await prisma.descontoTipo.findUnique({ where: { id } });
    if (!atual) {
      res.status(404).json({ error: "Tipo não encontrado" });
      return;
    }
    const lido = lerTipo(req.body ?? {});
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    if (await nomeDeTipoEmUso(lido.dados.nome, atual.id)) {
      res.status(409).json({ error: "Já existe um tipo de desconto com este nome" });
      return;
    }
    const antes = diffDoTipo({
      nome: atual.nome,
      descricao: atual.descricao,
      ativo: atual.ativo,
      permiteParcelamento: atual.permiteParcelamento,
      maxParcelas: atual.maxParcelas,
      valorMinimo: atual.valorMinimo == null ? null : dec(atual.valorMinimo),
      valorMaximo: atual.valorMaximo == null ? null : dec(atual.valorMaximo),
      exigeObservacao: atual.exigeObservacao,
      ordem: atual.ordem,
    });
    const diff = diffCampos(CAMPOS_TIPO, antes, diffDoTipo(lido.dados));
    const salvo = await prisma.$transaction(async (tx) => {
      const t = await tx.descontoTipo.update({ where: { id: atual.id }, data: lido.dados, include: { _count: { select: { processos: true } } } });
      if (diff.algumaMudanca) {
        await auditarDesconto(tx, {
          usuarioId: req.user!.userId,
          origem: "tela",
          correlationId: req.correlationId!,
          entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_TIPO,
          entidadeId: String(t.id),
          rotulo: `Tipo de desconto ${t.nome}`,
          evento: "DESCONTO_TIPO_ALTERADO",
          alteracoes: diff.alteracoes,
        });
      }
      return t;
    });
    res.json({ tipo: tipoParaResposta(salvo) });
  } catch (error) {
    handleError(res, error, "tipo-alterar");
  }
});

descontosRouter.delete("/tipos/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = qInteiro(req.params.id);
    const atual = id == null ? null : await prisma.descontoTipo.findUnique({ where: { id }, include: { _count: { select: { processos: true } } } });
    if (!atual) {
      res.status(404).json({ error: "Tipo não encontrado" });
      return;
    }
    if (atual._count.processos > 0) {
      res.status(409).json({ error: "Este tipo já tem lançamentos vinculados: inative em vez de excluir" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.descontoTipo.delete({ where: { id: atual.id } });
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_TIPO,
        entidadeId: String(atual.id),
        rotulo: `Tipo de desconto ${atual.nome}`,
        evento: "DESCONTO_TIPO_EXCLUIDO",
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "tipo-excluir");
  }
});

// ---------------------------------------------------------------- listas (padrão de colunas do CaxHub)
const caseRotulo = (coluna: string, rotulos: Record<string, string>) =>
  Prisma.raw(`CASE ${coluna} ${Object.entries(rotulos).map(([k, v]) => `WHEN '${k}' THEN '${v}'`).join(" ")} ELSE ${coluna} END`);

const NOME_CONSULTOR = Prisma.sql`COALESCE(co.nomcom, co.nomfor, 'Fornecedor ' || p.codfor)`;
const JOIN_CONSULTOR = Prisma.sql`LEFT JOIN LATERAL (SELECT c.nomcom, c.nomfor FROM consultores c WHERE c.codfor = p.codfor LIMIT 1) co ON TRUE`;
const ehStatus = (v: string): v is StatusProcesso => v in STATUS_PROCESSO_ROTULO;
const ehSituacao = (v: string): v is SituacaoParcela => v in SITUACAO_PARCELA_ROTULO;

registrarListaConsultavel(
  descontosRouter,
  "/processos",
  async (req) => {
    const escopo = await escopoDe(req);
    if (!escopo) throw new Error("Usuário não encontrado");
    const q = req.query;
    const codfor = qInteiro(q.codfor);
    const tipoId = qInteiro(q.tipoId);
    const processo = qTexto(q.processo).toUpperCase();
    const status = ehStatus(qTexto(q.status)) ? qTexto(q.status) : null;
    const situacao = ehSituacao(qTexto(q.situacaoParcela)) ? qTexto(q.situacaoParcela) : null;
    const competencia = qCompetencia(q.competencia);
    const vigDe = lerData(q.vigenciaDe) ? qTexto(q.vigenciaDe) : null;
    const vigAte = lerData(q.vigenciaAte) ? qTexto(q.vigenciaAte) : null;
    const lancDe = lerData(q.lancamentoDe) ? qTexto(q.lancamentoDe) : null;
    const lancAte = lerData(q.lancamentoAte) ? qTexto(q.lancamentoAte) : null;
    return {
      interna: Prisma.sql`
        SELECT p.id, 'DESC-' || p.ano || '-' || lpad(p.sequencia::text, 6, '0') AS processo, p.codemp, p.codfor,
               ${NOME_CONSULTOR} AS consultor, t.nome AS tipo, t.id AS "tipoId",
               ${caseRotulo("p.modo", MODO_ROTULO)} AS modo,
               p.valor_total::float8 AS "valorTotal", p.valor_parcela::float8 AS "valorParcela", p.qtd_parcelas AS "qtdParcelas",
               p.vigencia_inicio AS "vigenciaInicio", p.vigencia_fim AS "vigenciaFim", p.competencia_inicial AS "competenciaInicial",
               a.comp_final AS "competenciaFinal", a.prox AS "proximaCompetencia",
               a.descontadas AS "parcelasDescontadas", a.pendentes AS "parcelasPendentes",
               a.descontado::float8 AS "totalDescontado", a.saldo::float8 AS "saldoDevedor",
               ${caseRotulo("p.status", STATUS_PROCESSO_ROTULO)} AS status, p.status AS "statusCodigo",
               p.observacao, p.criado_em AS "criadoEm"
        FROM descontos_processos p
        JOIN descontos_tipos t ON t.id = p.tipo_id
        ${JOIN_CONSULTOR}
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE dp.situacao IN ('descontada', 'parcial'))::int AS descontadas,
                 count(*) FILTER (WHERE dp.situacao = 'pendente')::int AS pendentes,
                 COALESCE(sum(dp.valor_descontado), 0) AS descontado,
                 COALESCE(sum(dp.valor) FILTER (WHERE dp.situacao = 'pendente'), 0) AS saldo,
                 max(dp.competencia) FILTER (WHERE dp.situacao NOT IN ('cancelada', 'estornada')) AS comp_final,
                 min(dp.competencia) FILTER (WHERE dp.situacao = 'pendente') AS prox
          FROM descontos_parcelas dp WHERE dp.processo_id = p.id
        ) a ON TRUE
        WHERE ${escopoSql(escopo, Prisma.sql`p.codfor`)}
          AND (${codfor}::int IS NULL OR p.codfor = ${codfor}::int)
          AND (${tipoId}::int IS NULL OR p.tipo_id = ${tipoId}::int)
          AND (${processo} = '' OR position(${processo} IN ('DESC-' || p.ano || '-' || lpad(p.sequencia::text, 6, '0'))) > 0)
          AND (${status}::text IS NULL OR p.status = ${status}::text)
          AND (${situacao}::text IS NULL OR EXISTS (SELECT 1 FROM descontos_parcelas x WHERE x.processo_id = p.id AND x.situacao = ${situacao}::text))
          AND (${competencia}::date IS NULL OR EXISTS (SELECT 1 FROM descontos_parcelas x WHERE x.processo_id = p.id AND x.competencia = ${competencia}::date))
          AND (${vigDe}::date IS NULL OR p.vigencia_fim >= ${vigDe}::date)
          AND (${vigAte}::date IS NULL OR p.vigencia_inicio <= ${vigAte}::date)
          AND (${lancDe}::date IS NULL OR (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date >= ${lancDe}::date)
          AND (${lancAte}::date IS NULL OR (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date <= ${lancAte}::date)`,
      colunas: [
        col.inteiro("id", { obrigatoria: true }),
        col.texto("processo", { obrigatoria: true }),
        col.texto("consultor", { obrigatoria: true }),
        col.texto("tipo"),
        col.texto("modo"),
        col.decimal("valorTotal"),
        col.decimal("valorParcela"),
        col.inteiro("qtdParcelas"),
        col.data("vigenciaInicio"),
        col.data("vigenciaFim"),
        col.data("competenciaInicial"),
        col.data("competenciaFinal"),
        col.data("proximaCompetencia"),
        col.inteiro("parcelasDescontadas"),
        col.inteiro("parcelasPendentes"),
        col.decimal("totalDescontado"),
        col.decimal("saldoDevedor"),
        col.texto("status", { obrigatoria: true }),
        col.data("criadoEm"),
        col.texto("observacao"),
      ],
      totais: ["valorTotal", "totalDescontado", "saldoDevedor"],
      ordemPadrao: Prisma.sql`x."criadoEm" DESC, x."id" DESC`,
      pageSizePadrao: 30,
    };
  },
  "descontos-processos"
);

registrarListaConsultavel(
  descontosRouter,
  "/parcelas",
  async (req) => {
    const escopo = await escopoDe(req);
    if (!escopo) throw new Error("Usuário não encontrado");
    const q = req.query;
    const codfor = qInteiro(q.codfor);
    const tipoId = qInteiro(q.tipoId);
    const processo = qTexto(q.processo).toUpperCase();
    const situacao = ehSituacao(qTexto(q.situacao)) ? qTexto(q.situacao) : null;
    const compDe = qCompetencia(q.competenciaDe);
    const compAte = qCompetencia(q.competenciaAte);
    return {
      interna: Prisma.sql`
        SELECT dp.id, p.id AS "processoId", 'DESC-' || p.ano || '-' || lpad(p.sequencia::text, 6, '0') AS processo, p.codemp, p.codfor,
               ${NOME_CONSULTOR} AS consultor, t.nome AS tipo,
               dp.numero AS parcela, p.qtd_parcelas AS "qtdParcelas",
               dp.competencia, dp.vencimento, dp.valor::float8 AS valor, dp.valor_descontado::float8 AS "valorDescontado",
               (CASE dp.situacao WHEN 'pendente' THEN dp.valor WHEN 'parcial' THEN dp.valor - dp.valor_descontado ELSE 0 END)::float8 AS restante,
               ${caseRotulo("dp.situacao", SITUACAO_PARCELA_ROTULO)} AS situacao, dp.situacao AS "situacaoCodigo",
               dp.observacao
        FROM descontos_parcelas dp
        JOIN descontos_processos p ON p.id = dp.processo_id
        JOIN descontos_tipos t ON t.id = p.tipo_id
        ${JOIN_CONSULTOR}
        WHERE ${escopoSql(escopo, Prisma.sql`p.codfor`)}
          AND (${codfor}::int IS NULL OR p.codfor = ${codfor}::int)
          AND (${tipoId}::int IS NULL OR p.tipo_id = ${tipoId}::int)
          AND (${processo} = '' OR position(${processo} IN ('DESC-' || p.ano || '-' || lpad(p.sequencia::text, 6, '0'))) > 0)
          AND (${situacao}::text IS NULL OR dp.situacao = ${situacao}::text)
          AND (${compDe}::date IS NULL OR dp.competencia >= ${compDe}::date)
          AND (${compAte}::date IS NULL OR dp.competencia <= ${compAte}::date)`,
      colunas: [
        col.inteiro("id", { obrigatoria: true }),
        col.texto("processo", { obrigatoria: true }),
        col.texto("consultor", { obrigatoria: true }),
        col.texto("tipo"),
        col.inteiro("parcela"),
        col.data("competencia"),
        col.data("vencimento"),
        col.decimal("valor"),
        col.decimal("valorDescontado"),
        col.decimal("restante"),
        col.texto("situacao", { obrigatoria: true }),
        col.texto("observacao"),
      ],
      totais: ["valor", "valorDescontado", "restante"],
      ordemPadrao: Prisma.sql`x."competencia" ASC, x."vencimento" ASC, x."id" ASC`,
      pageSizePadrao: 30,
    };
  },
  "descontos-parcelas"
);

registrarListaConsultavel(
  descontosRouter,
  "/fechamentos",
  async (req) => {
    const escopo = await escopoDe(req);
    if (!escopo) throw new Error("Usuário não encontrado");
    const q = req.query;
    const codfor = qInteiro(q.codfor);
    const compDe = qCompetencia(q.competenciaDe);
    const compAte = qCompetencia(q.competenciaAte);
    return {
      interna: Prisma.sql`
        SELECT f.competencia, f.codemp, f.codfor,
               COALESCE(co.nomcom, co.nomfor, 'Fornecedor ' || f.codfor) AS consultor,
               f.valor_nota::float8 AS "valorNota", f.total_previsto::float8 AS "totalPrevisto", f.total_descontado::float8 AS "totalDescontado",
               (f.valor_nota - f.total_descontado)::float8 AS liquido, f.saldo_transportado::float8 AS "saldoTransportado",
               CASE f.origem WHEN 'job' THEN 'Automático' ELSE 'Manual' END AS origem, f.fechado_em AS "fechadoEm"
        FROM descontos_fechamentos f
        LEFT JOIN LATERAL (SELECT c.nomcom, c.nomfor FROM consultores c WHERE c.codfor = f.codfor LIMIT 1) co ON TRUE
        WHERE ${escopoSql(escopo, Prisma.sql`f.codfor`)}
          AND (${codfor}::int IS NULL OR f.codfor = ${codfor}::int)
          AND (${compDe}::date IS NULL OR f.competencia >= ${compDe}::date)
          AND (${compAte}::date IS NULL OR f.competencia <= ${compAte}::date)`,
      colunas: [
        col.data("competencia", { obrigatoria: true }),
        col.texto("consultor", { obrigatoria: true }),
        col.decimal("valorNota"),
        col.decimal("totalPrevisto"),
        col.decimal("totalDescontado"),
        col.decimal("liquido"),
        col.decimal("saldoTransportado"),
        col.texto("origem"),
        col.data("fechadoEm"),
      ],
      totais: ["valorNota", "totalPrevisto", "totalDescontado", "liquido", "saldoTransportado"],
      ordemPadrao: Prisma.sql`x."competencia" DESC, x."consultor" ASC`,
      pageSizePadrao: 30,
    };
  },
  "descontos-fechamentos"
);

// ---------------------------------------------------------------- processos: detalhe, simulação, criação, edição
interface DadosProcessoLidos extends DadosDoProcesso {
  codfor: number;
  tipoId: number;
}

function lerProcesso(body: Record<string, unknown>): { ok: true; dados: DadosProcessoLidos } | { ok: false; erro: string } {
  const codfor = lerInteiro(body.codfor);
  if (codfor == null) return { ok: false, erro: "Selecione o consultor" };
  const tipoId = lerInteiro(body.tipoId);
  if (tipoId == null) return { ok: false, erro: "Selecione o tipo de desconto" };
  const modo = body.modo as ModoDesconto;
  const vigenciaInicio = lerData(body.vigenciaInicio);
  const vigenciaFim = lerData(body.vigenciaFim);
  const competenciaInicial = lerCompetencia(body.competenciaInicial);
  if (!vigenciaInicio) return { ok: false, erro: "Informe a data inicial da vigência" };
  if (!vigenciaFim) return { ok: false, erro: "Informe a data final da vigência" };
  if (!competenciaInicial) return { ok: false, erro: "Informe a competência inicial" };
  const diaVencimento = lerInteiro(body.diaVencimento);
  if (diaVencimento == null) return { ok: false, erro: "Informe o dia de vencimento" };
  const qtdParcelas = lerInteiro(body.qtdParcelas);
  if (qtdParcelas == null) return { ok: false, erro: "A quantidade de parcelas deve ser um número inteiro maior que zero" };
  const observacao = typeof body.observacao === "string" && body.observacao.trim() ? body.observacao.trim() : null;
  if (observacao && observacao.length > 500) return { ok: false, erro: "A observação deve ter até 500 caracteres" };
  return {
    ok: true,
    dados: {
      codfor,
      tipoId,
      modo,
      valorTotal: lerValor(body.valorTotal),
      valorParcela: lerValor(body.valorParcela),
      qtdParcelas,
      vigenciaInicio,
      vigenciaFim,
      competenciaInicial,
      diaVencimento,
      observacao,
    },
  };
}

function tipoParaValidar(t: { ativo: boolean; permiteParcelamento: boolean; maxParcelas: number | null; valorMinimo: Prisma.Decimal | null; valorMaximo: Prisma.Decimal | null; exigeObservacao: boolean }) {
  return {
    ativo: t.ativo,
    permiteParcelamento: t.permiteParcelamento,
    maxParcelas: t.maxParcelas,
    valorMinimo: t.valorMinimo == null ? null : dec(t.valorMinimo),
    valorMaximo: t.valorMaximo == null ? null : dec(t.valorMaximo),
    exigeObservacao: t.exigeObservacao,
  };
}

const CAMPOS_PROCESSO: Record<string, string> = {
  codfor: "Consultor",
  tipoId: "Tipo de desconto",
  modo: "Modo de lançamento",
  valorTotal: "Valor total",
  valorParcela: "Valor da parcela",
  qtdParcelas: "Parcelas",
  vigenciaInicio: "Início da vigência",
  vigenciaFim: "Fim da vigência",
  competenciaInicial: "Competência inicial",
  diaVencimento: "Dia de vencimento",
  observacao: "Observação",
};

const diffDoProcesso = (p: { codfor: number; tipoId: number; modo: string; valorTotal: number; valorParcela: number; qtdParcelas: number; vigenciaInicio: Date; vigenciaFim: Date; competenciaInicial: Date; diaVencimento: number; observacao?: string | null }) =>
  paraDiff({
    ...p,
    vigenciaInicio: isoDia(p.vigenciaInicio),
    vigenciaFim: isoDia(p.vigenciaFim),
    competenciaInicial: isoCompetencia(p.competenciaInicial),
  });

/** Consultor que o administrador escolheu: precisa existir (codemp vem do cadastro). */
async function consultorDoCodfor(codfor: number) {
  return prisma.consultor.findFirst({ where: { codfor }, select: { codemp: true, codfor: true, nomcom: true, nomfor: true } });
}

/** Parcelas que cairiam em competência que o consultor já fechou nunca seriam descontadas: barra antes de gravar. */
async function competenciaJaFechada(codemp: number, codfor: number, competencias: Date[]): Promise<Date | null> {
  const f = await prisma.descontoFechamento.findFirst({ where: { codemp, codfor, competencia: { in: competencias } }, orderBy: { competencia: "asc" } });
  return f?.competencia ?? null;
}

descontosRouter.post("/processos/simular", exigirAdministra, async (req, res) => {
  try {
    const lido = lerProcesso(req.body ?? {});
    if (!lido.ok) {
      res.json({ valido: false, erro: lido.erro });
      return;
    }
    const tipo = await prisma.descontoTipo.findUnique({ where: { id: lido.dados.tipoId } });
    if (!tipo) {
      res.json({ valido: false, erro: "Tipo de desconto não encontrado" });
      return;
    }
    const r = validarProcesso(lido.dados, tipoParaValidar(tipo));
    if (!r.ok) {
      res.json({ valido: false, erro: r.erro });
      return;
    }
    const { parcelamento } = r;
    res.json({
      valido: true,
      valorTotal: parcelamento.valorTotal,
      valorParcela: parcelamento.valorParcela,
      competenciaFinal: isoCompetencia(parcelamento.parcelas[parcelamento.parcelas.length - 1].competencia),
      vencimentoFinal: isoDia(parcelamento.parcelas[parcelamento.parcelas.length - 1].vencimento),
      parcelas: parcelamento.parcelas.map((p) => ({ numero: p.numero, competencia: isoCompetencia(p.competencia), vencimento: isoDia(p.vencimento), valor: p.valor })),
    });
  } catch (error) {
    handleError(res, error, "simular");
  }
});

descontosRouter.post("/processos", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const lido = lerProcesso(req.body ?? {});
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const [tipo, consultor] = await Promise.all([prisma.descontoTipo.findUnique({ where: { id: lido.dados.tipoId } }), consultorDoCodfor(lido.dados.codfor)]);
    if (!tipo) {
      res.status(400).json({ error: "Tipo de desconto não encontrado" });
      return;
    }
    if (!consultor) {
      res.status(400).json({ error: "Consultor não encontrado" });
      return;
    }
    const validado = validarProcesso(lido.dados, tipoParaValidar(tipo));
    if (!validado.ok) {
      res.status(400).json({ error: validado.erro });
      return;
    }
    const { parcelamento } = validado;
    const fechada = await competenciaJaFechada(consultor.codemp, consultor.codfor!, parcelamento.parcelas.map((p) => p.competencia));
    if (fechada) {
      res.status(400).json({ error: `A competência ${isoCompetencia(fechada)} deste consultor já foi fechada: comece o desconto em uma competência aberta` });
      return;
    }
    const ano = hojeBrasil().getUTCFullYear();
    const criado = await prisma.$transaction(async (tx) => {
      const sequencia = await proximaSequencia(tx, ano);
      const processo = await tx.descontoProcesso.create({
        data: {
          ano,
          sequencia,
          codemp: consultor.codemp,
          codfor: lido.dados.codfor,
          tipoId: tipo.id,
          modo: lido.dados.modo,
          valorTotal: parcelamento.valorTotal,
          valorParcela: parcelamento.valorParcela,
          qtdParcelas: lido.dados.qtdParcelas,
          vigenciaInicio: lido.dados.vigenciaInicio,
          vigenciaFim: lido.dados.vigenciaFim,
          competenciaInicial: competenciaDe(lido.dados.competenciaInicial),
          diaVencimento: lido.dados.diaVencimento,
          observacao: lido.dados.observacao,
          status: "ativo",
          criadoPorId: req.user!.userId,
          parcelas: { create: parcelamento.parcelas.map((p) => ({ numero: p.numero, competencia: p.competencia, vencimento: p.vencimento, valor: p.valor })) },
        },
      });
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PROCESSO,
        entidadeId: String(processo.id),
        rotulo: `${numeroDoProcesso(ano, sequencia)} · ${tipo.nome} · ${nomeConsultor({ codfor: consultor.codfor, nomcom: consultor.nomcom, nomfor: consultor.nomfor })}`,
        evento: "DESCONTO_PROCESSO_CRIADO",
        alteracoes: diffCampos(
          CAMPOS_PROCESSO,
          null,
          diffDoProcesso({ ...lido.dados, valorTotal: parcelamento.valorTotal, valorParcela: parcelamento.valorParcela })
        ).alteracoes,
        metadata: { numero: numeroDoProcesso(ano, sequencia), parcelas: parcelamento.parcelas.length, tipo: tipo.nome },
      });
      return processo;
    });
    res.status(201).json({ id: criado.id, numero: rotuloDoProcesso(criado) });
  } catch (error) {
    handleError(res, error, "processo-criar");
  }
});

/** Carrega o processo se a pessoa pode vê-lo; senão responde 404 (não revela que existe). */
async function processoVisivel(req: Request, res: Response, idTexto: string) {
  const escopo = await escopoOuErro(req, res);
  if (!escopo) return null;
  const id = qInteiro(idTexto);
  const processo =
    id == null
      ? null
      : await prisma.descontoProcesso.findUnique({ where: { id }, include: { tipo: true, parcelas: { orderBy: [{ numero: "asc" }] } } });
  if (!processo || !podeVerConsultor(escopo, processo.codfor)) {
    res.status(404).json({ error: "Processo não encontrado" });
    return null;
  }
  return { escopo, processo };
}

type ProcessoCompleto = NonNullable<Awaited<ReturnType<typeof processoVisivel>>>["processo"];

/** Só dá para refazer as parcelas enquanto NENHUMA foi descontada, cancelada ou transportada (todas pendentes, na numeração original). */
const parcelasIntocadas = (p: ProcessoCompleto) => p.parcelas.every((x) => x.situacao === "pendente" && x.origemParcelaId == null);

descontosRouter.get("/processos/:id", async (req, res) => {
  try {
    const achado = await processoVisivel(req, res, req.params.id);
    if (!achado) return;
    const { escopo, processo } = achado;
    const consultor = await prisma.consultor.findFirst({ where: { codfor: processo.codfor }, select: { codfor: true, nomcom: true, nomfor: true } });
    const eventos = await prisma.auditEvento.findMany({
      where: {
        OR: [
          { entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PROCESSO, entidadeId: String(processo.id) },
          { entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PARCELA, metadata: { path: ["processoId"], equals: processo.id } },
        ],
      },
      include: { usuario: { select: { nome: true } } },
      orderBy: { ocorridoEm: "desc" },
      take: 300,
    });
    const parcelas = processo.parcelas.map((p) => {
      const situacao = p.situacao as SituacaoParcela;
      return {
        id: p.id,
        numero: p.numero,
        competencia: isoCompetencia(p.competencia),
        vencimento: isoDia(p.vencimento),
        valor: dec(p.valor),
        valorDescontado: dec(p.valorDescontado),
        restante: situacao === "pendente" ? dec(p.valor) : situacao === "parcial" ? dec(p.valor) - dec(p.valorDescontado) : 0,
        situacao,
        situacaoRotulo: SITUACAO_PARCELA_ROTULO[situacao] ?? p.situacao,
        transportada: p.origemParcelaId != null,
        observacao: p.observacao,
      };
    });
    const status = processo.status as StatusProcesso;
    res.json({
      id: processo.id,
      numero: rotuloDoProcesso(processo),
      codfor: processo.codfor,
      consultor: consultor ? nomeConsultor(consultor) : `Fornecedor ${processo.codfor}`,
      tipoId: processo.tipoId,
      tipo: processo.tipo.nome,
      modo: processo.modo,
      modoRotulo: MODO_ROTULO[processo.modo as ModoDesconto] ?? processo.modo,
      valorTotal: dec(processo.valorTotal),
      valorParcela: dec(processo.valorParcela),
      qtdParcelas: processo.qtdParcelas,
      vigenciaInicio: isoDia(processo.vigenciaInicio),
      vigenciaFim: isoDia(processo.vigenciaFim),
      competenciaInicial: isoCompetencia(processo.competenciaInicial),
      diaVencimento: processo.diaVencimento,
      observacao: processo.observacao,
      status,
      statusRotulo: STATUS_PROCESSO_ROTULO[status] ?? processo.status,
      criadoEm: processo.criadoEm,
      totalDescontado: totalDescontado(parcelas),
      saldoDevedor: saldoDevedor(parcelas),
      parcelas,
      // O administrador altera tudo enquanto nada foi descontado; depois só observação e fim da vigência.
      podeAdministrar: escopo.administra,
      editavelPorCompleto: escopo.administra && parcelasIntocadas(processo),
      historico: eventos.map((e) => ({
        id: String(e.id),
        ocorridoEm: e.ocorridoEm,
        usuario: e.usuario?.nome ?? (e.origem === "job" ? "Fechamento automático" : "—"),
        evento: e.eventoTipo,
        alteracoes: e.alteracoes,
        metadata: e.metadata,
        parcelaId: e.entidadeTipo === ENTIDADES_AUDITORIA.DESCONTO_PARCELA ? e.entidadeId : null,
      })),
    });
  } catch (error) {
    handleError(res, error, "processo-detalhe");
  }
});

descontosRouter.put("/processos/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const achado = await processoVisivel(req, res, req.params.id);
    if (!achado) return;
    const { processo } = achado;
    const lido = lerProcesso(req.body ?? {});
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const novo = lido.dados;
    const tipoNovo = await prisma.descontoTipo.findUnique({ where: { id: novo.tipoId } });
    if (!tipoNovo) {
      res.status(400).json({ error: "Tipo de desconto não encontrado" });
      return;
    }
    const antes = diffDoProcesso({
      codfor: processo.codfor,
      tipoId: processo.tipoId,
      modo: processo.modo,
      valorTotal: dec(processo.valorTotal),
      valorParcela: dec(processo.valorParcela),
      qtdParcelas: processo.qtdParcelas,
      vigenciaInicio: processo.vigenciaInicio,
      vigenciaFim: processo.vigenciaFim,
      competenciaInicial: processo.competenciaInicial,
      diaVencimento: processo.diaVencimento,
      observacao: processo.observacao,
    });
    const intocadas = parcelasIntocadas(processo);

    if (!intocadas) {
      // Com parcelas já descontadas/canceladas/transportadas o cronograma é história: só observação e fim da vigência mudam.
      const mexeuNoCronograma =
        novo.codfor !== processo.codfor ||
        novo.tipoId !== processo.tipoId ||
        novo.modo !== processo.modo ||
        novo.qtdParcelas !== processo.qtdParcelas ||
        novo.diaVencimento !== processo.diaVencimento ||
        isoDia(novo.vigenciaInicio) !== isoDia(processo.vigenciaInicio) ||
        isoCompetencia(competenciaDe(novo.competenciaInicial)) !== isoCompetencia(processo.competenciaInicial) ||
        Math.round((novo.modo === "mensal_fixo" ? (novo.valorParcela ?? 0) : (novo.valorTotal ?? 0)) * 100) !==
          Math.round((processo.modo === "mensal_fixo" ? dec(processo.valorParcela) : dec(processo.valorTotal)) * 100);
      if (mexeuNoCronograma) {
        res.status(409).json({
          error: "Este processo já tem parcelas descontadas, canceladas ou transportadas: só dá para alterar a observação e a data final da vigência. Para mudar o resto, cancele e lance um novo processo.",
        });
        return;
      }
      const ultimoVencimento = processo.parcelas.filter((p) => p.situacao === "pendente").reduce<Date | null>((m, p) => (m == null || p.vencimento > m ? p.vencimento : m), null);
      if (ultimoVencimento && novo.vigenciaFim.getTime() < ultimoVencimento.getTime()) {
        res.status(400).json({ error: `A data final da vigência deve cobrir as parcelas pendentes (a última vence em ${isoDia(ultimoVencimento)})` });
        return;
      }
      const depois = diffDoProcesso({ ...antesComoDados(processo), vigenciaFim: novo.vigenciaFim, observacao: novo.observacao });
      const diff = diffCampos(CAMPOS_PROCESSO, antes, depois);
      await prisma.$transaction(async (tx) => {
        await tx.descontoProcesso.update({ where: { id: processo.id }, data: { vigenciaFim: novo.vigenciaFim, observacao: novo.observacao } });
        await recalcularStatusDoProcesso(tx, processo.id);
        if (diff.algumaMudanca) {
          await auditarDesconto(tx, {
            usuarioId: req.user!.userId,
            origem: "tela",
            correlationId: req.correlationId!,
            entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PROCESSO,
            entidadeId: String(processo.id),
            rotulo: rotuloDoProcesso(processo),
            evento: "DESCONTO_PROCESSO_ALTERADO",
            alteracoes: diff.alteracoes,
          });
        }
      });
      res.json({ ok: true, recalculado: false });
      return;
    }

    // Nada foi descontado: refaz TODAS as parcelas com os valores novos (recálculo automático).
    const consultor = await consultorDoCodfor(novo.codfor);
    if (!consultor) {
      res.status(400).json({ error: "Consultor não encontrado" });
      return;
    }
    // O tipo antigo pode ter sido inativado depois do lançamento: se o tipo não mudou, não bloqueia a edição por isso.
    const tipoParaChecar = tipoNovo.id === processo.tipoId ? { ...tipoParaValidar(tipoNovo), ativo: true } : tipoParaValidar(tipoNovo);
    const validado = validarProcesso(novo, tipoParaChecar);
    if (!validado.ok) {
      res.status(400).json({ error: validado.erro });
      return;
    }
    const { parcelamento } = validado;
    const fechada = await competenciaJaFechada(consultor.codemp, novo.codfor, parcelamento.parcelas.map((p) => p.competencia));
    if (fechada) {
      res.status(400).json({ error: `A competência ${isoCompetencia(fechada)} deste consultor já foi fechada: use uma competência aberta` });
      return;
    }
    const depois = diffDoProcesso({
      ...novo,
      valorTotal: parcelamento.valorTotal,
      valorParcela: parcelamento.valorParcela,
      competenciaInicial: competenciaDe(novo.competenciaInicial),
    });
    const diff = diffCampos(CAMPOS_PROCESSO, antes, depois);
    await prisma.$transaction(async (tx) => {
      await tx.descontoParcela.deleteMany({ where: { processoId: processo.id } });
      await tx.descontoProcesso.update({
        where: { id: processo.id },
        data: {
          codemp: consultor.codemp,
          codfor: novo.codfor,
          tipoId: novo.tipoId,
          modo: novo.modo,
          valorTotal: parcelamento.valorTotal,
          valorParcela: parcelamento.valorParcela,
          qtdParcelas: novo.qtdParcelas,
          vigenciaInicio: novo.vigenciaInicio,
          vigenciaFim: novo.vigenciaFim,
          competenciaInicial: competenciaDe(novo.competenciaInicial),
          diaVencimento: novo.diaVencimento,
          observacao: novo.observacao,
          parcelas: { create: parcelamento.parcelas.map((p) => ({ numero: p.numero, competencia: p.competencia, vencimento: p.vencimento, valor: p.valor })) },
        },
      });
      await recalcularStatusDoProcesso(tx, processo.id);
      if (diff.algumaMudanca) {
        await auditarDesconto(tx, {
          usuarioId: req.user!.userId,
          origem: "tela",
          correlationId: req.correlationId!,
          entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PROCESSO,
          entidadeId: String(processo.id),
          rotulo: rotuloDoProcesso(processo),
          evento: "DESCONTO_PROCESSO_ALTERADO",
          alteracoes: diff.alteracoes,
          metadata: { parcelasRecalculadas: parcelamento.parcelas.length },
        });
      }
    });
    res.json({ ok: true, recalculado: true });
  } catch (error) {
    handleError(res, error, "processo-alterar");
  }
});

function antesComoDados(p: ProcessoCompleto) {
  return {
    codfor: p.codfor,
    tipoId: p.tipoId,
    modo: p.modo,
    valorTotal: dec(p.valorTotal),
    valorParcela: dec(p.valorParcela),
    qtdParcelas: p.qtdParcelas,
    vigenciaInicio: p.vigenciaInicio,
    vigenciaFim: p.vigenciaFim,
    competenciaInicial: p.competenciaInicial,
    diaVencimento: p.diaVencimento,
    observacao: p.observacao,
  };
}

// ---------------------------------------------------------------- ações (cancelar, quitar, estornar): sempre com justificativa
descontosRouter.post("/processos/:id/cancelar", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const motivo = lerJustificativa(req.body);
    if (!motivo) {
      res.status(400).json({ error: "Informe a justificativa (de 3 a 500 caracteres)" });
      return;
    }
    const achado = await processoVisivel(req, res, req.params.id);
    if (!achado) return;
    const { processo } = achado;
    const pendentes = processo.parcelas.filter((p) => p.situacao === "pendente");
    if (pendentes.length === 0) {
      res.status(409).json({ error: "Não há parcelas pendentes para cancelar neste processo" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      const correlationId = req.correlationId!;
      for (const p of pendentes) {
        await tx.descontoParcela.update({ where: { id: p.id }, data: { situacao: "cancelada" } });
        await auditarDesconto(tx, {
          usuarioId: req.user!.userId,
          origem: "tela",
          correlationId,
          entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PARCELA,
          entidadeId: String(p.id),
          rotulo: `${rotuloDoProcesso(processo)} · parcela ${p.numero}`,
          evento: "DESCONTO_PARCELA_CANCELADA",
          alteracoes: { situacao: { de: "pendente", para: "cancelada", rotulo: "Situação" } },
          metadata: { processoId: processo.id, motivo, valor: dec(p.valor), competencia: isoCompetencia(p.competencia), viaProcesso: true },
        });
      }
      const status = await recalcularStatusDoProcesso(tx, processo.id);
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PROCESSO,
        entidadeId: String(processo.id),
        rotulo: rotuloDoProcesso(processo),
        evento: "DESCONTO_PROCESSO_CANCELADO",
        alteracoes: { status: { de: processo.status, para: status, rotulo: "Status" } },
        metadata: { motivo, parcelasCanceladas: pendentes.map((p) => p.numero) },
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "processo-cancelar");
  }
});

descontosRouter.post("/processos/:id/quitar", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const motivo = lerJustificativa(req.body);
    if (!motivo) {
      res.status(400).json({ error: "Informe a justificativa (de 3 a 500 caracteres)" });
      return;
    }
    const achado = await processoVisivel(req, res, req.params.id);
    if (!achado) return;
    const { processo } = achado;
    const pendentes = processo.parcelas.filter((p) => p.situacao === "pendente");
    if (pendentes.length === 0) {
      res.status(409).json({ error: "Não há parcelas pendentes para quitar neste processo" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.descontoParcela.updateMany({ where: { id: { in: pendentes.map((p) => p.id) } }, data: { situacao: "quitada_antecipadamente" } });
      const status = await recalcularStatusDoProcesso(tx, processo.id);
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PROCESSO,
        entidadeId: String(processo.id),
        rotulo: rotuloDoProcesso(processo),
        evento: "DESCONTO_PROCESSO_QUITADO",
        alteracoes: { status: { de: processo.status, para: status, rotulo: "Status" } },
        metadata: { motivo, parcelasQuitadas: pendentes.map((p) => p.numero), valorQuitado: saldoDevedor(pendentes.map((p) => ({ situacao: "pendente" as const, valor: dec(p.valor) }))) },
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "processo-quitar");
  }
});

async function parcelaVisivel(req: Request, res: Response, idTexto: string) {
  const escopo = await escopoOuErro(req, res);
  if (!escopo) return null;
  const id = qInteiro(idTexto);
  const parcela = id == null ? null : await prisma.descontoParcela.findUnique({ where: { id }, include: { processo: true } });
  if (!parcela || !podeVerConsultor(escopo, parcela.processo.codfor)) {
    res.status(404).json({ error: "Parcela não encontrada" });
    return null;
  }
  return parcela;
}

descontosRouter.post("/parcelas/:id/cancelar", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const motivo = lerJustificativa(req.body);
    if (!motivo) {
      res.status(400).json({ error: "Informe a justificativa (de 3 a 500 caracteres)" });
      return;
    }
    const parcela = await parcelaVisivel(req, res, req.params.id);
    if (!parcela) return;
    if (parcela.situacao !== "pendente") {
      res.status(409).json({ error: "Só é possível cancelar parcela pendente (parcela descontada se estorna)" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.descontoParcela.update({ where: { id: parcela.id }, data: { situacao: "cancelada" } });
      await recalcularStatusDoProcesso(tx, parcela.processoId);
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PARCELA,
        entidadeId: String(parcela.id),
        rotulo: `${rotuloDoProcesso(parcela.processo)} · parcela ${parcela.numero}`,
        evento: "DESCONTO_PARCELA_CANCELADA",
        alteracoes: { situacao: { de: "pendente", para: "cancelada", rotulo: "Situação" } },
        metadata: { processoId: parcela.processoId, motivo, valor: dec(parcela.valor), competencia: isoCompetencia(parcela.competencia) },
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "parcela-cancelar");
  }
});

descontosRouter.post("/parcelas/:id/estornar", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const motivo = lerJustificativa(req.body);
    if (!motivo) {
      res.status(400).json({ error: "Informe a justificativa (de 3 a 500 caracteres)" });
      return;
    }
    const parcela = await parcelaVisivel(req, res, req.params.id);
    if (!parcela) return;
    if (parcela.situacao !== "descontada" && parcela.situacao !== "parcial") {
      res.status(409).json({ error: "Só é possível estornar parcela já descontada (ou descontada em parte)" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      const devolvido = dec(parcela.valorDescontado);
      await tx.descontoParcela.update({ where: { id: parcela.id }, data: { situacao: "estornada", valorDescontado: 0 } });
      // O saldo que seguiu para o mês seguinte (parcela parcial) deixa de ser devido junto com o estorno.
      const filhas = await tx.descontoParcela.findMany({ where: { origemParcelaId: parcela.id, situacao: "pendente" }, select: { id: true } });
      if (filhas.length > 0) {
        await tx.descontoParcela.updateMany({ where: { id: { in: filhas.map((f) => f.id) } }, data: { situacao: "cancelada", observacao: `Cancelada junto com o estorno da parcela ${parcela.numero}` } });
      }
      await recalcularStatusDoProcesso(tx, parcela.processoId);
      await auditarDesconto(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.DESCONTO_PARCELA,
        entidadeId: String(parcela.id),
        rotulo: `${rotuloDoProcesso(parcela.processo)} · parcela ${parcela.numero}`,
        evento: "DESCONTO_PARCELA_ESTORNADA",
        alteracoes: {
          situacao: { de: parcela.situacao, para: "estornada", rotulo: "Situação" },
          valorDescontado: { de: devolvido, para: 0, rotulo: "Valor descontado" },
        },
        metadata: { processoId: parcela.processoId, motivo, valorDevolvido: devolvido, competencia: isoCompetencia(parcela.competencia), saldosCancelados: filhas.length },
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "parcela-estornar");
  }
});

// ---------------------------------------------------------------- Home do consultor: detalhe das deduções por competência
descontosRouter.get("/competencias", async (req, res) => {
  try {
    const escopo = await escopoOuErro(req, res);
    if (!escopo) return;
    const codforPedido = qInteiro(req.query.codfor);
    const codfor = codforPedido ?? escopo.proprio?.codfor ?? null;
    if (codfor == null) {
      res.json({ codfor: null, competencias: [] });
      return;
    }
    if (!podeVerConsultor(escopo, codfor)) {
      res.status(403).json({ error: "Sem permissão para ver os descontos deste consultor" });
      return;
    }
    const competencias = qTexto(req.query.competencias)
      .split(",")
      .map((c) => lerCompetencia(c.trim()))
      .filter((c): c is Date => c != null)
      .slice(0, 24);
    const consultor = await consultorDoCodfor(codfor);
    if (!consultor || competencias.length === 0) {
      res.json({ codfor, competencias: [] });
      return;
    }
    res.json({ codfor, competencias: await descontosPorCompetencia(consultor.codemp, codfor, competencias) });
  } catch (error) {
    handleError(res, error, "competencias");
  }
});

// ---------------------------------------------------------------- fechamento manual de uma competência (quem administra)
descontosRouter.post("/fechamentos/:competencia", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const competencia = lerCompetencia(req.params.competencia);
    if (!competencia) {
      res.status(400).json({ error: "Competência inválida (use AAAA-MM)" });
      return;
    }
    if (competencia.getTime() >= competenciaDe(hojeBrasil()).getTime()) {
      res.status(400).json({ error: "Só é possível fechar competências já encerradas" });
      return;
    }
    res.json(await fecharCompetencia(competencia, "manual", req.user!.userId));
  } catch (error) {
    handleError(res, error, "fechar-competencia");
  }
});
