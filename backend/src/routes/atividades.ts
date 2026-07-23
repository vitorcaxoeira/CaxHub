import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel, priproLabel, DEPEXE_LABELS, PRIPRO_LABELS } from "../domain/propostasDominio";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";
import { criarNotificacao, notificarGestoresDoDepartamento } from "../domain/notificacoes";
import { UPLOADS_DIR } from "../config/uploads";
import { enfileirar } from "../sync/outboxSenior";

// Router à parte de `projetosRouter` (que hoje é admin+comercial só, por causa de
// Propostas) — aqui a tela é aberta a qualquer usuário autenticado; quem pode ver/mover
// cada atividade é decidido caso a caso por `podeExecutarAcao` (ação, não tela).
export const atividadesRouter = Router();
atividadesRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[atividades:${label}]`, message);
  res.status(500).json({ error: message });
}

function parseIntParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role };
}

// Resolve a atividade + o departamento dela (via PropostaItem) — usado por todos os
// sub-recursos (comentário/checklist/anexo) pra checar permissão antes de agir.
async function carregarAtividadeComDepexe(id: number) {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
  if (!atividade) return null;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) return null;
  return { atividade, depexe: item.depexe };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const nomeUnico = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
      cb(null, nomeUnico);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Busca todas as atividades ativas, decoradas com dado de proposta/cliente/consultor/
// coluna, já filtradas pelo que o usuário pode visualizar (usado tanto pela listagem
// quanto pelos indicadores — ambos precisam do mesmo recorte de permissão).
async function carregarAtividadesVisiveis(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  const [atividades, primeiraColuna] = await Promise.all([
    prisma.atividadeConsultor.findMany({
      where: { sitreg: "A" },
      include: { coluna: true },
      orderBy: { id: "asc" },
    }),
    prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } }),
  ]);

  const chavesItem = atividades.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite }));
  const itens =
    chavesItem.length > 0
      ? await prisma.propostaItem.findMany({
          where: { OR: chavesItem },
          select: { codemp: true, codpro: true, seqite: true, depexe: true, despro: true, qtdhor: true },
        })
      : [];
  const itemPorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i]));
  const depexePorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i.depexe]));

  // Total distribuído (soma de qtdhor de todas as atividades ativas) por item — usado
  // para mostrar orçamento contratado x distribuído sem precisar da árvore de EAP.
  const alocadoPorItem = new Map<string, number>();
  for (const a of atividades) {
    const chave = `${a.codemp}-${a.codpro}-${a.seqite}`;
    alocadoPorItem.set(chave, (alocadoPorItem.get(chave) ?? 0) + (a.qtdhor ?? 0));
  }

  // "Horas realizadas" = duração das sessões de execução ainda não confirmadas (tempo já
  // rastreado, mas ainda não virou RatItem) + duração (horfim-horini) dos RatItem já
  // confirmados/sincronizados pra essa atividade. Uma sessão confirmada tem `ratItemId`
  // preenchido, então sai da conta de "sessões" e passa a contar via RatItem — nunca as
  // duas ao mesmo tempo, pra não somar a mesma hora duas vezes.
  const seqatisValidos = [...new Set(atividades.map((a) => a.seqati).filter((s): s is bigint => s != null))];
  const ratItemsComHoras =
    seqatisValidos.length > 0
      ? await prisma.ratItem.findMany({
          where: { seqati: { in: seqatisValidos }, horini: { not: null }, horfim: { not: null } },
          select: { seqati: true, horini: true, horfim: true },
        })
      : [];
  const minutosRealizadosPorSeqati = new Map<bigint, number>();
  for (const item of ratItemsComHoras) {
    if (item.seqati == null || item.horini == null || item.horfim == null) continue;
    const atual = minutosRealizadosPorSeqati.get(item.seqati) ?? 0;
    minutosRealizadosPorSeqati.set(item.seqati, atual + (item.horfim - item.horini));
  }

  const sessoesNaoConfirmadas =
    atividades.length > 0
      ? await prisma.atividadeSessaoExecucao.findMany({
          where: { atividadeId: { in: atividades.map((a) => a.id) }, confirmada: false, fim: { not: null } },
          select: { atividadeId: true, inicio: true, fim: true },
        })
      : [];
  const minutosRealizadosPorAtividadeId = new Map<number, number>();
  for (const s of sessoesNaoConfirmadas) {
    if (s.fim == null) continue;
    const minutos = Math.round((s.fim.getTime() - s.inicio.getTime()) / 60000);
    minutosRealizadosPorAtividadeId.set(s.atividadeId, (minutosRealizadosPorAtividadeId.get(s.atividadeId) ?? 0) + minutos);
  }
  function horasRealizadasDaAtividade(a: (typeof atividades)[number]): number {
    return (a.seqati != null ? minutosRealizadosPorSeqati.get(a.seqati) ?? 0 : 0) + (minutosRealizadosPorAtividadeId.get(a.id) ?? 0);
  }

  // Realizado por ITEM (soma de todas as atividades do item, mesmo padrão de
  // alocadoPorItem) — usado no orçamento do item (contratado x distribuído x realizado);
  // diferente de `horasRealizadas` por atividade, exposto à parte pra uso futuro (ex.:
  // progresso individual do card).
  const realizadoPorItem = new Map<string, number>();
  for (const a of atividades) {
    const chave = `${a.codemp}-${a.codpro}-${a.seqite}`;
    realizadoPorItem.set(chave, (realizadoPorItem.get(chave) ?? 0) + horasRealizadasDaAtividade(a));
  }

  const idsEstrutura = [...new Set(atividades.map((a) => a.estruturaAtividadeId).filter((id): id is number => id != null))];
  const nosEstrutura =
    idsEstrutura.length > 0
      ? await prisma.estruturaAtividade.findMany({
          where: { id: { in: idsEstrutura } },
          select: { id: true, nome: true, percentualConcluido: true },
        })
      : [];
  const nosEstruturaPorId = new Map(nosEstrutura.map((n) => [n.id, n]));

  const chavesPropostaUnicas = [...new Set(atividades.map((a) => `${a.codemp}-${a.codpro}`))];
  const propostas =
    chavesPropostaUnicas.length > 0
      ? await prisma.proposta.findMany({
          where: {
            OR: chavesPropostaUnicas.map((chave) => {
              const [codemp, codpro] = chave.split("-").map(Number);
              return { codemp, codpro };
            }),
          },
          include: { cliente: true },
        })
      : [];
  const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

  const codforUnicos = [...new Set(atividades.map((a) => a.codfor))];
  const consultores =
    codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
  const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

  return atividades
    .map((a) => {
      const depexe = depexePorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`);
      const proposta = propostaPorChave.get(`${a.codemp}-${a.codpro}`);
      // Sem item/proposta correspondente (órfão) — não dá pra saber departamento/cliente, não exibe.
      if (depexe == null || !proposta) return null;

      if (!podeExecutarAcao(role, contexto, "visualizar", { depexe, codfor: a.codfor })) return null;

      const consultor = consultorPorCodfor.get(a.codfor);
      const coluna = a.coluna ?? primeiraColuna ?? null;
      const hoje = new Date(new Date().toDateString());
      // Atraso é medido pela data prevista de fim DA ATIVIDADE (planejamento manual do
      // CaxHub), não pelo prazo contratual da proposta inteira (datval, do Senior) — uma
      // atividade sem dataPrevistaFim definida nunca conta como atrasada.
      const atrasada = !coluna?.ehFinal && a.dataPrevistaFim != null && new Date(a.dataPrevistaFim) < hoje;
      const chaveItem = `${a.codemp}-${a.codpro}-${a.seqite}`;
      const item = itemPorChave.get(chaveItem);
      const noEstrutura = a.estruturaAtividadeId != null ? nosEstruturaPorId.get(a.estruturaAtividadeId) : null;
      return {
        id: a.id,
        codemp: a.codemp,
        codpro: a.codpro,
        seqite: a.seqite,
        numprj: proposta.numprj,
        cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
        pripro: proposta.pripro,
        priproLabel: priproLabel(proposta.pripro),
        datval: proposta.datval,
        depexe,
        depexeLabel: depexeLabel(depexe),
        consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${a.codfor}`,
        codfor: a.codfor,
        qtdhorPrevisto: a.qtdhor,
        colunaId: a.colunaId ?? primeiraColuna?.id ?? null,
        coluna,
        atrasada,
        dataPrevistaInicio: a.dataPrevistaInicio,
        dataPrevistaFim: a.dataPrevistaFim,
        podeMover: podeExecutarAcao(role, contexto, "mover", { depexe, codfor: a.codfor }),
        podeEditar: podeExecutarAcao(role, contexto, "editar", { depexe, codfor: a.codfor }),
        itemDescricao: item?.despro ?? null,
        itemQtdhor: item?.qtdhor ?? null,
        itemAlocado: alocadoPorItem.get(chaveItem) ?? 0,
        itemRealizado: realizadoPorItem.get(chaveItem) ?? 0,
        // Minutos: sessões ainda não confirmadas + RatItem já confirmados/sincronizados
        // (nunca as duas fontes ao mesmo tempo pra mesma sessão — ver comentário acima).
        horasRealizadas: horasRealizadasDaAtividade(a),
        estruturaAtividadeId: a.estruturaAtividadeId,
        estruturaNome: noEstrutura?.nome ?? null,
        estruturaPercentual: noEstrutura?.percentualConcluido ?? null,
        // Mesma regra de acesso da Alocação (departamentosPermitidos/podeGerenciarProposta
        // em alocacao.ts) — evita mandar um consultor comum pra rota do cronograma, que
        // devolveria 403 por não gerenciar o departamento.
        podeVerCronograma: role === "admin" || contexto.departamentosGerenciados.includes(depexe),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

atividadesRouter.get("/indicadores", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    const visiveis = await carregarAtividadesVisiveis(role, contexto);
    const backlog = visiveis.filter((v) => !v.coluna?.ehFinal);
    const concluidas = visiveis.filter((v) => v.coluna?.ehFinal);

    const totalBacklog = backlog.length;
    const horasBacklog = backlog.reduce((soma, v) => soma + (v.qtdhorPrevisto ?? 0), 0) / 60;
    const totalAtrasadas = backlog.filter((v) => v.atrasada).length;
    const pctAtrasadas = totalBacklog > 0 ? (totalAtrasadas / totalBacklog) * 100 : null;

    // SLA: de quando cada atividade concluída entrou pela 1ª vez numa coluna "ehFinal",
    // comparado com a data prevista de fim da própria atividade (dataPrevistaFim). Sem
    // histórico de movimentação ou sem data prevista definida, não dá pra saber se foi
    // concluída no prazo — fica fora da amostra do SLA.
    const historico =
      concluidas.length > 0
        ? await prisma.atividadeHistoricoMovimentacao.findMany({
            where: { atividadeId: { in: concluidas.map((v) => v.id) }, colunaNova: { ehFinal: true } },
            orderBy: { movidoEm: "asc" },
          })
        : [];
    const primeiraConclusaoPorAtividade = new Map<number, Date>();
    for (const h of historico) {
      if (!primeiraConclusaoPorAtividade.has(h.atividadeId)) primeiraConclusaoPorAtividade.set(h.atividadeId, h.movidoEm);
    }
    let slaDentroPrazo = 0;
    let slaAmostra = 0;
    for (const v of concluidas) {
      const concluidaEm = primeiraConclusaoPorAtividade.get(v.id);
      if (!concluidaEm || !v.dataPrevistaFim) continue;
      slaAmostra += 1;
      if (concluidaEm <= new Date(v.dataPrevistaFim)) slaDentroPrazo += 1;
    }
    const slaPct = slaAmostra > 0 ? (slaDentroPrazo / slaAmostra) * 100 : null;

    const porSituacaoMap = new Map<string, { colunaId: number | null; nome: string; corBadge: string | null; qtd: number; horas: number }>();
    for (const v of visiveis) {
      const chave = String(v.colunaId);
      if (!porSituacaoMap.has(chave)) {
        porSituacaoMap.set(chave, {
          colunaId: v.colunaId,
          nome: v.coluna?.nome ?? "Sem coluna",
          corBadge: v.coluna?.corBadge ?? null,
          qtd: 0,
          horas: 0,
        });
      }
      const bucket = porSituacaoMap.get(chave)!;
      bucket.qtd += 1;
      bucket.horas += (v.qtdhorPrevisto ?? 0) / 60;
    }

    const porDepartamentoMap = new Map<number, { depexe: number; depexeLabel: string; qtd: number; horas: number; atrasadas: number }>();
    for (const v of visiveis) {
      if (!porDepartamentoMap.has(v.depexe)) {
        porDepartamentoMap.set(v.depexe, { depexe: v.depexe, depexeLabel: v.depexeLabel, qtd: 0, horas: 0, atrasadas: 0 });
      }
      const bucket = porDepartamentoMap.get(v.depexe)!;
      bucket.qtd += 1;
      bucket.horas += (v.qtdhorPrevisto ?? 0) / 60;
      if (v.atrasada) bucket.atrasadas += 1;
    }

    // Workload: carga de backlog (não concluído) por consultor — só o que ainda está
    // pendente, não o histórico todo (senão não representaria capacidade atual).
    const porConsultorMap = new Map<string, { codfor: number; nome: string; qtd: number; horas: number; atrasadas: number }>();
    for (const v of backlog) {
      const chave = String(v.codfor);
      if (!porConsultorMap.has(chave)) {
        porConsultorMap.set(chave, { codfor: v.codfor, nome: v.consultorNome, qtd: 0, horas: 0, atrasadas: 0 });
      }
      const bucket = porConsultorMap.get(chave)!;
      bucket.qtd += 1;
      bucket.horas += (v.qtdhorPrevisto ?? 0) / 60;
      if (v.atrasada) bucket.atrasadas += 1;
    }

    res.json({
      totalBacklog,
      horasBacklog,
      totalAtrasadas,
      pctAtrasadas,
      slaPct,
      slaAmostra,
      porSituacao: [...porSituacaoMap.values()],
      porDepartamento: [...porDepartamentoMap.values()].sort((a, b) => b.qtd - a.qtd),
      porConsultor: [...porConsultorMap.values()].sort((a, b) => b.horas - a.horas),
    });
  } catch (error) {
    handleError(res, error, "indicadores");
  }
});

atividadesRouter.get("/opcoes-filtro", async (req: AuthenticatedRequest, res) => {
  try {
    const departamentos = Object.entries(DEPEXE_LABELS)
      .map(([value, label]) => ({ value: Number(value), label }))
      .sort((a, b) => a.value - b.value);
    const prioridades = Object.entries(PRIPRO_LABELS)
      .map(([value, label]) => ({ value: Number(value), label }))
      .sort((a, b) => a.value - b.value);

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    // Consultores derivados do mesmo recorte de visibilidade da listagem/indicadores —
    // não do time de um departamento específico (isso é `/alocacao/consultores-elegiveis`,
    // que serve pra escolher quem RECEBE uma alocação nova, não pra filtrar quem já tem
    // atividade visível). Considera todo `visiveis` (não só backlog), pra incluir quem só
    // tem atividade concluída.
    const visiveis = await carregarAtividadesVisiveis(ctx.role, ctx.contexto);
    const consultoresPorCodfor = new Map<number, string>();
    for (const v of visiveis) consultoresPorCodfor.set(v.codfor, v.consultorNome);
    const consultores = [...consultoresPorCodfor.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    res.json({ departamentos, prioridades, consultores });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

atividadesRouter.get("/quadro-colunas", async (_req, res) => {
  try {
    const colunas = await prisma.quadroColuna.findMany({ orderBy: { ordem: "asc" } });
    res.json({ colunas });
  } catch (error) {
    handleError(res, error, "quadro-colunas");
  }
});

atividadesRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    const filtroDepexe = parseIntParam(req.query.depexe);
    const filtroColunaId = parseIntParam(req.query.colunaId);
    const filtroPripro = parseIntParam(req.query.pripro);
    const filtroCodfor = parseIntParam(req.query.codfor);
    const somenteAtrasadas = req.query.atrasada === "true";
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().toLowerCase() : "";
    const page = parseIntParam(req.query.page);
    const pageSize = parseIntParam(req.query.pageSize);
    const situacoesValidas = ["backlog", "atrasadas", "concluidas"] as const;
    const situacaoRaw = typeof req.query.situacao === "string" ? req.query.situacao : null;
    const situacao = situacoesValidas.includes(situacaoRaw as (typeof situacoesValidas)[number])
      ? (situacaoRaw as (typeof situacoesValidas)[number])
      : null;

    const visiveis = await carregarAtividadesVisiveis(role, contexto);

    // KPIs calculados sobre o escopo total (visível pro usuário), antes de aplicar os
    // filtros transitórios abaixo — mesmo padrão da Alocação (alocacao.ts). Horas em
    // MINUTOS (o frontend converte pra "H:MM"), diferente de /indicadores (em horas).
    const backlogKpi = visiveis.filter((v) => !v.coluna?.ehFinal);
    const atrasadasKpi = backlogKpi.filter((v) => v.atrasada);
    const concluidasKpi = visiveis.filter((v) => v.coluna?.ehFinal);
    const somaHoras = (lista: typeof visiveis) => lista.reduce((soma, v) => soma + (v.qtdhorPrevisto ?? 0), 0);
    const kpis = {
      totalNoEscopo: visiveis.length,
      backlog: { quantidade: backlogKpi.length, horas: somaHoras(backlogKpi) },
      atrasadas: { quantidade: atrasadasKpi.length, horas: somaHoras(atrasadasKpi) },
      concluidas: { quantidade: concluidasKpi.length, horas: somaHoras(concluidasKpi) },
    };

    const rows = visiveis
      .filter((item) => filtroDepexe === null || item.depexe === filtroDepexe)
      .filter((item) => filtroColunaId === null || item.colunaId === filtroColunaId)
      .filter((item) => filtroPripro === null || item.pripro === filtroPripro)
      .filter((item) => filtroCodfor === null || item.codfor === filtroCodfor)
      .filter((item) => !somenteAtrasadas || item.atrasada)
      .filter((item) => !busca || item.cliente.toLowerCase().includes(busca) || String(item.codpro).includes(busca))
      .filter((item) => {
        if (situacao === "backlog") return !item.coluna?.ehFinal;
        if (situacao === "atrasadas") return item.atrasada;
        if (situacao === "concluidas") return !!item.coluna?.ehFinal;
        return true;
      });

    const total = rows.length;
    const rowsPagina =
      page !== null && pageSize !== null ? rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : rows;

    res.json({
      rows: rowsPagina,
      total,
      kpis,
      contexto: {
        role,
        departamentosGerenciados: contexto.departamentosGerenciados,
        departamentosTime: contexto.departamentosTime,
      },
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

atividadesRouter.patch("/:id/mover", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const colunaIdNovo = Number(req.body?.colunaId);
    if (!Number.isFinite(colunaIdNovo)) {
      res.status(400).json({ error: "colunaId é obrigatório" });
      return;
    }

    const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
    if (!atividade) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }

    const colunaNova = await prisma.quadroColuna.findUnique({ where: { id: colunaIdNovo } });
    if (!colunaNova) {
      res.status(400).json({ error: "Coluna não encontrada" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({
      where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
    });
    if (!item || item.depexe == null) {
      res.status(400).json({ error: "Item de proposta correspondente não encontrado" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "mover", { depexe: item.depexe, codfor: atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para mover esta atividade" });
      return;
    }

    // Sessão de execução: sair de qualquer coluna fecha a sessão aberta (se houver);
    // entrar numa coluna marcada como "em execução" abre uma nova. O mesmo instante é
    // usado pros dois lados pra não deixar brecha/sobreposição entre fechar e abrir.
    const agora = new Date();
    const operacoes = [
      prisma.atividadeConsultor.update({ where: { id }, data: { colunaId: colunaIdNovo } }),
      prisma.atividadeHistoricoMovimentacao.create({
        data: {
          atividadeId: id,
          colunaAnteriorId: atividade.colunaId,
          colunaNovaId: colunaIdNovo,
          userId: user.id,
        },
      }),
      prisma.atividadeSessaoExecucao.updateMany({
        where: { atividadeId: id, fim: null },
        data: { fim: agora },
      }),
      ...(colunaNova.contaComoExecucao
        ? [
            prisma.atividadeSessaoExecucao.create({
              data: { atividadeId: id, colunaId: colunaIdNovo, inicio: agora, origem: "movimentacao_kanban" },
            }),
          ]
        : []),
    ];
    await prisma.$transaction(operacoes);

    // Automação: coluna marcada pra notificar o(s) Líder(es) Técnico(s) do departamento.
    if (colunaNova.notificarGestor) {
      const mensagem = `${user.nome} moveu a atividade da proposta ${atividade.codpro} para "${colunaNova.nome}"`;
      await notificarGestoresDoDepartamento(atividade.codemp, item.depexe, "atividade_movida", mensagem, id, user.id);
    }

    // Só enfileira pra sincronizar de volta pro Senior se a atividade já veio do ERP
    // (tem seqati) — sem isso não existe registro lá pra atualizar.
    if (atividade.seqati != null) {
      await enfileirar(id, "mover_coluna", {
        seqati: atividade.seqati.toString(),
        colunaAnteriorId: atividade.colunaId,
        colunaNovaId: colunaIdNovo,
        colunaNovaNome: colunaNova.nome,
      });
    }

    res.json({ id, colunaId: colunaIdNovo });
  } catch (error) {
    handleError(res, error, "mover");
  }
});

// ---------- Planejamento (datas previstas de início/fim, pra Timeline/Gantt) ----------
atividadesRouter.patch("/:id/planejamento", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para editar o planejamento desta atividade" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    const atualizada = await prisma.atividadeConsultor.update({
      where: { id },
      data: { dataPrevistaInicio, dataPrevistaFim },
    });

    res.json({
      id: atualizada.id,
      dataPrevistaInicio: atualizada.dataPrevistaInicio,
      dataPrevistaFim: atualizada.dataPrevistaFim,
    });
  } catch (error) {
    handleError(res, error, "planejamento");
  }
});

// ---------- Histórico de movimentação ----------
atividadesRouter.get("/:id/historico", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "visualizar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para ver esta atividade" });
      return;
    }

    const historico = await prisma.atividadeHistoricoMovimentacao.findMany({
      where: { atividadeId: id },
      orderBy: { movidoEm: "asc" },
      include: { colunaAnterior: true, colunaNova: true, user: { select: { nome: true } } },
    });

    res.json({
      historico: historico.map((h) => ({
        id: h.id,
        colunaAnteriorNome: h.colunaAnterior?.nome ?? null,
        colunaNovaNome: h.colunaNova.nome,
        userNome: h.user?.nome ?? "Usuário removido",
        movidoEm: h.movidoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "historico");
  }
});

// ---------- Comentários ----------
atividadesRouter.get("/:id/comentarios", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "visualizar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para ver esta atividade" });
      return;
    }

    const comentarios = await prisma.atividadeComentario.findMany({
      where: { atividadeId: id },
      orderBy: { criadoEm: "asc" },
      include: { user: { select: { nome: true } } },
    });

    res.json({
      comentarios: comentarios.map((c) => ({
        id: c.id,
        texto: c.texto,
        autorNome: c.user?.nome ?? "Usuário removido",
        criadoEm: c.criadoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "comentarios-listar");
  }
});

atividadesRouter.post("/:id/comentarios", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
    if (!texto) {
      res.status(400).json({ error: "Texto do comentário é obrigatório" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para comentar nesta atividade" });
      return;
    }

    const comentario = await prisma.atividadeComentario.create({
      data: { atividadeId: id, userId: ctx.user.id, texto },
      include: { user: { select: { nome: true } } },
    });

    // Notifica o consultor responsável pela atividade, se alguém além dele comentou.
    const consultorResponsavel = await prisma.consultor.findFirst({
      where: { codemp: resolvido.atividade.codemp, codfor: resolvido.atividade.codfor },
    });
    if (consultorResponsavel?.email) {
      const usuarioResponsavel = await prisma.user.findFirst({
        where: { email: { equals: consultorResponsavel.email, mode: "insensitive" } },
      });
      if (usuarioResponsavel && usuarioResponsavel.id !== ctx.user.id) {
        await criarNotificacao(
          usuarioResponsavel.id,
          "novo_comentario",
          `${ctx.user.nome} comentou na atividade da proposta ${resolvido.atividade.codpro}`,
          id
        );
      }
    }

    res.status(201).json({
      comentario: {
        id: comentario.id,
        texto: comentario.texto,
        autorNome: comentario.user?.nome ?? "Usuário removido",
        criadoEm: comentario.criadoEm,
      },
    });
  } catch (error) {
    handleError(res, error, "comentarios-criar");
  }
});

// ---------- Checklist ----------
atividadesRouter.get("/:id/checklist", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "visualizar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para ver esta atividade" });
      return;
    }

    const itens = await prisma.atividadeChecklistItem.findMany({
      where: { atividadeId: id },
      orderBy: [{ ordem: "asc" }, { id: "asc" }],
    });

    res.json({ itens });
  } catch (error) {
    handleError(res, error, "checklist-listar");
  }
});

atividadesRouter.post("/:id/checklist", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
    if (!texto) {
      res.status(400).json({ error: "Texto do item é obrigatório" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para editar o checklist desta atividade" });
      return;
    }

    const maiorOrdem = await prisma.atividadeChecklistItem.aggregate({
      where: { atividadeId: id },
      _max: { ordem: true },
    });

    const item = await prisma.atividadeChecklistItem.create({
      data: { atividadeId: id, texto, ordem: (maiorOrdem._max.ordem ?? 0) + 1 },
    });

    res.status(201).json({ item });
  } catch (error) {
    handleError(res, error, "checklist-criar");
  }
});

atividadesRouter.patch("/:id/checklist/:itemId", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(id) || !Number.isFinite(itemId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para editar o checklist desta atividade" });
      return;
    }

    const concluido = Boolean(req.body?.concluido);
    const item = await prisma.atividadeChecklistItem.update({
      where: { id: itemId },
      data: { concluido, concluidoEm: concluido ? new Date() : null },
    });

    res.json({ item });
  } catch (error) {
    handleError(res, error, "checklist-atualizar");
  }
});

atividadesRouter.delete("/:id/checklist/:itemId", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(id) || !Number.isFinite(itemId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para editar o checklist desta atividade" });
      return;
    }

    await prisma.atividadeChecklistItem.delete({ where: { id: itemId } });
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "checklist-excluir");
  }
});

// ---------- Anexos ----------
atividadesRouter.get("/:id/anexos", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "visualizar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para ver esta atividade" });
      return;
    }

    const anexos = await prisma.atividadeAnexo.findMany({
      where: { atividadeId: id },
      orderBy: { criadoEm: "asc" },
      include: { user: { select: { nome: true } } },
    });

    res.json({
      anexos: anexos.map((a) => ({
        id: a.id,
        nomeArquivo: a.nomeArquivo,
        tamanhoBytes: a.tamanhoBytes,
        mimeType: a.mimeType,
        autorNome: a.user?.nome ?? "Usuário removido",
        criadoEm: a.criadoEm,
      })),
    });
  } catch (error) {
    handleError(res, error, "anexos-listar");
  }
});

atividadesRouter.post("/:id/anexos", upload.single("arquivo"), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Arquivo é obrigatório" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      fs.unlink(req.file.path, () => {});
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      fs.unlink(req.file.path, () => {});
      res.status(403).json({ error: "Sem permissão para anexar arquivos nesta atividade" });
      return;
    }

    const anexo = await prisma.atividadeAnexo.create({
      data: {
        atividadeId: id,
        userId: ctx.user.id,
        nomeArquivo: req.file.originalname,
        caminhoArquivo: req.file.filename,
        tamanhoBytes: req.file.size,
        mimeType: req.file.mimetype,
      },
    });

    res.status(201).json({
      anexo: {
        id: anexo.id,
        nomeArquivo: anexo.nomeArquivo,
        tamanhoBytes: anexo.tamanhoBytes,
        mimeType: anexo.mimeType,
        autorNome: ctx.user.nome,
        criadoEm: anexo.criadoEm,
      },
    });
  } catch (error) {
    handleError(res, error, "anexos-criar");
  }
});

atividadesRouter.get("/:id/anexos/:anexoId/download", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const anexoId = Number(req.params.anexoId);
    if (!Number.isFinite(id) || !Number.isFinite(anexoId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "visualizar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para ver esta atividade" });
      return;
    }

    const anexo = await prisma.atividadeAnexo.findUnique({ where: { id: anexoId } });
    if (!anexo || anexo.atividadeId !== id) {
      res.status(404).json({ error: "Anexo não encontrado" });
      return;
    }

    const caminhoAbsoluto = path.join(UPLOADS_DIR, anexo.caminhoArquivo);
    res.download(caminhoAbsoluto, anexo.nomeArquivo);
  } catch (error) {
    handleError(res, error, "anexos-download");
  }
});

atividadesRouter.delete("/:id/anexos/:anexoId", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const anexoId = Number(req.params.anexoId);
    if (!Number.isFinite(id) || !Number.isFinite(anexoId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeExecutarAcao(ctx.role, ctx.contexto, "editar", { depexe: resolvido.depexe, codfor: resolvido.atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para excluir anexos desta atividade" });
      return;
    }

    const anexo = await prisma.atividadeAnexo.findUnique({ where: { id: anexoId } });
    if (!anexo || anexo.atividadeId !== id) {
      res.status(404).json({ error: "Anexo não encontrado" });
      return;
    }

    await prisma.atividadeAnexo.delete({ where: { id: anexoId } });
    fs.unlink(path.join(UPLOADS_DIR, anexo.caminhoArquivo), () => {});
    res.status(204).send();
  } catch (error) {
    handleError(res, error, "anexos-excluir");
  }
});
