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
import {
  enfileirarDespesa,
  enfileirarEdicaoDespesa,
  enfileirarExclusaoDespesa,
  pendenciaEmAndamento,
  processarFilaDespesas,
  reprocessarDespesa,
} from "../sync/outboxSeniorDespesa";
import { runRatSyncPorNumrat } from "../sync/ratSync";
import { runRatItemSyncPorNumrat } from "../sync/ratItemSync";
import { runRegistroDespesaViagemSyncPorNumrat } from "../sync/registroDespesaViagemSync";
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
//
// Recebe as RATs inteiras (não só o id) desde 09/09/2026 — precisa de codemp+numrat pra casar
// com as pendências de despesa (RegistroDespesaViagem não referencia Rat.id, só a chave
// natural do Senior).
async function buscarItensEIntegracao(rats: { id: number; codemp: number; numrat: number | null }[]) {
  const ratIds = rats.map((r) => r.id);
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

  // Pendências de DESPESA (RDV) ativas das mesmas RATs — pedido explícito do Vitor (09/09/2026):
  // uma despesa com erro de envio precisa derrubar o "Sinc. ERP" da RAT inteira pra "falha",
  // não só o ícone da linha da despesa. Casamento por par (codemp,numrat) — RegistroDespesaViagem
  // não tem FK pra Rat.id. `OR` de pares exatos (não dois `in` soltos) pra não combinar
  // codemp/numrat de RATs diferentes entre si.
  const paresRat = rats.filter((r): r is { id: number; codemp: number; numrat: number } => r.numrat != null);
  const ratIdPorChave = new Map(paresRat.map((r) => [`${r.codemp}:${r.numrat}`, r.id]));
  const pendenciasDespesa =
    paresRat.length > 0
      ? await prisma.sincronizacaoPendenteDespesa.findMany({
          where: {
            status: { in: ["pendente", "enviando", "bloqueado"] },
            despesa: { OR: paresRat.map((r) => ({ codemp: r.codemp, numrat: r.numrat })), excluidaEm: null },
          },
          select: { status: true, ultimoErro: true, despesa: { select: { codemp: true, numrat: true } } },
        })
      : [];
  const pendenciasDespesaPorRat = new Map<number, { status: string; ultimoErro: string | null }[]>();
  for (const p of pendenciasDespesa) {
    const ratId = ratIdPorChave.get(`${p.despesa.codemp}:${p.despesa.numrat}`);
    if (ratId == null) continue;
    const lista = pendenciasDespesaPorRat.get(ratId) ?? [];
    lista.push({ status: p.status, ultimoErro: p.ultimoErro });
    pendenciasDespesaPorRat.set(ratId, lista);
  }

  const integracaoPorRat = new Map<number, IntegracaoErpStatus>();
  for (const ratId of ratIds) {
    const itensDaRat = itensPorRat.get(ratId) ?? [];
    const entradasItens = itensDaRat.map((item) => ({ confirmado: item.numrat != null, pendencia: pendenciaPorRatItem.get(item.id) }));
    // Cada pendência de despesa ATIVA entra como uma entrada própria, `confirmado: false` —
    // por definição ainda não terminou (já filtrado no where acima); pior caso entre ela e os
    // itens de apontamento vence junto, mesmo espírito de calcularIntegracaoErp.
    const entradasDespesa = (pendenciasDespesaPorRat.get(ratId) ?? []).map((p) => ({ confirmado: false, pendencia: p }));
    integracaoPorRat.set(ratId, calcularIntegracaoErp([...entradasItens, ...entradasDespesa]));
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
      ({ itensPorRat, integracaoPorRat } = await buscarItensEIntegracao(rats));
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
      ({ itensPorRat, integracaoPorRat } = await buscarItensEIntegracao(rats));
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

    // Data/hora decrescente (mais recente primeiro) — pedido do Vitor (10/09/2026), mesma
    // ordem agora usada em "Sessões pendentes de confirmação" (GET /apontamentos/sessoes-
    // pendentes). `datati`+`horini` porque RatItem não tem um único DateTime combinado (herança
    // do formato do Senior: data e "minutos desde meia-noite" em colunas separadas — ver
    // comentário do campo no schema). `nulls: "last"` pra item sem data/hora (raro, mas
    // possível antes de confirmado no Senior) não pular pra frente da fila por padrão do
    // Postgres em DESC; `id desc` como desempate final determinístico.
    const itens = await prisma.ratItem.findMany({
      where: { ratId: id },
      include: { sessoes: true },
      orderBy: [{ datati: { sort: "desc", nulls: "last" } }, { horini: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    });

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

// POST /:id/sincronizar — "Sinc. ERP": reorganizada (28/08/2026) em duas fases; despesas de
// viagem entraram na dança em 07/09/2026 (pedido do Vitor: "pode ter havido alteração no ERP
// que precisa vir pro nosso lado", inclusive despesa — mesmas regras do apontamento).
//
// Fase 1 — puxa de novo o cabeçalho, os itens e as despesas dessa RAT específica do Senior
// (filtrado por numrat, ver runRatSyncPorNumrat/runRatItemSyncPorNumrat/
// runRegistroDespesaViagemSyncPorNumrat), pra quando o consultor sabe que algo mudou lá e não
// quer esperar o job noturno (item às 4h30, despesa às 5h20). Roda sempre que a RAT já tem
// numrat (documento já confirmado no Senior) — INDEPENDENTE do status de integração local: só
// porque nossos itens já foram todos confirmados não quer dizer que nada mudou DO LADO DE LÁ
// (achado real 07/09/2026, RAT 1302077: botão ficava desabilitado com "sincronizado" e nunca
// dava pra puxar edição feita direto no ERP). Uma RAT onde nenhum item nunca chegou a ser
// enviado com sucesso ainda não tem o que buscar, e isso não é erro (400): a fase só é pulada.
// Se o CABEÇALHO não voltar mais na consulta (RAT inteira apagada/cancelada no Senior),
// Rat.numrat é desvinculado (ver desvincularRatAusenteNoSenior) — mesmo espírito de
// desvincularItensAusentesNoSenior, que já cobria só os itens. Despesa não tem esse tratamento
// de ausência ainda (mesma limitação da varredura completa, ver comentário "Sem carimbo" em
// registroDespesaViagemSync.ts) — só upsert do que a consulta trouxer.
//
// Fase 2 — reenvia pro Senior todo item/despesa desta RAT que ainda não está lá: "falha"
// (pendência com erro, inclui bloqueado — reseta e tenta de novo) ou "pendente" (nunca
// enfileirado — nunca enviado, ou desvinculado pela fase 1 — enfileira agora). Item/despesa
// "enviando" de verdade (em voo, ou recém-enfileirado sem erro ainda) fica de fora: vai fluir
// sozinho no próximo ciclo da fila, reenviar aqui não ajudaria em nada. Aguardado (não
// fire-and-forget como o reenvio por item) — escopado só aos ids desta RAT via `apenasIds`,
// nunca a fila inteira do sistema (ver comentário em processarFilaSincronizacao).
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
        await runRegistroDespesaViagemSyncPorNumrat(rat.codemp, rat.numrat);
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

    // Fase 2 (despesa) — mesma regra acima, na fila própria de despesa (sync/
    // outboxSeniorDespesa.ts): "bloqueado" é resetado antes (reprocessarDespesa zera
    // tentativas), "pendente" só precisa entrar no apenasIds. "enviando"/"enviado" ficam de
    // fora.
    const pendenciasDespesa =
      rat.numrat != null
        ? await prisma.sincronizacaoPendenteDespesa.findMany({
            where: { despesa: { codemp: rat.codemp, numrat: rat.numrat }, status: { in: ["pendente", "bloqueado"] } },
          })
        : [];
    for (const pendencia of pendenciasDespesa) {
      if (pendencia.status === "bloqueado") await reprocessarDespesa(pendencia.id);
    }
    if (pendenciasDespesa.length > 0) {
      await processarFilaDespesas({ apenasIds: pendenciasDespesa.map((p) => p.id) });
    }

    // Status agregado pós-tentativa, pra tela montar o aviso final sem precisar de mais uma
    // chamada — reaproveita o mesmo helper de GET / (buscarItensEIntegracao), escopado só a
    // esta RAT (conjunto de 1, sem custo de full-set nenhum).
    const { integracaoPorRat } = await buscarItensEIntegracao([rat]);
    const integracao = integracaoPorRat.get(rat.id) ?? "pendente";

    res.json({
      ok: true,
      ratDesvinculada,
      desvinculados: desvinculados.length,
      seqratsDesvinculados: desvinculados,
      itensReenviados,
      despesasReenviadas: pendenciasDespesa.length,
      integracao,
      integracaoLabel: integracaoErpLabel(integracao),
      integracaoTone: integracaoErpTone(integracao),
    });
  } catch (error) {
    handleError(res, error, "sincronizar");
  }
});

// Lançamento de despesas de viagem: admin ou o próprio consultor dono da RAT (mesma regra de
// "dono" que podeVerRat já usa) — liberado ao dono em 07/09/2026, a pedido do Vitor. Gestor de
// departamento continua de fora por ora (só visualiza a RAT do time, não lançou a despesa).
function podeGerenciarDespesas(role: string, contexto: Contexto, rat: { codfor: number }): boolean {
  if (role === "admin") return true;
  return contexto.consultor?.codfor === rat.codfor;
}

// Incluir/editar/excluir despesa (qualquer origem — própria ou vinda do Senior) só é permitido
// enquanto a RAT está com a situação Digitado (sitrat=9) — liberado em 07/09/2026, a pedido do
// Vitor, junto com a regra de negócio acima. Uma vez aprovada/fechada no ERP, o documento já
// foi consolidado lá e despesa deixa de aceitar mudança por aqui (só GET continua liberado).
function podeAlterarDespesasDaRat(rat: { numrat: number | null; sitrat: number | null }): boolean {
  return rat.numrat != null && rat.sitrat === 9;
}

// Mensagem exibida quando podeAlterarDespesasDaRat nega — diferencia "sem numrat ainda" (nunca
// teve despesa possível) de "situação avançou" (podia, mas não pode mais), senão o consultor
// não entende por que o botão sumiu de uma hora pra outra.
function mensagemBloqueioDespesas(rat: { numrat: number | null; sitrat: number | null }): string {
  if (rat.numrat == null) return "Esta RAT ainda não tem número do ERP — não é possível lançar despesa ainda";
  return "Despesas só podem ser incluídas, editadas ou excluídas enquanto a RAT está com a situação Digitado";
}

// Resolve a RAT e confere permissão de ESCRITA — mesma regra de podeVerRat + a restrição de
// podeGerenciarDespesas acima. Usada só por POST /:id/despesas (07/09/2026: GET passou a usar
// só podeVerRat — ver comentário do handler — pra abrir leitura pra quem só visualiza a RAT).
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
  const rat = await prisma.rat.findUnique({ where: { id: ratId } });
  if (!rat || !podeVerRat(ctx.role, ctx.contexto, rat)) {
    res.status(404).json({ error: "RAT não encontrada" });
    return null;
  }
  if (!podeGerenciarDespesas(ctx.role, ctx.contexto, rat)) {
    res.status(403).json({ error: "Lançamento de despesas de viagem disponível só para o consultor dono da RAT ou administradores" });
    return null;
  }
  return rat;
}

