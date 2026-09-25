import { NextFunction, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { CINCO_S_DIR } from "../config/uploads";
import { criarEventoAuditoria, diffCampos } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA, EventoAuditoriaTipo } from "../audit/taxonomia";
import { entidadeIdAvaliacao5S } from "../audit/identidadeEntidade";
import {
  Acesso5S,
  CHAVES_SENSO,
  NOTA_MAX,
  NOTA_MIN,
  PAPEIS_5S,
  Papel5S,
  SENSOS,
  Senso,
  TIPOS_AREA,
  TipoArea,
  calcularPercentuais,
  chaveMes,
  ehAgrupadora,
  ehSenso,
  hojeComoData,
  media,
  montarTitulo,
  podeAvaliar,
  podeGerenciarCadastros,
  podeObservarArea,
  podeVerArea,
  temAcesso,
  tendencia,
} from "../domain/gestao5s";
import { carregarAcesso5S } from "../domain/gestao5sAcesso";

// Módulo Gestão 5S — auditorias mensais de setores e ambientes comuns. Dado 100% do CaxHub.
// O acesso vem do cadastro em Participante5S (coordenador | avaliador | lider), não do papel do
// usuário; o admin do CaxHub é coordenador implícito. O líder só enxerga avaliações FINALIZADAS
// dos setores dele e dos ambientes comuns que lhe cabem (ver podeVerArea).
export const gestao5sRouter = Router();

interface Req5S extends AuthenticatedRequest {
  acesso?: Acesso5S;
}

gestao5sRouter.use(requireAuth);
gestao5sRouter.use(async (req: Req5S, res, next: NextFunction) => {
  try {
    req.acesso = await carregarAcesso5S(req.user!.userId, req.user!.role);
    next();
  } catch (error) {
    handleError(res, error, "acesso");
  }
});

// ---------- infraestrutura ----------

const MIMES_IMAGEM = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/heic", "image/heif"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(CINCO_S_DIR, { recursive: true });
      cb(null, CINCO_S_DIR);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (MIMES_IMAGEM.has(file.mimetype)) cb(null, true);
    else cb(new Error("Envie uma imagem (JPG, PNG, WEBP, GIF ou HEIC)"));
  },
});

const uploadUmaImagem = (req: Req5S, res: Response, next: NextFunction) =>
  upload.single("arquivo")(req, res, (err: unknown) => {
    if (err) return void res.status(400).json({ error: err instanceof Error ? err.message : "Falha no upload" });
    next();
  });

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[gestao-5s:${label}]`, message);
  res.status(500).json({ error: message });
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const txt = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const dec = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const isoDia = (d: Date): string => d.toISOString().slice(0, 10);

function idDaRota(req: AuthenticatedRequest, chave = "id"): number | null {
  const n = Number(req.params[chave]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function ehDataIso(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`));
}
const paraData = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function ehMes(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

// Exige participante cadastrado (ou admin). Responde 403 e devolve null quando não há acesso.
function exigirAcesso(req: Req5S, res: Response): Acesso5S | null {
  const acesso = req.acesso!;
  if (!temAcesso(acesso)) {
    res.status(403).json({ error: "Sem acesso ao módulo Gestão 5S" });
    return null;
  }
  return acesso;
}

function exigirCoordenador(req: Req5S, res: Response): Acesso5S | null {
  const acesso = exigirAcesso(req, res);
  if (!acesso) return null;
  if (!podeGerenciarCadastros(acesso)) {
    res.status(403).json({ error: "Apenas o coordenador do 5S pode alterar os cadastros" });
    return null;
  }
  return acesso;
}

// Filtro Prisma das áreas que o acesso enxerga (espelha podeVerArea).
function filtroAreasVisiveis(acesso: Acesso5S): Prisma.Area5SWhereInput {
  if (acesso.papel !== "lider") return {};
  return {
    OR: [
      { tipo: "setor", OR: [{ id: { in: acesso.areasLider } }, { ambientes: { some: { ativo: true } } }] },
      { tipo: "comum" },
    ],
  };
}

// Líder só vê avaliação finalizada; os demais, qualquer status.
function filtroAvaliacoesVisiveis(acesso: Acesso5S): Prisma.Avaliacao5SWhereInput {
  return {
    area: filtroAreasVisiveis(acesso),
    ...(acesso.papel === "lider" ? { status: "finalizada" } : {}),
  };
}

function auditar(
  tx: Prisma.TransactionClient,
  req: AuthenticatedRequest,
  av: { id: number; titulo: string },
  eventoTipo: EventoAuditoriaTipo,
  extra: { alteracoes?: ReturnType<typeof diffCampos>["alteracoes"]; metadata?: Record<string, unknown> } = {}
) {
  return criarEventoAuditoria(
    {
      origem: "tela",
      usuarioId: req.user!.userId,
      entidadeTipo: ENTIDADES_AUDITORIA.AVALIACAO_5S,
      entidadeId: entidadeIdAvaliacao5S(av.id),
      entidadeRotulo: av.titulo,
      eventoTipo,
      alteracoes: extra.alteracoes ?? null,
      metadata: extra.metadata ?? null,
      correlationId: req.correlationId!,
    },
    tx
  );
}

// ---------- acesso ----------

gestao5sRouter.get("/meu-acesso", (req: Req5S, res) => {
  const a = req.acesso!;
  res.json({
    papel: a.papel,
    areasLider: a.areasLider,
    pode: { gerenciarCadastros: podeGerenciarCadastros(a), avaliar: podeAvaliar(a), observar: temAcesso(a) },
  });
});

// ---------- áreas e ambientes ----------

const SELECT_AREA = {
  id: true,
  nome: true,
  tipo: true,
  setorVinculadoId: true,
  ativo: true,
  ordem: true,
  setorVinculado: { select: { nome: true } },
  ambientes: { where: { ativo: true }, select: { id: true, nome: true }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] },
} satisfies Prisma.Area5SSelect;

type AreaLinha = Prisma.Area5SGetPayload<{ select: typeof SELECT_AREA }>;

function serializarArea(a: AreaLinha) {
  return {
    id: a.id,
    nome: a.nome,
    tipo: a.tipo,
    setorVinculadoId: a.setorVinculadoId,
    setorVinculadoNome: a.setorVinculado?.nome ?? null,
    ativo: a.ativo,
    ordem: a.ordem,
    // Setor com ambientes comuns vinculados: não tem perguntas próprias, vira agrupador.
    ehAgrupadora: a.tipo === "setor" && a.ambientes.length > 0,
    vinculados: a.ambientes,
  };
}

gestao5sRouter.get("/areas", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    const tipo = TIPOS_AREA.find((t) => t === req.query.tipo);
    const incluirInativas = req.query.incluirInativas === "true" && podeGerenciarCadastros(acesso);
    const areas = await prisma.area5S.findMany({
      where: {
        AND: [filtroAreasVisiveis(acesso)],
        ...(tipo ? { tipo } : {}),
        ...(incluirInativas ? {} : { ativo: true }),
      },
      select: SELECT_AREA,
      orderBy: [{ tipo: "asc" }, { ordem: "asc" }, { nome: "asc" }],
    });
    res.json(areas.map(serializarArea));
  } catch (error) {
    handleError(res, error, "areas-listar");
  }
});

async function validarArea(body: Record<string, unknown>, idAtual?: number) {
  const nome = txt(body.nome, 120);
  if (!nome) return { erro: "Nome é obrigatório" };
  const tipo = TIPOS_AREA.find((t) => t === body.tipo);
  if (!tipo) return { erro: "Tipo deve ser 'setor' ou 'comum'" };
  let setorVinculadoId: number | null = null;
  if (tipo === "comum" && body.setorVinculadoId != null && body.setorVinculadoId !== "") {
    setorVinculadoId = Number(body.setorVinculadoId);
    if (setorVinculadoId === idAtual) return { erro: "Um ambiente não pode ser vinculado a ele mesmo" };
    const setor = await prisma.area5S.findUnique({ where: { id: setorVinculadoId }, select: { tipo: true } });
    if (!setor || setor.tipo !== "setor") return { erro: "O vínculo deve ser com um setor cadastrado" };
  }
  const ordem = Number.isInteger(Number(body.ordem)) ? Number(body.ordem) : 0;
  return { dados: { nome, tipo, setorVinculadoId, ordem, ativo: body.ativo === undefined ? true : body.ativo === true } };
}

