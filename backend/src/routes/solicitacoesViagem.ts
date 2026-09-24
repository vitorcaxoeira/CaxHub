import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { VIAGEM_DIR } from "../config/uploads";
import { resolverContextoConsultor } from "../domain/contextoProjeto";
import { criarEventoAuditoria, diffCampos, paraDiff } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA, EventoAuditoriaTipo } from "../audit/taxonomia";
import { entidadeIdSolicitacaoViagem } from "../audit/identidadeEntidade";
import { criarNotificacao, notificarAprovadoresViagem, notificarAtendimentoViagem } from "../domain/notificacoes";
import {
  ContextoViagem,
  FINALIDADES,
  PAPEIS_MODULO_VIAGEM,
  Finalidade,
  ItemEntrada,
  STATUS_VIAGEM,
  ViajanteEntrada,
  ViagemPermissao,
  ehAtendimento,
  ehDataIso,
  ehSolicitante,
  ehTerminal,
  mascararCpf,
  podeAprovarViagem,
  podeAtenderViagem,
  podeTransicionar,
  podeVerCpfCompleto,
  podeVerViagem,
  resolverAprovador,
  resolverVinculo,
  soDigitos,
  validarCpf,
  validarItem,
} from "../domain/solicitacoesViagem";

// Módulo Gestão de Solicitações — Solicitações de Viagem (hospedagem, passagem aérea, carro).
// Dado 100% do CaxHub, sem integração com o Senior. Todos os papéis abrem pedido; atendimento
// (administrativo + admin) cota e reserva; o gestor do departamento do solicitante aprova
// (snapshot gravado na criação — ver resolverAprovador). Permissão decidida por handler, como
// nos demais routers de solicitação; o frontend só esconde o que o backend recusaria.
export const solicitacoesViagemRouter = Router();
// Módulo restrito ao admin por enquanto — ver PAPEIS_MODULO_VIAGEM.
solicitacoesViagemRouter.use(requireAuth, requireRole(...PAPEIS_MODULO_VIAGEM));

// ---------- infraestrutura ----------

const MIMES_PERMITIDOS = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "message/rfc822",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(VIAGEM_DIR, { recursive: true });
      cb(null, VIAGEM_DIR);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (MIMES_PERMITIDOS.has(file.mimetype)) cb(null, true);
    else cb(new Error("Tipo de arquivo não permitido (use PDF, imagem, Word, Excel, TXT ou e-mail)"));
  },
});

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[solicitacoes-viagem:${label}]`, message);
  res.status(500).json({ error: message });
}

interface Ctx extends ContextoViagem {
  nome: string;
}

async function contextoDoUsuario(req: AuthenticatedRequest): Promise<Ctx | null> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { userId: user.id, role: req.user!.role, contexto, nome: user.nome };
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const txt = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const dia = (v: string | null | undefined): Date | null => (v ? new Date(`${v}T00:00:00.000Z`) : null);
const dec = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const isoDia = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function idDaRota(req: AuthenticatedRequest, chave = "id"): number | null {
  const n = Number(req.params[chave]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const INCLUDE_DETALHE = {
  solicitante: { select: { id: true, nome: true } },
  atendimento: { select: { id: true, nome: true } },
  aprovador: { select: { id: true, nome: true } },
  cliente: { select: { codcli: true, nomcli: true, apecli: true } },
  viajantes: { orderBy: { id: "asc" as const } },
  itens: { orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }], include: { viajantes: true } },
  cotacoes: { orderBy: { id: "asc" as const }, include: { criadoPor: { select: { nome: true } } } },
  anexos: { orderBy: { id: "asc" as const }, include: { user: { select: { nome: true } } } },
} satisfies Prisma.SolicitacaoViagemInclude;

type ViagemDetalhe = Prisma.SolicitacaoViagemGetPayload<{ include: typeof INCLUDE_DETALHE }>;

async function carregar(id: number): Promise<ViagemDetalhe | null> {
  return prisma.solicitacaoViagem.findUnique({ where: { id }, include: INCLUDE_DETALHE });
}

function rotuloProposta(v: { codemp: number | null; codpro: number | null }): string | null {
  return v.codpro != null ? `Proposta ${v.codpro}` : null;
}

function somaSelecionadas(v: ViagemDetalhe): number {
  return v.cotacoes.filter((c) => c.selecionada).reduce((acc, c) => acc + Number(c.valor), 0);
}

function somaReservado(v: ViagemDetalhe): number {
  return v.itens.reduce((acc, i) => acc + (i.valorReservado ? Number(i.valorReservado) : 0), 0);
}

// Tudo que o detalhe precisa, já com as permissões calculadas pra este usuário — o frontend
// decide só o que MOSTRAR; quem recusa de verdade continua sendo cada handler.
function serializar(v: ViagemDetalhe, ctx: Ctx) {
  const perm: ViagemPermissao = v;
  const atende = podeAtenderViagem(ctx);
  const cpfCompleto = podeVerCpfCompleto(ctx, perm);
  const terminal = ehTerminal(v.status);
  const souSolicitante = ehSolicitante(ctx, perm);
  const editavel = !terminal && ((souSolicitante && v.status === "solicitada") || (atende && v.status !== "aguardando_aprovacao"));

  return {
    id: v.id,
    status: v.status,
    finalidade: v.finalidade,
    motivo: v.motivo,
    solicitante: v.solicitante,
    atendimento: v.atendimento,
    aprovador: v.aprovador,
    cliente: v.cliente,
    codcli: v.codcli,
    codemp: v.codemp,
    codpro: v.codpro,
    propostaRotulo: rotuloProposta(v),
    qtdPessoas: v.qtdPessoas,
    dataInicio: isoDia(v.dataInicio),
    dataFim: isoDia(v.dataFim),
    cidadesDestino: v.cidadesDestino,
    roteiroObservacao: v.roteiroObservacao,
    observacoes: v.observacoes,
    precisaHospedagem: v.precisaHospedagem,
    precisaAereo: v.precisaAereo,
    precisaCarro: v.precisaCarro,
    valorAprovado: dec(v.valorAprovado),
    valorProposto: somaSelecionadas(v),
    valorReservado: somaReservado(v),
    aprovadoEm: v.aprovadoEm,
    observacaoDecisao: v.observacaoDecisao,
    motivoCancelamento: v.motivoCancelamento,
    criadoEm: v.criadoEm,
    atualizadoEm: v.atualizadoEm,
    viajantes: v.viajantes.map((p) => ({
      id: p.id,
      userId: p.userId,
      nome: p.nome,
      cpf: cpfCompleto ? p.cpf : mascararCpf(p.cpf),
    })),
    itens: v.itens.map((i) => ({
      id: i.id,
      tipo: i.tipo,
      ordem: i.ordem,
      viajantes: i.viajantes.map((x) => x.viajanteId),
      cidade: i.cidade,
      origem: i.origem,
      destino: i.destino,
      dataInicio: isoDia(i.dataInicio),
      dataFim: isoDia(i.dataFim),
      horaInicio: i.horaInicio,
      horaFim: i.horaFim,
      tipoAcomodacao: i.tipoAcomodacao,
      hotelPreferencia: i.hotelPreferencia,
      necessidades: i.necessidades,
      flexibilidadeHorario: i.flexibilidadeHorario,
      bagagem: i.bagagem,
      companhiaPreferencia: i.companhiaPreferencia,
      localRetirada: i.localRetirada,
      localDevolucao: i.localDevolucao,
      categoriaVeiculo: i.categoriaVeiculo,
      observacoes: i.observacoes,
      fornecedor: i.fornecedor,
      localizador: i.localizador,
      valorReservado: dec(i.valorReservado),
      reservadoEm: i.reservadoEm,
    })),
    cotacoes: v.cotacoes.map((c) => ({
      id: c.id,
      itemId: c.itemId,
      fornecedor: c.fornecedor,
      descricao: c.descricao,
      valor: Number(c.valor),
      validadeAte: isoDia(c.validadeAte),
      selecionada: c.selecionada,
      autorNome: c.criadoPor?.nome ?? null,
      criadoEm: c.criadoEm,
    })),
    anexos: v.anexos.map((a) => ({
      id: a.id,
      itemId: a.itemId,
      cotacaoId: a.cotacaoId,
      categoria: a.categoria,
      nomeArquivo: a.nomeArquivo,
      tamanhoBytes: a.tamanhoBytes,
      autorNome: a.user?.nome ?? "Usuário removido",
      criadoEm: a.criadoEm,
    })),
    pode: {
      editar: editavel,
      assumir: atende && podeTransicionar("assumir", v.status),
      cotar: atende && v.status === "em_cotacao",
      enviarAprovacao: atende && podeTransicionar("enviar_aprovacao", v.status),
      decidir: podeTransicionar("decidir", v.status) && podeAprovarViagem(ctx, perm),
      reservar: atende && (v.status === "aprovada" || v.status === "reservada"),
      finalizar: atende && podeTransicionar("finalizar", v.status),
      cancelar: !terminal && (atende || (souSolicitante && ["solicitada", "em_cotacao", "aguardando_aprovacao"].includes(v.status))),
      anexar: !!(atende || souSolicitante),
    },
  };
}

// Uma linha por evento de auditoria, dentro da transação da escrita.
function auditar(
  tx: Prisma.TransactionClient,
  req: AuthenticatedRequest,
  v: { id: number; codemp: number | null; codpro: number | null },
  eventoTipo: EventoAuditoriaTipo,
  extra: { alteracoes?: ReturnType<typeof diffCampos>["alteracoes"]; metadata?: Record<string, unknown> } = {}
) {
  return criarEventoAuditoria(
    {
      origem: "tela",
      usuarioId: req.user!.userId,
      codemp: v.codemp,
      codpro: v.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.SOLICITACAO_VIAGEM,
      entidadeId: entidadeIdSolicitacaoViagem(v.id),
      entidadeRotulo: `Viagem #${v.id}`,
      eventoTipo,
      alteracoes: extra.alteracoes ?? null,
      metadata: extra.metadata ?? null,
      correlationId: req.correlationId!,
    },
    tx
  );
}