// Mesma resolução de ratComPermissao, mas a partir de uma despesa já em mãos (PATCH/DELETE
// recebem :despesaId, não :id de RAT) — casa por codemp+numrat, igual ao DELETE original já
// fazia. Extraído (07/09/2026) porque agora são 2 endpoints (editar + excluir) repetindo a
// mesma sequência de checagens.
async function ratDaDespesaComPermissao(
  req: AuthenticatedRequest,
  res: import("express").Response,
  despesa: { codemp: number; numrat: number }
): Promise<import("@prisma/client").Rat | null> {
  const ctx = await contextoDoUsuario(req);
  if (!ctx) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return null;
  }
  const rat = await prisma.rat.findFirst({ where: { codemp: despesa.codemp, numrat: despesa.numrat } });
  if (!rat || !podeVerRat(ctx.role, ctx.contexto, rat)) {
    res.status(404).json({ error: "RAT não encontrada" });
    return null;
  }
  if (!podeGerenciarDespesas(ctx.role, ctx.contexto, rat)) {
    res.status(403).json({ error: "Lançamento de despesas de viagem disponível só para o consultor dono da RAT ou administradores" });
    return null;
  }
  return rat;
}

// GET /:id/despesas — despesas já lançadas na RAT + o que a tela precisa pra montar o
// formulário de lançamento (rotas ativas do cliente da RAT, opções de tipo/modalidade).
// Visibilidade (07/09/2026, pedido do Vitor): igual a GET /:id/itens — `podeVerRat`, não
// `podeGerenciarDespesas` — a aba "RDVs" do acordeão passou a aparecer pra qualquer um que vê a
// RAT, em modo leitura pra quem não gerencia (ver `podeGerenciar` na resposta abaixo). Escrita
// (POST/PATCH/DELETE) continua restrita, sem mudança nenhuma nelas.
ratsRouter.get("/:id/despesas", async (req: AuthenticatedRequest, res) => {
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
    const rat = await prisma.rat.findUnique({ where: { id } });
    if (!rat || !podeVerRat(ctx.role, ctx.contexto, rat)) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }
    const podeGerenciar = podeGerenciarDespesas(ctx.role, ctx.contexto, rat);

    // Excluída (soft delete confirmado no Senior) some da tela — ver excluidaEm no schema.
    const despesas =
      rat.numrat != null
        ? await prisma.registroDespesaViagem.findMany({
            where: { codemp: rat.codemp, numrat: rat.numrat, excluidaEm: null },
            orderBy: [{ datemi: "asc" }, { id: "asc" }],
          })
        : [];
    const rotas =
      rat.codcli != null
        ? await prisma.rotaViagem.findMany({ where: { codcli: rat.codcli, sitreg: "A" }, orderBy: { desrot: "asc" } })
        : [];

    // Pendências ativas de cada despesa listada — decide, por linha, se dá pra editar/excluir
    // agora (não enquanto um envio anterior está em voo) e se já existe uma exclusão aguardando
    // confirmação do Senior (indicador visual "Exclusão pendente").
    const despesaIds = despesas.map((d) => d.id);
    const pendencias =
      despesaIds.length > 0
        ? await prisma.sincronizacaoPendenteDespesa.findMany({
            where: { despesaId: { in: despesaIds }, status: { in: ["pendente", "enviando", "bloqueado"] } },
          })
        : [];
    const pendenciasPorDespesa = new Map<number, typeof pendencias>();
    for (const pendencia of pendencias) {
      const lista = pendenciasPorDespesa.get(pendencia.despesaId) ?? [];
      lista.push(pendencia);
      pendenciasPorDespesa.set(pendencia.despesaId, lista);
    }

    // `podeGerenciar` (permissão de dono/admin) entra na conta: sem ela, `podeLancar` é sempre
    // false pra quem só visualiza — mesmo quando a RAT em si estaria em condição de receber
    // despesa (numrat + Digitado). `mensagemBloqueio` só faz sentido pra quem gerencia (avisar
    // "não dá pra lançar" de uma ação que a pessoa nunca teria acesso mesmo seria ruído).
    const podeAlterar = podeGerenciar && podeAlterarDespesasDaRat(rat);

    res.json({
      podeGerenciar,
      podeLancar: podeAlterar,
      mensagemBloqueio: podeGerenciar && !podeAlterar ? mensagemBloqueioDespesas(rat) : null,
      despesas: despesas.map((d) => {
        const pendenciasDaDespesa = pendenciasPorDespesa.get(d.id) ?? [];
        const emAndamento = pendenciasDaDespesa.some((p) => p.status === "enviando");
        const exclusaoPendente = pendenciasDaDespesa.some((p) => p.tipo === "excluir_despesa");
        const podeMexer = podeAlterar && !emAndamento && !exclusaoPendente;

        // Status de integração com o Senior — mesma função/filosofia da coluna "Sinc. ERP" de
        // "Sessões pendentes de confirmação" (routes/apontamentos.ts) e do Cronograma
        // (routes/alocacao.ts). `confirmado` só entra quando NÃO há pendência ativa — com
        // pendência ativa, `confirmado: false` deixa o pior caso DELA vencer (enviando/falha),
        // em vez de "confirmado" (seqrdv de um envio ANTERIOR) mascarar como sincronizado uma
        // edição/exclusão que ainda está em voo ou falhou. Bug real (09/09/2026): editar uma
        // despesa já confirmada mostrava o ícone verde (seqrdv da inclusão original) mesmo com
        // a edição travada — Editar/Excluir sumiam (emAndamento correto) mas o ícone mentia.
        const integracaoDespesa = calcularIntegracaoErp(
          pendenciasDaDespesa.length > 0
            ? pendenciasDaDespesa.map((p) => ({ confirmado: false, pendencia: p }))
            : [{ confirmado: d.seqrdv != null }]
        );
        // "invalido" (dado ausente antes de enfileirar) não existe pra despesa — diferente do
        // outbox de RAT/alocação, `enfileirarDespesa` sempre recebe um registro já validado
        // (ver POST/PATCH abaixo), então toda falha real vem com `ultimoErro` preenchido.
        const integracaoErpErro =
          integracaoDespesa === "falha" ? pendenciasDaDespesa.find((p) => p.ultimoErro)?.ultimoErro ?? null : null;

        return {
          id: d.id,
          seqrdv: d.seqrdv,
          datemi: d.datemi,
          desrdv: d.desrdv,
          tipdes: d.tipdes,
          tipdesLabel: tipdesLabel(d.tipdes),
          moddes: d.moddes,
          moddesLabel: d.moddes != null ? moddesLabel(d.moddes) : null,
          qtdrdv: d.qtdrdv,
          // Decimal do Prisma serializa como STRING em JSON (decimal.js por baixo) — sem o
          // Number(), a soma no frontend (totalLancado) concatena string em vez de somar
          // ("0" + "150.00" + "10.99" = "0150.0010.99") e vira "R$ NaN" ao formatar. Mesmo
          // cuidado já usado em ratVisualizacao.ts/pedidos.ts pra Decimal.
          vlrunt: d.vlrunt != null ? Number(d.vlrunt) : null,
          vlrtot: d.vlrtot != null ? Number(d.vlrtot) : null,
          hordes: d.hordes,
          fatrdv: d.fatrdv,
          fatrdvLabel: simNaoLabel(d.fatrdv),
          rotid: d.rotid,
          origemCaxHub: d.origemCaxHub,
          // Nunca chegou a existir no Senior (nem enviado por nós, nem veio de lá) — não
          // depende mais de origemCaxHub: despesa vinda do ERP sempre tem seqrdv, então nunca
          // cai aqui.
          pendenteDeEnvio: d.seqrdv == null && d.enviadoEmSenior == null,
          exclusaoPendente,
          podeEditar: podeMexer,
          podeExcluir: podeMexer,
          integracaoErpLabel: integracaoErpLabel(integracaoDespesa),
          integracaoErpTone: integracaoErpTone(integracaoDespesa),
          integracaoErpErro,
        };
      }),
      rotas: rotas.map((r) => ({
        id: r.id,
        desrot: r.desrot,
        kmtrot: r.kmtrot != null ? Number(r.kmtrot) : null, // Decimal — mesmo cuidado de vlrunt/vlrtot acima
        horrot: r.horrot,
      })),
      opcoesTipo: TIPDES_DESPESA_AVULSA.map((t) => ({ value: t, label: TIPDES_LABELS[t] })),
      opcoesModalidade: Object.entries(MODDES_LABELS).map(([value, label]) => ({ value, label })),
    });
  } catch (error) {
    handleError(res, error, "despesas-listar");
  }
});