gestao5sRouter.post("/areas", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const v = await validarArea(req.body ?? {});
    if (v.erro) return void res.status(400).json({ error: v.erro });
    const area = await prisma.area5S.create({ data: v.dados!, select: SELECT_AREA });
    res.status(201).json(serializarArea(area));
  } catch (error) {
    handleError(res, error, "areas-criar");
  }
});

gestao5sRouter.put("/areas/:id", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const id = idDaRota(req);
    if (!id) return void res.status(400).json({ error: "Id inválido" });
    const atual = await prisma.area5S.findUnique({ where: { id }, select: { tipo: true } });
    if (!atual) return void res.status(404).json({ error: "Área não encontrada" });
    const v = await validarArea(req.body ?? {}, id);
    if (v.erro) return void res.status(400).json({ error: v.erro });
    if (v.dados!.tipo === "comum") {
      const vinculados = await prisma.area5S.count({ where: { setorVinculadoId: id, ativo: true } });
      if (vinculados > 0) return void res.status(400).json({ error: "Este setor tem ambientes vinculados e não pode virar ambiente comum" });
    }
    if (v.dados!.tipo !== atual.tipo) {
      const usada = await prisma.avaliacao5S.count({ where: { areaId: id } });
      if (usada > 0) return void res.status(409).json({ error: "Não é possível trocar o tipo de uma área que já tem avaliações" });
    }
    const area = await prisma.area5S.update({ where: { id }, data: v.dados!, select: SELECT_AREA });
    res.json(serializarArea(area));
  } catch (error) {
    handleError(res, error, "areas-editar");
  }
});

gestao5sRouter.delete("/areas/:id", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const id = idDaRota(req);
    if (!id) return void res.status(400).json({ error: "Id inválido" });
    const usada = await prisma.avaliacao5S.count({ where: { areaId: id } });
    if (usada > 0) return void res.status(409).json({ error: "Esta área já tem avaliações — desative em vez de excluir" });
    await prisma.area5S.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "areas-excluir");
  }
});

// ---------- perguntas do formulário ----------

const SELECT_PERGUNTA = {
  id: true,
  tipoArea: true,
  areaId: true,
  senso: true,
  texto: true,
  ordem: true,
  ativo: true,
  area: { select: { nome: true } },
} satisfies Prisma.Pergunta5SSelect;

function serializarPergunta(p: Prisma.Pergunta5SGetPayload<{ select: typeof SELECT_PERGUNTA }>) {
  return { id: p.id, tipoArea: p.tipoArea, areaId: p.areaId, areaNome: p.area?.nome ?? null, senso: p.senso, texto: p.texto, ordem: p.ordem, ativo: p.ativo };
}

async function validarPergunta(body: Record<string, unknown>) {
  const texto = txt(body.texto, 600);
  if (!texto) return { erro: "Texto da pergunta é obrigatório" };
  if (!ehSenso(body.senso)) return { erro: "Senso inválido" };
  const tipoArea = TIPOS_AREA.find((t) => t === body.tipoArea);
  if (!tipoArea) return { erro: "Tipo de área deve ser 'setor' ou 'comum'" };
  let areaId: number | null = null;
  if (body.areaId != null && body.areaId !== "") {
    areaId = Number(body.areaId);
    const area = await prisma.area5S.findUnique({ where: { id: areaId }, select: { tipo: true } });
    if (!area) return { erro: "Área não encontrada" };
    if (area.tipo !== tipoArea) return { erro: "A área escolhida não é do tipo informado" };
  }
  const ordem = Number.isInteger(Number(body.ordem)) ? Number(body.ordem) : 0;
  return { dados: { texto, senso: body.senso, tipoArea, areaId, ordem, ativo: body.ativo === undefined ? true : body.ativo === true } };
}

gestao5sRouter.get("/perguntas", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const tipoArea = TIPOS_AREA.find((t) => t === req.query.tipoArea);
    const areaId = num(req.query.areaId);
    const perguntas = await prisma.pergunta5S.findMany({
      where: { ...(tipoArea ? { tipoArea } : {}), ...(areaId ? { areaId } : {}) },
      select: SELECT_PERGUNTA,
      orderBy: [{ ordem: "asc" }, { id: "asc" }],
    });
    res.json(perguntas.map(serializarPergunta));
  } catch (error) {
    handleError(res, error, "perguntas-listar");
  }
});

gestao5sRouter.post("/perguntas", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const v = await validarPergunta(req.body ?? {});
    if (v.erro) return void res.status(400).json({ error: v.erro });
    let dados = v.dados!;
    if (!Number.isInteger(Number(req.body?.ordem))) {
      const max = await prisma.pergunta5S.aggregate({ _max: { ordem: true }, where: { tipoArea: dados.tipoArea, senso: dados.senso, areaId: dados.areaId } });
      dados = { ...dados, ordem: (max._max.ordem ?? 0) + 1 };
    }
    const p = await prisma.pergunta5S.create({ data: dados as Prisma.Pergunta5SUncheckedCreateInput, select: SELECT_PERGUNTA });
    res.status(201).json(serializarPergunta(p));
  } catch (error) {
    handleError(res, error, "perguntas-criar");
  }
});

gestao5sRouter.post("/perguntas/reordenar", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => Number.isInteger(i))) {
      return void res.status(400).json({ error: "Informe a lista de ids na nova ordem" });
    }
    await prisma.$transaction(ids.map((id: number, i: number) => prisma.pergunta5S.update({ where: { id }, data: { ordem: i + 1 } })));
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "perguntas-reordenar");
  }
});

gestao5sRouter.put("/perguntas/:id", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const id = idDaRota(req);
    if (!id) return void res.status(400).json({ error: "Id inválido" });
    if (!(await prisma.pergunta5S.findUnique({ where: { id }, select: { id: true } }))) {
      return void res.status(404).json({ error: "Pergunta não encontrada" });
    }
    const v = await validarPergunta(req.body ?? {});
    if (v.erro) return void res.status(400).json({ error: v.erro });
    const p = await prisma.pergunta5S.update({ where: { id }, data: v.dados as Prisma.Pergunta5SUncheckedUpdateInput, select: SELECT_PERGUNTA });
    res.json(serializarPergunta(p));
  } catch (error) {
    handleError(res, error, "perguntas-editar");
  }
});

gestao5sRouter.delete("/perguntas/:id", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const id = idDaRota(req);
    if (!id) return void res.status(400).json({ error: "Id inválido" });
    const usada = await prisma.avaliacao5SResposta.count({ where: { perguntaId: id } });
    if (usada > 0) return void res.status(409).json({ error: "Esta pergunta já foi usada em avaliações — desative em vez de excluir" });
    await prisma.pergunta5S.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "perguntas-excluir");
  }
});

// ---------- participantes (avaliadores e líderes) ----------

const SELECT_PARTICIPANTE = {
  id: true,
  userId: true,
  papel: true,
  ativo: true,
  user: { select: { nome: true, email: true } },
  areas: { select: { areaId: true, area: { select: { nome: true } } } },
} satisfies Prisma.Participante5SSelect;

function serializarParticipante(p: Prisma.Participante5SGetPayload<{ select: typeof SELECT_PARTICIPANTE }>) {
  return {
    id: p.id,
    userId: p.userId,
    nome: p.user.nome,
    email: p.user.email,
    papel: p.papel,
    ativo: p.ativo,
    areas: p.areas.map((a) => ({ id: a.areaId, nome: a.area.nome })),
  };
}

