import { NextFunction, Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { diffCampos } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA } from "../audit/taxonomia";
import { nomeConsultor } from "../domain/contextoProjeto";
import {
  FONTE_ROTULO,
  SENTIDO_ROTULO,
  SITUACAO_FECHAMENTO_ROTULO,
  UNIDADE_ROTULO,
  competenciaDe,
  eFonteIndicador,
  eSentidoIndicador,
  eUnidadeIndicador,
  ativoNoMes,
  regraVigente,
  totalDoConsultor,
  validarFaixas,
  validarPeriodo,
  validarVigenciaDeRegra,
  vigenciaSobreposta,
  type FaixaRegra,
  type FonteIndicador,
  type SentidoIndicador,
} from "../domain/bonificacao";
import { escopoDoUsuario, escopoSql, podeAdministrarBonificacao, podeVerConsultor, type EscopoBonificacao } from "../domain/bonificacaoAcesso";
import { saldoBancoDoMesSql } from "../domain/bonificacaoHoras";
import { agruparTimesEAreas, type LinhaTimeArea, type TimeComAreas } from "../domain/bonificacaoTimes";
import { capturarFilaDoDia } from "../domain/bonificacaoApuracao";
import { ErroBonificacao, apurarFechamento, auditarBonificacao, dec, faixasDoBanco, informarResultado, isoCompetencia, isoDia } from "../domain/bonificacaoDados";
import { hojeBrasil } from "../domain/descontosDados";
import { bonificacoesNasCompetencias } from "../domain/bonificacaoNota";
import { TIPO_CONTRATO_ROTULO, indicacaoDaNota, tipoDeContrato } from "../domain/bonificacaoContrato";
import { col, registrarListaConsultavel } from "./listaConsultavel";
import { extrasDaConsulta } from "../consultas/camposRelacionados";
import { FONTES_BONIFICACAO_FECHAMENTOS, FONTES_BONIFICACAO_RESULTADOS } from "../domain/fontesDeCampos";

// Gestão de Bonificação (menu próprio, 25/11/2026): processos de bonificação com indicadores, regras por vigência (faixas -> pontos x valor base),
// consultores enquadrados e fechamento mensal. Regras de cálculo em domain/bonificacao.ts; apuração (Kyria/HCM) em domain/bonificacaoApuracao.ts;
// acesso em domain/bonificacaoAcesso.ts (admin e administrativo administram; gestor vê o time; consultor vê o próprio, só o que está fechado).
// Tudo local: nada daqui vai ao Senior.
export const bonificacaoRouter = Router();
bonificacaoRouter.use(requireAuth);