// Campos do cabeçalho auditados no PUT. CPF NUNCA entra aqui.
const CAMPOS_CABECALHO: Record<string, string> = {
  finalidade: "Finalidade",
  motivo: "Motivo",
  codcli: "Cliente",
  codpro: "Proposta",
  dataInicio: "Início",
  dataFim: "Término",
  cidadesDestino: "Destinos",
  observacoes: "Observações",
  roteiroObservacao: "Observação do roteiro",
};

// ---------- validação de entrada (criação/edição) ----------

interface EntradaViagem {
  finalidade: Finalidade;
  motivo: string;
  dataInicio: string;
  dataFim: string;
  cidadesDestino: string;
  observacoes: string | null;
  roteiroObservacao: string | null;
  viajantes: (ViajanteEntrada & { id?: number })[];
  itens: (ItemEntrada & { id?: number })[];
  vinculo: { codcli: number | null; codemp: number | null; codpro: number | null };
}

async function validarEntrada(body: Record<string, unknown>): Promise<{ erro: string } | { dados: EntradaViagem }> {
  const finalidade = body.finalidade as Finalidade;
  if (!(FINALIDADES as readonly string[]).includes(finalidade)) return { erro: "Finalidade inválida" };
  const motivo = txt(body.motivo, 1000);
  if (!motivo) return { erro: "Informe o motivo da viagem" };
  const cidadesDestino = txt(body.cidadesDestino, 500);
  if (!cidadesDestino) return { erro: "Informe a(s) cidade(s) de destino" };
  if (!ehDataIso(body.dataInicio) || !ehDataIso(body.dataFim)) return { erro: "Informe o período da viagem" };
  if (body.dataFim < body.dataInicio) return { erro: "O término da viagem é anterior ao início" };

  const brutosViajantes = Array.isArray(body.viajantes) ? (body.viajantes as Record<string, unknown>[]) : [];
  if (brutosViajantes.length === 0) return { erro: "Informe ao menos um viajante" };
  const viajantes: EntradaViagem["viajantes"] = [];
  for (const [i, b] of brutosViajantes.entries()) {
    const nome = txt(b.nome, 150);
    if (!nome) return { erro: `Viajante ${i + 1}: informe o nome completo` };
    // CPF é opcional (pode não estar à mão na hora do pedido); se veio preenchido, tem que ser válido.
    if (soDigitos(b.cpf) !== "" && !validarCpf(b.cpf)) return { erro: `Viajante ${i + 1}: CPF inválido` };
    const userId = num(b.userId);
    viajantes.push({ id: num(b.id) ?? undefined, userId, nome, cpf: soDigitos(b.cpf) });
  }

  const brutosItens = Array.isArray(body.itens) ? (body.itens as Record<string, unknown>[]) : [];
  if (brutosItens.length === 0) return { erro: "Informe ao menos um serviço (hospedagem, passagem ou carro)" };
  const itens: EntradaViagem["itens"] = [];
  for (const [i, b] of brutosItens.entries()) {
    const item: ItemEntrada & { id?: number } = {
      id: num(b.id) ?? undefined,
      tipo: b.tipo as ItemEntrada["tipo"],
      viajantes: Array.isArray(b.viajantes) ? (b.viajantes as unknown[]).map(Number) : [],
      cidade: txt(b.cidade, 150),
      origem: txt(b.origem, 150),
      destino: txt(b.destino, 150),
      dataInicio: typeof b.dataInicio === "string" && b.dataInicio ? b.dataInicio : null,
      dataFim: typeof b.dataFim === "string" && b.dataFim ? b.dataFim : null,
      horaInicio: txt(b.horaInicio, 5),
      horaFim: txt(b.horaFim, 5),
      tipoAcomodacao: txt(b.tipoAcomodacao, 15),
      hotelPreferencia: txt(b.hotelPreferencia, 200),
      necessidades: txt(b.necessidades, 500),
      flexibilidadeHorario: txt(b.flexibilidadeHorario, 200),
      bagagem: txt(b.bagagem, 200),
      companhiaPreferencia: txt(b.companhiaPreferencia, 100),
      localRetirada: txt(b.localRetirada, 200),
      localDevolucao: txt(b.localDevolucao, 200),
      categoriaVeiculo: txt(b.categoriaVeiculo, 100),
      observacoes: txt(b.observacoes, 1000),
    };
    const erroItem = validarItem(item, viajantes.length, i);
    if (erroItem) return { erro: erroItem };
    itens.push(item);
  }

  const vinculo = await resolverVinculo(finalidade, body);
  if (vinculo.erro) return { erro: vinculo.erro };

  return {
    dados: {
      finalidade,
      motivo,
      dataInicio: body.dataInicio,
      dataFim: body.dataFim,
      cidadesDestino,
      observacoes: txt(body.observacoes, 20000),
      roteiroObservacao: txt(body.roteiroObservacao, 20000),
      viajantes,
      itens,
      vinculo: { codcli: vinculo.codcli, codemp: vinculo.codemp, codpro: vinculo.codpro },
    },
  };
}