async function validarParticipante(body: Record<string, unknown>) {
  const papel = PAPEIS_5S.find((p) => p === body.papel) as Papel5S | undefined;
  if (!papel) return { erro: "Papel inválido" };
  const areaIds = Array.isArray(body.areaIds) ? [...new Set(body.areaIds.map(Number))].filter((n) => Number.isInteger(n)) : [];
  if (papel === "lider") {
    if (areaIds.length === 0) return { erro: "Líder precisa estar vinculado a pelo menos um setor" };
    const setores = await prisma.area5S.count({ where: { id: { in: areaIds }, tipo: "setor" } });
    if (setores !== areaIds.length) return { erro: "Líder só pode ser vinculado a setores cadastrados" };
  }
  return { dados: { papel, areaIds: papel === "lider" ? areaIds : [], ativo: body.ativo === undefined ? true : body.ativo === true } };
}

gestao5sRouter.get("/participantes", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const lista = await prisma.participante5S.findMany({ select: SELECT_PARTICIPANTE, orderBy: { user: { nome: "asc" } } });
    res.json(lista.map(serializarParticipante));
  } catch (error) {
    handleError(res, error, "participantes-listar");
  }
});

// Usuários ativos que ainda não são participantes (para o seletor do cadastro).
gestao5sRouter.get("/participantes/usuarios-disponiveis", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const usuarios = await prisma.user.findMany({
      where: {
        status: "ativo",
        participante5s: null,
        ...(q ? { OR: [{ nome: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
      },
      select: { id: true, nome: true, email: true },
      orderBy: { nome: "asc" },
      take: 50,
    });
    res.json(usuarios);
  } catch (error) {
    handleError(res, error, "participantes-usuarios");
  }
});

gestao5sRouter.post("/participantes", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const userId = num(req.body?.userId);
    if (!userId) return void res.status(400).json({ error: "Usuário é obrigatório" });
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      return void res.status(404).json({ error: "Usuário não encontrado" });
    }
    if (await prisma.participante5S.findUnique({ where: { userId }, select: { id: true } })) {
      return void res.status(409).json({ error: "Este usuário já está cadastrado no 5S" });
    }
    const v = await validarParticipante(req.body ?? {});
    if (v.erro) return void res.status(400).json({ error: v.erro });
    const p = await prisma.participante5S.create({
      data: { userId, papel: v.dados!.papel, ativo: v.dados!.ativo, areas: { create: v.dados!.areaIds.map((areaId) => ({ areaId })) } },
      select: SELECT_PARTICIPANTE,
    });
    res.status(201).json(serializarParticipante(p));
  } catch (error) {
    handleError(res, error, "participantes-criar");
  }
});

gestao5sRouter.put("/participantes/:id", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const id = idDaRota(req);
    if (!id) return void res.status(400).json({ error: "Id inválido" });
    if (!(await prisma.participante5S.findUnique({ where: { id }, select: { id: true } }))) {
      return void res.status(404).json({ error: "Participante não encontrado" });
    }
    const v = await validarParticipante(req.body ?? {});
    if (v.erro) return void res.status(400).json({ error: v.erro });
    const p = await prisma.$transaction(async (tx) => {
      await tx.participante5SArea.deleteMany({ where: { participanteId: id } });
      return tx.participante5S.update({
        where: { id },
        data: { papel: v.dados!.papel, ativo: v.dados!.ativo, areas: { create: v.dados!.areaIds.map((areaId) => ({ areaId })) } },
        select: SELECT_PARTICIPANTE,
      });
    });
    res.json(serializarParticipante(p));
  } catch (error) {
    handleError(res, error, "participantes-editar");
  }
});

gestao5sRouter.delete("/participantes/:id", async (req: Req5S, res) => {
  try {
    if (!exigirCoordenador(req, res)) return;
    const id = idDaRota(req);
    if (!id) return void res.status(400).json({ error: "Id inválido" });
    await prisma.participante5S.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "participantes-excluir");
  }
});

// ---------- avaliações ----------

const INCLUDE_DETALHE = {
  area: { select: { id: true, nome: true, tipo: true, setorVinculadoId: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } },
  avaliador: { select: { id: true, nome: true } },
  respostas: { orderBy: [{ ordem: "asc" }, { id: "asc" }], include: { imagens: { select: { id: true, nomeArquivo: true }, orderBy: { id: "asc" } } } },
  sensos: { include: { imagens: { select: { id: true, nomeArquivo: true }, orderBy: { id: "asc" } } } },
  pai: { select: { id: true, titulo: true } },
  filhas: {
    orderBy: { id: "asc" },
    include: {
      area: { select: { nome: true, tipo: true } },
      avaliador: { select: { nome: true } },
      respostas: { select: { nota: true, naoSeAplica: true } },
    },
  },
} satisfies Prisma.Avaliacao5SInclude;

type AvaliacaoDetalhe = Prisma.Avaliacao5SGetPayload<{ include: typeof INCLUDE_DETALHE }>;

function percentuaisDe(a: {
  percGeral: Prisma.Decimal | null;
  percSeiri: Prisma.Decimal | null;
  percSeiton: Prisma.Decimal | null;
  percSeiso: Prisma.Decimal | null;
  percSeiketsu: Prisma.Decimal | null;
  percShitsuke: Prisma.Decimal | null;
}) {
  return {
    geral: dec(a.percGeral),
    porSenso: {
      seiri: dec(a.percSeiri),
      seiton: dec(a.percSeiton),
      seiso: dec(a.percSeiso),
      seiketsu: dec(a.percSeiketsu),
      shitsuke: dec(a.percShitsuke),
    },
  };
}

function donoOuCoordenador(acesso: Acesso5S, userId: number, avaliadorId: number | null): boolean {
  return podeAvaliar(acesso) && (acesso.papel === "coordenador" || avaliadorId === userId);
}

function permissoes(acesso: Acesso5S, userId: number, a: { status: string; avaliadorId: number | null; filhas?: { status: string }[] }) {
  const dono = donoOuCoordenador(acesso, userId, a.avaliadorId);
  const emAndamento = a.status === "em_andamento";
  // Avaliação-pai (invólucro da área agrupadora): sem respostas próprias, o status é derivado das
  // filhas. Só dá para excluí-la (e às filhas) enquanto todas estiverem em andamento.
  if ((a.filhas?.length ?? 0) > 0) {
    return { editar: false, finalizar: false, reabrir: false, excluir: dono && a.filhas!.every((f) => f.status === "em_andamento") };
  }
  return { editar: dono && emAndamento, finalizar: dono && emAndamento, reabrir: dono && !emAndamento, excluir: dono && emAndamento };
}

function serializarResumo(a: {
  id: number;
  titulo: string;
  areaId: number;
  data: Date;
  status: string;
  avaliadorId: number | null;
  finalizadaEm: Date | null;
  percGeral: Prisma.Decimal | null;
  percSeiri: Prisma.Decimal | null;
  percSeiton: Prisma.Decimal | null;
  percSeiso: Prisma.Decimal | null;
  percSeiketsu: Prisma.Decimal | null;
  percShitsuke: Prisma.Decimal | null;
  area: { nome: string; tipo: string };
  avaliador: { nome: string } | null;
  _count?: { filhas: number };
}) {
  return {
    quantidadeAmbientes: a._count?.filhas ?? 0,
    id: a.id,
    titulo: a.titulo,
    areaId: a.areaId,
    areaNome: a.area.nome,
    areaTipo: a.area.tipo,
    avaliadorId: a.avaliadorId,
    avaliadorNome: a.avaliador?.nome ?? null,
    data: isoDia(a.data),
    status: a.status,
    finalizadaEm: a.finalizadaEm,
    percentuais: percentuaisDe(a),
  };
}

