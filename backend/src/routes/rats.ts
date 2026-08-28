import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, podeExecutarAcao, codforsDoTime } from "../domain/contextoProjeto";
import {
  sitratLabel,
  sitratTone,
  SITRAT_ORDER,
  calcularIntegracaoErp,
  integracaoErpLabel,
  integracaoErpTone,
  type IntegracaoErpStatus,
} from "../domain/ratDominio";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdRat } from "../audit/identidadeEntidade";
import { enfileirar, processarFilaSincronizacao, prepararReenvioItem } from "../sync/outboxSenior";
import { runRatSyncPorNumrat } from "../sync/ratSync";
import { runRatItemSyncPorNumrat } from "../sync/ratItemSync";
import {
  TIPDES_DESPESA_AVULSA,
  TIPDES_DESLOCAMENTO_ROTA,
  TIPDES_LABELS,
  MODDES_LABELS,
  tipdesLabel,
  moddesLabel,
  simNaoLabel,
} from "../domain/rdvDominio";

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

// Itens (campos mínimos) + status agregado de integração com o Senior de um conjunto de RATs.
// Extraído (28/08/2026) pra poder rodar em dois momentos diferentes de GET / conforme o filtro
// de integração está ativo ou não — ver comentário no handler. `select` explícito (não
// `include`) porque essa busca pode rodar sobre o conjunto INTEIRO de RATs visíveis (até
// dezenas de milhares em produção): buscar todas as colunas de RatItem + a relação `sessoes`
// inteira nesse volume é o que causava os 3+ segundos medidos antes desta correção — só os
// campos realmente lidos (numrat/horini/horfim pro total, desati pra "todosComObservacao",
// atividadeId pra achar a pendência).
async function buscarItensEIntegracao(ratIds: number[]) {
  const itens =
    ratIds.length > 0
      ? await prisma.ratItem.findMany({
          where: { ratId: { in: ratIds } },
          select: {
            id: true,
            ratId: true,
            numrat: true,
            horini: true,
            horfim: true,
            desati: true,
            sessoes: { select: { atividadeId: true } },
          },
        })
      : [];
  const itensPorRat = new Map<number, typeof itens>();
  for (const item of itens) {
    if (!itensPorRat.has(item.ratId)) itensPorRat.set(item.ratId, []);
    itensPorRat.get(item.ratId)!.push(item);
  }

  // Mesmo casamento em memória de GET /:id/itens: a fila é indexada por atividade, o
  // ratItemId correspondente vive dentro do payload. Só tipo "criar_apontamento" — RAT
  // aprovada também enfileira "aprovar_rat" (sem canal publicado, fica pendente pra sempre) e
  // contaminaria o agregado se entrasse aqui (ver comentário de calcularIntegracaoErp).
  const atividadeIds = [...new Set(itens.map((i) => i.sessoes[0]?.atividadeId).filter((v): v is number => v != null))];
  const pendencias =
    atividadeIds.length > 0
      ? await prisma.sincronizacaoPendente.findMany({
          where: { tipo: "criar_apontamento", atividadeId: { in: atividadeIds } },
          select: { atividadeId: true, status: true, ultimoErro: true, payload: true },
          orderBy: { id: "desc" },
        })
      : [];
  const pendenciaPorRatItem = new Map<number, { status: string; ultimoErro: string | null }>();
  for (const pendencia of pendencias) {
    const ratItemId = Number((pendencia.payload as { ratItemId?: number })?.ratItemId);
    if (Number.isFinite(ratItemId) && !pendenciaPorRatItem.has(ratItemId)) {
      pendenciaPorRatItem.set(ratItemId, { status: pendencia.status, ultimoErro: pendencia.ultimoErro });
    }
  }

  const integracaoPorRat = new Map<number, IntegracaoErpStatus>();
  for (const ratId of ratIds) {
    const itensDaRat = itensPorRat.get(ratId) ?? [];
    integracaoPorRat.set(
      ratId,
      calcularIntegracaoErp(itensDaRat.map((item) => ({ numrat: item.numrat, pendencia: pendenciaPorRatItem.get(item.id) })))
    );
  }

  return { itensPorRat, integracaoPorRat };
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

    // Lista separada por vírgula ("134,207") — o seletor da tela é multi-seleção. Number("")
    // é 0, não NaN, então sem a guarda de string vazia um filtro ausente viraria [0] e
    // esconderia todas as RATs. Mesmo padrão dos filtros de Mercado > Pedidos.
    const codforsFiltro = (typeof req.query.codfor === "string" ? req.query.codfor : "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v !== 0);
    if (codforsFiltro.length > 0) {
      rats = rats.filter((r) => codforsFiltro.includes(r.codfor));
    }

    // Filtro por situação da RAT (Rat.sitrat) — lista separada por vírgula, mesmo idioma
    // dos outros filtros multi-seleção. Sem custo nenhum: sitrat já vem no próprio `rat`,
    // nenhum join/query a mais. RAT sem situação (sitrat null) fica de fora sempre que o
    // filtro está ativo.
    const sitratFiltro = (typeof req.query.sitrat === "string" ? req.query.sitrat : "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v !== 0);
    if (sitratFiltro.length > 0) {
      rats = rats.filter((r) => r.sitrat != null && sitratFiltro.includes(r.sitrat));
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

    // Busca na observação dos itens (RatItem.desati) — separada da busca livre acima de
    // propósito: só dispara a query em RatItem quando o campo vem preenchido (28/08/2026,
    // mesmo cuidado de [[custo-condicional-ao-filtro-nao-ao-request]]); sem termo, este
    // bloco inteiro é pulado e GET /rats não ganha custo nenhum a mais. Opera sobre `rats`
    // já reduzido pelos filtros acima, então o alcance da query já sai proporcional ao que
    // sobrou, não ao total do sistema.
    const buscaItem = typeof req.query.buscaItem === "string" ? req.query.buscaItem.trim() : "";
    if (buscaItem) {
      const ratIdsCandidatos = rats.map((r) => r.id);
      const itensCorrespondentes =
        ratIdsCandidatos.length > 0
          ? await prisma.ratItem.findMany({
              where: { ratId: { in: ratIdsCandidatos }, desati: { contains: buscaItem, mode: "insensitive" } },
              select: { ratId: true },
            })
          : [];
      const ratIdsComItem = new Set(itensCorrespondentes.map((i) => i.ratId));
      rats = rats.filter((r) => ratIdsComItem.has(r.id));
    }

    // Filtro por situação de sincronização — lista separada por vírgula, mesmo idioma do
    // filtro de consultor acima (seletor multi-seleção na tela).
    const integracaoFiltro = (typeof req.query.integracao === "string" ? req.query.integracao : "")
      .split(",")
      .filter((v): v is IntegracaoErpStatus => (["sincronizado", "enviando", "falha", "pendente"] as string[]).includes(v));

    // Status de integração (28/08/2026): só busca pro conjunto INTEIRO (antes da paginação)
    // quando o filtro está de fato ativo — é o único caso em que precisa disso pra filtrar
    // certo. Sem filtro (o caso comum), fica pra depois da paginação, só com os itens da
    // página atual — mesmo custo de antes desta feature existir. Ver buscarItensEIntegracao
    // acima pro porquê do `select` explícito: em produção, "conjunto inteiro" pode ser dezenas
    // de milhares de RATs, e medimos 3+ segundos quando isso rodava sem essa guarda.
    let itensPorRat: Awaited<ReturnType<typeof buscarItensEIntegracao>>["itensPorRat"] = new Map();
    let integracaoPorRat: Awaited<ReturnType<typeof buscarItensEIntegracao>>["integracaoPorRat"] = new Map();
    if (integracaoFiltro.length > 0) {
      ({ itensPorRat, integracaoPorRat } = await buscarItensEIntegracao(rats.map((r) => r.id)));
      rats = rats.filter((r) => integracaoFiltro.includes(integracaoPorRat.get(r.id)!));
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

    // Caso comum (sem filtro de integração): a busca de itens/integração ainda não rodou —
    // faz agora, só pros ratIds da página atual (mesmo escopo de antes desta feature existir).
    if (integracaoFiltro.length === 0) {
      ({ itensPorRat, integracaoPorRat } = await buscarItensEIntegracao(rats.map((r) => r.id)));
    }

    const codforsUnicos = [...new Set(rats.map((r) => r.codfor))];
    const consultores =
      codforsUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforsUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

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
        const integracao = integracaoPorRat.get(r.id) ?? "pendente";
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
          integracao,
          integracaoLabel: integracaoErpLabel(integracao),
          integracaoTone: integracaoErpTone(integracao),
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

    // Restringe ao time: `Rat.depexe` é o departamento do ITEM que originou o apontamento
    // (ver buscarOuCriarRatRascunho), não o do consultor — então um consultor de fora do
    // time que trabalhe num item deste departamento tem RAT visível aqui e, sem esse
    // filtro, apareceria no seletor como se fosse do time. A visibilidade das RATs em si
    // não muda: como gestor do departamento, ele continua vendo o trabalho feito nos itens
    // dele. `null` = admin, sem restrição.
    const doTime = await codforsDoTime(ctx.role, ctx.contexto);
    const codforsUnicos = [...new Set(rats.map((r) => r.codfor))].filter((codfor) => doTime == null || doTime.has(codfor));
    const consultores =
      codforsUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforsUnicos } } }) : [];

    res.json({
      consultores: consultores
        .map((c) => ({ codfor: c.codfor as number, nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}` }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      // Situações da RAT (USU_LSITRAT) — enum fixo do domínio (ratDominio.ts), única fonte
      // do rótulo/ordem (mesma que já monta sitratLabel/sitratTone de cada linha da lista).
      situacoesRat: SITRAT_ORDER.map((sitrat) => ({ sitrat, label: sitratLabel(sitrat) })),
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
          // Sequência do item na proposta — exibida como prefixo da descrição na tela.
          seqite: item.seqite,
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
      // adiarEnvio: aprovar uma RAT com vários itens enfileira todos aqui — sem isso,
      // cada um dispararia o envio na hora e abriria N chamadas SOAP concorrentes. Uma
      // varredura só, depois do laço inteiro (mesmo padrão de POST /confirmar-lote em
      // routes/apontamentos.ts).
      await enfileirar(
        atividadeId,
        "aprovar_rat",
        {
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
        },
        { adiarEnvio: true }
      );
      itensEnfileirados += 1;
    }
    if (itensEnfileirados > 0) {
      processarFilaSincronizacao().catch((erro) => {
        console.error("[rats] envio em lote ao Senior falhou:", erro instanceof Error ? erro.message : erro);
      });
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

// Mesma lógica do desvincularItensAusentesNoSenior acima, mas pro CABEÇALHO: quando a RAT
// inteira não volta mais na consulta ao Senior (documento apagado/cancelado lá), limpar
// Rat.numrat pra permitir reintegrar — nunca apagar a linha local, ela é o registro do
// trabalho que aconteceu de verdade. `encontrouNoSenior` vem de runRatSyncPorNumrat (true =
// a consulta por numrat trouxe pelo menos 1 linha).
async function desvincularRatAusenteNoSenior(
  rat: { id: number; codemp: number; codpro: number | null; numrat: number | null },
  encontrouNoSenior: boolean,
  req: AuthenticatedRequest
): Promise<boolean> {
  if (encontrouNoSenior || rat.numrat == null) return false;

  const numratAnterior = rat.numrat;
  await prisma.$transaction([
    prisma.rat.update({ where: { id: rat.id }, data: { numrat: null } }),
    criarEventoAuditoria({
      origem: "tela",
      usuarioId: req.user!.userId,
      codemp: rat.codemp,
      codpro: rat.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.RAT,
      entidadeId: entidadeIdRat(rat.id),
      entidadeRotulo: `RAT ${numratAnterior}`,
      eventoTipo: EVENTOS_AUDITORIA.RAT_DESVINCULADA_SENIOR,
      alteracoes: { numrat: { de: numratAnterior, para: null, rotulo: "Nº no ERP" } },
      metadata: null,
      correlationId: req.correlationId!,
    }),
  ]);

  return true;
}

// POST /:id/sincronizar — "Sinc. ERP": reorganizada (28/08/2026) em duas fases.
//
// Fase 1 (existente) — puxa de novo o cabeçalho e os itens dessa RAT específica do Senior
// (filtrado por numrat, ver runRatSyncPorNumrat/runRatItemSyncPorNumrat), pra quando o
// consultor sabe que algo mudou lá e não quer esperar o job noturno. Só roda se a RAT já
// tem numrat (documento já confirmado no Senior) — uma RAT onde nenhum item nunca chegou a
// ser enviado com sucesso ainda não tem o que buscar, e isso deixou de ser erro (400): a
// fase só é pulada. Se o CABEÇALHO não voltar mais na consulta (RAT inteira apagada/
// cancelada no Senior), Rat.numrat é desvinculado (ver desvincularRatAusenteNoSenior) —
// mesmo espírito de desvincularItensAusentesNoSenior, que já cobria só os itens.
//
// Fase 2 (nova) — reenvia pro Senior todo item desta RAT que ainda não está lá: "falha"
// (pendência com erro, inclui bloqueado — reseta e tenta de novo) ou "pendente" (nunca
// enfileirado — nunca enviado, ou desvinculado pela fase 1 — enfileira agora). Item
// "enviando" de verdade (em voo, ou recém-enfileirado sem erro ainda) fica de fora: vai
// fluir sozinho no próximo ciclo da fila, reenviar aqui não ajudaria em nada. Aguardado
// (não fire-and-forget como o reenvio por item) — escopado só aos ids desta RAT via
// `apenasIds`, nunca a fila inteira do sistema (ver comentário em processarFilaSincronizacao).
//
// Mesma visibilidade de GET /:id/itens — não fica restrito a gestor/admin.
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

    let ratDesvinculada = false;
    let desvinculados: number[] = [];
    if (rat.numrat != null) {
      let encontrouCabecalho: boolean;
      let seqratsNoSenior: number[];
      try {
        encontrouCabecalho = await runRatSyncPorNumrat(rat.codemp, rat.numrat);
        seqratsNoSenior = await runRatItemSyncPorNumrat(rat.codemp, rat.numrat);
      } catch (syncError) {
        const message = syncError instanceof Error ? syncError.message : String(syncError);
        res.status(502).json({ error: `Falha ao sincronizar com o ERP: ${message}` });
        return;
      }

      // Ordem não importa entre as duas (mexem em campos/tabelas diferentes) — cabeçalho
      // primeiro só porque é a checagem "mais grave" (RAT inteira sumiu, não só um item).
      ratDesvinculada = await desvincularRatAusenteNoSenior(rat, encontrouCabecalho, req);
      desvinculados = await desvincularItensAusentesNoSenior(rat, seqratsNoSenior, req);
    }

    // Fase 2: recarrega os itens (pós fase 1, já refletindo qualquer desvinculação) + a
    // pendência mais recente de cada um — mesmo casamento em memória de GET /:id/itens.
    const itensDaRat = await prisma.ratItem.findMany({ where: { ratId: rat.id }, include: { rat: true, sessoes: true } });
    const atividadeIdsDaRat = [...new Set(itensDaRat.map((i) => i.sessoes[0]?.atividadeId).filter((v): v is number => v != null))];
    const pendenciasDaRat =
      atividadeIdsDaRat.length > 0
        ? await prisma.sincronizacaoPendente.findMany({
            where: { tipo: "criar_apontamento", atividadeId: { in: atividadeIdsDaRat } },
            orderBy: { id: "desc" },
          })
        : [];
    const pendenciaPorRatItem = new Map<number, (typeof pendenciasDaRat)[number]>();
    for (const pendencia of pendenciasDaRat) {
      const ratItemId = Number((pendencia.payload as { ratItemId?: number })?.ratItemId);
      if (Number.isFinite(ratItemId) && !pendenciaPorRatItem.has(ratItemId)) {
        pendenciaPorRatItem.set(ratItemId, pendencia);
      }
    }

    let itensReenviados = 0;
    const pendenciaIdsParaProcessar: number[] = [];
    for (const item of itensDaRat) {
      if (item.numrat != null) continue; // já sincronizado, nada a reenviar
      const pendencia = pendenciaPorRatItem.get(item.id);
      if (pendencia && !pendencia.ultimoErro) continue; // enviando de verdade, deixa fluir sozinho
      const resultado = await prepararReenvioItem(item, pendencia);
      if (resultado.ok) {
        pendenciaIdsParaProcessar.push(resultado.pendenciaId);
        itensReenviados += 1;
      }
    }
    if (pendenciaIdsParaProcessar.length > 0) {
      await processarFilaSincronizacao({ apenasIds: pendenciaIdsParaProcessar });
    }

    // Status agregado pós-tentativa, pra tela montar o aviso final sem precisar de mais uma
    // chamada — reaproveita o mesmo helper de GET / (buscarItensEIntegracao), escopado só a
    // esta RAT (conjunto de 1, sem custo de full-set nenhum).
    const { integracaoPorRat } = await buscarItensEIntegracao([rat.id]);
    const integracao = integracaoPorRat.get(rat.id) ?? "pendente";

    res.json({
      ok: true,
      ratDesvinculada,
      desvinculados: desvinculados.length,
      seqratsDesvinculados: desvinculados,
      itensReenviados,
      integracao,
      integracaoLabel: integracaoErpLabel(integracao),
      integracaoTone: integracaoErpTone(integracao),
    });
  } catch (error) {
    handleError(res, error, "sincronizar");
  }
});

// Lançamento de despesas de viagem restrito a admin por enquanto — a pedido do Vitor,
// enquanto o recurso ainda está em validação (nem todo consultor/gestor deve ver a ação
// ainda). Reavaliar pra abrir a dono/gestor da RAT quando o recurso for liberado geral.
function podeGerenciarDespesas(role: string): boolean {
  return role === "admin";
}

// Resolve a RAT e confere permissão — mesma regra de podeVerRat + a restrição a admin acima
// — compartilhada pelos 3 endpoints de despesa de viagem abaixo.
async function ratComPermissao(
  req: AuthenticatedRequest,
  res: import("express").Response,
  ratId: number
): Promise<import("@prisma/client").Rat | null> {
  const ctx = await contextoDoUsuario(req);
  if (!ctx) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return null;
  }
  if (!podeGerenciarDespesas(ctx.role)) {
    res.status(403).json({ error: "Lançamento de despesas de viagem disponível só para administradores por enquanto" });
    return null;
  }
  const rat = await prisma.rat.findUnique({ where: { id: ratId } });
  if (!rat || !podeVerRat(ctx.role, ctx.contexto, rat)) {
    res.status(404).json({ error: "RAT não encontrada" });
    return null;
  }
  return rat;
}

// GET /:id/despesas — despesas já lançadas na RAT + o que a tela precisa pra montar o
// formulário de lançamento (rotas ativas do cliente da RAT, opções de tipo/modalidade).
ratsRouter.get("/:id/despesas", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const rat = await ratComPermissao(req, res, id);
    if (!rat) return;

    const despesas =
      rat.numrat != null
        ? await prisma.registroDespesaViagem.findMany({
            where: { codemp: rat.codemp, numrat: rat.numrat },
            orderBy: [{ datemi: "asc" }, { id: "asc" }],
          })
        : [];
    const rotas =
      rat.codcli != null
        ? await prisma.rotaViagem.findMany({ where: { codcli: rat.codcli, sitreg: "A" }, orderBy: { desrot: "asc" } })
        : [];

    res.json({
      podeLancar: rat.numrat != null,
      despesas: despesas.map((d) => ({
        id: d.id,
        datemi: d.datemi,
        desrdv: d.desrdv,
        tipdes: d.tipdes,
        tipdesLabel: tipdesLabel(d.tipdes),
        moddesLabel: d.moddes != null ? moddesLabel(d.moddes) : null,
        qtdrdv: d.qtdrdv,
        vlrunt: d.vlrunt,
        vlrtot: d.vlrtot,
        hordes: d.hordes,
        fatrdvLabel: simNaoLabel(d.fatrdv),
        origemCaxHub: d.origemCaxHub,
        pendenteDeEnvio: d.origemCaxHub && d.enviadoEmSenior == null,
        podeExcluir: d.origemCaxHub && d.enviadoEmSenior == null,
      })),
      rotas: rotas.map((r) => ({
        id: r.id,
        desrot: r.desrot,
        kmtrot: r.kmtrot,
        horrot: r.horrot,
      })),
      opcoesTipo: TIPDES_DESPESA_AVULSA.map((t) => ({ value: t, label: TIPDES_LABELS[t] })),
      opcoesModalidade: Object.entries(MODDES_LABELS).map(([value, label]) => ({ value, label })),
    });
  } catch (error) {
    handleError(res, error, "despesas-listar");
  }
});

// POST /:id/despesas — lança despesa (aba "despesa") ou deslocamento por rota (aba
// "deslocamento"). Grava sempre local (origemCaxHub=true, seqrdv=null): o Senior não publica
// operação de gravação de RDV hoje (só alocarAtividades/getData/getPropostaItemDev/
// registrarAtividades) — quando publicar, um job varre origemCaxHub + enviadoEmSenior IS NULL
// e envia o acumulado, sem precisar redigitar nada.
ratsRouter.post("/:id/despesas", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const rat = await ratComPermissao(req, res, id);
    if (!rat) return;
    if (rat.numrat == null) {
      res.status(400).json({ error: "Esta RAT ainda não tem número do ERP — não é possível lançar despesa ainda" });
      return;
    }

    const aba = req.body?.aba === "deslocamento" ? "deslocamento" : "despesa";
    const datemi = req.body?.datemi ? new Date(req.body.datemi) : null;
    const vlrunt = Number(req.body?.vlrunt);
    if (!datemi || !Number.isFinite(datemi.getTime())) {
      res.status(400).json({ error: "Data é obrigatória" });
      return;
    }
    // `qtdrdv` é Int no banco (mesma coluna do Senior) — a Deslocamento pode chegar com o km
    // fracionado da rota (ex.: 239.1, pré-preenchido a partir de RotaViagem.kmtrot). Arredonda
    // ANTES de calcular vlrtot, senão o total gravado usaria o valor fracionado enquanto o
    // qtdrdv persistido seria truncado pelo Postgres — os dois ficariam inconsistentes.
    const qtdrdv = Math.round(Number(req.body?.qtdrdv));
    if (!Number.isFinite(qtdrdv) || qtdrdv <= 0) {
      res.status(400).json({ error: "Quantidade precisa ser maior que zero" });
      return;
    }
    if (!Number.isFinite(vlrunt) || vlrunt < 0) {
      res.status(400).json({ error: "Valor unitário inválido" });
      return;
    }
    // Nunca confiar no total que vier do corpo — a tela mostra o campo travado, mas quem
    // grava é o backend. É sempre qtd × unitário, os dois validados acima.
    const vlrtot = Math.round(qtdrdv * vlrunt * 100) / 100;

    let data: Parameters<typeof prisma.registroDespesaViagem.create>[0]["data"];

    if (aba === "deslocamento") {
      const rotid = Number(req.body?.rotid);
      const moddes = typeof req.body?.moddes === "string" ? req.body.moddes.trim() : "";
      if (!Number.isFinite(rotid)) {
        res.status(400).json({ error: "Selecione uma rota" });
        return;
      }
      if (!MODDES_LABELS[moddes]) {
        res.status(400).json({ error: "Modalidade inválida" });
        return;
      }
      // A rota tem que pertencer ao cliente da RAT — sem essa checagem, dava pra lançar
      // deslocamento com o km de uma rota de outro cliente qualquer, só sabendo o id.
      const rota = await prisma.rotaViagem.findFirst({ where: { id: rotid, codcli: rat.codcli ?? -1, sitreg: "A" } });
      if (!rota) {
        res.status(400).json({ error: "Rota não encontrada para o cliente desta RAT" });
        return;
      }
      const desrdv = typeof req.body?.desrdv === "string" && req.body.desrdv.trim() !== "" ? req.body.desrdv.trim() : rota.desrot;
      // Horas de deslocamento: só na aba Deslocamento, e só editável por ora — a regra de
      // cálculo automático (a partir da rota/percursos) ainda não foi definida (ver plano).
      const hordesBruto = Number(req.body?.hordes);
      const hordes = Number.isFinite(hordesBruto) ? hordesBruto : null;
      data = {
        codemp: rat.codemp,
        numrat: rat.numrat,
        seqrdv: null,
        datemi,
        desrdv,
        tipdes: TIPDES_DESLOCAMENTO_ROTA,
        moddes,
        qtdrdv,
        vlrunt,
        vlrtot,
        hordes,
        fatrdv: "S",
        reerdv: "S",
        rotid: rota.id,
        origemCaxHub: true,
      };
    } else {
      const tipdes = Number(req.body?.tipdes);
      if (!(TIPDES_DESPESA_AVULSA as readonly number[]).includes(tipdes)) {
        res.status(400).json({ error: "Tipo de despesa inválido" });
        return;
      }
      const desrdv = typeof req.body?.desrdv === "string" ? req.body.desrdv.trim() : "";
      if (desrdv === "") {
        res.status(400).json({ error: "Descrição é obrigatória" });
        return;
      }
      // Default "Sim" — mesma convenção da tela do ERP (a maioria fatura o cliente: 14.260
      // de 15.034 linhas históricas já vêm com fatrdv='S').
      const fatrdv = req.body?.fatrdv === "N" ? "N" : "S";
      data = {
        codemp: rat.codemp,
        numrat: rat.numrat,
        seqrdv: null,
        datemi,
        desrdv,
        tipdes,
        qtdrdv,
        vlrunt,
        vlrtot,
        fatrdv,
        reerdv: "S",
        origemCaxHub: true,
      };
    }

    const criada = await prisma.registroDespesaViagem.create({ data });
    res.status(201).json({ id: criada.id });
  } catch (error) {
    handleError(res, error, "despesas-criar");
  }
});

// DELETE /despesas/:despesaId — só remove o que nasceu no CaxHub e ainda não foi enviado ao
// Senior. Despesa vinda do ERP (ou já marcada como enviada) não se apaga por aqui: o próximo
// sync traria ela de volta mesmo assim, e "apagar" daria a falsa impressão de que desapareceu.
ratsRouter.delete("/despesas/:despesaId", async (req: AuthenticatedRequest, res) => {
  try {
    const despesaId = Number(req.params.despesaId);
    if (!Number.isFinite(despesaId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: despesaId } });
    if (!despesa) {
      res.status(404).json({ error: "Despesa não encontrada" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeGerenciarDespesas(ctx.role)) {
      res.status(403).json({ error: "Lançamento de despesas de viagem disponível só para administradores por enquanto" });
      return;
    }
    const rat = await prisma.rat.findFirst({ where: { codemp: despesa.codemp, numrat: despesa.numrat } });
    if (!rat || !podeVerRat(ctx.role, ctx.contexto, rat)) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }
    if (!despesa.origemCaxHub || despesa.enviadoEmSenior != null) {
      res.status(400).json({ error: "Só é possível excluir despesa lançada aqui e ainda não enviada ao Senior" });
      return;
    }

    await prisma.registroDespesaViagem.delete({ where: { id: despesaId } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "despesas-excluir");
  }
});