function dadosItem(i: ItemEntrada, ordem: number) {
  return {
    tipo: i.tipo,
    ordem,
    cidade: i.cidade ?? null,
    origem: i.origem ?? null,
    destino: i.destino ?? null,
    dataInicio: dia(i.dataInicio),
    dataFim: dia(i.dataFim),
    horaInicio: i.horaInicio ?? null,
    horaFim: i.horaFim ?? null,
    tipoAcomodacao: i.tipoAcomodacao ?? null,
    hotelPreferencia: i.hotelPreferencia ?? null,
    necessidades: i.necessidades ?? null,
    flexibilidadeHorario: i.flexibilidadeHorario ?? null,
    bagagem: i.bagagem ?? null,
    companhiaPreferencia: i.companhiaPreferencia ?? null,
    localRetirada: i.localRetirada ?? null,
    localDevolucao: i.localDevolucao ?? null,
    categoriaVeiculo: i.categoriaVeiculo ?? null,
    observacoes: i.observacoes ?? null,
  };
}

function flagsDosItens(itens: ItemEntrada[]) {
  return {
    precisaHospedagem: itens.some((i) => i.tipo === "hospedagem"),
    precisaAereo: itens.some((i) => i.tipo === "aereo"),
    precisaCarro: itens.some((i) => i.tipo === "carro"),
  };
}

// ---------- apoio ao formulário (vêm antes de /:id) ----------

solicitacoesViagemRouter.get("/apoio/clientes", async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const clientes = await prisma.cliente.findMany({
      where: q
        ? { OR: [{ nomcli: { contains: q, mode: "insensitive" } }, { apecli: { contains: q, mode: "insensitive" } }, ...(/^\d+$/.test(q) ? [{ codcli: Number(q) }] : [])] }
        : {},
      select: { codcli: true, nomcli: true, apecli: true },
      orderBy: { nomcli: "asc" },
      take: 20,
    });
    res.json({ clientes });
  } catch (error) {
    handleError(res, error, "apoio-clientes");
  }
});

// Sem recorte de situação de propósito: uma viagem pode ser pedida pra proposta em qualquer
// fase (o typeahead de outro domínio que herda o recorte dele esconde proposta legítima).
solicitacoesViagemRouter.get("/apoio/propostas", async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const codcli = num(req.query.codcli);
    const or: Prisma.PropostaWhereInput[] = [];
    if (q) {
      or.push({ despro: { contains: q, mode: "insensitive" } }, { cliente: { nomcli: { contains: q, mode: "insensitive" } } });
      if (/^\d+$/.test(q)) or.push({ codpro: Number(q) });
    }
    const propostas = await prisma.proposta.findMany({
      where: { ...(codcli ? { codcli } : {}), ...(or.length ? { OR: or } : {}) },
      select: { codemp: true, codpro: true, despro: true, codcli: true, cliente: { select: { nomcli: true, apecli: true } } },
      orderBy: { codpro: "desc" },
      take: 20,
    });
    res.json({
      propostas: propostas.map((p) => ({
        codemp: p.codemp,
        codpro: p.codpro,
        despro: p.despro,
        codcli: p.codcli,
        clienteNome: p.cliente.apecli || p.cliente.nomcli,
      })),
    });
  } catch (error) {
    handleError(res, error, "apoio-propostas");
  }
});

// Usuários ativos, pra escolher quem viaja. O CPF NÃO vem daqui — não está cadastrado no
// usuário; quem pede a viagem digita.
solicitacoesViagemRouter.get("/apoio/usuarios", async (req: AuthenticatedRequest, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    const usuarios = await prisma.user.findMany({
      where: { status: "ativo", ...(q ? { nome: { contains: q, mode: "insensitive" } } : {}) },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
      take: 20,
    });
    res.json({ usuarios });
  } catch (error) {
    handleError(res, error, "apoio-usuarios");
  }
});

// ---------- lista ----------