// Erro de validação de campo do formulário (despesa avulsa ou deslocamento por rota) — nunca
// escreve na resposta diretamente porque validarCamposDespesa é usada por 2 rotas (criar/
// editar) com handlers de erro levemente diferentes.
class ErroValidacaoDespesa extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Campos de conteúdo da despesa — o que POST (criar) e PATCH (editar) têm em comum. */
interface DadosDespesaValidados {
  datemi: Date;
  desrdv: string | null;
  tipdes: number;
  moddes: string | null;
  qtdrdv: number;
  vlrunt: number;
  vlrtot: number;
  hordes: number | null;
  fatrdv: string;
  rotid: number | null;
}

// Valida e normaliza os campos de "Despesa avulsa" ou "Deslocamento por rota" vindos do corpo
// da requisição. Extraído (07/09/2026) de POST /:id/despesas pra ser reaproveitado por
// PATCH /despesas/:despesaId — a mesma regra de negócio vale nos dois, só muda o que o
// chamador faz com o resultado (create vs. update).
async function validarCamposDespesa(rat: { codcli: number | null }, body: any): Promise<DadosDespesaValidados> {
  const aba = body?.aba === "deslocamento" ? "deslocamento" : "despesa";
  const datemi = body?.datemi ? new Date(body.datemi) : null;
  const vlrunt = Number(body?.vlrunt);
  if (!datemi || !Number.isFinite(datemi.getTime())) {
    throw new ErroValidacaoDespesa(400, "Data é obrigatória");
  }
  // `qtdrdv` é Int no banco (mesma coluna do Senior) — a Deslocamento pode chegar com o km
  // fracionado da rota (ex.: 239.1, pré-preenchido a partir de RotaViagem.kmtrot). Arredonda
  // ANTES de calcular vlrtot, senão o total gravado usaria o valor fracionado enquanto o
  // qtdrdv persistido seria truncado pelo Postgres — os dois ficariam inconsistentes.
  const qtdrdv = Math.round(Number(body?.qtdrdv));
  if (!Number.isFinite(qtdrdv) || qtdrdv <= 0) {
    throw new ErroValidacaoDespesa(400, "Quantidade precisa ser maior que zero");
  }
  if (!Number.isFinite(vlrunt) || vlrunt < 0) {
    throw new ErroValidacaoDespesa(400, "Valor unitário inválido");
  }
  // Nunca confiar no total que vier do corpo — a tela mostra o campo travado, mas quem
  // grava é o backend. É sempre qtd × unitário, os dois validados acima.
  const vlrtot = Math.round(qtdrdv * vlrunt * 100) / 100;

  if (aba === "deslocamento") {
    const rotid = Number(body?.rotid);
    const moddes = typeof body?.moddes === "string" ? body.moddes.trim() : "";
    if (!Number.isFinite(rotid)) {
      throw new ErroValidacaoDespesa(400, "Selecione uma rota");
    }
    if (!MODDES_LABELS[moddes]) {
      throw new ErroValidacaoDespesa(400, "Modalidade inválida");
    }
    // A rota tem que pertencer ao cliente da RAT — sem essa checagem, dava pra lançar
    // deslocamento com o km de uma rota de outro cliente qualquer, só sabendo o id.
    const rota = await prisma.rotaViagem.findFirst({ where: { id: rotid, codcli: rat.codcli ?? -1, sitreg: "A" } });
    if (!rota) {
      throw new ErroValidacaoDespesa(400, "Rota não encontrada para o cliente desta RAT");
    }
    const desrdv = typeof body?.desrdv === "string" && body.desrdv.trim() !== "" ? body.desrdv.trim() : rota.desrot;
    // Horas de deslocamento: só na aba Deslocamento, e só editável por ora — a regra de
    // cálculo automático (a partir da rota/percursos) ainda não foi definida (ver plano).
    const hordesBruto = Number(body?.hordes);
    const hordes = Number.isFinite(hordesBruto) ? hordesBruto : null;
    return { datemi, desrdv, tipdes: TIPDES_DESLOCAMENTO_ROTA, moddes, qtdrdv, vlrunt, vlrtot, hordes, fatrdv: "S", rotid: rota.id };
  }

  const tipdes = Number(body?.tipdes);
  if (!(TIPDES_DESPESA_AVULSA as readonly number[]).includes(tipdes)) {
    throw new ErroValidacaoDespesa(400, "Tipo de despesa inválido");
  }
  const desrdv = typeof body?.desrdv === "string" ? body.desrdv.trim() : "";
  if (desrdv === "") {
    throw new ErroValidacaoDespesa(400, "Descrição é obrigatória");
  }
  // Default "Sim" — mesma convenção da tela do ERP (a maioria fatura o cliente: 14.260
  // de 15.034 linhas históricas já vêm com fatrdv='S').
  const fatrdv = body?.fatrdv === "N" ? "N" : "S";
  return { datemi, desrdv, tipdes, moddes: null, qtdrdv, vlrunt, vlrtot, hordes: null, fatrdv, rotid: null };
}