function serializarDetalhe(a: AvaliacaoDetalhe, acesso: Acesso5S, userId: number) {
  const blocos = new Map(a.sensos.map((s) => [s.senso, s]));
  return {
    ...serializarResumo(a),
    quantidadeAmbientes: a.filhas.length,
    pai: a.pai,
    filhas: a.filhas.map((f) => ({
      ...serializarResumo(f),
      respondidas: f.respostas.filter((r) => r.nota != null || r.naoSeAplica).length,
      total: f.respostas.length,
    })),
    pode: permissoes(acesso, userId, a),
    respostas: a.respostas.map((r) => ({
      id: r.id,
      perguntaId: r.perguntaId,
      senso: r.senso,
      texto: r.perguntaTexto,
      nota: r.nota,
      naoSeAplica: r.naoSeAplica,
      inconsistencia: r.inconsistencia,
      complemento: r.complemento,
      imagens: r.imagens,
    })),
    sensos: SENSOS.map((s) => {
      const b = blocos.get(s.chave);
      return {
        senso: s.chave,
        observacoes: b?.observacoes ?? null,
        melhorias: b?.melhorias ?? null,
        pontosAtencao: b?.pontosAtencao ?? null,
        informacoes: b?.informacoes ?? null,
        imagens: b?.imagens ?? [],
      };
    }),
  };
}

// Abre a avaliação respeitando o recorte de visão; responde 404/403 e devolve null quando não pode.
async function abrirAvaliacao(req: Req5S, res: Response) {
  const acesso = exigirAcesso(req, res);
  if (!acesso) return null;
  const id = idDaRota(req);
  if (!id) {
    res.status(400).json({ error: "Id inválido" });
    return null;
  }
  const a = await prisma.avaliacao5S.findUnique({ where: { id }, include: INCLUDE_DETALHE });
  if (!a) {
    res.status(404).json({ error: "Avaliação não encontrada" });
    return null;
  }
  if (!podeVerArea(acesso, a.area) || (acesso.papel === "lider" && a.status !== "finalizada")) {
    res.status(403).json({ error: "Sem permissão para ver esta avaliação" });
    return null;
  }
  return { a, acesso, userId: req.user!.userId };
}

async function recalcular(tx: Prisma.TransactionClient, avaliacaoId: number) {
  const respostas = await tx.avaliacao5SResposta.findMany({ where: { avaliacaoId }, select: { senso: true, nota: true, naoSeAplica: true } });
  const p = calcularPercentuais(respostas);
  const atual = await tx.avaliacao5S.update({
    where: { id: avaliacaoId },
    data: {
      percGeral: p.geral,
      percSeiri: p.porSenso.seiri,
      percSeiton: p.porSenso.seiton,
      percSeiso: p.porSenso.seiso,
      percSeiketsu: p.porSenso.seiketsu,
      percShitsuke: p.porSenso.shitsuke,
    },
  });
  if (atual.avaliacaoPaiId) await sincronizarPai(tx, atual.avaliacaoPaiId);
  return p;
}

// Mantém a avaliação-pai coerente com as filhas: percentuais = pool das respostas de todas elas (soma
// das notas / (5 × aplicáveis), como a aba "Comum" da planilha), status derivado (finalizada só
// quando todas estão) e, sem filhas, o invólucro some.
async function sincronizarPai(tx: Prisma.TransactionClient, paiId: number) {
  const filhas = await tx.avaliacao5S.findMany({
    where: { avaliacaoPaiId: paiId },
    select: { status: true, respostas: { select: { senso: true, nota: true, naoSeAplica: true } } },
  });
  if (filhas.length === 0) {
    await tx.avaliacao5S.delete({ where: { id: paiId } });
    return;
  }
  const p = calcularPercentuais(filhas.flatMap((f) => f.respostas));
  const finalizada = filhas.every((f) => f.status === "finalizada");
  const pai = await tx.avaliacao5S.findUnique({ where: { id: paiId }, select: { status: true, finalizadaEm: true } });
  await tx.avaliacao5S.update({
    where: { id: paiId },
    data: {
      percGeral: p.geral,
      percSeiri: p.porSenso.seiri,
      percSeiton: p.porSenso.seiton,
      percSeiso: p.porSenso.seiso,
      percSeiketsu: p.porSenso.seiketsu,
      percShitsuke: p.porSenso.shitsuke,
      status: finalizada ? "finalizada" : "em_andamento",
      finalizadaEm: finalizada ? (pai?.finalizadaEm ?? new Date()) : null,
    },
  });
}

// Perguntas ativas que valem para a área (gerais do tipo + as restritas a ela), na ordem dos sensos.
async function perguntasAtivasDaArea(area: { id: number; tipo: string }) {
  const perguntas = await prisma.pergunta5S.findMany({
    where: { ativo: true, tipoArea: area.tipo, OR: [{ areaId: null }, { areaId: area.id }] },
    orderBy: [{ ordem: "asc" }, { id: "asc" }],
  });
  const ordemSenso = new Map(CHAVES_SENSO.map((s, i) => [s as string, i]));
  perguntas.sort((x, y) => (ordemSenso.get(x.senso) ?? 9) - (ordemSenso.get(y.senso) ?? 9) || x.ordem - y.ordem || x.id - y.id);
  return perguntas;
}

gestao5sRouter.get("/avaliacoes", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    const filtros: Prisma.Avaliacao5SWhereInput[] = [filtroAvaliacoesVisiveis(acesso)];
    const areaId = num(req.query.areaId);
    if (areaId) filtros.push({ areaId });
    else filtros.push({ avaliacaoPaiId: null });
    const avaliadorId = num(req.query.avaliadorId);
    if (avaliadorId) filtros.push({ avaliadorId });
    const tipo = TIPOS_AREA.find((t) => t === req.query.tipo);
    if (tipo) filtros.push({ area: { tipo } });
    if (req.query.status === "em_andamento" || req.query.status === "finalizada") filtros.push({ status: req.query.status });
    if (ehDataIso(req.query.de)) filtros.push({ data: { gte: paraData(req.query.de) } });
    if (ehDataIso(req.query.ate)) filtros.push({ data: { lte: paraData(req.query.ate) } });
    const where: Prisma.Avaliacao5SWhereInput = { AND: filtros };
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [total, itens] = await Promise.all([
      prisma.avaliacao5S.count({ where }),
      prisma.avaliacao5S.findMany({
        where,
        include: { area: { select: { nome: true, tipo: true } }, avaliador: { select: { nome: true } }, _count: { select: { filhas: true } } },
        orderBy: [{ data: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ total, page, pageSize, itens: itens.map(serializarResumo) });
  } catch (error) {
    handleError(res, error, "avaliacoes-listar");
  }
});

gestao5sRouter.post("/avaliacoes", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    if (!podeAvaliar(acesso)) return void res.status(403).json({ error: "Apenas avaliadores podem iniciar uma avaliação" });
    const areaId = num(req.body?.areaId);
    if (!areaId) return void res.status(400).json({ error: "Escolha a área a ser avaliada" });
    const area = await prisma.area5S.findUnique({ where: { id: areaId } });
    if (!area || !area.ativo) return void res.status(400).json({ error: "Área não encontrada ou inativa" });
    const data = hojeComoData();

    // Área agrupadora (setor com ambientes comuns vinculados): sem perguntas próprias. Abre uma
    // avaliação por ambiente, todas ligadas a uma avaliação-pai que acumula o resultado.
    const ambientes = area.tipo === "setor" ? await prisma.area5S.findMany({ where: { setorVinculadoId: area.id, ativo: true, tipo: "comum" }, orderBy: [{ ordem: "asc" }, { nome: "asc" }] }) : [];
    if (ambientes.length > 0) {
      const conjuntos: { amb: (typeof ambientes)[number]; ps: Awaited<ReturnType<typeof perguntasAtivasDaArea>> }[] = [];
      for (const amb of ambientes) {
        const ps = await perguntasAtivasDaArea(amb);
        if (ps.length > 0) conjuntos.push({ amb, ps });
      }
      if (conjuntos.length === 0) return void res.status(400).json({ error: "Nenhum ambiente vinculado tem perguntas ativas. Cadastre o formulário antes." });
      const pai = await prisma.$transaction(async (tx) => {
        const casca = await tx.avaliacao5S.create({ data: { titulo: montarTitulo(data, area.nome), areaId: area.id, avaliadorId: req.user!.userId, data } });
        await auditar(tx, req, casca, EVENTOS_AUDITORIA.AVALIACAO_5S_CRIADA, { metadata: { areaId: area.id, area: area.nome, ambientes: conjuntos.length } });
        for (const { amb, ps } of conjuntos) {
          const filha = await tx.avaliacao5S.create({
            data: {
              titulo: montarTitulo(data, amb.nome),
              areaId: amb.id,
              avaliadorId: req.user!.userId,
              data,
              avaliacaoPaiId: casca.id,
              respostas: { create: ps.map((p, i) => ({ perguntaId: p.id, senso: p.senso, perguntaTexto: p.texto, ordem: i })) },
            },
          });
          await auditar(tx, req, filha, EVENTOS_AUDITORIA.AVALIACAO_5S_CRIADA, { metadata: { areaId: amb.id, area: amb.nome, perguntas: ps.length, avaliacaoPaiId: casca.id } });
        }
        return casca;
      });
      return void res.status(201).json({ id: pai.id, ambientes: conjuntos.length });
    }

    const perguntas = await perguntasAtivasDaArea(area);
    if (perguntas.length === 0) return void res.status(400).json({ error: "Não há perguntas ativas para este tipo de área. Cadastre o formulário antes." });
    const criada = await prisma.$transaction(async (tx) => {
      const nova = await tx.avaliacao5S.create({
        data: {
          titulo: montarTitulo(data, area.nome),
          areaId: area.id,
          avaliadorId: req.user!.userId,
          data,
          respostas: { create: perguntas.map((p, i) => ({ perguntaId: p.id, senso: p.senso, perguntaTexto: p.texto, ordem: i })) },
        },
      });
      await auditar(tx, req, nova, EVENTOS_AUDITORIA.AVALIACAO_5S_CRIADA, { metadata: { areaId: area.id, area: area.nome, perguntas: perguntas.length } });
      return nova;
    });
    res.status(201).json({ id: criada.id });
  } catch (error) {
    handleError(res, error, "avaliacoes-criar");
  }
});