const lista = (v: unknown): string[] => (typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

solicitacoesViagemRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) return void res.status(404).json({ error: "Usuário não encontrado" });

    const escopo = String(req.query.escopo ?? "minhas");
    // O escopo já é o recorte de permissão: nada de filtrar em memória depois.
    let base: Prisma.SolicitacaoViagemWhereInput;
    if (escopo === "atendimento") {
      if (!ehAtendimento(ctx.role)) return void res.status(403).json({ error: "Sem permissão para o atendimento" });
      base = {};
    } else if (escopo === "aprovacao") {
      if (ctx.role === "admin") base = {};
      else if (ctx.contexto.departamentosGerenciados.length > 0)
        base = { aprovacaoDepexe: { in: ctx.contexto.departamentosGerenciados }, NOT: { solicitanteId: ctx.userId } };
      else return void res.status(403).json({ error: "Sem permissão para aprovações" });
    } else {
      base = { solicitanteId: ctx.userId };
    }

    const status = lista(req.query.status).filter((s) => (STATUS_VIAGEM as readonly string[]).includes(s));
    const finalidades = lista(req.query.finalidade).filter((s) => (FINALIDADES as readonly string[]).includes(s));
    const codcli = num(req.query.codcli);
    const q = String(req.query.q ?? "").trim();
    const de = typeof req.query.de === "string" && ehDataIso(req.query.de) ? req.query.de : null;
    const ate = typeof req.query.ate === "string" && ehDataIso(req.query.ate) ? req.query.ate : null;

    const filtros: Prisma.SolicitacaoViagemWhereInput[] = [];
    if (finalidades.length) filtros.push({ finalidade: { in: finalidades } });
    if (codcli) filtros.push({ codcli });
    if (de) filtros.push({ dataFim: { gte: dia(de)! } });
    if (ate) filtros.push({ dataInicio: { lte: dia(ate)! } });
    if (q) {
      const or: Prisma.SolicitacaoViagemWhereInput[] = [
        { motivo: { contains: q, mode: "insensitive" } },
        { cidadesDestino: { contains: q, mode: "insensitive" } },
        { solicitante: { nome: { contains: q, mode: "insensitive" } } },
        { cliente: { nomcli: { contains: q, mode: "insensitive" } } },
      ];
      if (/^#?\d+$/.test(q)) or.push({ id: Number(q.replace("#", "")) });
      filtros.push({ OR: or });
    }
    const where: Prisma.SolicitacaoViagemWhereInput = { AND: [base, ...filtros] };
    const whereComStatus: Prisma.SolicitacaoViagemWhereInput = status.length ? { AND: [where, { status: { in: status } }] } : where;

    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const tamanho = Math.min(100, Math.max(1, Number(req.query.tamanho) || 25));

    const [total, linhas, porStatus] = await Promise.all([
      prisma.solicitacaoViagem.count({ where: whereComStatus }),
      prisma.solicitacaoViagem.findMany({
        where: whereComStatus,
        orderBy: { id: "desc" },
        skip: (pagina - 1) * tamanho,
        take: tamanho,
        include: {
          solicitante: { select: { nome: true } },
          atendimento: { select: { nome: true } },
          cliente: { select: { nomcli: true, apecli: true } },
        },
      }),
      // KPIs sem o filtro de status (senão o card do status escolhido zeraria os demais).
      prisma.solicitacaoViagem.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);

    res.json({
      total,
      pagina,
      tamanho,
      kpis: Object.fromEntries(porStatus.map((s) => [s.status, s._count._all])),
      solicitacoes: linhas.map((v) => ({
        id: v.id,
        status: v.status,
        finalidade: v.finalidade,
        motivo: v.motivo,
        solicitanteNome: v.solicitante?.nome ?? "Usuário removido",
        atendimentoNome: v.atendimento?.nome ?? null,
        clienteNome: v.cliente ? v.cliente.apecli || v.cliente.nomcli : null,
        propostaRotulo: rotuloProposta(v),
        dataInicio: isoDia(v.dataInicio),
        dataFim: isoDia(v.dataFim),
        cidadesDestino: v.cidadesDestino,
        qtdPessoas: v.qtdPessoas,
        precisaHospedagem: v.precisaHospedagem,
        precisaAereo: v.precisaAereo,
        precisaCarro: v.precisaCarro,
        valorAprovado: dec(v.valorAprovado),
        criadoEm: v.criadoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// ---------- detalhe ----------

// Carrega + valida acesso. Devolve `null` depois de já ter respondido (404/403).
async function abrir(req: AuthenticatedRequest, res: Response): Promise<{ v: ViagemDetalhe; ctx: Ctx } | null> {
  const id = idDaRota(req);
  if (!id) {
    res.status(400).json({ error: "Id inválido" });
    return null;
  }
  const ctx = await contextoDoUsuario(req);
  if (!ctx) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return null;
  }
  const v = await carregar(id);
  if (!v) {
    res.status(404).json({ error: "Solicitação não encontrada" });
    return null;
  }
  if (!podeVerViagem(ctx, v) && ctx.role !== "admin") {
    res.status(403).json({ error: "Sem permissão para ver esta solicitação" });
    return null;
  }
  return { v, ctx };
}

solicitacoesViagemRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrir(req, res);
    if (!r) return;
    res.json({ solicitacao: serializar(r.v, r.ctx) });
  } catch (error) {
    handleError(res, error, "detalhe");
  }
});

// ---------- criação ----------

solicitacoesViagemRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) return void res.status(404).json({ error: "Usuário não encontrado" });

    const validado = await validarEntrada(req.body ?? {});
    if ("erro" in validado) return void res.status(400).json({ error: validado.erro });
    const d = validado.dados;
    const aprovador = await resolverAprovador(ctx.userId);

    const criada = await prisma.$transaction(async (tx) => {
      const v = await tx.solicitacaoViagem.create({
        data: {
          solicitanteId: ctx.userId,
          finalidade: d.finalidade,
          motivo: d.motivo,
          ...d.vinculo,
          qtdPessoas: d.viajantes.length,
          dataInicio: dia(d.dataInicio)!,
          dataFim: dia(d.dataFim)!,
          cidadesDestino: d.cidadesDestino,
          observacoes: d.observacoes,
          roteiroObservacao: d.roteiroObservacao,
          ...flagsDosItens(d.itens),
          aprovacaoCodemp: aprovador?.codemp ?? null,
          aprovacaoDepexe: aprovador?.depexe ?? null,
        },
      });
      const idsViajantes: number[] = [];
      for (const p of d.viajantes) {
        const criado = await tx.solicitacaoViagemViajante.create({
          data: { solicitacaoId: v.id, userId: p.userId ?? null, nome: p.nome, cpf: p.cpf },
        });
        idsViajantes.push(criado.id);
      }
      for (const [ordem, i] of d.itens.entries()) {
        await tx.solicitacaoViagemItem.create({
          data: {
            solicitacaoId: v.id,
            ...dadosItem(i, ordem),
            viajantes: { create: i.viajantes.map((idx) => ({ viajanteId: idsViajantes[idx] })) },
          },
        });
      }
      await auditar(tx, req, v, EVENTOS_AUDITORIA.VIAGEM_SOLICITADA, {
        metadata: { finalidade: d.finalidade, itens: d.itens.map((i) => i.tipo), viajantes: d.viajantes.length },
      });
      return v;
    });

    await notificarAtendimentoViagem("viagem_solicitada", `${ctx.nome} solicitou a viagem #${criada.id} (${d.cidadesDestino})`, criada.id, ctx.userId);
    res.status(201).json({ id: criada.id });
  } catch (error) {
    handleError(res, error, "criar");
  }
});

// ---------- edição ----------

solicitacoesViagemRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrir(req, res);
    if (!r) return;
    const { v, ctx } = r;
    if (!serializar(v, ctx).pode.editar) return void res.status(403).json({ error: "Esta solicitação não pode ser editada por você neste status" });

    // Depois da aprovação a estrutura fica travada (quem, o quê e onde já foi autorizado): o
    // atendimento só ajusta datas, horários e observação dos itens existentes (remarcação).
    if (v.status === "aprovada" || v.status === "reservada") {
      const brutos = Array.isArray(req.body?.itens) ? (req.body.itens as Record<string, unknown>[]) : [];
      const antesPorId = new Map(v.itens.map((i) => [i.id, i]));
      const ajustes: { id: number; dataInicio: string | null; dataFim: string | null; horaInicio: string | null; horaFim: string | null; observacoes: string | null }[] = [];
      for (const b of brutos) {
        const id = num(b.id);
        if (id === null || !antesPorId.has(id)) return void res.status(409).json({ error: "Após a aprovação só é possível ajustar datas e horários dos itens existentes" });
        const dataInicio = typeof b.dataInicio === "string" && b.dataInicio ? b.dataInicio : null;
        const dataFim = typeof b.dataFim === "string" && b.dataFim ? b.dataFim : null;
        if ((dataInicio && !ehDataIso(dataInicio)) || (dataFim && !ehDataIso(dataFim))) return void res.status(400).json({ error: "Data inválida" });
        if (dataInicio && dataFim && dataFim < dataInicio) return void res.status(400).json({ error: "A data final é anterior à inicial" });
        const horaInicio = txt(b.horaInicio, 5);
        const horaFim = txt(b.horaFim, 5);
        if ([horaInicio, horaFim].some((h) => h && !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))) return void res.status(400).json({ error: "Horário inválido (use HH:MM)" });
        ajustes.push({ id, dataInicio, dataFim, horaInicio, horaFim, observacoes: txt(b.observacoes, 1000) });
      }
      await prisma.$transaction(async (tx) => {
        const alteracoes: Record<string, { de: unknown; para: unknown; rotulo: string }> = {};
        for (const a of ajustes) {
          const antes = antesPorId.get(a.id)!;
          const depois = { dataInicio: a.dataInicio, dataFim: a.dataFim, horaInicio: a.horaInicio, horaFim: a.horaFim, observacoes: a.observacoes };
          const d = diffCampos(
            { dataInicio: "Início", dataFim: "Término", horaInicio: "Hora inicial", horaFim: "Hora final", observacoes: "Observações" },
            paraDiff({ dataInicio: isoDia(antes.dataInicio), dataFim: isoDia(antes.dataFim), horaInicio: antes.horaInicio, horaFim: antes.horaFim, observacoes: antes.observacoes }),
            paraDiff(depois)
          );
          for (const [campo, e] of Object.entries(d.alteracoes)) alteracoes[`item${a.id}.${campo}`] = { ...e, rotulo: `Item ${a.id} — ${e.rotulo}` };
          await tx.solicitacaoViagemItem.update({
            where: { id: a.id },
            data: { dataInicio: dia(a.dataInicio), dataFim: dia(a.dataFim), horaInicio: a.horaInicio, horaFim: a.horaFim, observacoes: a.observacoes },
          });
        }
        if (Object.keys(alteracoes).length > 0) await auditar(tx, req, v, EVENTOS_AUDITORIA.VIAGEM_ALTERADA, { alteracoes });
      });
      return void res.json({ solicitacao: serializar((await carregar(v.id))!, ctx) });
    }

    const validado = await validarEntrada(req.body ?? {});
    if ("erro" in validado) return void res.status(400).json({ error: validado.erro });
    const d = validado.dados;

    await prisma.$transaction(async (tx) => {
      const antes = { finalidade: v.finalidade, motivo: v.motivo, codcli: v.codcli, codpro: v.codpro, dataInicio: isoDia(v.dataInicio), dataFim: isoDia(v.dataFim), cidadesDestino: v.cidadesDestino, observacoes: v.observacoes, roteiroObservacao: v.roteiroObservacao };
      const depois = { finalidade: d.finalidade, motivo: d.motivo, codcli: d.vinculo.codcli, codpro: d.vinculo.codpro, dataInicio: d.dataInicio, dataFim: d.dataFim, cidadesDestino: d.cidadesDestino, observacoes: d.observacoes, roteiroObservacao: d.roteiroObservacao };
      const diff = diffCampos(CAMPOS_CABECALHO, paraDiff(antes), paraDiff(depois));

      await tx.solicitacaoViagem.update({
        where: { id: v.id },
        data: {
          finalidade: d.finalidade,
          motivo: d.motivo,
          ...d.vinculo,
          qtdPessoas: d.viajantes.length,
          dataInicio: dia(d.dataInicio)!,
          dataFim: dia(d.dataFim)!,
          cidadesDestino: d.cidadesDestino,
          observacoes: d.observacoes,
          roteiroObservacao: d.roteiroObservacao,
          ...flagsDosItens(d.itens),
        },
      });

      // Viajantes: atualiza os que vêm com id, cria os novos, remove os que sumiram.
      const idsExistentes = new Set(v.viajantes.map((p) => p.id));
      const mantidos = new Set<number>();
      const idPorIndice: number[] = [];
      for (const p of d.viajantes) {
        if (p.id && idsExistentes.has(p.id)) {
          await tx.solicitacaoViagemViajante.update({ where: { id: p.id }, data: { userId: p.userId ?? null, nome: p.nome, cpf: p.cpf } });
          mantidos.add(p.id);
          idPorIndice.push(p.id);
        } else {
          const criado = await tx.solicitacaoViagemViajante.create({ data: { solicitacaoId: v.id, userId: p.userId ?? null, nome: p.nome, cpf: p.cpf } });
          mantidos.add(criado.id);
          idPorIndice.push(criado.id);
        }
      }
      const removerViajantes = [...idsExistentes].filter((id) => !mantidos.has(id));
      if (removerViajantes.length) await tx.solicitacaoViagemViajante.deleteMany({ where: { id: { in: removerViajantes } } });

      // Itens: mesma lógica; preserva reserva/cotações/anexos dos que continuam.
      const itensExistentes = new Set(v.itens.map((i) => i.id));
      const itensMantidos = new Set<number>();
      for (const [ordem, i] of d.itens.entries()) {
        const vinculos = i.viajantes.map((idx) => ({ viajanteId: idPorIndice[idx] }));
        if (i.id && itensExistentes.has(i.id)) {
          await tx.solicitacaoViagemItem.update({
            where: { id: i.id },
            data: { ...dadosItem(i, ordem), viajantes: { deleteMany: {}, create: vinculos } },
          });
          itensMantidos.add(i.id);
        } else {
          const criado = await tx.solicitacaoViagemItem.create({
            data: { solicitacaoId: v.id, ...dadosItem(i, ordem), viajantes: { create: vinculos } },
          });
          itensMantidos.add(criado.id);
        }
      }
      const removerItens = [...itensExistentes].filter((id) => !itensMantidos.has(id));
      if (removerItens.length) await tx.solicitacaoViagemItem.deleteMany({ where: { id: { in: removerItens } } });

      await auditar(tx, req, { id: v.id, codemp: d.vinculo.codemp, codpro: d.vinculo.codpro }, EVENTOS_AUDITORIA.VIAGEM_ALTERADA, {
        alteracoes: diff.alteracoes,
        metadata: { itens: d.itens.map((i) => i.tipo), viajantes: d.viajantes.length, itensRemovidos: removerItens.length },
      });
    });

    res.json({ solicitacao: serializar((await carregar(v.id))!, ctx) });
  } catch (error) {
    handleError(res, error, "editar");
  }
});

// ---------- transições ----------

// Aplica uma mudança de status com checagem otimista do status de origem (dois cliques ou
// duas pessoas: o segundo recebe 409 em vez de passar por cima).
async function mudarStatus(
  req: AuthenticatedRequest,
  res: Response,
  opts: {
    label: string;
    permitido: (ctx: Ctx, v: ViagemDetalhe) => boolean | string;
    origem: (v: ViagemDetalhe) => boolean;
    validar?: (v: ViagemDetalhe) => string | null;
    dados: (v: ViagemDetalhe, ctx: Ctx) => Prisma.SolicitacaoViagemUncheckedUpdateInput;
    evento: EventoAuditoriaTipo;
    metadata?: (v: ViagemDetalhe) => Record<string, unknown>;
    depois?: (v: ViagemDetalhe, ctx: Ctx) => Promise<void>;
  }
) {
  const r = await abrir(req, res);
  if (!r) return;
  const { v, ctx } = r;
  const perm = opts.permitido(ctx, v);
  if (perm !== true) return void res.status(403).json({ error: typeof perm === "string" ? perm : "Sem permissão" });
  if (!opts.origem(v)) return void res.status(409).json({ error: `Não é possível fazer isso com a solicitação em "${v.status}"` });
  const erro = opts.validar?.(v);
  if (erro) return void res.status(400).json({ error: erro });

  const resultado = await prisma.$transaction(async (tx) => {
    const atualizadas = await tx.solicitacaoViagem.updateMany({
      where: { id: v.id, status: v.status },
      data: opts.dados(v, ctx) as Prisma.SolicitacaoViagemUpdateManyMutationInput,
    });
    if (atualizadas.count === 0) return false;
    await auditar(tx, req, v, opts.evento, { metadata: { de: v.status, ...(opts.metadata?.(v) ?? {}) } });
    return true;
  });
  if (!resultado) return void res.status(409).json({ error: "A solicitação mudou enquanto você agia — recarregue" });

  if (opts.depois) await opts.depois(v, ctx);
  res.json({ solicitacao: serializar((await carregar(v.id))!, ctx) });
}