// Categorias fixas do relatório impresso — mesmo agrupamento do modelo já usado dentro do
// Senior (RELATÓRIO DE DESPESAS DE VIAGEM): sempre as 6, na mesma ordem, mesmo zeradas.
// "Quilometragem" junta tipdes 1 (Deslocamento/km Rodado, despesa avulsa) e 7 (Deslocamento por
// Rota) — os dois são km rodado, o modelo do Senior não distingue entre eles.
const CATEGORIAS_RELATORIO_DESPESA: { categoria: string; tipdes: number[] }[] = [
  { categoria: "Quilometragem", tipdes: [1, 7] },
  { categoria: "Estadias/Refeições", tipdes: [2] },
  { categoria: "Pedágios", tipdes: [3] },
  { categoria: "Ligações Telefônicas", tipdes: [4] },
  { categoria: "Táxi/Metrô/Ônibus", tipdes: [5] },
  { categoria: "Outros", tipdes: [6] },
];

// GET /:id/despesas/relatorio — dados pro relatório de impressão da RDV
// (RelatorioDespesasRat.tsx, frontend, aberto numa aba própria a partir do botão "Imprimir" em
// DespesasRatPainel.tsx), no modelo já usado dentro do Senior. Mesma visibilidade de
// GET /:id/despesas (podeVerRat, não podeGerenciarDespesas — pedido explícito do Vitor,
// 09/09/2026: "Imprimir" é leitura, aparece pra qualquer um que vê a RAT).
ratsRouter.get("/:id/despesas/relatorio", async (req: AuthenticatedRequest, res) => {
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
    const rat = await prisma.rat.findUnique({ where: { id } });
    if (!rat || !podeVerRat(ctx.role, ctx.contexto, rat)) {
      res.status(404).json({ error: "RAT não encontrada" });
      return;
    }

    const [cliente, consultor, despesas] = await Promise.all([
      rat.codcli != null ? prisma.cliente.findUnique({ where: { codcli: rat.codcli } }) : null,
      prisma.consultor.findFirst({ where: { codemp: rat.codemp, codfor: rat.codfor } }),
      // Excluída (soft delete confirmado no Senior) fica de fora — mesmo filtro de
      // GET /:id/despesas.
      rat.numrat != null
        ? prisma.registroDespesaViagem.findMany({
            where: { codemp: rat.codemp, numrat: rat.numrat, excluidaEm: null },
            orderBy: [{ datemi: "asc" }, { id: "asc" }],
          })
        : [],
    ]);

    // Deslocamento por rota (tipdes=7) com qtdrdv=0 é lixo de teste/rascunho (rota selecionada
    // sem km de verdade) — não é um lançamento real, não entra no relatório impresso nem nos
    // totais/resumo (pedido explícito do Vitor, 09/09/2026).
    const despesasImpressas = despesas.filter((d) => !(d.tipdes === TIPDES_DESLOCAMENTO_ROTA && (d.qtdrdv ?? 0) === 0));

    // "Faturar Cliente" não existe como campo agregado da RAT — só por despesa (`fatrdv`).
    // Deriva como verdadeiro se QUALQUER despesa faturar (decisão explícita do Vitor).
    const faturaCliente = despesasImpressas.some((d) => d.fatrdv === "S");

    const resumoPorCategoria = CATEGORIAS_RELATORIO_DESPESA.map(({ categoria, tipdes }) => {
      const doGrupo = despesasImpressas.filter((d) => d.tipdes != null && tipdes.includes(d.tipdes));
      return {
        categoria,
        qtdrdv: doGrupo.reduce((soma, d) => soma + (d.qtdrdv ?? 0), 0),
        vlrtot: doGrupo.reduce((soma, d) => soma + Number(d.vlrtot ?? 0), 0),
      };
    });

    res.json({
      rat: {
        numrat: rat.numrat,
        datemi: rat.datemi,
        consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${rat.codfor}`,
        cliente: cliente ? `${cliente.codcli} - ${cliente.nomcli}` : null,
        codpro: rat.codpro,
        numprj: rat.numprj,
        codfpj: rat.codfpj,
        faturaCliente,
      },
      despesas: despesasImpressas.map((d) => ({
        tipdes: d.tipdes,
        tipdesLabel: tipdesLabel(d.tipdes),
        desrdv: d.desrdv,
        qtdrdv: d.qtdrdv,
        // Decimal do Prisma serializa como string em JSON — mesmo cuidado de GET /:id/despesas.
        vlrunt: d.vlrunt != null ? Number(d.vlrunt) : null,
        vlrtot: d.vlrtot != null ? Number(d.vlrtot) : null,
        datemi: d.datemi,
      })),
      resumoPorCategoria,
      total: despesasImpressas.reduce((soma, d) => soma + Number(d.vlrtot ?? 0), 0),
    });
  } catch (error) {
    handleError(res, error, "despesas-relatorio");
  }
});

// POST /:id/despesas — lança despesa (aba "despesa") ou deslocamento por rota (aba
// "deslocamento"). Grava sempre local (origemCaxHub=true, seqrdv=null) e enfileira o envio pro
// Senior via `ManterItemDespesa` (sync/outboxSeniorDespesa.ts, mesmas regras do outbox de RAT:
// disparo imediato + cron de 15 min como rede de segurança).
ratsRouter.post("/:id/despesas", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const rat = await ratComPermissao(req, res, id);
    if (!rat) return;
    if (!podeAlterarDespesasDaRat(rat)) {
      res.status(400).json({ error: mensagemBloqueioDespesas(rat) });
      return;
    }

    let validado: DadosDespesaValidados;
    try {
      validado = await validarCamposDespesa(rat, req.body);
    } catch (erro) {
      if (erro instanceof ErroValidacaoDespesa) {
        res.status(erro.status).json({ error: erro.message });
        return;
      }
      throw erro;
    }

    const criada = await prisma.registroDespesaViagem.create({
      data: {
        codemp: rat.codemp,
        numrat: rat.numrat!,
        seqrdv: null,
        reerdv: "S",
        origemCaxHub: true,
        ...validado,
      },
    });
    await enfileirarDespesa(criada.id);
    res.status(201).json({ id: criada.id });
  } catch (error) {
    handleError(res, error, "despesas-criar");
  }
});

// PATCH /despesas/:despesaId — edita uma despesa já lançada (qualquer origem), enquanto a RAT
// dela ainda está Digitada (07/09/2026, pedido do Vitor). Os campos são gravados localmente na
// hora; se a despesa já tinha sido confirmada no Senior (seqrdv preenchido), a edição só chega
// lá quando a pendência "editar_despesa" (tipEve=A + seqRdv) for processada — daí o `pendente`
// na resposta. Se nunca tinha sido enviada, os novos valores entram na própria inclusão
// pendente (enviarInclusaoDespesa relê do banco, nunca confia no payload congelado).
ratsRouter.patch("/despesas/:despesaId", async (req: AuthenticatedRequest, res) => {
  try {
    const despesaId = Number(req.params.despesaId);
    if (!Number.isFinite(despesaId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: despesaId } });
    if (!despesa || despesa.excluidaEm != null) {
      res.status(404).json({ error: "Despesa não encontrada" });
      return;
    }
    const rat = await ratDaDespesaComPermissao(req, res, despesa);
    if (!rat) return;
    if (!podeAlterarDespesasDaRat(rat)) {
      res.status(400).json({ error: mensagemBloqueioDespesas(rat) });
      return;
    }
    if (await pendenciaEmAndamento(despesaId)) {
      res.status(409).json({ error: "Envio anterior desta despesa ainda em andamento — tente novamente em instantes" });
      return;
    }

    let validado: DadosDespesaValidados;
    try {
      validado = await validarCamposDespesa(rat, req.body);
    } catch (erro) {
      if (erro instanceof ErroValidacaoDespesa) {
        res.status(erro.status).json({ error: erro.message });
        return;
      }
      throw erro;
    }

    await prisma.registroDespesaViagem.update({ where: { id: despesaId }, data: validado });

    if (despesa.seqrdv != null) {
      await enfileirarEdicaoDespesa(despesaId);
    } else {
      // Nunca foi enviada — a inclusão pendente já existente vai mandar os valores novos
      // quando processada. Só reenfileira se por algum motivo não sobrou nenhuma pendência
      // ativa (ex.: apagada manualmente antes) — caso raro, mas sem isso a edição ficaria
      // presa sem nunca ser propagada.
      const semPendenciaAtiva = !(await prisma.sincronizacaoPendenteDespesa.findFirst({
        where: { despesaId, status: { in: ["pendente", "enviando"] } },
      }));
      if (semPendenciaAtiva) await enfileirarDespesa(despesaId);
    }

    res.json({ ok: true, pendente: true });
  } catch (error) {
    handleError(res, error, "despesas-editar");
  }
});

// POST /despesas/:despesaId/reenviar — nova tentativa de sincronizar UMA despesa com o Senior,
// disparada pelo próprio ícone "Sinc. ERP" da linha quando o estado é "falha" ou "pendente"
// (GET /:id/despesas, ver integracaoErpTone) — mesmo espírito de
// POST /apontamentos/envio/:ratItemId/reenviar. Não passa por `podeAlterarDespesasDaRat`: não
// está mudando o conteúdo da despesa, só reenviando o que já existe, então continua liberado
// mesmo se a RAT saiu de "Digitado" nesse meio-tempo (mesmo raciocínio da Fase 2 de
// POST /:id/sincronizar, que reprocessa pendências independente do sitrat atual).
ratsRouter.post("/despesas/:despesaId/reenviar", async (req: AuthenticatedRequest, res) => {
  try {
    const despesaId = Number(req.params.despesaId);
    if (!Number.isFinite(despesaId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: despesaId } });
    if (!despesa || despesa.excluidaEm != null) {
      res.status(404).json({ error: "Despesa não encontrada" });
      return;
    }
    const rat = await ratDaDespesaComPermissao(req, res, despesa);
    if (!rat) return;
    if (await pendenciaEmAndamento(despesaId)) {
      res.status(409).json({ error: "Já existe um envio em andamento para esta despesa — tente novamente em instantes" });
      return;
    }

    // Reaproveita a pendência existente (preserva `tipo`/tipEve — enviar/editar/excluir) em vez
    // de criar uma nova; só cria do zero se por algum motivo não sobrou nenhuma (ex.: apagada
    // manualmente). "bloqueado" precisa resetar tentativas/ultimoErro antes; "pendente" com
    // ultimoErro (tentativas < MAX) já está apto, só precisa do disparo imediato.
    const pendencia = await prisma.sincronizacaoPendenteDespesa.findFirst({
      where: { despesaId, status: { in: ["pendente", "bloqueado"] } },
      orderBy: { id: "desc" },
    });
    let pendenciaId: number;
    if (pendencia) {
      if (pendencia.status === "bloqueado") await reprocessarDespesa(pendencia.id);
      pendenciaId = pendencia.id;
    } else {
      pendenciaId = await enfileirarDespesa(despesaId, { adiarEnvio: true });
    }

    // Disparo em segundo plano — quem chamou não espera o envio terminar, só sabe que entrou
    // na fila; a tela descobre o resultado no próximo GET /:id/despesas.
    processarFilaDespesas({ apenasId: pendenciaId }).catch((erro) => {
      console.error("[despesas] reenvio ao Senior falhou:", erro instanceof Error ? erro.message : erro);
    });

    res.status(202).json({ status: "reenviando" });
  } catch (error) {
    handleError(res, error, "despesas-reenviar");
  }
});

// DELETE /despesas/:despesaId — enquanto a RAT ainda está Digitada, exclui qualquer despesa
// dela (própria origem ou vinda do Senior; 07/09/2026, pedido do Vitor). Nunca tinha ido pro
// Senior (seqrdv nulo) → apaga a linha na hora, nada a desfazer lá. Já tinha sido confirmada →
// enfileira a exclusão (tipEve=E + seqRdv) e só vira soft delete (excluidaEm) quando o Senior
// confirmar, ver processarFilaDespesas em sync/outboxSeniorDespesa.ts — a linha continua
// visível como "Exclusão pendente" até lá (ver exclusaoPendente em GET /:id/despesas).
ratsRouter.delete("/despesas/:despesaId", async (req: AuthenticatedRequest, res) => {
  try {
    const despesaId = Number(req.params.despesaId);
    if (!Number.isFinite(despesaId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: despesaId } });
    if (!despesa || despesa.excluidaEm != null) {
      res.status(404).json({ error: "Despesa não encontrada" });
      return;
    }
    const rat = await ratDaDespesaComPermissao(req, res, despesa);
    if (!rat) return;
    if (!podeAlterarDespesasDaRat(rat)) {
      res.status(400).json({ error: mensagemBloqueioDespesas(rat) });
      return;
    }
    if (await pendenciaEmAndamento(despesaId)) {
      res.status(409).json({ error: "Envio anterior desta despesa ainda em andamento — tente novamente em instantes" });
      return;
    }
    const exclusaoJaPendente = await prisma.sincronizacaoPendenteDespesa.findFirst({
      where: { despesaId, tipo: "excluir_despesa", status: { in: ["pendente", "bloqueado"] } },
    });
    if (exclusaoJaPendente) {
      res.status(400).json({ error: "Exclusão já está pendente de confirmação no Senior" });
      return;
    }

    if (despesa.seqrdv == null) {
      // Nunca existiu no Senior — nada a desfazer lá. Cancela qualquer pendência de inclusão
      // ainda ativa (o usuário desistiu antes dela sair daqui) e apaga a linha de vez.
      await prisma.$transaction([
        prisma.sincronizacaoPendenteDespesa.deleteMany({ where: { despesaId, status: { in: ["pendente", "bloqueado"] } } }),
        prisma.registroDespesaViagem.delete({ where: { id: despesaId } }),
      ]);
      res.json({ ok: true, pendente: false });
      return;
    }

    await enfileirarExclusaoDespesa(despesaId);
    res.json({ ok: true, pendente: true });
  } catch (error) {
    handleError(res, error, "despesas-excluir");
  }
});