gestao5sRouter.get("/avaliacoes/:id", async (req: Req5S, res) => {
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return;
    const { a, acesso, userId } = r;
    // Observações da equipe da área no mês da avaliação (contexto para o leitor).
    const ini = new Date(Date.UTC(a.data.getUTCFullYear(), a.data.getUTCMonth(), 1));
    const fim = new Date(Date.UTC(a.data.getUTCFullYear(), a.data.getUTCMonth() + 1, 0));
    const obs = await prisma.observacao5S.findMany({
      where: { areaId: { in: [a.areaId, ...a.filhas.map((f) => f.areaId)] }, dataOcorrido: { gte: ini, lte: fim } },
      include: { area: { select: { nome: true } }, autor: { select: { nome: true } }, imagens: { select: { id: true, nomeArquivo: true } } },
      orderBy: { dataOcorrido: "asc" },
    });
    res.json({
      ...serializarDetalhe(a, acesso, userId),
      observacoesEquipe: obs.map((o) => ({ id: o.id, areaNome: o.area.nome, dataOcorrido: isoDia(o.dataOcorrido), texto: o.texto, autorNome: o.autor?.nome ?? null, imagens: o.imagens })),
    });
  } catch (error) {
    handleError(res, error, "avaliacoes-detalhe");
  }
});

gestao5sRouter.put("/avaliacoes/:id/respostas/:respostaId", async (req: Req5S, res) => {
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return;
    const { a, acesso, userId } = r;
    if (!permissoes(acesso, userId, a).editar) return void res.status(403).json({ error: "Esta avaliação não pode ser editada" });
    const resposta = a.respostas.find((x) => x.id === idDaRota(req, "respostaId"));
    if (!resposta) return void res.status(404).json({ error: "Pergunta não encontrada nesta avaliação" });
    const body = req.body ?? {};
    const data: Prisma.Avaliacao5SRespostaUpdateInput = {};
    if ("naoSeAplica" in body && body.naoSeAplica === true) {
      data.naoSeAplica = true;
      data.nota = null;
    } else if ("nota" in body) {
      if (body.nota === null) {
        data.nota = null;
        data.naoSeAplica = false;
      } else {
        const nota = Number(body.nota);
        if (!Number.isInteger(nota) || nota < NOTA_MIN || nota > NOTA_MAX) {
          return void res.status(400).json({ error: `A nota deve ser de ${NOTA_MIN} a ${NOTA_MAX}` });
        }
        data.nota = nota;
        data.naoSeAplica = false;
      }
    } else if ("naoSeAplica" in body && body.naoSeAplica === false) {
      data.naoSeAplica = false;
    }
    if ("inconsistencia" in body) data.inconsistencia = txt(body.inconsistencia, 5000);
    if ("complemento" in body) data.complemento = txt(body.complemento, 5000);
    if (Object.keys(data).length === 0) return void res.status(400).json({ error: "Nada para atualizar" });

    const percentuais = await prisma.$transaction(async (tx) => {
      const atualizada = await tx.avaliacao5SResposta.update({ where: { id: resposta.id }, data });
      const diff = diffCampos(
        { nota: "Nota", naoSeAplica: "Não se aplica", inconsistencia: "Inconsistência" },
        { nota: resposta.nota, naoSeAplica: resposta.naoSeAplica, inconsistencia: resposta.inconsistencia },
        { nota: atualizada.nota, naoSeAplica: atualizada.naoSeAplica, inconsistencia: atualizada.inconsistencia }
      );
      if (diff.algumaMudanca) {
        await auditar(tx, req, a, EVENTOS_AUDITORIA.AVALIACAO_5S_NOTA_ALTERADA, {
          alteracoes: diff.alteracoes,
          metadata: { respostaId: resposta.id, senso: resposta.senso, pergunta: resposta.perguntaTexto },
        });
      }
      return recalcular(tx, a.id);
    });
    res.json({ percentuais });
  } catch (error) {
    handleError(res, error, "resposta-salvar");
  }
});

gestao5sRouter.put("/avaliacoes/:id/sensos/:senso", async (req: Req5S, res) => {
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return;
    const { a, acesso, userId } = r;
    if (!permissoes(acesso, userId, a).editar) return void res.status(403).json({ error: "Esta avaliação não pode ser editada" });
    const senso = req.params.senso;
    if (!ehSenso(senso)) return void res.status(400).json({ error: "Senso inválido" });
    const body = req.body ?? {};
    const campos: Record<string, string | null> = {};
    for (const c of ["observacoes", "melhorias", "pontosAtencao", "informacoes"]) {
      if (c in body) campos[c] = txt(body[c], 5000);
    }
    await prisma.avaliacao5SSenso.upsert({
      where: { avaliacaoId_senso: { avaliacaoId: a.id, senso } },
      create: { avaliacaoId: a.id, senso, ...campos },
      update: campos,
    });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "senso-salvar");
  }
});

gestao5sRouter.post("/avaliacoes/:id/finalizar", async (req: Req5S, res) => {
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return;
    const { a, acesso, userId } = r;
    if (!permissoes(acesso, userId, a).finalizar) return void res.status(403).json({ error: "Esta avaliação não pode ser finalizada" });
    const pendentes = a.respostas.filter((x) => x.nota == null && !x.naoSeAplica).length;
    if (pendentes > 0) return void res.status(400).json({ error: `Faltam ${pendentes} pergunta(s) sem resposta (use NA quando não se aplicar)` });
    await prisma.$transaction(async (tx) => {
      await recalcular(tx, a.id);
      await tx.avaliacao5S.update({ where: { id: a.id }, data: { status: "finalizada", finalizadaEm: new Date() } });
      await auditar(tx, req, a, EVENTOS_AUDITORIA.AVALIACAO_5S_FINALIZADA);
      if (a.avaliacaoPaiId) await sincronizarPai(tx, a.avaliacaoPaiId);
    });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "avaliacoes-finalizar");
  }
});