const soAtendimento = (ctx: Ctx) => podeAtenderViagem(ctx) || "Apenas o atendimento pode fazer isso";

solicitacoesViagemRouter.post("/:id/assumir", async (req: AuthenticatedRequest, res) => {
  try {
    await mudarStatus(req, res, {
      label: "assumir",
      permitido: soAtendimento,
      origem: (v) => podeTransicionar("assumir", v.status),
      dados: (_v, ctx) => ({ status: "em_cotacao", responsavelAtendimentoId: ctx.userId }),
      evento: EVENTOS_AUDITORIA.VIAGEM_ASSUMIDA,
      depois: async (v, ctx) => {
        if (v.solicitanteId && v.solicitanteId !== ctx.userId) {
          await criarNotificacao(v.solicitanteId, "viagem_em_cotacao", `${ctx.nome} assumiu a cotação da viagem #${v.id}`, undefined, v.id);
        }
      },
    });
  } catch (error) {
    handleError(res, error, "assumir");
  }
});

solicitacoesViagemRouter.post("/:id/enviar-aprovacao", async (req: AuthenticatedRequest, res) => {
  try {
    await mudarStatus(req, res, {
      label: "enviar-aprovacao",
      permitido: soAtendimento,
      origem: (v) => podeTransicionar("enviar_aprovacao", v.status),
      validar: (v) => (v.cotacoes.some((c) => c.selecionada) ? null : "Selecione ao menos uma cotação antes de enviar para aprovação"),
      dados: () => ({ status: "aguardando_aprovacao", observacaoDecisao: null }),
      evento: EVENTOS_AUDITORIA.VIAGEM_ENVIADA_APROVACAO,
      metadata: (v) => ({ valorProposto: somaSelecionadas(v) }),
      depois: async (v, ctx) => {
        await notificarAprovadoresViagem(
          { codemp: v.aprovacaoCodemp, depexe: v.aprovacaoDepexe },
          `Viagem #${v.id} aguarda sua aprovação (${v.cidadesDestino})`,
          v.id,
          ctx.userId
        );
      },
    });
  } catch (error) {
    handleError(res, error, "enviar-aprovacao");
  }
});

solicitacoesViagemRouter.post("/:id/decidir", async (req: AuthenticatedRequest, res) => {
  try {
    const acao = String(req.body?.acao ?? "");
    if (!["aprovar", "reprovar", "devolver"].includes(acao)) return void res.status(400).json({ error: "Ação inválida" });
    const observacao = txt(req.body?.observacao, 1000);
    if (acao !== "aprovar" && !observacao) return void res.status(400).json({ error: "Informe o motivo" });

    const evento = { aprovar: EVENTOS_AUDITORIA.VIAGEM_APROVADA, reprovar: EVENTOS_AUDITORIA.VIAGEM_REPROVADA, devolver: EVENTOS_AUDITORIA.VIAGEM_DEVOLVIDA }[acao]!;
    const rotulo = { aprovar: "aprovada", reprovar: "reprovada", devolver: "devolvida para nova cotação" }[acao]!;
    let valorAprovado: number | null = null;

    await mudarStatus(req, res, {
      label: "decidir",
      permitido: (ctx, v) => podeAprovarViagem(ctx, v) || "Sem permissão para decidir esta solicitação",
      origem: (v) => podeTransicionar("decidir", v.status),
      validar: (v) => {
        if (acao !== "aprovar") return null;
        const informado = req.body?.valorAprovado;
        valorAprovado = informado === undefined || informado === null || informado === "" ? somaSelecionadas(v) : Number(informado);
        return Number.isFinite(valorAprovado) && valorAprovado >= 0 && valorAprovado < 1e10 ? null : "Valor aprovado inválido";
      },
      dados: (_v, ctx) =>
        acao === "aprovar"
          ? { status: "aprovada", valorAprovado, aprovadoPorId: ctx.userId, aprovadoEm: new Date(), observacaoDecisao: observacao }
          : acao === "reprovar"
            ? { status: "reprovada", aprovadoPorId: ctx.userId, aprovadoEm: new Date(), observacaoDecisao: observacao }
            : { status: "em_cotacao", observacaoDecisao: observacao },
      evento,
      metadata: () => ({ acao, valorAprovado, observacao }),
      depois: async (v, ctx) => {
        const avisar = new Set<number>();
        if (v.solicitanteId) avisar.add(v.solicitanteId);
        if (acao === "devolver" && v.responsavelAtendimentoId) avisar.add(v.responsavelAtendimentoId);
        avisar.delete(ctx.userId);
        for (const id of avisar) await criarNotificacao(id, `viagem_${acao === "aprovar" ? "aprovada" : acao === "reprovar" ? "reprovada" : "devolvida"}`, `A viagem #${v.id} foi ${rotulo} por ${ctx.nome}`, undefined, v.id);
      },
    });
  } catch (error) {
    handleError(res, error, "decidir");
  }
});

// Todos os itens com localizador, e o total reservado não pode passar do aprovado — se
// passar, volta para a aprovação em vez de reservar (o gasto real excede o autorizado).
solicitacoesViagemRouter.post("/:id/reservar", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrir(req, res);
    if (!r) return;
    const { v, ctx } = r;
    if (!podeAtenderViagem(ctx)) return void res.status(403).json({ error: "Apenas o atendimento pode fazer isso" });
    if (!podeTransicionar("reservar", v.status)) return void res.status(409).json({ error: `Não é possível reservar com a solicitação em "${v.status}"` });
    if (v.itens.some((i) => !i.localizador)) return void res.status(400).json({ error: "Registre o localizador de todos os itens antes de concluir a reserva" });

    const estoura = somaReservado(v) > Number(v.valorAprovado ?? 0);
    const novoStatus = estoura ? "aguardando_aprovacao" : "reservada";
    const ok = await prisma.$transaction(async (tx) => {
      const up = await tx.solicitacaoViagem.updateMany({ where: { id: v.id, status: "aprovada" }, data: { status: novoStatus } });
      if (up.count === 0) return false;
      await auditar(tx, req, v, estoura ? EVENTOS_AUDITORIA.VIAGEM_REVALIDACAO_EXIGIDA : EVENTOS_AUDITORIA.VIAGEM_RESERVADA, {
        metadata: { valorAprovado: dec(v.valorAprovado), valorReservado: somaReservado(v) },
      });
      return true;
    });
    if (!ok) return void res.status(409).json({ error: "A solicitação mudou enquanto você agia — recarregue" });

    if (estoura) {
      await notificarAprovadoresViagem({ codemp: v.aprovacaoCodemp, depexe: v.aprovacaoDepexe }, `Viagem #${v.id}: o valor reservado passou do aprovado e precisa de nova aprovação`, v.id, ctx.userId);
    } else if (v.solicitanteId && v.solicitanteId !== ctx.userId) {
      await criarNotificacao(v.solicitanteId, "viagem_reservada", `A viagem #${v.id} foi reservada`, undefined, v.id);
    }
    res.json({ solicitacao: serializar((await carregar(v.id))!, ctx), revalidacao: estoura });
  } catch (error) {
    handleError(res, error, "reservar");
  }
});

