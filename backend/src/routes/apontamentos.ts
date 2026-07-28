import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";
import { enfileirar } from "../sync/outboxSenior";

// Tela "Meus Apontamentos": o consultor revisa as sessões de execução que o sistema já
// rastreou (ver AtividadeSessaoExecucao / PATCH /atividades/:id/mover) e confirma —
// nesse momento vira um RatItem de verdade e entra na fila pro Senior. Sessão é a fonte
// da verdade do tempo trabalhado; RAT/IAT é só o formato de exportação.
export const apontamentosRouter = Router();
apontamentosRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[apontamentos:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

function minutosDesdeMeiaNoite(data: Date): number {
  return data.getHours() * 60 + data.getMinutes();
}

// Uma RAT Digitada por consultor+proposta — reaproveita se já existir uma (do CaxHub OU
// já confirmada no Senior, tanto faz) pra não gerar um documento por apontamento. Fica
// recebendo apontamentos de qualquer dia enquanto Digitada; depois de aprovada (PATCH
// /rats/:id/aprovar) ou aprovada direto no Senior (sync noturno atualiza sitrat aqui), o
// próximo apontamento pra essa mesma dupla consultor+proposta não encontra mais essa
// linha (sitrat != 9) e abre uma RAT nova — não há corte por dia. Importante: NÃO
// filtra por `origemCaxHub`/`numrat` — uma RAT real (já com número do Senior) que ainda
// esteja "Digitada" lá (documento existe, ainda não impresso/aprovado no ERP) é tão
// válida pra receber itens quanto uma criada pelo próprio CaxHub; filtrar só por
// origemCaxHub fazia todo apontamento novo criar uma RAT CaxHub paralela mesmo já
// existindo uma real digitada pra aquele consultor+proposta. `codfpj` é copiado da
// própria Proposta (mesmo valor que ela já guarda) — é o dado mais confiável disponível
// hoje pra esse campo, só usado quando é preciso CRIAR uma RAT nova. `depexe` vem do
// item que originou este apontamento — usado pra resolver "quem gerencia essa RAT"
// (mesma regra de podeExecutarAcao); se um consultor apontar em itens de departamentos
// diferentes na mesma proposta (raro), a RAT fica com o depexe do primeiro item, não
// resolvemos RAT multi-departamento nesta fase.
async function buscarOuCriarRatRascunho(
  atividade: { codemp: number; codpro: number },
  codfor: number,
  depexe: number,
  dataSessao: Date
) {
  const existente = await prisma.rat.findFirst({
    where: { sitrat: 9, codemp: atividade.codemp, codfor, codpro: atividade.codpro },
    orderBy: { id: "desc" },
  });
  if (existente) return existente;

  const proposta = await prisma.proposta.findUnique({
    where: { codemp_codpro: { codemp: atividade.codemp, codpro: atividade.codpro } },
  });

  return prisma.rat.create({
    data: {
      codemp: atividade.codemp,
      codfor,
      numprj: proposta?.numprj ?? null,
      codfpj: proposta?.codfpj ?? null,
      codpro: atividade.codpro,
      codcli: proposta?.codcli ?? null,
      datemi: new Date(dataSessao.toDateString()),
      sitrat: 9, // Digitado — rascunho local, ainda não confirmado no Senior
      depexe,
      origemCaxHub: true,
    },
  });
}

interface AjustesConfirmacao {
  ajusteInicio?: string;
  ajusteFim?: string;
  descricao?: string;
}

// Núcleo compartilhado por POST /confirmar (sessão já existe, veio de movimentação de
// coluna) e POST /manual (sessão criada na hora) — confirmar é sempre: validar RBAC,
// resolver/criar o Rat do dia, criar o RatItem, marcar a sessão e enfileirar pro Senior.
async function confirmarSessao(
  sessaoId: number,
  ajustes: AjustesConfirmacao,
  ctx: NonNullable<Awaited<ReturnType<typeof contextoDoUsuario>>>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { contexto, role } = ctx;

  const sessao = await prisma.atividadeSessaoExecucao.findUnique({
    where: { id: sessaoId },
    include: { atividade: true },
  });
  if (!sessao) return { status: 404, body: { error: "Sessão não encontrada" } };
  if (sessao.confirmada) return { status: 400, body: { error: "Sessão já confirmada" } };
  if (sessao.fim == null) return { status: 400, body: { error: "Sessão ainda em andamento" } };

  const atividade = sessao.atividade;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) {
    return { status: 400, body: { error: "Item de proposta correspondente não encontrado" } };
  }
  if (!podeExecutarAcao(role, contexto, "lancarApontamento", { depexe: item.depexe, codfor: atividade.codfor })) {
    return { status: 403, body: { error: "Sem permissão para lançar apontamento nesta atividade" } };
  }
  // Sem seqati (atividade ainda não confirmada pelo Senior) também pode virar
  // apontamento — RatItem.seqati fica null nesse caso, sem bloquear o fluxo.

  const inicio = ajustes.ajusteInicio ? new Date(ajustes.ajusteInicio) : sessao.inicio;
  const fim = ajustes.ajusteFim ? new Date(ajustes.ajusteFim) : sessao.fim;
  if (!(fim.getTime() > inicio.getTime())) {
    return { status: 400, body: { error: "O fim precisa ser depois do início" } };
  }

  const rat = await buscarOuCriarRatRascunho(atividade, atividade.codfor, item.depexe, inicio);
  const ratNovo = rat.origemCaxHub && rat.numrat == null;

  const ratItem = await prisma.ratItem.create({
    data: {
      ratId: rat.id,
      codemp: atividade.codemp,
      numprj: rat.numprj,
      codpro: atividade.codpro,
      seqite: atividade.seqite,
      codfas: atividade.fasid,
      seqati: atividade.seqati,
      datati: new Date(inicio.toDateString()),
      horini: minutosDesdeMeiaNoite(inicio),
      horfim: minutosDesdeMeiaNoite(fim),
      // Sem fallback pro despro do item de propósito: a RAT só pode ser aprovada quando
      // TODO item tiver observação preenchida (ver PATCH /rats/:id/aprovar) — se
      // caísse pro despro genérico automaticamente, esse gate nunca bloquearia nada de
      // verdade. A descrição do item continua visível na tela como contexto à parte.
      desati: ajustes.descricao?.trim() || null,
      origemCaxHub: true,
    },
  });

  await prisma.atividadeSessaoExecucao.update({
    where: { id: sessaoId },
    data: { confirmada: true, ratItemId: ratItem.id },
  });

  await enfileirar(atividade.id, "criar_apontamento", {
    ratItemId: ratItem.id,
    ratId: rat.id,
    seqati: atividade.seqati?.toString() ?? null,
    codemp: atividade.codemp,
    codpro: atividade.codpro,
    seqite: atividade.seqite,
    codfas: atividade.fasid,
    datati: ratItem.datati,
    horini: ratItem.horini,
    horfim: ratItem.horfim,
    desati: ratItem.desati,
    ratNovo,
    codfor: rat.codfor,
    codcli: rat.codcli,
    depexe: item.depexe,
  });

  return { status: 201, body: { ratItemId: ratItem.id, ratId: rat.id } };
}