gestao5sRouter.post("/avaliacoes/:id/reabrir", async (req: Req5S, res) => {
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return;
    const { a, acesso, userId } = r;
    if (!permissoes(acesso, userId, a).reabrir) return void res.status(403).json({ error: "Esta avaliação não pode ser reaberta" });
    await prisma.$transaction(async (tx) => {
      await tx.avaliacao5S.update({ where: { id: a.id }, data: { status: "em_andamento", finalizadaEm: null } });
      await auditar(tx, req, a, EVENTOS_AUDITORIA.AVALIACAO_5S_REABERTA);
      if (a.avaliacaoPaiId) await sincronizarPai(tx, a.avaliacaoPaiId);
    });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "avaliacoes-reabrir");
  }
});

gestao5sRouter.delete("/avaliacoes/:id", async (req: Req5S, res) => {
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return;
    const { a, acesso, userId } = r;
    if (!permissoes(acesso, userId, a).excluir) return void res.status(403).json({ error: "Só é possível excluir avaliações em andamento" });
    const donas = { OR: [{ id: a.id }, { avaliacaoPaiId: a.id }] };
    const caminhos = (
      await prisma.imagem5S.findMany({
        where: { OR: [{ resposta: { avaliacao: donas } }, { avaliacaoSenso: { avaliacao: donas } }] },
        select: { caminhoArquivo: true },
      })
    ).map((i) => i.caminhoArquivo);
    await prisma.$transaction(async (tx) => {
      await auditar(tx, req, a, EVENTOS_AUDITORIA.AVALIACAO_5S_EXCLUIDA, { metadata: { area: a.area.nome, data: isoDia(a.data), ambientes: a.filhas.length } });
      await tx.avaliacao5S.delete({ where: { id: a.id } });
      if (a.avaliacaoPaiId) await sincronizarPai(tx, a.avaliacaoPaiId);
    });
    for (const c of caminhos) fs.unlink(path.join(CINCO_S_DIR, c), () => {});
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "avaliacoes-excluir");
  }
});

// ---------- imagens ----------

gestao5sRouter.post("/avaliacoes/:id/imagens", uploadUmaImagem, async (req: Req5S, res) => {
  const descartar = () => req.file && fs.unlink(req.file.path, () => {});
  try {
    const r = await abrirAvaliacao(req, res);
    if (!r) return void descartar();
    const { a, acesso, userId } = r;
    if (!req.file) return void res.status(400).json({ error: "Imagem é obrigatória" });
    if (!permissoes(acesso, userId, a).editar) {
      descartar();
      return void res.status(403).json({ error: "Esta avaliação não pode ser editada" });
    }
    const respostaId = num(req.body?.respostaId);
    const senso = req.body?.senso;
    if (respostaId) {
      if (!a.respostas.some((x) => x.id === respostaId)) {
        descartar();
        return void res.status(400).json({ error: "Pergunta inválida" });
      }
    } else if (!ehSenso(senso)) {
      descartar();
      return void res.status(400).json({ error: "Informe a pergunta (respostaId) ou o senso" });
    }
    const imagem = await prisma.$transaction(async (tx) => {
      let avaliacaoSensoId: number | null = null;
      if (!respostaId) {
        const bloco = await tx.avaliacao5SSenso.upsert({
          where: { avaliacaoId_senso: { avaliacaoId: a.id, senso: senso as Senso } },
          create: { avaliacaoId: a.id, senso: senso as Senso },
          update: {},
        });
        avaliacaoSensoId = bloco.id;
      }
      const img = await tx.imagem5S.create({
        data: {
          respostaId: respostaId ?? null,
          avaliacaoSensoId,
          userId,
          nomeArquivo: req.file!.originalname.slice(0, 255),
          caminhoArquivo: req.file!.filename,
          tamanhoBytes: req.file!.size,
          mimeType: req.file!.mimetype,
        },
      });
      await auditar(tx, req, a, EVENTOS_AUDITORIA.AVALIACAO_5S_IMAGEM_ADICIONADA, { metadata: { imagemId: img.id, respostaId, senso: respostaId ? null : senso } });
      return img;
    });
    res.status(201).json({ id: imagem.id, nomeArquivo: imagem.nomeArquivo });
  } catch (error) {
    descartar();
    handleError(res, error, "imagem-avaliacao");
  }
});

// Resolve a imagem e a área dela (para checar visão) — a imagem pertence a resposta, bloco de senso
// ou observação da equipe.
async function abrirImagem(req: Req5S, res: Response) {
  const acesso = exigirAcesso(req, res);
  if (!acesso) return null;
  const id = idDaRota(req, "imagemId");
  if (!id) {
    res.status(400).json({ error: "Id inválido" });
    return null;
  }
  const img = await prisma.imagem5S.findUnique({
    where: { id },
    include: {
      resposta: { select: { avaliacao: { select: { id: true, titulo: true, status: true, avaliadorId: true, area: { select: { id: true, tipo: true, setorVinculadoId: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } } } } } },
      avaliacaoSenso: { select: { avaliacao: { select: { id: true, titulo: true, status: true, avaliadorId: true, area: { select: { id: true, tipo: true, setorVinculadoId: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } } } } } },
      observacao: { select: { autorId: true, area: { select: { id: true, tipo: true, setorVinculadoId: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } } } },
    },
  });
  if (!img) {
    res.status(404).json({ error: "Imagem não encontrada" });
    return null;
  }
  const avaliacao = img.resposta?.avaliacao ?? img.avaliacaoSenso?.avaliacao ?? null;
  const area = avaliacao?.area ?? img.observacao?.area;
  if (!area || !podeVerArea(acesso, area) || (avaliacao && acesso.papel === "lider" && avaliacao.status !== "finalizada")) {
    res.status(403).json({ error: "Sem permissão para ver esta imagem" });
    return null;
  }
  return { img, avaliacao, observacao: img.observacao, acesso, userId: req.user!.userId };
}

gestao5sRouter.get("/imagens/:imagemId", async (req: Req5S, res) => {
  try {
    const r = await abrirImagem(req, res);
    if (!r) return;
    res.type(r.img.mimeType);
    res.sendFile(path.join(CINCO_S_DIR, r.img.caminhoArquivo), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "Arquivo não encontrado" });
    });
  } catch (error) {
    handleError(res, error, "imagem-baixar");
  }
});

gestao5sRouter.delete("/imagens/:imagemId", async (req: Req5S, res) => {
  try {
    const r = await abrirImagem(req, res);
    if (!r) return;
    const { img, avaliacao, observacao, acesso, userId } = r;
    if (avaliacao) {
      if (!permissoes(acesso, userId, avaliacao).editar) return void res.status(403).json({ error: "Esta avaliação não pode ser editada" });
    } else if (!(acesso.papel === "coordenador" || observacao?.autorId === userId)) {
      return void res.status(403).json({ error: "Sem permissão para excluir esta imagem" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.imagem5S.delete({ where: { id: img.id } });
      if (avaliacao) await auditar(tx, req, avaliacao, EVENTOS_AUDITORIA.AVALIACAO_5S_IMAGEM_REMOVIDA, { metadata: { imagemId: img.id, nomeArquivo: img.nomeArquivo } });
    });
    fs.unlink(path.join(CINCO_S_DIR, img.caminhoArquivo), () => {});
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "imagem-excluir");
  }
});

// ---------- observações da equipe ----------

const INCLUDE_OBS = {
  area: { select: { id: true, nome: true, tipo: true, setorVinculadoId: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } },
  autor: { select: { nome: true } },
  imagens: { select: { id: true, nomeArquivo: true }, orderBy: { id: "asc" } },
} satisfies Prisma.Observacao5SInclude;