solicitacoesViagemRouter.post("/:id/finalizar", async (req: AuthenticatedRequest, res) => {
  try {
    await mudarStatus(req, res, {
      label: "finalizar",
      permitido: soAtendimento,
      origem: (v) => podeTransicionar("finalizar", v.status),
      dados: () => ({ status: "finalizada" }),
      evento: EVENTOS_AUDITORIA.VIAGEM_FINALIZADA,
    });
  } catch (error) {
    handleError(res, error, "finalizar");
  }
});

solicitacoesViagemRouter.post("/:id/cancelar", async (req: AuthenticatedRequest, res) => {
  try {
    const motivo = txt(req.body?.motivo, 1000);
    if (!motivo) return void res.status(400).json({ error: "Informe o motivo do cancelamento" });
    await mudarStatus(req, res, {
      label: "cancelar",
      permitido: (ctx, v) => {
        if (podeAtenderViagem(ctx)) return true;
        if (ehSolicitante(ctx, v) && ["solicitada", "em_cotacao", "aguardando_aprovacao"].includes(v.status)) return true;
        return "Você não pode cancelar esta solicitação neste status";
      },
      origem: (v) => !ehTerminal(v.status),
      dados: () => ({ status: "cancelada", motivoCancelamento: motivo }),
      evento: EVENTOS_AUDITORIA.VIAGEM_CANCELADA,
      metadata: () => ({ motivo }),
      depois: async (v, ctx) => {
        const avisar = new Set<number>();
        if (v.solicitanteId) avisar.add(v.solicitanteId);
        if (v.responsavelAtendimentoId) avisar.add(v.responsavelAtendimentoId);
        avisar.delete(ctx.userId);
        for (const id of avisar) await criarNotificacao(id, "viagem_cancelada", `A viagem #${v.id} foi cancelada por ${ctx.nome}`, undefined, v.id);
      },
    });
  } catch (error) {
    handleError(res, error, "cancelar");
  }
});

// ---------- cotações ----------

function lerCotacao(body: Record<string, unknown>, itensValidos: Set<number>): { erro: string } | { dados: { fornecedor: string; descricao: string | null; valor: number; validadeAte: Date | null; itemId: number | null } } {
  const fornecedor = txt(body.fornecedor, 150);
  if (!fornecedor) return { erro: "Informe o fornecedor" };
  const valor = Number(body.valor);
  if (!Number.isFinite(valor) || valor < 0 || valor >= 1e10) return { erro: "Valor inválido" };
  const validade = typeof body.validadeAte === "string" && body.validadeAte ? body.validadeAte : null;
  if (validade && !ehDataIso(validade)) return { erro: "Validade inválida" };
  const itemId = num(body.itemId);
  if (itemId !== null && !itensValidos.has(itemId)) return { erro: "Item inválido" };
  return { dados: { fornecedor, descricao: txt(body.descricao, 500), valor: Math.round(valor * 100) / 100, validadeAte: dia(validade), itemId } };
}

async function abrirParaCotar(req: AuthenticatedRequest, res: Response) {
  const r = await abrir(req, res);
  if (!r) return null;
  if (!podeAtenderViagem(r.ctx)) return void res.status(403).json({ error: "Apenas o atendimento pode fazer isso" }) as never;
  if (r.v.status !== "em_cotacao") return void res.status(409).json({ error: "As cotações só podem ser alteradas com a solicitação em cotação" }) as never;
  return r;
}

solicitacoesViagemRouter.post("/:id/cotacoes", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrirParaCotar(req, res);
    if (!r) return;
    const lido = lerCotacao(req.body ?? {}, new Set(r.v.itens.map((i) => i.id)));
    if ("erro" in lido) return void res.status(400).json({ error: lido.erro });
    await prisma.$transaction(async (tx) => {
      const c = await tx.solicitacaoViagemCotacao.create({ data: { solicitacaoId: r.v.id, criadoPorId: r.ctx.userId, ...lido.dados } });
      await auditar(tx, req, r.v, EVENTOS_AUDITORIA.VIAGEM_COTACAO_ADICIONADA, { metadata: { cotacaoId: c.id, fornecedor: c.fornecedor, valor: lido.dados.valor } });
    });
    res.status(201).json({ solicitacao: serializar((await carregar(r.v.id))!, r.ctx) });
  } catch (error) {
    handleError(res, error, "cotacao-criar");
  }
});

solicitacoesViagemRouter.put("/:id/cotacoes/:cid", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrirParaCotar(req, res);
    if (!r) return;
    const cid = idDaRota(req, "cid");
    if (!cid || !r.v.cotacoes.some((c) => c.id === cid)) return void res.status(404).json({ error: "Cotação não encontrada" });
    const lido = lerCotacao(req.body ?? {}, new Set(r.v.itens.map((i) => i.id)));
    if ("erro" in lido) return void res.status(400).json({ error: lido.erro });
    await prisma.solicitacaoViagemCotacao.update({ where: { id: cid }, data: lido.dados });
    res.json({ solicitacao: serializar((await carregar(r.v.id))!, r.ctx) });
  } catch (error) {
    handleError(res, error, "cotacao-editar");
  }
});

solicitacoesViagemRouter.delete("/:id/cotacoes/:cid", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrirParaCotar(req, res);
    if (!r) return;
    const cid = idDaRota(req, "cid");
    const c = r.v.cotacoes.find((x) => x.id === cid);
    if (!c) return void res.status(404).json({ error: "Cotação não encontrada" });
    await prisma.$transaction(async (tx) => {
      await tx.solicitacaoViagemCotacao.delete({ where: { id: c.id } });
      await auditar(tx, req, r.v, EVENTOS_AUDITORIA.VIAGEM_COTACAO_REMOVIDA, { metadata: { cotacaoId: c.id, fornecedor: c.fornecedor } });
    });
    res.json({ solicitacao: serializar((await carregar(r.v.id))!, r.ctx) });
  } catch (error) {
    handleError(res, error, "cotacao-excluir");
  }
});

