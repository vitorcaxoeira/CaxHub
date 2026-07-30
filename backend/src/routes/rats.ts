import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";
import { sitratLabel, sitratTone } from "../domain/ratDominio";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdRat } from "../audit/identidadeEntidade";
import { enfileirar } from "../sync/outboxSenior";
import { runRatSyncPorNumrat } from "../sync/ratSync";
import { runRatItemSyncPorNumrat } from "../sync/ratItemSync";

// Tela "Meus Apontamentos": RATs agrupam os apontamentos (RatItem) de um consultor numa
// proposta. Visibilidade: consultor vê só as próprias RATs; gestor do departamento
// (Rat.depexe) vê as do time; admin vê tudo — mesma regra de podeExecutarAcao usada no
// resto do projeto (backend/src/domain/contextoProjeto.ts), aplicada por fora dela pra
// listagem (mais restrita que "visualizar": aqui um colega de time NÃO vê a RAT do
// outro, só o gestor/admin).
export const ratsRouter = Router();
ratsRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[rats:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

type Contexto = Awaited<ReturnType<typeof resolverContextoConsultor>>;

// RATs que o usuário pode ver: as próprias (por codfor) + as dos departamentos que
// gerencia (por Rat.depexe) — admin vê tudo, sem filtro.
async function ratsVisiveis(role: string, contexto: Contexto) {
  if (role === "admin") {
    return prisma.rat.findMany({ orderBy: { id: "desc" } });
  }
  const meuCodfor = contexto.consultor?.codfor ?? null;
  const or: Array<Record<string, unknown>> = [];
  if (meuCodfor != null) or.push({ codfor: meuCodfor });
  if (contexto.departamentosGerenciados.length > 0) or.push({ depexe: { in: contexto.departamentosGerenciados } });
  if (or.length === 0) return [];
  return prisma.rat.findMany({ where: { OR: or }, orderBy: { id: "desc" } });
}

function podeVerRat(role: string, contexto: Contexto, rat: { codfor: number; depexe: number | null }): boolean {
  if (role === "admin") return true;
  if (contexto.consultor?.codfor === rat.codfor) return true;
  return rat.depexe != null && contexto.departamentosGerenciados.includes(rat.depexe);
}

// GET / — lista de RATs visíveis, já com totais agregados por RAT (pra linha do
// acordeon; os itens em si só carregam sob demanda em GET /:id/itens).
ratsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    let rats = await ratsVisiveis(role, contexto);

    const codforFiltro = req.query.codfor != null ? Number(req.query.codfor) : null;
    if (codforFiltro != null && Number.isFinite(codforFiltro)) {
      rats = rats.filter((r) => r.codfor === codforFiltro);
    }

    // Join com Proposta/Cliente precisa vir ANTES da paginação — busca por cliente
    // depende desse dado pra filtrar o conjunto inteiro, não só a página atual.
    const chavesPropostaTodas = [...new Set(rats.filter((r) => r.codpro != null).map((r) => `${r.codemp}-${r.codpro}`))];
    const propostasTodas =
      chavesPropostaTodas.length > 0
        ? await prisma.proposta.findMany({
            where: {
              OR: chavesPropostaTodas.map((chave) => {
                const [codemp, codpro] = chave.split("-").map(Number);
                return { codemp, codpro };
              }),
            },
            include: { cliente: true },
          })
        : [];
    const propostaPorChave = new Map(propostasTodas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    // Busca livre: cliente (nome), número da proposta (codpro) ou número da RAT no
    // Senior (numrat) — mesmo padrão de busca por substring já usado em
    // GET /alocacao/propostas.
    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().toLowerCase() : "";
    if (busca) {
      rats = rats.filter((r) => {
        const proposta = r.codpro != null ? propostaPorChave.get(`${r.codemp}-${r.codpro}`) : undefined;
        const cliente = proposta ? `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}` : "";
        return (
          cliente.toLowerCase().includes(busca) ||
          String(r.codpro ?? "").includes(busca) ||
          String(r.numrat ?? "").includes(busca)
        );
      });
    }

    // Ordem pedida: 1) RATs que precisam ser confirmadas primeiro (sitrat=9/Digitado —
    // o resto das situações, já resolvidas, vem depois); 2) dentro de cada grupo, data
    // de emissão decrescente (mais recente primeiro); 3) número da proposta como
    // desempate final.
    rats.sort((a, b) => {
      const prioridadeA = a.sitrat === 9 ? 0 : 1;
      const prioridadeB = b.sitrat === 9 ? 0 : 1;
      if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;

      const dataA = a.datemi ? a.datemi.getTime() : -Infinity;
      const dataB = b.datemi ? b.datemi.getTime() : -Infinity;
      if (dataA !== dataB) return dataB - dataA;

      return (a.codpro ?? 0) - (b.codpro ?? 0);
    });

    const total = rats.length;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
    const inicioPagina = (page - 1) * pageSize;
    rats = rats.slice(inicioPagina, inicioPagina + pageSize);

    if (rats.length === 0) {
      res.json({ rats: [], total });
      return;
    }

    const codforsUnicos = [...new Set(rats.map((r) => r.codfor))];
    const consultores =
      codforsUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforsUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

    const ratIds = rats.map((r) => r.id);
    const todosItens = ratIds.length > 0 ? await prisma.ratItem.findMany({ where: { ratId: { in: ratIds } } }) : [];
    const itensPorRat = new Map<number, typeof todosItens>();
    for (const item of todosItens) {
      if (!itensPorRat.has(item.ratId)) itensPorRat.set(item.ratId, []);
      itensPorRat.get(item.ratId)!.push(item);
    }

    res.json({
      total,
      rats: rats.map((r) => {
        const proposta = r.codpro != null ? propostaPorChave.get(`${r.codemp}-${r.codpro}`) : undefined;
        const consultor = consultorPorCodfor.get(r.codfor);
        const itensDaRat = itensPorRat.get(r.id) ?? [];
        const totalMinutos = itensDaRat.reduce(
          (soma, item) => soma + (item.horini != null && item.horfim != null ? item.horfim - item.horini : 0),
          0
        );
        return {
          id: r.id,
          numrat: r.numrat,
          datemi: r.datemi,
          codemp: r.codemp,
          codpro: r.codpro,
          numprj: r.numprj,
          cliente: proposta ? `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}` : null,
          codfor: r.codfor,
          consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${r.codfor}`,
          sitrat: r.sitrat,
          sitratLabel: sitratLabel(r.sitrat),
          sitratTone: sitratTone(r.sitrat),
          totalItens: itensDaRat.length,
          totalMinutos,
          podeAprovar:
            r.sitrat === 9 && podeExecutarAcao(role, contexto, "aprovar", { depexe: r.depexe ?? -1, codfor: r.codfor }),
          todosComObservacao: itensDaRat.length > 0 && itensDaRat.every((item) => !!item.desati?.trim()),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// GET /opcoes-filtro — consultores distintos entre as RATs visíveis, pro seletor da
// tela (só faz diferença pra gestor/admin — consultor comum só vê a si mesmo).
ratsRouter.get("/opcoes-filtro", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const rats = await ratsVisiveis(ctx.role, ctx.contexto);
    const codforsUnicos = [...new Set(rats.map((r) => r.codfor))];
    const consultores =
      codforsUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforsUnicos } } }) : [];

    res.json({
      consultores: consultores
        .map((c) => ({ codfor: c.codfor as number, nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}` }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// GET /:id/itens — RatItem de uma RAT, carregado sob demanda ao expandir o acordeon.
ratsRouter.get("/:id/itens", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    const rat = await prisma.rat.findUnique({ where: { id } });
    if (!rat || !podeVerRat(role, contexto, rat)) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }

    const itens = await prisma.ratItem.findMany({ where: { ratId: id }, include: { sessoes: true }, orderBy: { id: "asc" } });

    const chavesItem = itens
      .filter((i): i is typeof i & { seqite: number } => i.seqite != null && i.codpro != null)
      .map((i) => ({ codemp: i.codemp, codpro: i.codpro!, seqite: i.seqite }));
    const propostaItens = chavesItem.length > 0 ? await prisma.propostaItem.findMany({ where: { OR: chavesItem } }) : [];
    const itemPorChave = new Map(propostaItens.map((pi) => [`${pi.codemp}-${pi.codpro}-${pi.seqite}`, pi]));

    const souDono = contexto.consultor?.codfor === rat.codfor;

    // Estado do envio ao Senior, pra tela conseguir explicar por que um item deixou de
    // ser editável (ver sync/outboxSenior.ts). A fila é indexada por atividade, e o
    // apontamento correspondente vive dentro do payload — daí o casamento em memória.
    const atividadeIds = [...new Set(itens.map((i) => i.sessoes[0]?.atividadeId).filter((v): v is number => v != null))];
    const pendencias =
      atividadeIds.length > 0
        ? await prisma.sincronizacaoPendente.findMany({
            where: { tipo: "criar_apontamento", atividadeId: { in: atividadeIds } },
            orderBy: { id: "desc" },
          })
        : [];
    const envioPorRatItem = new Map<number, { status: string; erro: string | null }>();
    for (const pendencia of pendencias) {
      const ratItemId = Number((pendencia.payload as { ratItemId?: number })?.ratItemId);
      // orderBy id desc + "só o primeiro vence" = fica o envio mais recente de cada item.
      if (Number.isFinite(ratItemId) && !envioPorRatItem.has(ratItemId)) {
        envioPorRatItem.set(ratItemId, { status: pendencia.status, erro: pendencia.ultimoErro });
      }
    }

    res.json({
      itens: itens.map((item) => {
        const propostaItem =
          item.seqite != null && item.codpro != null ? itemPorChave.get(`${item.codemp}-${item.codpro}-${item.seqite}`) : undefined;
        return {
          id: item.id,
          sessaoId: item.sessoes[0]?.id ?? null,
          atividadeId: item.sessoes[0]?.atividadeId ?? null,
          codser: propostaItem?.codser ?? null,
          itemDescricao: propostaItem?.despro ?? null,
          datati: item.datati,
          horini: item.horini,
          horfim: item.horfim,
          duracaoMinutos: item.horini != null && item.horfim != null ? item.horfim - item.horini : null,
          desati: item.desati,
          confirmadoNoSenior: item.numrat != null,
          editavel: souDono && item.numrat == null && rat.sitrat === 9,
          // Identidade atribuída pelo Senior — só existe depois do registro.
          numrat: item.numrat,
          seqrat: item.seqrat,
          // pendente | enviando | enviado | bloqueado | null (sem registro na fila).
          envioStatus: envioPorRatItem.get(item.id)?.status ?? null,
          // Motivo da última recusa do Senior, quando houve — é o que a tela mostra no
          // hover de "falha no envio".
          envioErro: envioPorRatItem.get(item.id)?.erro ?? null,
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "itens");
  }
});

// PATCH /:id/aprovar — só gestor do departamento da RAT (Rat.depexe) ou admin, só
// enquanto Digitada, só com observação preenchida em todo item. Muda sitrat só dentro
// do CaxHub — não há canal de escrita de volta pro Senior ainda (ver ratSync.ts).
ratsRouter.patch("/:id/aprovar", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    const rat = await prisma.rat.findUnique({ where: { id } });
    if (!rat) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }
    if (!podeExecutarAcao(role, contexto, "aprovar", { depexe: rat.depexe ?? -1, codfor: rat.codfor })) {
      res.status(403).json({ error: "Sem permissão para aprovar esta RAT" });
      return;
    }
    if (rat.sitrat !== 9) {
      res.status(400).json({ error: "Só é possível aprovar uma RAT que esteja Digitada" });
      return;
    }

    const itens = await prisma.ratItem.findMany({ where: { ratId: id }, include: { sessoes: true } });
    if (itens.length === 0) {
      res.status(400).json({ error: "RAT sem nenhum item — nada a aprovar" });
      return;
    }
    const semObservacao = itens.filter((item) => !item.desati?.trim());
    if (semObservacao.length > 0) {
      res.status(400).json({
        error: `${semObservacao.length} item(ns) sem observação preenchida — preencha antes de aprovar`,
      });
      return;
    }

    const atualizado = await prisma.rat.update({ where: { id }, data: { sitrat: 6 } });

    // Mesma lógica de confirmarSessao (backend/src/routes/apontamentos.ts): enfileira
    // no outbox pro Senior, 1 item por RatItem — aprovar a RAT é o gatilho de envio,
    // não a confirmação individual do apontamento. Não mexe em Proposta.sitpro em
    // nenhum momento (esta rota só lê/escreve Rat e RatItem).
    let itensEnfileirados = 0;
    for (const item of itens) {
      const atividadeId = item.sessoes[0]?.atividadeId;
      if (atividadeId == null) continue;
      await enfileirar(atividadeId, "aprovar_rat", {
        ratId: rat.id,
        ratItemId: item.id,
        numrat: rat.numrat,
        seqati: item.seqati?.toString() ?? null,
        codemp: item.codemp,
        codpro: item.codpro,
        seqite: item.seqite,
        codfas: item.codfas,
        datati: item.datati,
        horini: item.horini,
        horfim: item.horfim,
        desati: item.desati,
        codfor: rat.codfor,
        codcli: rat.codcli,
        depexe: rat.depexe,
      });
      itensEnfileirados += 1;
    }

    await criarEventoAuditoria({
      origem: "tela",
      usuarioId: req.user!.userId,
      codemp: rat.codemp,
      codpro: rat.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.RAT,
      entidadeId: entidadeIdRat(rat.id),
      entidadeRotulo: `RAT ${rat.id} — Proposta ${rat.codemp}/${rat.codpro ?? "?"}`,
      eventoTipo: EVENTOS_AUDITORIA.RAT_APROVADA,
      alteracoes: { sitrat: { de: 9, para: 6, rotulo: "Situação" } },
      metadata: { itensEnfileirados },
      correlationId: req.correlationId!,
    });

    res.json({ sitrat: atualizado.sitrat, sitratLabel: sitratLabel(atualizado.sitrat) });
  } catch (error) {
    handleError(res, error, "aprovar");
  }
});

// Apontamentos que TINHAM identidade no Senior mas não voltaram na consulta = foram
// apagados lá. Aqui a lógica é oposta à de Pedidos (onde sumir do ERP vira "removido" e a
// linha desaparece das telas): o apontamento é um registro de trabalho que aconteceu de
// verdade, nascido no CaxHub, então o local é a fonte da verdade. Some do ERP, o certo é
// **desvincular** (limpar numrat/seqrat) pra poder reintegrar, nunca apagar.
//
// Nada é reenviado automaticamente: a exclusão pode ter sido intencional do outro lado,
// então quem decide é o consultor, pelo botão "Enviar" que reaparece na linha.
async function desvincularItensAusentesNoSenior(
  rat: { id: number; codemp: number; codpro: number | null; numrat: number | null },
  seqratsNoSenior: number[],
  req: AuthenticatedRequest
): Promise<number[]> {
  const ausentes = await prisma.ratItem.findMany({
    where: {
      ratId: rat.id,
      numrat: { not: null },
      // Lista vazia (nenhum item voltou) tem que significar "todos ausentes" — por isso o
      // notIn só entra quando há algo pra excluir da busca.
      seqrat: seqratsNoSenior.length > 0 ? { not: null, notIn: seqratsNoSenior } : { not: null },
    },
    select: { id: true, seqrat: true },
  });
  if (ausentes.length === 0) return [];

  const seqrats = ausentes.map((i) => i.seqrat as number);
  const ids = ausentes.map((i) => i.id);

  await prisma.$transaction([
    prisma.ratItem.updateMany({
      where: { id: { in: ids } },
      // datreg também sai: era a data de registro NO SENIOR, e esse registro não existe mais.
      data: { numrat: null, seqrat: null, datreg: null },
    }),
    criarEventoAuditoria({
      origem: "tela",
      usuarioId: req.user!.userId,
      codemp: rat.codemp,
      codpro: rat.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.RAT,
      entidadeId: entidadeIdRat(rat.id),
      entidadeRotulo: `RAT ${rat.numrat}`,
      eventoTipo: EVENTOS_AUDITORIA.RAT_ITEM_DESVINCULADO_SENIOR,
      alteracoes: null,
      metadata: { seqratsDesvinculados: seqrats, ratItemIds: ids },
      correlationId: req.correlationId!,
    }),
  ]);

  // A pendência de envio antiga ficou obsoleta: ela diz "enviado", mas o registro que ela
  // criou não existe mais no ERP. Removê-la devolve o apontamento ao estado limpo de
  // "confirmado localmente, nunca enviado" — o que também destrava o Excluir, que recusa
  // desfazer quando existe pendência em qualquer status diferente de "pendente".
  const atividadesDosItens = await prisma.atividadeSessaoExecucao.findMany({
    where: { ratItemId: { in: ids } },
    select: { atividadeId: true, ratItemId: true },
  });
  for (const sessao of atividadesDosItens) {
    const pendencias = await prisma.sincronizacaoPendente.findMany({
      where: { tipo: "criar_apontamento", atividadeId: sessao.atividadeId },
    });
    const obsoletas = pendencias.filter((p) => Number((p.payload as { ratItemId?: number })?.ratItemId) === sessao.ratItemId);
    if (obsoletas.length > 0) {
      await prisma.sincronizacaoPendente.deleteMany({ where: { id: { in: obsoletas.map((p) => p.id) } } });
    }
  }

  return seqrats;
}

// POST /:id/sincronizar — "Sinc. ERP": puxa de novo o cabeçalho e os itens dessa RAT
// específica do Senior (filtrado por numrat, ver runRatSyncPorNumrat/
// runRatItemSyncPorNumrat), pra quando o consultor sabe que algo mudou lá e não quer
// esperar o job noturno. Só disponível depois que a RAT tem numrat (documento já
// confirmado no Senior) — mesma visibilidade de GET /:id/itens, não fica restrito a
// gestor/admin porque é uma ação só de leitura (atualiza o espelho local, não escreve
// nada no Senior).
ratsRouter.post("/:id/sincronizar", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    const rat = await prisma.rat.findUnique({ where: { id } });
    if (!rat || !podeVerRat(role, contexto, rat)) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }
    if (rat.numrat == null) {
      res.status(400).json({ error: "Esta RAT ainda não tem número do ERP — nada pra sincronizar" });
      return;
    }

    let seqratsNoSenior: number[];
    try {
      await runRatSyncPorNumrat(rat.codemp, rat.numrat);
      seqratsNoSenior = await runRatItemSyncPorNumrat(rat.codemp, rat.numrat);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      res.status(502).json({ error: `Falha ao sincronizar com o ERP: ${message}` });
      return;
    }

    const desvinculados = await desvincularItensAusentesNoSenior(rat, seqratsNoSenior, req);

    res.json({ ok: true, desvinculados: desvinculados.length, seqratsDesvinculados: desvinculados });
  } catch (error) {
    handleError(res, error, "sincronizar");
  }
});