type ObsLinha = Prisma.Observacao5SGetPayload<{ include: typeof INCLUDE_OBS }>;

function serializarObs(o: ObsLinha, acesso: Acesso5S, userId: number) {
  return {
    id: o.id,
    areaId: o.areaId,
    areaNome: o.area.nome,
    dataOcorrido: isoDia(o.dataOcorrido),
    texto: o.texto,
    autorId: o.autorId,
    autorNome: o.autor?.nome ?? null,
    criadoEm: o.criadoEm,
    imagens: o.imagens,
    pode: { editar: acesso.papel === "coordenador" || o.autorId === userId },
  };
}

gestao5sRouter.get("/observacoes", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    const filtros: Prisma.Observacao5SWhereInput[] = [{ area: filtroAreasVisiveis(acesso) }];
    const areaId = num(req.query.areaId);
    if (areaId) filtros.push({ areaId });
    if (ehDataIso(req.query.de)) filtros.push({ dataOcorrido: { gte: paraData(req.query.de) } });
    if (ehDataIso(req.query.ate)) filtros.push({ dataOcorrido: { lte: paraData(req.query.ate) } });
    const where: Prisma.Observacao5SWhereInput = { AND: filtros };
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [total, itens] = await Promise.all([
      prisma.observacao5S.count({ where }),
      prisma.observacao5S.findMany({ where, include: INCLUDE_OBS, orderBy: [{ dataOcorrido: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ total, page, pageSize, itens: itens.map((o) => serializarObs(o, acesso, req.user!.userId)) });
  } catch (error) {
    handleError(res, error, "observacoes-listar");
  }
});

async function validarObs(req: Req5S, acesso: Acesso5S) {
  const body = req.body ?? {};
  const texto = txt(body.texto, 5000);
  if (!texto) return { erro: "Descreva a observação" };
  if (!ehDataIso(body.dataOcorrido)) return { erro: "Informe a data do ocorrido" };
  const areaId = num(body.areaId);
  if (!areaId) return { erro: "Escolha a área" };
  const area = await prisma.area5S.findUnique({ where: { id: areaId }, select: { id: true, tipo: true, setorVinculadoId: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } });
  if (!area) return { erro: "Área não encontrada" };
  if (!podeObservarArea(acesso, area)) return { erro: "Você não pode registrar observações nesta área", status: 403 };
  return { dados: { texto, areaId, dataOcorrido: paraData(body.dataOcorrido) } };
}

gestao5sRouter.post("/observacoes", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    const v = await validarObs(req, acesso);
    if (v.erro) return void res.status(v.status ?? 400).json({ error: v.erro });
    const o = await prisma.observacao5S.create({ data: { ...v.dados!, autorId: req.user!.userId }, include: INCLUDE_OBS });
    res.status(201).json(serializarObs(o, acesso, req.user!.userId));
  } catch (error) {
    handleError(res, error, "observacoes-criar");
  }
});

async function abrirObs(req: Req5S, res: Response) {
  const acesso = exigirAcesso(req, res);
  if (!acesso) return null;
  const id = idDaRota(req);
  if (!id) {
    res.status(400).json({ error: "Id inválido" });
    return null;
  }
  const o = await prisma.observacao5S.findUnique({ where: { id }, include: INCLUDE_OBS });
  if (!o) {
    res.status(404).json({ error: "Observação não encontrada" });
    return null;
  }
  if (!podeVerArea(acesso, o.area)) {
    res.status(403).json({ error: "Sem permissão para ver esta observação" });
    return null;
  }
  const userId = req.user!.userId;
  if (!(acesso.papel === "coordenador" || o.autorId === userId)) {
    res.status(403).json({ error: "Só o autor ou o coordenador podem alterar esta observação" });
    return null;
  }
  return { o, acesso, userId };
}

gestao5sRouter.put("/observacoes/:id", async (req: Req5S, res) => {
  try {
    const r = await abrirObs(req, res);
    if (!r) return;
    const v = await validarObs(req, r.acesso);
    if (v.erro) return void res.status(v.status ?? 400).json({ error: v.erro });
    const o = await prisma.observacao5S.update({ where: { id: r.o.id }, data: v.dados!, include: INCLUDE_OBS });
    res.json(serializarObs(o, r.acesso, r.userId));
  } catch (error) {
    handleError(res, error, "observacoes-editar");
  }
});

gestao5sRouter.delete("/observacoes/:id", async (req: Req5S, res) => {
  try {
    const r = await abrirObs(req, res);
    if (!r) return;
    const caminhos = (await prisma.imagem5S.findMany({ where: { observacaoId: r.o.id }, select: { caminhoArquivo: true } })).map((i) => i.caminhoArquivo);
    await prisma.observacao5S.delete({ where: { id: r.o.id } });
    for (const c of caminhos) fs.unlink(path.join(CINCO_S_DIR, c), () => {});
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "observacoes-excluir");
  }
});

gestao5sRouter.post("/observacoes/:id/imagens", uploadUmaImagem, async (req: Req5S, res) => {
  const descartar = () => req.file && fs.unlink(req.file.path, () => {});
  try {
    const r = await abrirObs(req, res);
    if (!r) return void descartar();
    if (!req.file) return void res.status(400).json({ error: "Imagem é obrigatória" });
    const img = await prisma.imagem5S.create({
      data: { observacaoId: r.o.id, userId: r.userId, nomeArquivo: req.file.originalname.slice(0, 255), caminhoArquivo: req.file.filename, tamanhoBytes: req.file.size, mimeType: req.file.mimetype },
    });
    res.status(201).json({ id: img.id, nomeArquivo: img.nomeArquivo });
  } catch (error) {
    descartar();
    handleError(res, error, "imagem-observacao");
  }
});

// ---------- dashboard e comparativo ----------

interface AvaliacaoAgregavel {
  areaId: number;
  data: Date;
  percGeral: Prisma.Decimal | null;
  percSeiri: Prisma.Decimal | null;
  percSeiton: Prisma.Decimal | null;
  percSeiso: Prisma.Decimal | null;
  percSeiketsu: Prisma.Decimal | null;
  percShitsuke: Prisma.Decimal | null;
}

type Bloco = { geral: number | null; porSenso: Record<Senso, number | null> };

// Média de um conjunto de avaliações (geral e por senso), ignorando o que não tem resposta.
function mediaBloco(avaliacoes: AvaliacaoAgregavel[]): Bloco {
  const perc = avaliacoes.map(percentuaisDe);
  return {
    geral: media(perc.map((p) => p.geral)),
    porSenso: Object.fromEntries(CHAVES_SENSO.map((s) => [s, media(perc.map((p) => p.porSenso[s]))])) as Record<Senso, number | null>,
  };
}

// Média de blocos já agregados (mês a mês ou área a área), com peso igual para cada um.
function mediaDeBlocos(blocos: Bloco[]): Bloco {
  return {
    geral: media(blocos.map((b) => b.geral)),
    porSenso: Object.fromEntries(CHAVES_SENSO.map((s) => [s, media(blocos.map((b) => b.porSenso[s]))])) as Record<Senso, number | null>,
  };
}

function listarMeses(de: string, ate: string): string[] {
  const meses: string[] = [];
  let [ano, mes] = de.split("-").map(Number);
  const [anoFim, mesFim] = ate.split("-").map(Number);
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    meses.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return meses;
}

function intervaloDeMeses(de: string, ate: string) {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return { ini: new Date(Date.UTC(a1, m1 - 1, 1)), fim: new Date(Date.UTC(a2, m2, 0)) };
}

function mesAtual(): string {
  return chaveMes(hojeComoData());
}

function tendenciaDaSerie(serie: Array<number | null>): ReturnType<typeof tendencia> {
  const comDado = serie.filter((v): v is number => v != null);
  if (comDado.length < 2) return null;
  return tendencia(comDado[comDado.length - 1], comDado[comDado.length - 2]);
}