function handleError(res: Response, error: unknown, label: string) {
  if (error instanceof ErroBonificacao) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[bonificacao:${label}]`, message);
  res.status(500).json({ error: message });
}

// O escopo é resolvido uma vez por requisição (a lista consulta 3 rotas: lista, resumo e valores).
const escopos = new WeakMap<Request, Promise<EscopoBonificacao | null>>();
function escopoDe(req: Request): Promise<EscopoBonificacao | null> {
  let p = escopos.get(req);
  if (!p) {
    const r = req as AuthenticatedRequest;
    p = escopoDoUsuario(r.user!.userId, r.user!.role as string);
    escopos.set(req, p);
  }
  return p;
}
async function escopoOuErro(req: Request, res: Response): Promise<EscopoBonificacao | null> {
  const e = await escopoDe(req);
  if (!e) res.status(404).json({ error: "Usuário não encontrado" });
  return e;
}
function exigirAdministra(req: Request, res: Response, next: NextFunction) {
  if (!podeAdministrarBonificacao((req as AuthenticatedRequest).user!.role as string)) {
    res.status(403).json({ error: "Sem permissão: apenas administrador e administrativo gerenciam a bonificação" });
    return;
  }
  next();
}
const temAcesso = (e: EscopoBonificacao) => e.administra || e.ehGestor || e.proprio != null;
/** Escopo de quem tem alguma coisa para ver; os outros levam 403. */
async function escopoComAcesso(req: Request, res: Response): Promise<EscopoBonificacao | null> {
  const e = await escopoOuErro(req, res);
  if (!e) return null;
  if (!temAcesso(e)) {
    res.status(403).json({ error: "Sem acesso à Gestão de Bonificação" });
    return null;
  }
  return e;
}

// Quem não tem nada a ver com o módulo (nem administra, nem gerencia time, nem é consultor) leva 403 em tudo, menos em /meu-acesso (o menu pergunta).
bonificacaoRouter.use(async (req, res, next) => {
  try {
    if (req.path === "/meu-acesso") return next();
    const escopo = await escopoOuErro(req, res);
    if (!escopo) return;
    if (!temAcesso(escopo)) {
      res.status(403).json({ error: "Sem acesso à Gestão de Bonificação" });
      return;
    }
    next();
  } catch (error) {
    handleError(res, error, "acesso");
  }
});

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
const lerTexto = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const qTexto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const qInteiro = (v: unknown) => (typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : null);
const qCompetencia = (v: unknown) => {
  const d = lerCompetencia(v);
  return d ? isoDia(d) : null;
};
const idDaRota = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);
function lerJustificativa(body: unknown): string | null {
  const t = typeof (body as { justificativa?: unknown })?.justificativa === "string" ? (body as { justificativa: string }).justificativa.trim() : "";
  return t.length >= 3 && t.length <= 500 ? t : null;
}
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50) || "indicador";

// ---------------------------------------------------------------- acesso, consultores, times
bonificacaoRouter.get("/meu-acesso", async (req, res) => {
  try {
    const escopo = await escopoOuErro(req, res);
    if (!escopo) return;
    res.json({
      administra: escopo.administra,
      gestao: escopo.administra || escopo.ehGestor,
      visualiza: temAcesso(escopo),
      proprioCodfor: escopo.proprio?.codfor ?? null,
    });
  } catch (error) {
    handleError(res, error, "meu-acesso");
  }
});

// Quem a pessoa pode escolher no seletor/filtro: quem administra, todos os habilitados; gestor, o time; consultor, ele mesmo.
bonificacaoRouter.get("/consultores", async (req, res) => {
  try {
    const escopo = await escopoComAcesso(req, res);
    if (!escopo) return;
    res.json({ consultores: await escopo.consultores(), administra: escopo.administra, ehGestor: escopo.ehGestor, proprioCodfor: escopo.proprio?.codfor ?? null });
  } catch (error) {
    handleError(res, error, "consultores");
  }
});

// Times do Kyria (para o enquadramento: quais times o líder lidera / o atendente atende).
bonificacaoRouter.get("/times-kyria", exigirAdministra, async (_req, res) => {
  try {
    const times = await prisma.kyriaTeam.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, key: true, name: true } });
    res.json({ times });
  } catch (error) {
    handleError(res, error, "times-kyria");
  }
});

// ---------------------------------------------------------------- processos
const CAMPOS_PROCESSO: Record<string, string> = {
  nome: "Nome",
  descricao: "Descrição",
  ativo: "Ativo",
  vigenciaInicio: "Início da vigência",
  vigenciaFim: "Fim da vigência",
  compoeNota: "Compõe o valor da nota fiscal",
};

const processoParaResposta = (p: { id: number; nome: string; descricao: string | null; ativo: boolean; compoeNota: boolean; vigenciaInicio: Date; vigenciaFim: Date | null }) => ({
  id: p.id,
  nome: p.nome,
  descricao: p.descricao,
  ativo: p.ativo,
  compoeNota: p.compoeNota,
  vigenciaInicio: isoDia(p.vigenciaInicio),
  vigenciaFim: p.vigenciaFim ? isoDia(p.vigenciaFim) : null,
});

function lerProcesso(body: Record<string, unknown>): { ok: true; dados: { nome: string; descricao: string | null; ativo: boolean; compoeNota: boolean; vigenciaInicio: Date; vigenciaFim: Date | null } } | { ok: false; erro: string } {
  const nome = lerTexto(body.nome, 120);
  if (!nome) return { ok: false, erro: "Informe o nome do processo" };
  const vigenciaInicio = lerData(body.vigenciaInicio);
  if (!vigenciaInicio) return { ok: false, erro: "Informe o início da vigência" };
  const vigenciaFim = body.vigenciaFim ? lerData(body.vigenciaFim) : null;
  if (body.vigenciaFim && !vigenciaFim) return { ok: false, erro: "Fim da vigência inválido" };
  const erroPeriodo = validarPeriodo(vigenciaInicio, vigenciaFim);
  if (erroPeriodo) return { ok: false, erro: erroPeriodo };
  return { ok: true, dados: { nome, descricao: lerTexto(body.descricao, 500), ativo: body.ativo !== false, compoeNota: body.compoeNota === true || body.compoeNota === "true", vigenciaInicio, vigenciaFim } };
}

bonificacaoRouter.get("/processos", async (req, res) => {
  try {
    const escopo = await escopoComAcesso(req, res);
    if (!escopo) return;
    const processos = await prisma.bonificacaoProcesso.findMany({
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      include: { _count: { select: { indicadores: true, enquadramentos: true } } },
    });
    res.json({ processos: processos.map((p) => ({ ...processoParaResposta(p), indicadores: p._count.indicadores, enquadramentos: p._count.enquadramentos })) });
  } catch (error) {
    handleError(res, error, "processos");
  }
});

/** Detalhe completo (indicadores, regras, faixas, enquadramentos e times): configuração, só para quem administra. */
async function detalheDoProcesso(id: number) {
  const p = await prisma.bonificacaoProcesso.findUnique({
    where: { id },
    include: {
      indicadores: { orderBy: [{ ordem: "asc" }, { id: "asc" }], include: { regras: { orderBy: { vigenciaInicio: "asc" }, include: { faixas: { orderBy: { ordem: "asc" } } } } } },
      enquadramentos: { orderBy: [{ codfor: "asc" }, { vigenciaInicio: "asc" }], include: { times: { include: { time: { select: { id: true, name: true } } } } } },
    },
  });
  if (!p) return null;
  const codfors = [...new Set(p.enquadramentos.map((e) => e.codfor))];
  const consultores = codfors.length ? await prisma.consultor.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true, nomcom: true, nomfor: true } }) : [];
  const nomes = new Map(consultores.map((c) => [c.codfor, nomeConsultor(c)]));
  return {
    ...processoParaResposta(p),
    indicadores: p.indicadores.map((i) => ({
      id: i.id,
      chave: i.chave,
      nome: i.nome,
      descricao: i.descricao,
      fonte: i.fonte,
      fonteRotulo: FONTE_ROTULO[i.fonte as FonteIndicador] ?? i.fonte,
      unidade: i.unidade,
      unidadeRotulo: UNIDADE_ROTULO[i.unidade as keyof typeof UNIDADE_ROTULO] ?? i.unidade,
      sentido: i.sentido,
      sentidoRotulo: SENTIDO_ROTULO[i.sentido as SentidoIndicador] ?? i.sentido,
      ordem: i.ordem,
      ativo: i.ativo,
      regras: i.regras.map((r) => ({
        id: r.id,
        vigenciaInicio: isoDia(r.vigenciaInicio),
        vigenciaFim: r.vigenciaFim ? isoDia(r.vigenciaFim) : null,
        valorBase: dec(r.valorBase),
        idadeMeses: r.idadeMeses,
        observacao: r.observacao,
        faixas: faixasDoBanco(r.faixas),
      })),
    })),
    enquadramentos: p.enquadramentos.map((e) => ({
      id: e.id,
      codemp: e.codemp,
      codfor: e.codfor,
      consultor: nomes.get(e.codfor) ?? `Fornecedor ${e.codfor}`,
      vigenciaInicio: isoDia(e.vigenciaInicio),
      vigenciaFim: e.vigenciaFim ? isoDia(e.vigenciaFim) : null,
      observacao: e.observacao,
      times: e.times.map((t) => ({ id: t.time.id, nome: t.time.name })),
    })),
  };
}

bonificacaoRouter.get("/processos/:id", exigirAdministra, async (req, res) => {
  try {
    const id = idDaRota(req.params.id);
    const detalhe = id == null ? null : await detalheDoProcesso(id);
    if (!detalhe) {
      res.status(404).json({ error: "Processo não encontrado" });
      return;
    }
    res.json({ processo: detalhe });
  } catch (error) {
    handleError(res, error, "processo");
  }
});

bonificacaoRouter.post("/processos", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const lido = lerProcesso((req.body ?? {}) as Record<string, unknown>);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    if (await prisma.bonificacaoProcesso.findFirst({ where: { nome: { equals: lido.dados.nome, mode: "insensitive" } }, select: { id: true } })) {
      res.status(409).json({ error: "Já existe um processo com este nome" });
      return;
    }
    const criado = await prisma.$transaction(async (tx) => {
      const p = await tx.bonificacaoProcesso.create({ data: { ...lido.dados, criadoPorId: req.user!.userId } });
      await auditarBonificacao(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_PROCESSO,
        entidadeId: String(p.id),
        rotulo: `Processo de bonificação ${p.nome}`,
        evento: "BONIFICACAO_PROCESSO_CRIADO",
        alteracoes: diffCampos(CAMPOS_PROCESSO, null, p as unknown as Record<string, unknown>).alteracoes,
      });
      return p;
    });
    res.status(201).json({ processo: processoParaResposta(criado) });
  } catch (error) {
    handleError(res, error, "processo-criar");
  }
});

bonificacaoRouter.put("/processos/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoProcesso.findUnique({ where: { id } });
    if (!atual) {
      res.status(404).json({ error: "Processo não encontrado" });
      return;
    }
    const lido = lerProcesso((req.body ?? {}) as Record<string, unknown>);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    if (await prisma.bonificacaoProcesso.findFirst({ where: { id: { not: atual.id }, nome: { equals: lido.dados.nome, mode: "insensitive" } }, select: { id: true } })) {
      res.status(409).json({ error: "Já existe um processo com este nome" });
      return;
    }
    const salvo = await prisma.$transaction(async (tx) => {
      const p = await tx.bonificacaoProcesso.update({ where: { id: atual.id }, data: lido.dados });
      const diff = diffCampos(CAMPOS_PROCESSO, atual as unknown as Record<string, unknown>, p as unknown as Record<string, unknown>);
      if (diff.algumaMudanca) {
        await auditarBonificacao(tx, {
          usuarioId: req.user!.userId,
          origem: "tela",
          correlationId: req.correlationId!,
          entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_PROCESSO,
          entidadeId: String(p.id),
          rotulo: `Processo de bonificação ${p.nome}`,
          evento: "BONIFICACAO_PROCESSO_ALTERADO",
          alteracoes: diff.alteracoes,
        });
      }
      return p;
    });
    res.json({ processo: processoParaResposta(salvo) });
  } catch (error) {
    handleError(res, error, "processo-alterar");
  }
});

// ---------------------------------------------------------------- indicadores
async function auditarProcesso(tx: Prisma.TransactionClient, req: AuthenticatedRequest, processoId: number, nome: string, evento: Parameters<typeof auditarBonificacao>[1]["evento"], metadata: Record<string, unknown>) {
  await auditarBonificacao(tx, {
    usuarioId: req.user!.userId,
    origem: "tela",
    correlationId: req.correlationId!,
    entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_PROCESSO,
    entidadeId: String(processoId),
    rotulo: `Processo de bonificação ${nome}`,
    evento,
    metadata,
  });
}

bonificacaoRouter.post("/processos/:id/indicadores", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const processo = id == null ? null : await prisma.bonificacaoProcesso.findUnique({ where: { id }, include: { indicadores: { select: { chave: true, ordem: true } } } });
    if (!processo) {
      res.status(404).json({ error: "Processo não encontrado" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nome = lerTexto(body.nome, 120);
    if (!nome) {
      res.status(400).json({ error: "Informe o nome do indicador" });
      return;
    }
    const { fonte, unidade, sentido } = body;
    if (!eFonteIndicador(fonte)) {
      res.status(400).json({ error: "Fonte do indicador inválida" });
      return;
    }
    if (!eUnidadeIndicador(unidade)) {
      res.status(400).json({ error: "Unidade do indicador inválida" });
      return;
    }
    if (!eSentidoIndicador(sentido)) {
      res.status(400).json({ error: "Sentido do indicador inválido" });
      return;
    }
    const usadas = new Set(processo.indicadores.map((i) => i.chave));
    let chave = slug(nome);
    for (let n = 2; usadas.has(chave); n++) chave = `${slug(nome).slice(0, 45)}_${n}`;
    const ordem = processo.indicadores.reduce((m, i) => Math.max(m, i.ordem), 0) + 1;
    const criado = await prisma.$transaction(async (tx) => {
      const i = await tx.bonificacaoIndicador.create({
        data: { processoId: processo.id, chave, nome, descricao: lerTexto(body.descricao, 500), fonte, unidade, sentido, ordem },
      });
      await auditarProcesso(tx, req, processo.id, processo.nome, "BONIFICACAO_INDICADOR_ALTERADO", { acao: "criado", indicadorId: i.id, nome: i.nome, fonte: i.fonte });
      return i;
    });
    res.status(201).json({ indicador: { id: criado.id, chave: criado.chave } });
  } catch (error) {
    handleError(res, error, "indicador-criar");
  }
});

bonificacaoRouter.put("/indicadores/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoIndicador.findUnique({ where: { id }, include: { processo: { select: { id: true, nome: true } } } });
    if (!atual) {
      res.status(404).json({ error: "Indicador não encontrado" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nome = lerTexto(body.nome, 120);
    if (!nome) {
      res.status(400).json({ error: "Informe o nome do indicador" });
      return;
    }
    const ordem = lerInteiro(body.ordem) ?? atual.ordem;
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoIndicador.update({ where: { id: atual.id }, data: { nome, descricao: lerTexto(body.descricao, 500), ordem, ativo: body.ativo !== false } });
      await auditarProcesso(tx, req, atual.processo.id, atual.processo.nome, "BONIFICACAO_INDICADOR_ALTERADO", { acao: "alterado", indicadorId: atual.id, nome, ativo: body.ativo !== false });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "indicador-alterar");
  }
});

bonificacaoRouter.delete("/indicadores/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoIndicador.findUnique({ where: { id }, include: { processo: { select: { id: true, nome: true } }, _count: { select: { resultados: true } } } });
    if (!atual) {
      res.status(404).json({ error: "Indicador não encontrado" });
      return;
    }
    if (atual._count.resultados > 0) {
      res.status(409).json({ error: "Este indicador já tem resultados apurados: inative em vez de excluir" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoIndicador.delete({ where: { id: atual.id } });
      await auditarProcesso(tx, req, atual.processo.id, atual.processo.nome, "BONIFICACAO_INDICADOR_ALTERADO", { acao: "excluido", indicadorId: atual.id, nome: atual.nome });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "indicador-excluir");
  }
});

// ---------------------------------------------------------------- regras (versões do indicador, com faixas)
interface DadosRegra {
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  valorBase: number;
  idadeMeses: number | null;
  observacao: string | null;
  faixas: FaixaRegra[];
}

function lerRegra(body: Record<string, unknown>, indicador: { fonte: string; sentido: string }): { ok: true; dados: DadosRegra } | { ok: false; erro: string } {
  const vigenciaInicio = lerData(body.vigenciaInicio);
  if (!vigenciaInicio) return { ok: false, erro: "Informe o início da vigência" };
  const vigenciaFim = body.vigenciaFim ? lerData(body.vigenciaFim) : null;
  if (body.vigenciaFim && !vigenciaFim) return { ok: false, erro: "Fim da vigência inválido" };
  const erroVigencia = validarVigenciaDeRegra(vigenciaInicio, vigenciaFim);
  if (erroVigencia) return { ok: false, erro: erroVigencia };
  const valorBase = lerValor(body.valorBase);
  if (valorBase == null || valorBase < 0 || valorBase > 1_000_000) return { ok: false, erro: "Informe o valor base (de R$ 0 a R$ 1.000.000)" };
  let idadeMeses: number | null = null;
  if (indicador.fonte === "kyria_chamados_antigos") {
    idadeMeses = lerInteiro(body.idadeMeses);
    if (idadeMeses == null || idadeMeses < 1 || idadeMeses > 60) return { ok: false, erro: "Informe a idade dos chamados em meses (de 1 a 60)" };
  }
  if (!Array.isArray(body.faixas)) return { ok: false, erro: "Informe as faixas" };
  const faixas: FaixaRegra[] = [];
  for (const [i, f] of (body.faixas as Record<string, unknown>[]).entries()) {
    const pontos = lerValor(f?.pontos);
    if (pontos == null) return { ok: false, erro: `Pontos da faixa ${i + 1} inválidos` };
    const semLimite = f?.limite == null || (typeof f.limite === "string" && f.limite.trim() === "");
    const limite = semLimite ? null : lerValor(f.limite);
    if (!semLimite && limite == null) return { ok: false, erro: `Limite da faixa ${i + 1} inválido` };
    faixas.push({ limite, pontos });
  }
  const erroFaixas = validarFaixas(faixas, indicador.sentido as SentidoIndicador);
  if (erroFaixas) return { ok: false, erro: erroFaixas };
  return { ok: true, dados: { vigenciaInicio, vigenciaFim, valorBase, idadeMeses, observacao: lerTexto(body.observacao, 500), faixas } };
}

const textoRegra = (d: DadosRegra) =>
  `${isoDia(d.vigenciaInicio)}${d.vigenciaFim ? ` a ${isoDia(d.vigenciaFim)}` : " em diante"} · R$ ${d.valorBase.toFixed(2)} · ${d.faixas.map((f) => `${f.limite ?? "demais"}=${f.pontos}`).join(" | ")}`;

bonificacaoRouter.post("/indicadores/:id/regras", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const indicador = id == null ? null : await prisma.bonificacaoIndicador.findUnique({ where: { id }, include: { processo: { select: { id: true, nome: true } }, regras: true } });
    if (!indicador) {
      res.status(404).json({ error: "Indicador não encontrado" });
      return;
    }
    const lido = lerRegra((req.body ?? {}) as Record<string, unknown>, indicador);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const cruza = vigenciaSobreposta(indicador.regras.map((r) => ({ id: r.id, inicio: r.vigenciaInicio, fim: r.vigenciaFim })), { inicio: lido.dados.vigenciaInicio, fim: lido.dados.vigenciaFim });
    if (cruza) {
      res.status(409).json({ error: `A vigência cruza com outra regra deste indicador (${isoDia(cruza.inicio)}${cruza.fim ? ` a ${isoDia(cruza.fim)}` : " em diante"}): encerre a anterior antes` });
      return;
    }
    const d = lido.dados;
    const criada = await prisma.$transaction(async (tx) => {
      const r = await tx.bonificacaoRegra.create({
        data: {
          indicadorId: indicador.id,
          vigenciaInicio: d.vigenciaInicio,
          vigenciaFim: d.vigenciaFim,
          valorBase: d.valorBase,
          idadeMeses: d.idadeMeses,
          observacao: d.observacao,
          faixas: { create: d.faixas.map((f, i) => ({ ordem: i + 1, limite: f.limite, pontos: f.pontos })) },
        },
      });
      await auditarProcesso(tx, req, indicador.processo.id, indicador.processo.nome, "BONIFICACAO_REGRA_CRIADA", { indicadorId: indicador.id, indicador: indicador.nome, regraId: r.id, regra: textoRegra(d) });
      return r;
    });
    res.status(201).json({ regra: { id: criada.id } });
  } catch (error) {
    handleError(res, error, "regra-criar");
  }
});

/** Regra já usada num fechamento FECHADO: o valor pago não pode mudar por baixo (só encerrar a vigência e anotar). */
const regraUsadaEmFechado = async (regraId: number) =>
  (await prisma.bonificacaoResultado.count({ where: { regraId, fechamento: { situacao: "fechado" } } })) > 0;

bonificacaoRouter.put("/regras/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoRegra.findUnique({ where: { id }, include: { faixas: true, indicador: { include: { processo: { select: { id: true, nome: true } }, regras: true } } } });
    if (!atual) {
      res.status(404).json({ error: "Regra não encontrada" });
      return;
    }
    const lido = lerRegra((req.body ?? {}) as Record<string, unknown>, atual.indicador);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const d = lido.dados;
    const antes: DadosRegra = { vigenciaInicio: atual.vigenciaInicio, vigenciaFim: atual.vigenciaFim, valorBase: dec(atual.valorBase), idadeMeses: atual.idadeMeses, observacao: atual.observacao, faixas: faixasDoBanco(atual.faixas) };
    if (await regraUsadaEmFechado(atual.id)) {
      const mudouNucleo = isoDia(d.vigenciaInicio) !== isoDia(antes.vigenciaInicio) || d.valorBase !== antes.valorBase || d.idadeMeses !== antes.idadeMeses || JSON.stringify(d.faixas) !== JSON.stringify(antes.faixas);
      if (mudouNucleo) {
        res.status(409).json({ error: "Esta regra já foi usada em um fechamento fechado: só é possível encerrar a vigência ou ajustar a observação. Para mudar valor ou faixas, encerre esta e cadastre outra." });
        return;
      }
    }
    const cruza = vigenciaSobreposta(atual.indicador.regras.map((r) => ({ id: r.id, inicio: r.vigenciaInicio, fim: r.vigenciaFim })), { id: atual.id, inicio: d.vigenciaInicio, fim: d.vigenciaFim });
    if (cruza) {
      res.status(409).json({ error: `A vigência cruza com outra regra deste indicador (${isoDia(cruza.inicio)}${cruza.fim ? ` a ${isoDia(cruza.fim)}` : " em diante"})` });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoFaixa.deleteMany({ where: { regraId: atual.id } });
      await tx.bonificacaoRegra.update({
        where: { id: atual.id },
        data: {
          vigenciaInicio: d.vigenciaInicio,
          vigenciaFim: d.vigenciaFim,
          valorBase: d.valorBase,
          idadeMeses: d.idadeMeses,
          observacao: d.observacao,
          faixas: { create: d.faixas.map((f, i) => ({ ordem: i + 1, limite: f.limite, pontos: f.pontos })) },
        },
      });
      await auditarProcesso(tx, req, atual.indicador.processo.id, atual.indicador.processo.nome, "BONIFICACAO_REGRA_ALTERADA", {
        indicadorId: atual.indicadorId,
        indicador: atual.indicador.nome,
        regraId: atual.id,
        de: textoRegra(antes),
        para: textoRegra(d),
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "regra-alterar");
  }
});

bonificacaoRouter.delete("/regras/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoRegra.findUnique({ where: { id }, include: { faixas: true, indicador: { include: { processo: { select: { id: true, nome: true } } } } } });
    if (!atual) {
      res.status(404).json({ error: "Regra não encontrada" });
      return;
    }
    if (await regraUsadaEmFechado(atual.id)) {
      res.status(409).json({ error: "Esta regra já foi usada em um fechamento fechado: encerre a vigência em vez de excluir" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoRegra.delete({ where: { id: atual.id } });
      await auditarProcesso(tx, req, atual.indicador.processo.id, atual.indicador.processo.nome, "BONIFICACAO_REGRA_EXCLUIDA", {
        indicadorId: atual.indicadorId,
        indicador: atual.indicador.nome,
        regraId: atual.id,
        regra: textoRegra({ vigenciaInicio: atual.vigenciaInicio, vigenciaFim: atual.vigenciaFim, valorBase: dec(atual.valorBase), idadeMeses: atual.idadeMeses, observacao: atual.observacao, faixas: faixasDoBanco(atual.faixas) }),
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "regra-excluir");
  }
});

// ---------------------------------------------------------------- enquadramentos (consultores dentro do processo)
interface DadosEnquadramento {
  codfor: number;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  observacao: string | null;
  timesIds: string[];
}

function lerEnquadramento(body: Record<string, unknown>): { ok: true; dados: DadosEnquadramento } | { ok: false; erro: string } {
  const codfor = lerInteiro(body.codfor);
  if (codfor == null) return { ok: false, erro: "Selecione o consultor" };
  const vigenciaInicio = lerData(body.vigenciaInicio);
  if (!vigenciaInicio) return { ok: false, erro: "Informe o início da vigência" };
  const vigenciaFim = body.vigenciaFim ? lerData(body.vigenciaFim) : null;
  if (body.vigenciaFim && !vigenciaFim) return { ok: false, erro: "Fim da vigência inválido" };
  const erro = validarPeriodo(vigenciaInicio, vigenciaFim);
  if (erro) return { ok: false, erro };
  const timesIds = Array.isArray(body.timesIds) ? [...new Set((body.timesIds as unknown[]).filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 64))] : [];
  return { ok: true, dados: { codfor, vigenciaInicio, vigenciaFim, observacao: lerTexto(body.observacao, 500), timesIds } };
}

/** Confere consultor, times e cruzamento de vigência; devolve o codemp do consultor ou a mensagem de erro. */
async function validarEnquadramento(processoId: number, d: DadosEnquadramento, ignorarId: number | null): Promise<{ codemp: number } | { erro: string; status: number }> {
  const consultor = await prisma.consultor.findFirst({ where: { codfor: d.codfor }, select: { codemp: true } });
  if (!consultor) return { erro: "Consultor não encontrado", status: 404 };
  if (d.timesIds.length) {
    const achados = await prisma.kyriaTeam.count({ where: { id: { in: d.timesIds } } });
    if (achados !== d.timesIds.length) return { erro: "Algum time do Kyria informado não existe", status: 400 };
  }
  const outros = await prisma.bonificacaoEnquadramento.findMany({ where: { processoId, codfor: d.codfor }, select: { id: true, vigenciaInicio: true, vigenciaFim: true } });
  const cruza = vigenciaSobreposta(outros.map((o) => ({ id: o.id, inicio: o.vigenciaInicio, fim: o.vigenciaFim })), { id: ignorarId ?? undefined, inicio: d.vigenciaInicio, fim: d.vigenciaFim });
  if (cruza) return { erro: `Este consultor já está enquadrado no processo em ${isoDia(cruza.inicio)}${cruza.fim ? ` a ${isoDia(cruza.fim)}` : " em diante"}: ajuste essa vigência`, status: 409 };
  return { codemp: consultor.codemp };
}

bonificacaoRouter.post("/processos/:id/enquadramentos", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const processo = id == null ? null : await prisma.bonificacaoProcesso.findUnique({ where: { id }, select: { id: true, nome: true } });
    if (!processo) {
      res.status(404).json({ error: "Processo não encontrado" });
      return;
    }
    const lido = lerEnquadramento((req.body ?? {}) as Record<string, unknown>);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const v = await validarEnquadramento(processo.id, lido.dados, null);
    if ("erro" in v) {
      res.status(v.status).json({ error: v.erro });
      return;
    }
    const d = lido.dados;
    const criado = await prisma.$transaction(async (tx) => {
      const e = await tx.bonificacaoEnquadramento.create({
        data: {
          processoId: processo.id,
          codemp: v.codemp,
          codfor: d.codfor,
          vigenciaInicio: d.vigenciaInicio,
          vigenciaFim: d.vigenciaFim,
          observacao: d.observacao,
          criadoPorId: req.user!.userId,
          times: { create: d.timesIds.map((kyriaTeamId) => ({ kyriaTeamId })) },
        },
      });
      await auditarProcesso(tx, req, processo.id, processo.nome, "BONIFICACAO_ENQUADRAMENTO_CRIADO", { enquadramentoId: e.id, codfor: d.codfor, vigenciaInicio: isoDia(d.vigenciaInicio), vigenciaFim: d.vigenciaFim ? isoDia(d.vigenciaFim) : null, times: d.timesIds });
      return e;
    });
    res.status(201).json({ enquadramento: { id: criado.id } });
  } catch (error) {
    handleError(res, error, "enquadramento-criar");
  }
});

bonificacaoRouter.put("/enquadramentos/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoEnquadramento.findUnique({ where: { id }, include: { processo: { select: { id: true, nome: true } }, times: true } });
    if (!atual) {
      res.status(404).json({ error: "Enquadramento não encontrado" });
      return;
    }
    const lido = lerEnquadramento({ ...((req.body ?? {}) as Record<string, unknown>), codfor: atual.codfor });
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const v = await validarEnquadramento(atual.processoId, lido.dados, atual.id);
    if ("erro" in v) {
      res.status(v.status).json({ error: v.erro });
      return;
    }
    const d = lido.dados;
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoEnquadramentoTime.deleteMany({ where: { enquadramentoId: atual.id } });
      await tx.bonificacaoEnquadramento.update({
        where: { id: atual.id },
        data: { vigenciaInicio: d.vigenciaInicio, vigenciaFim: d.vigenciaFim, observacao: d.observacao, times: { create: d.timesIds.map((kyriaTeamId) => ({ kyriaTeamId })) } },
      });
      await auditarProcesso(tx, req, atual.processo.id, atual.processo.nome, "BONIFICACAO_ENQUADRAMENTO_ALTERADO", {
        enquadramentoId: atual.id,
        codfor: atual.codfor,
        de: { vigenciaInicio: isoDia(atual.vigenciaInicio), vigenciaFim: atual.vigenciaFim ? isoDia(atual.vigenciaFim) : null, times: atual.times.map((t) => t.kyriaTeamId) },
        para: { vigenciaInicio: isoDia(d.vigenciaInicio), vigenciaFim: d.vigenciaFim ? isoDia(d.vigenciaFim) : null, times: d.timesIds },
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "enquadramento-alterar");
  }
});

bonificacaoRouter.delete("/enquadramentos/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const atual = id == null ? null : await prisma.bonificacaoEnquadramento.findUnique({ where: { id }, include: { processo: { select: { id: true, nome: true } } } });
    if (!atual) {
      res.status(404).json({ error: "Enquadramento não encontrado" });
      return;
    }
    const usado = await prisma.bonificacaoResultado.count({ where: { codfor: atual.codfor, fechamento: { processoId: atual.processoId } } });
    if (usado > 0) {
      res.status(409).json({ error: "Este consultor já tem resultados neste processo: encerre a vigência em vez de excluir" });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoEnquadramento.delete({ where: { id: atual.id } });
      await auditarProcesso(tx, req, atual.processo.id, atual.processo.nome, "BONIFICACAO_ENQUADRAMENTO_EXCLUIDO", { enquadramentoId: atual.id, codfor: atual.codfor });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "enquadramento-excluir");
  }
});

// ---------------------------------------------------------------- fechamento mensal
function lerCompetenciaDaRota(v: string): Date | null {
  return /^\d{4}-\d{2}$/.test(v) ? lerCompetencia(v) : null;
}
const competenciaCorrente = () => competenciaDe(hojeBrasil());

/** O que a pessoa pode ver do fechamento: quem administra, tudo; os demais, só o fechado e só os consultores do seu escopo. */
const visivel = (escopo: EscopoBonificacao, situacao: string) => escopo.administra || situacao === "fechado";

/**
 * Consultores deste fechamento cujo desconto da competência já fechou DEPOIS da bonificação: a base do desconto (o Valor Nota) já incluía a bonificação,
 * e reabrir não o refaz (decisão do Vitor, 25/11/2026: reabrir é permitido, com este aviso).
 */
async function descontosFechadosComEstaBonificacao(f: { id: number; competencia: Date; fechadoEm: Date | null }): Promise<number> {
  if (!f.fechadoEm) return 0;
  const codfors = (await prisma.bonificacaoResultado.findMany({ where: { fechamentoId: f.id }, select: { codfor: true }, distinct: ["codfor"] })).map((r) => r.codfor);
  if (codfors.length === 0) return 0;
  return prisma.descontoFechamento.count({ where: { competencia: f.competencia, codfor: { in: codfors }, fechadoEm: { gte: f.fechadoEm } } });
}

bonificacaoRouter.post("/fechamentos/apurar", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const processoId = lerInteiro(body.processoId);
    const competencia = lerCompetencia(body.competencia);
    if (processoId == null || !competencia) {
      res.status(400).json({ error: "Informe o processo e a competência (AAAA-MM)" });
      return;
    }
    if (competencia.getTime() > competenciaCorrente().getTime()) {
      res.status(400).json({ error: "Não é possível apurar uma competência futura" });
      return;
    }
    const resumo = await apurarFechamento({ processoId, competencia, usuarioId: req.user!.userId, origem: "tela", correlationId: req.correlationId! });
    res.json(resumo);
  } catch (error) {
    handleError(res, error, "apurar");
  }
});

bonificacaoRouter.get("/fechamentos/:processoId/:competencia", async (req, res) => {
  try {
    const escopo = await escopoComAcesso(req, res);
    if (!escopo) return;
    const processoId = idDaRota(req.params.processoId);
    const competencia = lerCompetenciaDaRota(req.params.competencia);
    if (processoId == null || !competencia) {
      res.status(400).json({ error: "Processo ou competência inválidos" });
      return;
    }
    const processo = await prisma.bonificacaoProcesso.findUnique({
      where: { id: processoId },
      include: {
        indicadores: { where: { ativo: true }, orderBy: [{ ordem: "asc" }, { id: "asc" }], include: { regras: { include: { faixas: true } } } },
        enquadramentos: { select: { codfor: true, vigenciaInicio: true, vigenciaFim: true } },
      },
    });
    if (!processo) {
      res.status(404).json({ error: "Processo não encontrado" });
      return;
    }
    const fechamento = await prisma.bonificacaoFechamento.findUnique({ where: { processoId_competencia: { processoId, competencia } } });
    const podeVer = fechamento != null && visivel(escopo, fechamento.situacao);
    const resultados = podeVer ? await prisma.bonificacaoResultado.findMany({ where: { fechamentoId: fechamento.id }, orderBy: [{ codfor: "asc" }, { indicadorId: "asc" }] }) : [];
    const visiveis = resultados.filter((r) => podeVerConsultor(escopo, r.codfor));
    const codfors = [...new Set(visiveis.map((r) => r.codfor))];
    const consultores = codfors.length ? await prisma.consultor.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true, nomcom: true, nomfor: true } }) : [];
    const nomes = new Map(consultores.map((c) => [c.codfor, nomeConsultor(c)]));
    // Indicação "vai para a nota": só o consultor com contrato Fixo/Hora vigente recebe a bonificação na nota (e só se o processo a compõe). Fechado = a flag copiada ao fechar.
    const compoeNota = fechamento && fechamento.situacao === "fechado" ? fechamento.compoeNota : processo.compoeNota;
    const codempDe = new Map(visiveis.map((r) => [r.codfor, r.codemp]));
    const contratos = new Map(await Promise.all(codfors.map(async (cf) => [cf, await tipoDeContrato(codempDe.get(cf)!, cf)] as const)));

    const linhas = codfors
      .map((codfor) => {
        const itens = visiveis.filter((r) => r.codfor === codfor);
        const nota = indicacaoDaNota(compoeNota, contratos.get(codfor) ?? null);
        const total = totalDoConsultor(itens.map((r) => ({ pontos: r.pontos == null ? null : Number(r.pontos), valor: r.valor == null ? null : Number(r.valor) })));
        return {
          codfor,
          consultor: nomes.get(codfor) ?? `Fornecedor ${codfor}`,
          resultados: Object.fromEntries(
            itens.map((r) => [
              r.indicadorId,
              {
                id: r.id,
                valorApurado: r.valorApurado == null ? null : Number(r.valorApurado),
                valorInformado: r.valorInformado == null ? null : Number(r.valorInformado),
                pontos: r.pontos == null ? null : Number(r.pontos),
                valorBase: r.valorBase == null ? null : Number(r.valorBase),
                valor: r.valor == null ? null : Number(r.valor),
                detalhe: r.detalhe,
                observacao: r.observacao,
              },
            ])
          ),
          totalPontos: total.pontos,
          totalValor: total.centavos / 100,
          pendentes: total.pendentes,
          vaiParaNota: nota.vaiParaNota,
          contrato: nota.contrato,
          contratoRotulo: nota.contrato ? TIPO_CONTRATO_ROTULO[nota.contrato] : null,
          motivoNota: nota.motivo,
        };
      })
      .sort((a, b) => a.consultor.localeCompare(b.consultor, "pt-BR"));

    res.json({
      processo: { id: processo.id, nome: processo.nome },
      competencia: isoCompetencia(competencia),
      administra: escopo.administra,
      fechamento: fechamento && podeVer ? { id: fechamento.id, situacao: fechamento.situacao, situacaoRotulo: SITUACAO_FECHAMENTO_ROTULO[fechamento.situacao as "aberto" | "fechado"] ?? fechamento.situacao, apuradoEm: fechamento.apuradoEm, fechadoEm: fechamento.fechadoEm } : null,
      // O que vale para a nota: fechado = a flag que foi copiada ao fechar; aberto = a do processo (é o que será copiada). `descontosJaFechados` só para quem
      // administra: quantos consultores já tiveram o desconto da competência fechado DEPOIS desta bonificação (a base deles já a inclui).
      compoeNota,
      descontosJaFechados: escopo.administra && fechamento && fechamento.situacao === "fechado" && fechamento.compoeNota ? await descontosFechadosComEstaBonificacao(fechamento) : 0,
      enquadrados: escopo.administra ? processo.enquadramentos.filter((e) => ativoNoMes({ inicio: e.vigenciaInicio, fim: e.vigenciaFim }, competencia)).length : null,
      indicadores: processo.indicadores.map((i) => {
        const regra = regraVigente(i.regras, competencia);
        return {
          id: i.id,
          chave: i.chave,
          nome: i.nome,
          fonte: i.fonte,
          fonteRotulo: FONTE_ROTULO[i.fonte as FonteIndicador] ?? i.fonte,
          unidade: i.unidade,
          sentido: i.sentido,
          regra: regra ? { id: regra.id, valorBase: dec(regra.valorBase), idadeMeses: regra.idadeMeses, faixas: faixasDoBanco(regra.faixas) } : null,
        };
      }),
      linhas,
      totais: {
        valor: linhas.reduce((s, l) => s + Math.round(l.totalValor * 100), 0) / 100,
        pontos: Math.round(linhas.reduce((s, l) => s + l.totalPontos, 0) * 1000) / 1000,
        pendentes: linhas.reduce((s, l) => s + l.pendentes, 0),
        // Quanto deste fechamento vai para a nota (só quem tem contrato Fixo/Hora, em processo que compõe a nota).
        naNota: linhas.filter((l) => l.vaiParaNota).reduce((s, l) => s + Math.round(l.totalValor * 100), 0) / 100,
      },
    });
  } catch (error) {
    handleError(res, error, "fechamento-detalhe");
  }
});

bonificacaoRouter.post("/fechamentos/:id/fechar", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const f = id == null ? null : await prisma.bonificacaoFechamento.findUnique({ where: { id }, include: { processo: { select: { nome: true, compoeNota: true } }, resultados: { select: { valor: true } } } });
    if (!f) {
      res.status(404).json({ error: "Fechamento não encontrado" });
      return;
    }
    if (f.situacao === "fechado") {
      res.status(409).json({ error: "Esta competência já está fechada" });
      return;
    }
    if (f.competencia.getTime() >= competenciaCorrente().getTime()) {
      res.status(409).json({ error: "O mês ainda não terminou: só se fecha uma competência já encerrada" });
      return;
    }
    if (f.resultados.length === 0) {
      res.status(409).json({ error: "Apure a competência antes de fechar" });
      return;
    }
    const pendentes = f.resultados.filter((r) => r.valor == null).length;
    if (pendentes > 0) {
      res.status(409).json({ error: `Há ${pendentes} indicador(es) sem valor: lance os valores que faltam (ou cadastre a regra) antes de fechar` });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoFechamento.update({ where: { id: f.id }, data: { situacao: "fechado", fechadoEm: new Date(), fechadoPorId: req.user!.userId, compoeNota: f.processo.compoeNota } });
      await auditarBonificacao(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_FECHAMENTO,
        entidadeId: String(f.id),
        rotulo: `${f.processo.nome} · ${isoCompetencia(f.competencia)}`,
        evento: "BONIFICACAO_FECHAMENTO_FECHADO",
        metadata: { processoId: f.processoId, competencia: isoCompetencia(f.competencia), resultados: f.resultados.length, total: f.resultados.reduce((s, r) => s + dec(r.valor), 0), compoeNota: f.processo.compoeNota },
      });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "fechar");
  }
});

bonificacaoRouter.post("/fechamentos/:id/reabrir", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    const f = id == null ? null : await prisma.bonificacaoFechamento.findUnique({ where: { id }, include: { processo: { select: { nome: true } } } });
    if (!f) {
      res.status(404).json({ error: "Fechamento não encontrado" });
      return;
    }
    if (f.situacao !== "fechado") {
      res.status(409).json({ error: "Esta competência não está fechada" });
      return;
    }
    const justificativa = lerJustificativa(req.body);
    if (!justificativa) {
      res.status(400).json({ error: "Informe a justificativa (de 3 a 500 caracteres)" });
      return;
    }
    // Compunha a nota: ao reabrir o valor SAI da nota até fechar de novo; o desconto que já fechou com ele na base não é refeito (só avisa).
    const descontosJaFechados = f.compoeNota ? await descontosFechadosComEstaBonificacao(f) : 0;
    await prisma.$transaction(async (tx) => {
      await tx.bonificacaoFechamento.update({ where: { id: f.id }, data: { situacao: "aberto", fechadoEm: null, fechadoPorId: null } });
      await auditarBonificacao(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_FECHAMENTO,
        entidadeId: String(f.id),
        rotulo: `${f.processo.nome} · ${isoCompetencia(f.competencia)}`,
        evento: "BONIFICACAO_FECHAMENTO_REABERTO",
        metadata: { processoId: f.processoId, competencia: isoCompetencia(f.competencia), justificativa, compoeNota: f.compoeNota, descontosJaFechados },
      });
    });
    res.json({ ok: true, compunhaNota: f.compoeNota, descontosJaFechados });
  } catch (error) {
    handleError(res, error, "reabrir");
  }
});

bonificacaoRouter.put("/resultados/:id", exigirAdministra, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDaRota(req.params.id);
    if (id == null) {
      res.status(404).json({ error: "Resultado não encontrado" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const vazio = body.valorInformado == null || (typeof body.valorInformado === "string" && body.valorInformado.trim() === "");
    const informado = vazio ? null : lerValor(body.valorInformado);
    if (!vazio && (informado == null || informado < 0 || informado > 1_000_000)) {
      res.status(400).json({ error: "Valor informado inválido" });
      return;
    }
    const observacao = lerTexto(body.observacao, 500);
    const r = await prisma.$transaction(async (tx) => {
      const out = await informarResultado(tx, id, informado, observacao);
      await auditarBonificacao(tx, {
        usuarioId: req.user!.userId,
        origem: "tela",
        correlationId: req.correlationId!,
        entidadeTipo: ENTIDADES_AUDITORIA.BONIFICACAO_RESULTADO,
        entidadeId: String(id),
        rotulo: out.rotulo,
        evento: "BONIFICACAO_RESULTADO_ALTERADO",
        alteracoes: { valorInformado: { de: out.antes.valorInformado, para: out.depois.valorInformado, rotulo: "Valor informado" }, valor: { de: out.antes.valor, para: out.depois.valor, rotulo: "Valor (R$)" } },
        metadata: { fechamentoId: out.fechamentoId, observacao },
      });
      return out;
    });
    res.json({ pontos: r.depois.pontos, valor: r.depois.valor });
  } catch (error) {
    handleError(res, error, "resultado");
  }
});

// ---------------------------------------------------------------- Home do consultor: a bonificação que compõe a nota, por competência
// Detalhe de cada bonificação (processo, indicador, resultado, pontos, valor base e valor) que somou ao valor da nota do consultor nas competências pedidas.
// Só entra o que está FECHADO em processo que compõe a nota (domain/bonificacaoNota.ts). Consultor vê só a própria; gestor, o time; admin, todos.
bonificacaoRouter.get("/competencias", async (req, res) => {
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
      res.status(403).json({ error: "Sem permissão para ver a bonificação deste consultor" });
      return;
    }
    const competencias = qTexto(req.query.competencias)
      .split(",")
      .map((c) => lerCompetencia(c.trim()))
      .filter((c): c is Date => c != null)
      .slice(0, 24);
    // O mesmo fornecedor pode existir em mais de uma empresa: vale a empresa em que ele tem contrato Fixo/Hora vigente. Sem contrato a bonificação não incide na nota: nada a
    // detalhar (a Home também não a soma).
    const empresas = competencias.length ? await prisma.consultor.findMany({ where: { codfor }, select: { codemp: true }, distinct: ["codemp"] }) : [];
    let codempComContrato: number | null = null;
    for (const e of empresas) {
      if (await tipoDeContrato(e.codemp, codfor)) {
        codempComContrato = e.codemp;
        break;
      }
    }
    if (codempComContrato == null) {
      res.json({ codfor, competencias: [] });
      return;
    }
    const r = await bonificacoesNasCompetencias(codempComContrato, codfor, competencias);
    res.json({
      codfor,
      competencias: [...new Set(competencias.map((c) => isoCompetencia(c)))].map((chave) => {
        const m = r.porMes.get(chave);
        return { competencia: chave, total: m?.total ?? 0, itens: m?.itens ?? [] };
      }),
    });
  } catch (error) {
    handleError(res, error, "competencias");
  }
});

// ---------------------------------------------------------------- listas (padrão de colunas do CaxHub)
const NOME_CONSULTOR = (alias: string) => Prisma.raw(`COALESCE(co.nomcom, co.nomfor, 'Fornecedor ' || ${alias}.codfor)`);
const JOIN_CONSULTOR = (alias: string) => Prisma.raw(`LEFT JOIN LATERAL (SELECT c.nomcom, c.nomfor FROM consultores c WHERE c.codfor = ${alias}.codfor LIMIT 1) co ON TRUE`);
const SITUACAO_SQL = (alias: string) => Prisma.raw(`CASE ${alias}.situacao WHEN 'fechado' THEN 'Fechado' ELSE 'Aberto' END`);
const eSituacao = (v: string) => v === "aberto" || v === "fechado";

registrarListaConsultavel(
  bonificacaoRouter,
  "/fechamentos",
  async (req) => {
    const escopo = await escopoDe(req);
    if (!escopo) throw new Error("Usuário não encontrado");
    if (!temAcesso(escopo)) throw new Error("Sem acesso à Gestão de Bonificação");
    const q = req.query;
    const processoId = qInteiro(q.processoId);
    const situacao = eSituacao(qTexto(q.situacao)) ? qTexto(q.situacao) : null;
    const compDe = qCompetencia(q.competenciaDe);
    const compAte = qCompetencia(q.competenciaAte);
    const extras = extrasDaConsulta(FONTES_BONIFICACAO_FECHAMENTOS, q as Record<string, unknown>);
    return {
      fontes: FONTES_BONIFICACAO_FECHAMENTOS,
      interna: Prisma.sql`
        SELECT f.id, p.id AS "processoId", p.nome AS processo, f.competencia, ${SITUACAO_SQL("f")} AS situacao, f.situacao AS "situacaoCodigo",
               a.consultores, a.total::float8 AS total, a.pendentes, f.apurado_em AS "apuradoEm", f.fechado_em AS "fechadoEm"${extras.selecao}
        FROM bonificacao_fechamentos f
        JOIN bonificacao_processos p ON p.id = f.processo_id
        LEFT JOIN LATERAL (
          SELECT count(DISTINCT r.codfor)::int AS consultores, COALESCE(sum(r.valor), 0) AS total, (count(*) FILTER (WHERE r.valor IS NULL))::int AS pendentes
          FROM bonificacao_resultados r WHERE r.fechamento_id = f.id AND ${escopoSql(escopo, Prisma.sql`r.codfor`)}
        ) a ON TRUE
        WHERE ${escopo.administra ? Prisma.sql`TRUE` : Prisma.sql`f.situacao = 'fechado' AND a.consultores > 0`}
          AND (${processoId}::int IS NULL OR f.processo_id = ${processoId}::int)
          AND (${situacao}::text IS NULL OR f.situacao = ${situacao}::text)
          AND (${compDe}::date IS NULL OR f.competencia >= ${compDe}::date)
          AND (${compAte}::date IS NULL OR f.competencia <= ${compAte}::date)`,
      colunas: [
        col.data("competencia", { obrigatoria: true }),
        col.texto("processo", { obrigatoria: true }),
        col.texto("situacao"),
        col.inteiro("consultores"),
        col.decimal("total"),
        col.inteiro("pendentes"),
        col.data("apuradoEm"),
        col.data("fechadoEm"),
        ...extras.colunas,
      ],
      totais: ["total"],
      ordemPadrao: Prisma.sql`x."competencia" DESC, x."processo" ASC`,
      pageSizePadrao: 30,
    };
  },
  "bonificacao-fechamentos"
);

registrarListaConsultavel(
  bonificacaoRouter,
  "/resultados",
  async (req) => {
    const escopo = await escopoDe(req);
    if (!escopo) throw new Error("Usuário não encontrado");
    if (!temAcesso(escopo)) throw new Error("Sem acesso à Gestão de Bonificação");
    const q = req.query;
    const processoId = qInteiro(q.processoId);
    const codfor = qInteiro(q.codfor);
    const situacao = eSituacao(qTexto(q.situacao)) ? qTexto(q.situacao) : null;
    const compDe = qCompetencia(q.competenciaDe);
    const compAte = qCompetencia(q.competenciaAte);
    const extras = extrasDaConsulta(FONTES_BONIFICACAO_RESULTADOS, q as Record<string, unknown>);
    return {
      fontes: FONTES_BONIFICACAO_RESULTADOS,
      interna: Prisma.sql`
        SELECT r.id, p.id AS "processoId", p.nome AS processo, f.competencia, ${SITUACAO_SQL("f")} AS situacao, r.codemp, r.codfor,
               ${NOME_CONSULTOR("r")} AS consultor, i.nome AS indicador,
               r.valor_apurado::float8 AS "valorApurado", r.valor_informado::float8 AS "valorInformado", r.pontos::float8 AS pontos,
               r.valor_base::float8 AS "valorBase", r.valor::float8 AS valor, r.observacao${extras.selecao}
        FROM bonificacao_resultados r
        JOIN bonificacao_fechamentos f ON f.id = r.fechamento_id
        JOIN bonificacao_processos p ON p.id = f.processo_id
        JOIN bonificacao_indicadores i ON i.id = r.indicador_id
        ${JOIN_CONSULTOR("r")}
        WHERE ${escopoSql(escopo, Prisma.sql`r.codfor`)}
          AND ${escopo.administra ? Prisma.sql`TRUE` : Prisma.sql`f.situacao = 'fechado'`}
          AND (${processoId}::int IS NULL OR f.processo_id = ${processoId}::int)
          AND (${codfor}::int IS NULL OR r.codfor = ${codfor}::int)
          AND (${situacao}::text IS NULL OR f.situacao = ${situacao}::text)
          AND (${compDe}::date IS NULL OR f.competencia >= ${compDe}::date)
          AND (${compAte}::date IS NULL OR f.competencia <= ${compAte}::date)`,
      colunas: [
        col.data("competencia", { obrigatoria: true }),
        col.texto("processo"),
        col.texto("consultor", { obrigatoria: true }),
        col.texto("indicador"),
        col.decimal("valorApurado"),
        col.decimal("valorInformado"),
        col.decimal("pontos"),
        col.decimal("valorBase"),
        col.decimal("valor"),
        col.texto("situacao"),
        col.texto("observacao"),
        ...extras.colunas,
      ],
      totais: ["pontos", "valor"],
      ordemPadrao: Prisma.sql`x."competencia" DESC, x."consultor" ASC, x."indicador" ASC`,
      pageSizePadrao: 30,
    };
  },
  "bonificacao-resultados"
);

// ---------------------------------------------------------------- relatório: Horas Disponíveis x Trabalhadas (Kyria)
// Lista do kit (filtro e ordem por coluna, resumo, CSV): uma linha por atendente enquadrado, com as horas trabalhadas do ponto (HCM), o saldo do
// banco de horas no mês, as extras (saldo positivo), o total do mês, as horas apontadas no Kyria, o tempo ocioso, o % e o PDI do fechamento. O detalhe por time do chamado vem em `porTime` (aberto ao clicar na linha). É calculado na hora
// (não depende de apurar o fechamento); o PDI só aparece quando o fechamento já foi lançado (quem administra vê o aberto; os demais, o fechado).
// Mesma regra de domain/bonificacaoApuracao.ts (apurarPctPonto), em domain/bonificacaoHoras.ts: % = minutos do Kyria do mês de Brasília ÷ total do
// mês (ponto ConAbs 2 + saldo positivo do banco de horas, sem removidos).
registrarListaConsultavel(
  bonificacaoRouter,
  "/relatorios/horas-kyria",
  async (req) => {
    const escopo = await escopoDe(req);
    if (!escopo) throw new Error("Usuário não encontrado");
    if (!temAcesso(escopo)) throw new Error("Sem acesso à Gestão de Bonificação");
    const q = req.query;
    const competencia = lerCompetencia(qTexto(q.competencia)) ?? competenciaDe(new Date(Date.UTC(hojeBrasil().getUTCFullYear(), hojeBrasil().getUTCMonth() - 1, 1)));
    const ini = isoDia(competencia);
    const fim = isoDia(new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 1)));
    const processoId = qInteiro(q.processoId);
    const codfor = qInteiro(q.codfor);
    const NO_MES_KYRIA = Prisma.sql`(en.started_at AT TIME ZONE 'America/Sao_Paulo') >= ${ini}::date AND (en.started_at AT TIME ZONE 'America/Sao_Paulo') < ${fim}::date`;
    // Minutos apontados no mês por time do TICKET e, dentro dele, por ÁREA do chamado, por usuário (codusu) — usada pelo detalhe da tela e pelo
    // da impressão. Área = etiqueta(s) do grupo de chave "area"; chamado com duas áreas vira "A + B" (a hora não conta duas vezes).
    const horasPorTime = async (codusus: unknown[]): Promise<Map<number, TimeComAreas[]>> => {
      const usuarios = [...new Set(codusus.filter((n): n is number => typeof n === "number"))];
      if (usuarios.length === 0) return new Map();
      const linhas = await prisma.$queryRaw<LinhaTimeArea[]>`
        SELECT m.codusu, COALESCE(kt.name, '(sem time)') AS time, COALESCE(ar.area, '(sem área)') AS area, sum(en.minutes)::float8 AS minutos
        FROM kyria_members m
        JOIN kyria_time_entries en ON en.user_id = m.id AND en.minutes IS NOT NULL AND ${NO_MES_KYRIA}
        JOIN kyria_tickets t ON t.id = en.ticket_id
        LEFT JOIN kyria_teams kt ON kt.id = t.team_id
        LEFT JOIN LATERAL (
          SELECT string_agg(l.name, ' + ' ORDER BY l.name) AS area
          FROM kyria_ticket_labels tl
          JOIN kyria_labels l ON l.id = tl.label_id
          JOIN kyria_label_groups g ON g.id = l.group_id AND g.key = 'area'
          WHERE tl.ticket_id = t.id
        ) ar ON TRUE
        WHERE m.codusu = ANY(${usuarios}::int[])
        GROUP BY m.codusu, kt.name, ar.area`;
      return agruparTimesEAreas(linhas);
    };
    return {
      interna: Prisma.sql`
        SELECT x.processo_id AS "processoId", x.processo, x.codemp, x.codfor, co.codusu, COALESCE(co.nomcom, co.nomfor, 'Fornecedor ' || x.codfor) AS consultor,
               ky.minutos::float8 AS "minutosKyria", pt.minutos::float8 AS "minutosPonto",
               bh.minutos AS "saldoBanco", GREATEST(COALESCE(bh.minutos, 0), 0)::float8 AS "minutosExtras", tm.minutos AS "minutosTotal",
               -- Ocioso só quando há o que comparar: total no mês e atendente ligado a um membro do Kyria (sem o vínculo seria "tudo ocioso").
               CASE WHEN tm.minutos > 0 AND EXISTS (SELECT 1 FROM kyria_members m WHERE m.codusu = co.codusu)
                    THEN round((tm.minutos - COALESCE(ky.minutos, 0)::float8)::numeric, 2)::float8 END AS "minutosOcioso",
               CASE WHEN tm.minutos > 0 THEN round((ky.minutos::float8 * 100 / tm.minutos)::numeric, 4)::float8 END AS percentual,
               pdi.horas::float8 AS "pdiHoras",
               CASE WHEN pdi.pontos IS NULL THEN NULL WHEN pdi.pontos > 0 THEN 'Sim' ELSE 'Não' END AS "pdiConcluido",
               CASE WHEN co.codusu IS NULL THEN 'Consultor não encontrado'
                    WHEN NOT EXISTS (SELECT 1 FROM kyria_members m WHERE m.codusu = co.codusu) THEN 'Sem vínculo com o Kyria'
                    WHEN v.hcm_numcad IS NULL THEN 'Sem vínculo com o HCM'
                    WHEN COALESCE(pt.minutos, 0) = 0 THEN 'Sem horas trabalhadas no ponto neste mês' END AS motivo
        FROM (
          SELECT DISTINCT p.id AS processo_id, p.nome AS processo, e.codemp, e.codfor
          FROM bonificacao_enquadramentos e
          JOIN bonificacao_processos p ON p.id = e.processo_id AND p.ativo
          WHERE EXISTS (SELECT 1 FROM bonificacao_indicadores i WHERE i.processo_id = p.id AND i.fonte = 'kyria_pct_ponto' AND i.ativo)
            AND e.vigencia_inicio < ${fim}::date AND (e.vigencia_fim IS NULL OR e.vigencia_fim >= ${ini}::date)
            AND (${processoId}::int IS NULL OR p.id = ${processoId}::int)
            AND (${codfor}::int IS NULL OR e.codfor = ${codfor}::int)
            AND ${escopoSql(escopo, Prisma.sql`e.codfor`)}
        ) x
        LEFT JOIN LATERAL (SELECT c.codusu, c.nomcom, c.nomfor FROM consultores c WHERE c.codemp = x.codemp AND c.codfor = x.codfor LIMIT 1) co ON TRUE
        LEFT JOIN consultor_vinculos v ON v.codemp = x.codemp AND v.codusu = co.codusu
        LEFT JOIN LATERAL (
          SELECT sum(en.minutes) AS minutos FROM kyria_time_entries en JOIN kyria_members m ON m.id = en.user_id
          WHERE m.codusu = co.codusu AND en.minutes IS NOT NULL AND ${NO_MES_KYRIA}
        ) ky ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(sp.qtdhor), 0) AS minutos FROM hcm_situacao_ponto sp JOIN hcm_situacoes st ON st.codsit = sp.codsit
          WHERE v.hcm_numcad IS NOT NULL AND sp.numemp = v.hcm_numemp AND sp.tipcol = v.hcm_tipcol AND sp.numcad = v.hcm_numcad
            AND st.conabs = 2 AND sp.removido_em_senior IS NULL AND sp.datapu >= ${ini}::date AND sp.datapu < ${fim}::date
        ) pt ON TRUE
        LEFT JOIN LATERAL (${saldoBancoDoMesSql(Prisma.sql`v.hcm_numemp`, Prisma.sql`v.hcm_tipcol`, Prisma.sql`v.hcm_numcad`, ini, fim)}) bh ON TRUE
        CROSS JOIN LATERAL (SELECT (COALESCE(pt.minutos, 0) + GREATEST(COALESCE(bh.minutos, 0), 0))::float8 AS minutos) tm
        LEFT JOIN LATERAL (
          SELECT COALESCE(r.valor_informado, r.valor_apurado) AS horas, r.pontos
          FROM bonificacao_resultados r
          JOIN bonificacao_fechamentos f ON f.id = r.fechamento_id AND f.processo_id = x.processo_id AND f.competencia = ${ini}::date
          JOIN bonificacao_indicadores i ON i.id = r.indicador_id AND i.chave = 'pdi'
          WHERE r.codfor = x.codfor AND ${escopo.administra ? Prisma.sql`TRUE` : Prisma.sql`f.situacao = 'fechado'`}
          LIMIT 1
        ) pdi ON TRUE`,
      colunas: [
        col.texto("consultor", { obrigatoria: true }),
        col.texto("processo"),
        col.decimal("minutosPonto", { formato: "horasMinutos" }),
        col.decimal("saldoBanco", { formato: "horasMinutos" }),
        col.decimal("minutosExtras", { formato: "horasMinutos" }),
        col.decimal("minutosTotal", { formato: "horasMinutos" }),
        col.decimal("minutosKyria", { formato: "horasMinutos" }),
        col.decimal("minutosOcioso", { formato: "horasMinutos" }),
        col.decimal("percentual"),
        col.decimal("pdiHoras"),
        col.texto("pdiConcluido"),
        col.texto("motivo"),
        col.inteiro("processoId"),
        col.inteiro("codfor"),
        col.inteiro("codusu"),
      ],
      totais: ["minutosPonto", "minutosExtras", "minutosTotal", "minutosKyria", "minutosOcioso"],
      ordemPadrao: Prisma.sql`x."processo" ASC, x."consultor" ASC`,
      pageSizePadrao: 25,
      // Detalhe por time do chamado (time do TICKET, não o do apontamento: o do apontamento vem nulo/divergente em boa parte das linhas) e, dentro
      // do time, por área do chamado.
      decorar: async (linhas) => {
        const porTime = await horasPorTime(linhas.map((l) => l.codusu));
        return linhas.map((l) => ({ ...l, porTime: porTime.get(l.codusu as number) ?? [] }));
      },
      // Relatório impresso/PDF: os times saem sob o atendente quando a tela os tinha abertos (`detalhe` = chaves "processoId-codfor" das linhas abertas).
      detalheImpressao: async (linhas) => {
        const abertas = new Set(qTexto(q.detalhe).split(",").filter(Boolean));
        if (abertas.size === 0) return linhas.map(() => null);
        const chave = (l: Record<string, unknown>) => `${l.processoId}-${l.codfor}`;
        const porTime = await horasPorTime(linhas.filter((l) => abertas.has(chave(l))).map((l) => l.codusu));
        return linhas.map((l) => {
          if (!abertas.has(chave(l))) return null;
          const total = typeof l.minutosKyria === "number" ? l.minutosKyria : 0;
          const parte = (minutos: number) => (total > 0 ? Math.round((minutos * 10000) / total) / 100 : null);
          // Impressão: o time e, logo abaixo, as áreas dele com um recuo no nome (a célula impressa é texto simples).
          return (porTime.get(l.codusu as number) ?? []).flatMap((t) => [
            { consultor: t.time, minutosKyria: t.minutos, percentual: parte(t.minutos) },
            ...t.porArea.map((a) => ({ consultor: `\u00a0\u00a0\u00a0\u00a0› ${a.area}`, minutosKyria: a.minutos, percentual: parte(a.minutos) })),
          ]);
        });
      },
    };
  },
  "bonificacao-horas-kyria"
);

// ---------------------------------------------------------------- foto da fila do Kyria
// O cron de sexta (kyria/filaSemanalSync.ts) tira a foto sozinho; aqui o admin tira na hora (ex.: o job falhou ou foi implantado depois da sexta).
bonificacaoRouter.post("/fila-semanal/capturar", exigirAdministra, async (_req, res) => {
  try {
    const { times } = await capturarFilaDoDia(hojeBrasil());
    res.json({ data: isoDia(hojeBrasil()), times });
  } catch (error) {
    handleError(res, error, "fila-capturar");
  }
});
