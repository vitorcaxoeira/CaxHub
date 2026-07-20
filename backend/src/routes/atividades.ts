import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel, priproLabel, DEPEXE_LABELS, PRIPRO_LABELS } from "../domain/propostasDominio";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";

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
          select: { codemp: true, codpro: true, seqite: true, depexe: true },
        })
      : [];
  const depexePorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i.depexe]));

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
      const atrasada = !coluna?.ehFinal && proposta.datval != null && new Date(proposta.datval) < hoje;
      return {
        id: a.id,
        codemp: a.codemp,
        codpro: a.codpro,
        seqite: a.seqite,
        numprj: proposta.numprj,
        cliente: proposta.cliente.nomcli,
        pripro: proposta.pripro,
        priproLabel: priproLabel(proposta.pripro),
        datval: proposta.datval,
        depexe,
        depexeLabel: depexeLabel(depexe),
        consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${a.codfor}`,
        qtdhorPrevisto: a.qtdhor,
        colunaId: a.colunaId ?? primeiraColuna?.id ?? null,
        coluna,
        atrasada,
        podeMover: podeExecutarAcao(role, contexto, "mover", { depexe, codfor: a.codfor }),
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
    // comparado com o prazo (datval) da proposta. Sem histórico de movimentação
    // registrado, não dá pra saber quando foi concluída — fica fora da amostra do SLA.
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
      if (!concluidaEm || !v.datval) continue;
      slaAmostra += 1;
      if (concluidaEm <= new Date(v.datval)) slaDentroPrazo += 1;
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

    res.json({
      totalBacklog,
      horasBacklog,
      totalAtrasadas,
      pctAtrasadas,
      slaPct,
      slaAmostra,
      porSituacao: [...porSituacaoMap.values()],
      porDepartamento: [...porDepartamentoMap.values()].sort((a, b) => b.qtd - a.qtd),
    });
  } catch (error) {
    handleError(res, error, "indicadores");
  }
});

atividadesRouter.get("/opcoes-filtro", (_req, res) => {
  const departamentos = Object.entries(DEPEXE_LABELS)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((a, b) => a.value - b.value);
  const prioridades = Object.entries(PRIPRO_LABELS)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((a, b) => a.value - b.value);
  res.json({ departamentos, prioridades });
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
    const somenteAtrasadas = req.query.atrasada === "true";
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().toLowerCase() : "";
    const page = parseIntParam(req.query.page);
    const pageSize = parseIntParam(req.query.pageSize);

    const visiveis = await carregarAtividadesVisiveis(role, contexto);

    const rows = visiveis
      .filter((item) => filtroDepexe === null || item.depexe === filtroDepexe)
      .filter((item) => filtroColunaId === null || item.colunaId === filtroColunaId)
      .filter((item) => filtroPripro === null || item.pripro === filtroPripro)
      .filter((item) => !somenteAtrasadas || item.atrasada)
      .filter((item) => !busca || item.cliente.toLowerCase().includes(busca) || String(item.codpro).includes(busca));

    const total = rows.length;
    const rowsPagina =
      page !== null && pageSize !== null ? rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : rows;

    res.json({
      rows: rowsPagina,
      total,
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

    const [atividadeAtualizada] = await prisma.$transaction([
      prisma.atividadeConsultor.update({ where: { id }, data: { colunaId: colunaIdNovo } }),
      prisma.atividadeHistoricoMovimentacao.create({
        data: {
          atividadeId: id,
          colunaAnteriorId: atividade.colunaId,
          colunaNovaId: colunaIdNovo,
          userId: user.id,
        },
      }),
    ]);

    res.json({ id: atividadeAtualizada.id, colunaId: atividadeAtualizada.colunaId });
  } catch (error) {
    handleError(res, error, "mover");
  }
});