type MesBloco = Bloco & { mes: string; quantidade: number };

interface ResultadoArea {
  areaId: number;
  nome: string;
  // Área agrupadora: resultado acumulado das respostas dos ambientes vinculados.
  acumulado: boolean;
  avaliacoes: number;
  meses: MesBloco[];
}

// Resultado mensal por área.
// - Setor sem ambientes e ambiente comum: média das avaliações finalizadas do mês.
// - Área agrupadora (setor com ambientes vinculados): pool das RESPOSTAS de todas as avaliações dos
//   ambientes no mês — soma das notas / (5 × aplicáveis), a mesma conta da aba "Comum" da planilha
//   (ambiente com mais perguntas pesa mais).
async function resultadosPorArea(acesso: Acesso5S, tipo: TipoArea, meses: string[], areaId?: number): Promise<ResultadoArea[]> {
  const { ini, fim } = intervaloDeMeses(meses[0], meses[meses.length - 1]);
  const janela = { gte: ini, lte: fim };
  const avaliacoes = await prisma.avaliacao5S.findMany({
    where: { AND: [filtroAvaliacoesVisiveis(acesso), { status: "finalizada", filhas: { none: {} }, area: { tipo }, data: janela, ...(areaId ? { areaId } : {}) }] },
    select: {
      areaId: true, data: true, percGeral: true, percSeiri: true, percSeiton: true, percSeiso: true, percSeiketsu: true, percShitsuke: true,
      area: { select: { nome: true, ambientes: { where: { ativo: true }, select: { id: true }, take: 1 } } },
    },
  });

  const porArea = new Map<number, { nome: string; itens: typeof avaliacoes }>();
  for (const a of avaliacoes) {
    // Agrupadora não usa a média das próprias avaliações: o resultado dela vem do pool abaixo.
    if (ehAgrupadora({ id: a.areaId, tipo, setorVinculadoId: null, ambientes: a.area.ambientes })) continue;
    const e = porArea.get(a.areaId) ?? { nome: a.area.nome, itens: [] };
    e.itens.push(a);
    porArea.set(a.areaId, e);
  }
  const resultado: ResultadoArea[] = [...porArea.entries()].map(([id, { nome, itens }]) => ({
    areaId: id,
    nome,
    acumulado: false,
    avaliacoes: itens.length,
    meses: meses.map((mes) => {
      const doMes = itens.filter((i) => chaveMes(i.data) === mes);
      return { mes, quantidade: doMes.length, ...mediaBloco(doMes) };
    }),
  }));

  if (tipo === "setor") {
    const dosAmbientes = await prisma.avaliacao5S.findMany({
      where: {
        AND: [
          filtroAvaliacoesVisiveis(acesso),
          { status: "finalizada", data: janela, area: { tipo: "comum", setorVinculado: { is: { ativo: true } }, ...(areaId ? { setorVinculadoId: areaId } : {}) } },
        ],
      },
      select: {
        data: true,
        area: { select: { setorVinculadoId: true, setorVinculado: { select: { nome: true } } } },
        respostas: { select: { senso: true, nota: true, naoSeAplica: true } },
      },
    });
    const porMae = new Map<number, { nome: string; itens: typeof dosAmbientes }>();
    for (const a of dosAmbientes) {
      const mae = a.area.setorVinculadoId!;
      const e = porMae.get(mae) ?? { nome: a.area.setorVinculado!.nome, itens: [] };
      e.itens.push(a);
      porMae.set(mae, e);
    }
    for (const [id, { nome, itens }] of porMae) {
      resultado.push({
        areaId: id,
        nome,
        acumulado: true,
        avaliacoes: itens.length,
        meses: meses.map((mes) => {
          const doMes = itens.filter((i) => chaveMes(i.data) === mes);
          const p = calcularPercentuais(doMes.flatMap((i) => i.respostas));
          return { mes, quantidade: doMes.length, geral: p.geral, porSenso: p.porSenso };
        }),
      });
    }
  }
  return resultado;
}

gestao5sRouter.get("/dashboard", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    const tipo = TIPOS_AREA.find((t) => t === req.query.tipo) ?? "setor";
    const fim = ehMes(req.query.ate) ? req.query.ate : mesAtual();
    const inicioPadrao = listarMeses("2000-01", fim).slice(-6)[0];
    const inicio = ehMes(req.query.de) ? req.query.de : inicioPadrao;
    const meses = listarMeses(inicio, fim);
    if (meses.length === 0 || meses.length > 36) return void res.status(400).json({ error: "O período deve ter de 1 a 36 meses" });

    const areas = (await resultadosPorArea(acesso, tipo, meses)).map((r) => ({
      areaId: r.areaId,
      nome: r.nome,
      acumulado: r.acumulado,
      avaliacoes: r.avaliacoes,
      ...mediaDeBlocos(r.meses.filter((m) => m.geral != null)),
      meses: r.meses,
      tendencia: tendenciaDaSerie(r.meses.map((m) => m.geral)),
    }));
    areas.sort((x, y) => (y.geral ?? -1) - (x.geral ?? -1) || x.nome.localeCompare(y.nome));
    const ranking = areas.map((a, i) => ({ posicao: i + 1, areaId: a.areaId, nome: a.nome, acumulado: a.acumulado, geral: a.geral, tendencia: a.tendencia }));

    const empresaMeses = meses.map((mes) => {
      const doMes = areas.map((a) => a.meses.find((m) => m.mes === mes)!).filter((m) => m.geral != null);
      return { mes, ...mediaDeBlocos(doMes) };
    });
    const empresa = { ...mediaDeBlocos(areas.filter((a) => a.geral != null)), meses: empresaMeses, tendencia: tendenciaDaSerie(empresaMeses.map((m) => m.geral)) };

    res.json({ tipo, de: inicio, ate: fim, meses, ranking, areas, empresa });
  } catch (error) {
    handleError(res, error, "dashboard");
  }
});

// Comparativo mensal: por senso (e geral), o resultado de cada mês pedido. Sem areaId, agrega todas as
// áreas visíveis do tipo escolhido (média dos resultados de cada área, peso igual). Com areaId de uma
// área agrupadora, o resultado é o acúmulo dos ambientes vinculados.
gestao5sRouter.get("/comparativo", async (req: Req5S, res) => {
  try {
    const acesso = exigirAcesso(req, res);
    if (!acesso) return;
    const meses = typeof req.query.meses === "string" ? [...new Set(req.query.meses.split(",").map((m) => m.trim()))] : [];
    if (meses.length < 2 || meses.length > 12 || !meses.every(ehMes)) {
      return void res.status(400).json({ error: "Informe de 2 a 12 meses no formato AAAA-MM (separados por vírgula)" });
    }
    meses.sort();
    const areaId = num(req.query.areaId);
    let tipo: TipoArea = TIPOS_AREA.find((t) => t === req.query.tipo) ?? "setor";
    if (areaId) {
      const area = await prisma.area5S.findUnique({ where: { id: areaId }, select: { tipo: true } });
      if (!area) return void res.status(404).json({ error: "Área não encontrada" });
      tipo = area.tipo as TipoArea;
    }
    const resultados = await resultadosPorArea(acesso, tipo, meses, areaId ?? undefined);
    const blocos = meses.map((mes) => mediaDeBlocos(resultados.map((r) => r.meses.find((m) => m.mes === mes)!).filter((m) => m.geral != null)));
    const linhas = [
      ...SENSOS.map((s) => ({ chave: s.chave, rotulo: s.rotulo, valores: blocos.map((b) => b.porSenso[s.chave]) })),
      { chave: "geral", rotulo: "Geral", valores: blocos.map((b) => b.geral) },
    ];
    res.json({ meses, areaId, tipo, linhas });
  } catch (error) {
    handleError(res, error, "comparativo");
  }
});