// Atividades do próprio consultor logado, já confirmadas pelo Senior (seqati != null,
// exigido por confirmarSessao) — alimenta o select do apontamento manual.
apontamentosRouter.get("/minhas-atividades", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.json({ atividades: [] });
      return;
    }

    const atividades = await prisma.atividadeConsultor.findMany({
      where: { codfor, sitreg: "A", seqati: { not: null } },
      orderBy: { id: "desc" },
    });
    const chavesItem = atividades.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite }));
    const itens = chavesItem.length > 0 ? await prisma.propostaItem.findMany({ where: { OR: chavesItem } }) : [];
    const itemPorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i]));

    res.json({
      atividades: atividades.map((a) => {
        const item = itemPorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`);
        return {
          id: a.id,
          codpro: a.codpro,
          itemDescricao: item?.despro ?? null,
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "minhas-atividades");
  }
});

// Sessões fechadas (fim != null) e ainda não confirmadas das atividades do consultor
// logado — o que aparece na tela pra revisão.
apontamentosRouter.get("/sessoes-pendentes", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.json({ sessoes: [] });
      return;
    }

    const sessoes = await prisma.atividadeSessaoExecucao.findMany({
      where: { fim: { not: null }, confirmada: false, atividade: { codfor, sitreg: "A" } },
      include: { atividade: true, coluna: true },
      orderBy: { id: "desc" },
    });

    const chavesProposta = [...new Set(sessoes.map((s) => `${s.atividade.codemp}-${s.atividade.codpro}`))];
    const propostas =
      chavesProposta.length > 0
        ? await prisma.proposta.findMany({
            where: { OR: chavesProposta.map((c) => ({ codemp: Number(c.split("-")[0]), codpro: Number(c.split("-")[1]) })) },
            include: { cliente: true },
          })
        : [];
    const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    const chavesItem = sessoes.map((s) => ({ codemp: s.atividade.codemp, codpro: s.atividade.codpro, seqite: s.atividade.seqite }));
    const itens = chavesItem.length > 0 ? await prisma.propostaItem.findMany({ where: { OR: chavesItem } }) : [];
    const itemPorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i]));

    res.json({
      sessoes: sessoes.map((s) => {
        const proposta = propostaPorChave.get(`${s.atividade.codemp}-${s.atividade.codpro}`);
        const item = itemPorChave.get(`${s.atividade.codemp}-${s.atividade.codpro}-${s.atividade.seqite}`);
        return {
          id: s.id,
          atividadeId: s.atividadeId,
          codpro: s.atividade.codpro,
          numprj: proposta?.numprj ?? null,
          cliente: proposta?.cliente.nomcli ?? null,
          codcli: proposta?.codcli ?? null,
          itemDescricao: item?.despro ?? null,
          seqite: s.atividade.seqite,
          colunaNome: s.coluna.nome,
          inicio: s.inicio,
          fim: s.fim,
          duracaoMinutos: s.fim ? Math.round((s.fim.getTime() - s.inicio.getTime()) / 60000) : 0,
          origem: s.origem,
          observacao: s.observacao,
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "sessoes-pendentes");
  }
});

apontamentosRouter.post("/confirmar", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.body?.sessaoId);
    if (!Number.isFinite(sessaoId)) {
      res.status(400).json({ error: "sessaoId é obrigatório" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { status, body } = await confirmarSessao(sessaoId, {
      ajusteInicio: req.body?.ajusteInicio,
      ajusteFim: req.body?.ajusteFim,
      descricao: req.body?.descricao,
    }, ctx);
    res.status(status).json(body);
  } catch (error) {
    handleError(res, error, "confirmar");
  }
});

// Fallback pra lançar tempo sem uma sessão automática correspondente (trabalho feito
// fora do CaxHub, ou esqueceu de mover o card) — cria a sessão já fechada e confirma
// no mesmo passo.
apontamentosRouter.post("/manual", async (req: AuthenticatedRequest, res) => {
  try {
    const atividadeId = Number(req.body?.atividadeId);
    const inicio = req.body?.inicio ? new Date(req.body.inicio) : null;
    const fim = req.body?.fim ? new Date(req.body.fim) : null;
    if (!Number.isFinite(atividadeId) || !inicio || !fim) {
      res.status(400).json({ error: "atividadeId, inicio e fim são obrigatórios" });
      return;
    }

    const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: atividadeId } });
    if (!atividade) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }

    const colunaAtual = atividade.colunaId
      ? await prisma.quadroColuna.findUnique({ where: { id: atividade.colunaId } })
      : await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
    if (!colunaAtual) {
      res.status(400).json({ error: "Quadro Kanban sem colunas configuradas" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.create({
      data: { atividadeId, colunaId: colunaAtual.id, inicio, fim, origem: "manual" },
    });

    const { status, body } = await confirmarSessao(sessao.id, { descricao: req.body?.descricao }, ctx);
    res.status(status).json(body);
  } catch (error) {
    handleError(res, error, "manual");
  }
});

// Edita a observação (RatItem.desati) de um apontamento já confirmado — é como o
// consultor preenche o que faltou pra RAT poder ser aprovada (ver PATCH
// /rats/:id/aprovar, que exige observação em todo item). Só o dono, só enquanto a RAT
// pai ainda está Digitada e o item ainda não foi confirmado no Senior — mesmos guards
// de DELETE /:id logo abaixo.
apontamentosRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.params.id);
    const desati = typeof req.body?.desati === "string" ? req.body.desati.trim() : "";
    if (!Number.isFinite(sessaoId) || !desati) {
      res.status(400).json({ error: "desati é obrigatório" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.findUnique({
      where: { id: sessaoId },
      include: { atividade: true, ratItem: { include: { rat: true } } },
    });
    if (!sessao || sessao.atividade.codfor !== codfor) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    if (!sessao.ratItem) {
      res.status(400).json({ error: "Sessão ainda não confirmada — nada a editar" });
      return;
    }
    if (sessao.ratItem.numrat != null) {
      res.status(400).json({ error: "Já confirmado no Senior — não é possível editar" });
      return;
    }
    if (sessao.ratItem.rat.sitrat !== 9) {
      res.status(400).json({ error: "A RAT deste apontamento não está mais Digitada — não é possível editar" });
      return;
    }

    await prisma.ratItem.update({ where: { id: sessao.ratItem.id }, data: { desati } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "editar-observacao");
  }
});

// Só desfaz enquanto o envio ainda está pendente — nunca depois de já ter ido/travado
// no Senior, pra não apagar algo que já pode existir do outro lado.
apontamentosRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.params.id);
    if (!Number.isFinite(sessaoId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.findUnique({
      where: { id: sessaoId },
      include: { atividade: true, ratItem: true },
    });
    if (!sessao || sessao.atividade.codfor !== codfor) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    if (!sessao.confirmada || !sessao.ratItem) {
      res.status(400).json({ error: "Sessão ainda não confirmada — nada a desfazer" });
      return;
    }
    if (sessao.ratItem.numrat != null) {
      res.status(400).json({ error: "Já confirmado no Senior — não é possível excluir" });
      return;
    }
    const pendencia = await prisma.sincronizacaoPendente.findFirst({
      where: { tipo: "criar_apontamento", atividadeId: sessao.atividadeId },
      orderBy: { id: "desc" },
    });
    if (pendencia && pendencia.status !== "pendente") {
      res.status(400).json({ error: "Envio já em andamento ou bloqueado — não é possível excluir" });
      return;
    }

    const ratItemId = sessao.ratItem.id;
    await prisma.atividadeSessaoExecucao.update({ where: { id: sessaoId }, data: { confirmada: false, ratItemId: null } });
    if (pendencia) await prisma.sincronizacaoPendente.delete({ where: { id: pendencia.id } });
    await prisma.ratItem.delete({ where: { id: ratItemId } });

    res.status(204).send();
  } catch (error) {
    handleError(res, error, "excluir");
  }
});