// Marca/desmarca. Cotação ligada a um item: só uma selecionada por item.
solicitacoesViagemRouter.post("/:id/cotacoes/:cid/selecionar", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrirParaCotar(req, res);
    if (!r) return;
    const cid = idDaRota(req, "cid");
    const c = r.v.cotacoes.find((x) => x.id === cid);
    if (!c) return void res.status(404).json({ error: "Cotação não encontrada" });
    const selecionar = req.body?.selecionada !== false;
    await prisma.$transaction(async (tx) => {
      if (selecionar && c.itemId !== null) {
        await tx.solicitacaoViagemCotacao.updateMany({ where: { solicitacaoId: r.v.id, itemId: c.itemId, id: { not: c.id } }, data: { selecionada: false } });
      }
      await tx.solicitacaoViagemCotacao.update({ where: { id: c.id }, data: { selecionada: selecionar } });
      await auditar(tx, req, r.v, EVENTOS_AUDITORIA.VIAGEM_COTACAO_SELECIONADA, { metadata: { cotacaoId: c.id, fornecedor: c.fornecedor, selecionada: selecionar } });
    });
    res.json({ solicitacao: serializar((await carregar(r.v.id))!, r.ctx) });
  } catch (error) {
    handleError(res, error, "cotacao-selecionar");
  }
});

// ---------- reserva por item ----------

solicitacoesViagemRouter.put("/:id/itens/:itemId/reserva", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrir(req, res);
    if (!r) return;
    const { v, ctx } = r;
    if (!podeAtenderViagem(ctx)) return void res.status(403).json({ error: "Apenas o atendimento pode fazer isso" });
    if (v.status !== "aprovada" && v.status !== "reservada") return void res.status(409).json({ error: "A reserva só é registrada depois da aprovação" });
    const item = v.itens.find((i) => i.id === idDaRota(req, "itemId"));
    if (!item) return void res.status(404).json({ error: "Item não encontrado" });

    const fornecedor = txt(req.body?.fornecedor, 150);
    const localizador = txt(req.body?.localizador, 100);
    if (!localizador) return void res.status(400).json({ error: "Informe o localizador/número da reserva" });
    const valor = Number(req.body?.valorReservado);
    if (!Number.isFinite(valor) || valor < 0 || valor >= 1e10) return void res.status(400).json({ error: "Valor reservado inválido" });

    const totalNovo = somaReservado(v) - Number(item.valorReservado ?? 0) + valor;
    const estoura = v.status === "reservada" && totalNovo > Number(v.valorAprovado ?? 0);

    await prisma.$transaction(async (tx) => {
      await tx.solicitacaoViagemItem.update({ where: { id: item.id }, data: { fornecedor, localizador, valorReservado: Math.round(valor * 100) / 100, reservadoEm: new Date() } });
      await auditar(tx, req, v, EVENTOS_AUDITORIA.VIAGEM_RESERVA_REGISTRADA, { metadata: { itemId: item.id, tipo: item.tipo, fornecedor, localizador, valorReservado: valor } });
      if (estoura) {
        await tx.solicitacaoViagem.update({ where: { id: v.id }, data: { status: "aguardando_aprovacao" } });
        await auditar(tx, req, v, EVENTOS_AUDITORIA.VIAGEM_REVALIDACAO_EXIGIDA, { metadata: { valorAprovado: dec(v.valorAprovado), valorReservado: totalNovo } });
      }
    });
    if (estoura) {
      await notificarAprovadoresViagem({ codemp: v.aprovacaoCodemp, depexe: v.aprovacaoDepexe }, `Viagem #${v.id}: o valor reservado passou do aprovado e precisa de nova aprovação`, v.id, ctx.userId);
    }
    res.json({ solicitacao: serializar((await carregar(v.id))!, ctx), revalidacao: estoura });
  } catch (error) {
    handleError(res, error, "reserva");
  }
});

// ---------- anexos ----------

const CATEGORIAS_ANEXO = ["cotacao", "comprovante", "voucher", "outro"];

solicitacoesViagemRouter.post(
  "/:id/anexos",
  (req, res, next) =>
    upload.single("arquivo")(req, res, (err: unknown) => {
      if (err) return void res.status(400).json({ error: err instanceof Error ? err.message : "Falha no upload" });
      next();
    }),
  async (req: AuthenticatedRequest, res) => {
    const descartar = () => req.file && fs.unlink(req.file.path, () => {});
    try {
      const r = await abrir(req, res);
      if (!r) return void descartar();
      const { v, ctx } = r;
      if (!req.file) return void res.status(400).json({ error: "Arquivo é obrigatório" });
      if (!podeAtenderViagem(ctx) && !ehSolicitante(ctx, v)) {
        descartar();
        return void res.status(403).json({ error: "Sem permissão para anexar arquivos nesta solicitação" });
      }
      const categoria = CATEGORIAS_ANEXO.includes(String(req.body?.categoria)) ? String(req.body.categoria) : "outro";
      const itemId = num(req.body?.itemId);
      const cotacaoId = num(req.body?.cotacaoId);
      if ((itemId !== null && !v.itens.some((i) => i.id === itemId)) || (cotacaoId !== null && !v.cotacoes.some((c) => c.id === cotacaoId))) {
        descartar();
        return void res.status(400).json({ error: "Item ou cotação inválidos" });
      }
      const anexo = await prisma.$transaction(async (tx) => {
        const a = await tx.solicitacaoViagemAnexo.create({
          data: { solicitacaoId: v.id, itemId, cotacaoId, userId: ctx.userId, categoria, nomeArquivo: req.file!.originalname, caminhoArquivo: req.file!.filename, tamanhoBytes: req.file!.size, mimeType: req.file!.mimetype },
        });
        await auditar(tx, req, v, EVENTOS_AUDITORIA.VIAGEM_ANEXO_ADICIONADO, { metadata: { anexoId: a.id, nomeArquivo: a.nomeArquivo, categoria } });
        return a;
      });
      res.status(201).json({ anexoId: anexo.id, solicitacao: serializar((await carregar(v.id))!, ctx) });
    } catch (error) {
      descartar();
      handleError(res, error, "anexo-criar");
    }
  }
);

solicitacoesViagemRouter.get("/:id/anexos/:anexoId/download", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrir(req, res);
    if (!r) return;
    const anexo = r.v.anexos.find((a) => a.id === idDaRota(req, "anexoId"));
    if (!anexo) return void res.status(404).json({ error: "Anexo não encontrado" });
    res.download(path.join(VIAGEM_DIR, anexo.caminhoArquivo), anexo.nomeArquivo);
  } catch (error) {
    handleError(res, error, "anexo-download");
  }
});

solicitacoesViagemRouter.delete("/:id/anexos/:anexoId", async (req: AuthenticatedRequest, res) => {
  try {
    const r = await abrir(req, res);
    if (!r) return;
    const { v, ctx } = r;
    const anexo = v.anexos.find((a) => a.id === idDaRota(req, "anexoId"));
    if (!anexo) return void res.status(404).json({ error: "Anexo não encontrado" });
    if (!podeAtenderViagem(ctx) && anexo.userId !== ctx.userId) return void res.status(403).json({ error: "Sem permissão para excluir este anexo" });
    await prisma.$transaction(async (tx) => {
      await tx.solicitacaoViagemAnexo.delete({ where: { id: anexo.id } });
      await auditar(tx, req, v, EVENTOS_AUDITORIA.VIAGEM_ANEXO_REMOVIDO, { metadata: { anexoId: anexo.id, nomeArquivo: anexo.nomeArquivo } });
    });
    fs.unlink(path.join(VIAGEM_DIR, anexo.caminhoArquivo), () => {});
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "anexo-excluir");
  }
});
