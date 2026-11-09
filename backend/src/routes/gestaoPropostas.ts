import { Router, type Request, type Response } from "express";
import { AuthenticatedRequest, requireAuth, requireRole } from "../auth/middleware";
import { ErroEntradaConsulta } from "../consultas/consultaColunas";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { entidadeIdProposta } from "../audit/identidadeEntidade";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { resolverContextoConsultor } from "../domain/contextoProjeto";
import {
  consultaGestaoPropostas,
  ORDEM_PADRAO_GESTAO_PROPOSTAS,
  precisaCalcularConjunto,
  SITRAT_BLOQUEIA_FINALIZAR,
  type FiltrosGestaoPropostas,
} from "../domain/gestaoPropostasSql";
import {
  DEPEXE_LABELS,
  MODPRO_LABELS,
  SITPRO_EM_EXECUCAO,
  SITPRO_EXECUTADA,
  SITPRO_FINALIZAVEL,
  SITPRO_ORDER,
  sitproLabel,
  sitproTone,
} from "../domain/propostasDominio";
import { integracaoErpTone, sitratToneEfetivo } from "../domain/ratDominio";
import {
  consultaRatsLista,
  ORDEM_PADRAO_RATS,
  precisaCalcularConjunto as precisaCalcularConjuntoRats,
  ROTULOS_INTEGRACAO,
  ROTULOS_SITRAT,
  type FiltrosTopoRats,
} from "../domain/ratsListaSql";
import { podeVerValoresDaProposta } from "../domain/valoresDaProposta";
import { runAtividadeConsultorSyncPorCodpro } from "../sync/atividadeConsultorSync";
import {
  ehAvisoDeEspera,
  enfileirarSituacaoProposta,
  pendenciaDeSituacaoEmAndamento,
  portaDeSituacaoPublicada,
  TIPO_FINALIZAR_PROPOSTA,
  TIPO_REABRIR_EXECUCAO_PROPOSTA,
} from "../sync/outboxSeniorProposta";
import { runPropostaItemSyncPorCodpro } from "../sync/propostaItemSync";
import { runPropostaSyncPorCodpro } from "../sync/propostaSync";
import { runRatItemSyncPorCodpro } from "../sync/ratItemSync";
import { runRatSyncPorCodpro } from "../sync/ratSync";
import { col, registrarListaConsultavel, type ListaConsultavel } from "./listaConsultavel";

// Tela Gestão Propostas (09/11/2026): gestão das propostas — horas vendidas × executadas em RAT, o que é faturável e as ações que mudam a
// SITUAÇÃO da proposta (Finalizar, Em Execução). Mesmo recorte do menu Propostas (/projetos/propostas): admin e comercial. A visibilidade por
// departamento NÃO se aplica aqui: quem gere propostas gere todas.
export const gestaoPropostasRouter = Router();
gestaoPropostasRouter.use(requireAuth, requireRole("admin", "comercial"));

/** "7,8" -> [7, 8]; vazio ou sem número válido -> null (sem recorte). O 0 é um valor válido. */
function lerIds(valor: unknown): number[] | null {
  if (typeof valor !== "string" || valor === "") return null;
  const ids = valor
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));
  return ids.length > 0 ? ids : null;
}

function lerFiltrosTopo(req: Request): FiltrosGestaoPropostas {
  return {
    // Mesmo padrão da Eficiência: sem o parâmetro (ou com valor desconhecido), "De clientes".
    tipo: req.query.tipo === "int" || req.query.tipo === "all" ? req.query.tipo : "cli",
    situacoes: lerIds(req.query.situacao),
    depexes: lerIds(req.query.depexe),
    modpros: lerIds(req.query.modpro),
    busca: typeof req.query.busca === "string" ? req.query.busca : "",
  };
}

/** As colunas em R$ só existem para quem pode ver valores de proposta (domain/valoresDaProposta.ts): quem não pode nem recebe o número. */
async function podeVerValores(req: Request): Promise<boolean> {
  const r = req as AuthenticatedRequest;
  const user = await prisma.user.findUnique({ where: { id: r.user!.userId } });
  if (!user) return false;
  const contexto = await resolverContextoConsultor(user.email);
  return podeVerValoresDaProposta(r.user!.role as string, contexto.departamentosGerenciados);
}

const dominioDe = (rotulos: string[]) => rotulos.map((r) => ({ valor: r, rotulo: r }));

// ---------- Lista mestre: propostas de TODAS as situações ----------
// Registrada ANTES de qualquer rota com `:param` deste router (o Express atende a primeira; /propostas/resumo não pode cair numa rota de detalhe).
// Sem `totais`: o campo `totais` rodaria o agregado de RAT sobre o filtro inteiro em TODA página e anularia o cálculo por linha. O Σ do rodapé
// é sob demanda (GET /resumo) e aí `precisaCalcularConjunto` liga o cálculo do conjunto.
registrarListaConsultavel(
  gestaoPropostasRouter,
  "/propostas",
  async (req): Promise<ListaConsultavel> => {
    const comValores = await podeVerValores(req);
    const { com, interna } = consultaGestaoPropostas(lerFiltrosTopo(req), {
      conjunto: precisaCalcularConjunto(req.query as Record<string, unknown>),
      comValores,
    });
    return {
      com,
      interna,
      colunas: [
        col.inteiro("codpro", { obrigatoria: true }),
        col.inteiro("codlev2"),
        col.texto("sitproLabel", { obrigatoria: true }),
        col.inteiro("numprj"),
        col.texto("cliente", { obrigatoria: true }),
        col.data("datret"),
        col.texto("despro"),
        col.texto("depexeLabel", { obrigatoria: true }),
        col.texto("forfatLabel", { obrigatoria: true }),
        // Lista composta ("A, B"): a aba "Valores" do funil não ajuda.
        col.texto("depcusrecLabel", { semValores: true }),
        col.texto("modproLabel", { obrigatoria: true }),
        // Nula quando a proposta não tem relacionada (ou ela não está no CaxHub).
        col.texto("modproRelacLabel"),
        col.inteiro("totalItens", { obrigatoria: true }),
        col.inteiro("totalRats", { obrigatoria: true }),
        col.inteiro("ratsBloqueando", { obrigatoria: true }),
        col.decimal("horasProposta", { obrigatoria: true }),
        col.decimal("horasRat", { obrigatoria: true }),
        col.decimal("saldoHoras", { obrigatoria: true }),
        col.decimal("horasFaturadas", { obrigatoria: true }),
        col.decimal("horasNaoFaturadas", { obrigatoria: true }),
        ...(comValores ? [col.decimal("valorFaturamento", { obrigatoria: true }), col.decimal("valorNaoFaturado", { obrigatoria: true })] : []),
      ],
      ordemPadrao: ORDEM_PADRAO_GESTAO_PROPOSTAS,
      pageSizePadrao: 15,
      // Só exibição (não filtra nem ordena): a mudança de situação a caminho do Senior, uma consulta só para as chaves da página.
      decorar: async (linhas) => {
        if (linhas.length === 0) return linhas;
        const pendencias = await prisma.sincronizacaoPendenteProposta.findMany({
          where: { OR: linhas.map((l) => ({ codemp: l.codemp as number, codpro: l.codpro as number })) },
          orderBy: [{ codemp: "asc" }, { codpro: "asc" }, { id: "desc" }],
          distinct: ["codemp", "codpro"],
        });
        const porChave = new Map(pendencias.map((p) => [`${p.codemp}-${p.codpro}`, p]));
        return linhas.map((l) => {
          const p = porChave.get(`${l.codemp}-${l.codpro}`);
          // A última pendência já enviada não é mais "a caminho": a situação nova já está na linha.
          const aberta = p && p.status !== "enviado" ? p : null;
          return {
            ...l,
            pendenciaSituacao: aberta?.status ?? null,
            pendenciaSituacaoErro: aberta?.ultimoErro ?? null,
            // pendente sem falha real: só espera o ERP poder receber (porta ainda não publicada, ou escrita desligada neste ambiente).
            pendenciaSituacaoAguardando: aberta ? aberta.status === "pendente" && ehAvisoDeEspera(aberta.ultimoErro) : false,
            pendenciaSituacaoPara: aberta ? sitproLabel(aberta.sitproPara) : null,
          };
        });
      },
    };
  },
  "gestao-propostas",
);

// ---------- Lista filha: as RATs de UMA proposta ----------
// O caminho NÃO leva :codemp/:codpro de propósito: o PDF e o "Imprimir" remontam a URL a partir do caminho REGISTRADO (listaConsultavel.ts), então um
// caminho com parâmetro viraria literal. A proposta viaja em ?codemp=&codpro=, que a lista repassa à exportação.
// Reusa a consulta de "Meus Apontamentos" (domain/ratsListaSql.ts, com a regra de integração já guardada por teste de paridade), com
// visibilidade total: o recorte aqui é a PROPOSTA, não o consultor/departamento de quem olha — quem abre esta tela vê todas as RATs dela.
// Horas em MINUTOS (totalMinutos, minutosFaturaveis...), ao contrário da lista mestre (horas decimais).
registrarListaConsultavel(
  gestaoPropostasRouter,
  "/rats",
  async (req): Promise<ListaConsultavel> => {
    const codemp = Number(req.query.codemp);
    const codpro = Number(req.query.codpro);
    if (!Number.isInteger(codemp) || !Number.isInteger(codpro)) throw new ErroEntradaConsulta("Informe codemp e codpro da proposta.");
    const comValores = await podeVerValores(req);
    const filtros: FiltrosTopoRats = {
      codfors: [],
      sitrats: lerIds(req.query.sitrat) ?? [],
      busca: typeof req.query.busca === "string" ? req.query.busca : "",
      buscaItem: "",
      integracao: [],
      codemp,
      codpro,
    };
    const { com, interna } = consultaRatsLista(
      { todas: true, codfor: null, depexes: [] },
      filtros,
      { conjunto: precisaCalcularConjuntoRats(req.query as Record<string, unknown>, filtros), comFaturamento: true },
    );
    return {
      com,
      interna,
      colunas: [
        col.inteiro("id", { obrigatoria: true }),
        col.inteiro("numrat"),
        col.data("datemi"),
        col.texto("sitratLabel", { obrigatoria: true, dominio: dominioDe(ROTULOS_SITRAT) }),
        col.texto("consultorNome", { obrigatoria: true }),
        col.texto("integracaoLabel", { obrigatoria: true, dominio: dominioDe(ROTULOS_INTEGRACAO) }),
        col.inteiro("totalItens", { obrigatoria: true }),
        col.inteiro("totalMinutos", { obrigatoria: true }),
        col.inteiro("minutosFaturaveis", { obrigatoria: true }),
        col.inteiro("minutosNaoFaturaveis", { obrigatoria: true }),
        ...(comValores ? [col.decimal("valorFaturamento", { obrigatoria: true }), col.decimal("valorNaoFaturado", { obrigatoria: true })] : []),
      ],
      ordemPadrao: ORDEM_PADRAO_RATS,
      pageSizePadrao: 10,
      decorar: (linhas) =>
        linhas.map((l) => {
          const excluida = l.excluida === true;
          return {
            ...l,
            sitratTone: sitratToneEfetivo({ sitrat: l.sitrat as number | null, removidoEmSenior: excluida ? new Date(0) : null }),
            integracaoTone: integracaoErpTone(l.integracao as Parameters<typeof integracaoErpTone>[0]),
          };
        }),
    };
  },
  "gestao-propostas-rats",
);

// GET /opcoes-filtro — situações, departamentos e modalidades que os filtros do topo oferecem, sempre do domínio do backend (nunca lista fixa na tela).
gestaoPropostasRouter.get("/opcoes-filtro", (_req, res) => {
  res.json({
    situacoes: SITPRO_ORDER.map((sitpro) => ({ sitpro, label: sitproLabel(sitpro) })),
    departamentos: Object.entries(DEPEXE_LABELS).map(([depexe, label]) => ({ depexe: Number(depexe), label })),
    modalidades: Object.entries(MODPRO_LABELS).map(([modpro, label]) => ({ modpro: Number(modpro), label })),
  });
});

// ---------- Daqui para baixo, rotas com :param (depois das duas listas) ----------

interface ChaveProposta {
  codemp: number;
  codpro: number;
}

function lerChave(req: Request, res: Response): ChaveProposta | null {
  const codemp = Number(req.params.codemp);
  const codpro = Number(req.params.codpro);
  if (!Number.isInteger(codemp) || !Number.isInteger(codpro)) {
    res.status(400).json({ error: "Parâmetros inválidos" });
    return null;
  }
  return { codemp, codpro };
}

function erroInterno(res: Response, erro: unknown, rotulo: string) {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  console.error(`[gestao-propostas:${rotulo}]`, mensagem);
  res.status(500).json({ error: mensagem });
}

/** Traz do Senior a proposta, os itens, as atividades de consultor e as RATs (cabeçalhos e apontamentos) dela. Propaga o erro: quem chama responde 502. */
async function sincronizarProposta({ codemp, codpro }: ChaveProposta, opcoes: { comAtividades: boolean }) {
  const encontrada = await runPropostaSyncPorCodpro(codemp, codpro);
  const totalItens = await runPropostaItemSyncPorCodpro(codemp, codpro);
  const totalAtividades = opcoes.comAtividades ? await runAtividadeConsultorSyncPorCodpro(codemp, codpro) : 0;
  // Esta tela analisa RATs: sem elas aqui, "Horas em RAT" e o bloqueio do Finalizar ficariam com o espelho da madrugada. Os apontamentos
  // vêm DEPOIS do cabeçalho (RatItem.ratId depende dele).
  const totalRats = await runRatSyncPorCodpro(codemp, codpro);
  const totalItensRat = await runRatItemSyncPorCodpro(codemp, codpro);
  return { encontrada, totalItens, totalAtividades, totalRats, totalItensRat };
}

// POST /propostas/:codemp/:codpro/sincronizar — "Sinc. ERP" da linha e do campo de número digitado (que pode ser uma proposta que o CaxHub nunca viu;
// os syncs por codpro fazem upsert). Sem checagem de acesso por departamento: o requireRole do router já é o recorte.
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/sincronizar", async (req, res) => {
  try {
    const chave = lerChave(req, res);
    if (!chave) return;
    try {
      res.json({ ok: true, ...(await sincronizarProposta(chave, { comAtividades: true })) });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      res.status(502).json({ error: `Falha ao sincronizar com o ERP: ${message}` });
    }
  } catch (erro) {
    erroInterno(res, erro, "sincronizar");
  }
});

type AcaoSituacao = "finalizar" | "em-execucao";

type ResultadoPreparo =
  | { ok: true; proposta: { sitpro: number | null }; destino: number; tipo: typeof TIPO_FINALIZAR_PROPOSTA | typeof TIPO_REABRIR_EXECUCAO_PROPOSTA }
  | { ok: false; status: 400 | 404 | 409 | 502; motivo: string };

/**
 * Valida a mudança de situação sem tocar `res` (devolve o motivo), na ordem da casa (rats.ts, aprovar/fechar): proposta existe → não foi excluída
 * no Senior → situação de origem exata → nada em voo → regra de negócio (Finalizar: nenhuma RAT Digitada ou Fechada). Antes de validar, traz a
 * proposta (e, no Finalizar, as RATs) do Senior: a validação vale contra o dado de agora, não contra o espelho da madrugada.
 */
async function prepararMudancaSituacao({ codemp, codpro }: ChaveProposta, acao: AcaoSituacao): Promise<ResultadoPreparo> {
  try {
    await runPropostaSyncPorCodpro(codemp, codpro);
    if (acao === "finalizar") {
      await runRatSyncPorCodpro(codemp, codpro);
      await runRatItemSyncPorCodpro(codemp, codpro);
    }
  } catch (erro) {
    const message = erro instanceof Error ? erro.message : String(erro);
    return { ok: false, status: 502, motivo: `Falha ao sincronizar com o ERP: ${message}` };
  }

  const proposta = await prisma.proposta.findUnique({
    where: { codemp_codpro: { codemp, codpro } },
    select: { sitpro: true, removidoEmSenior: true },
  });
  if (!proposta) return { ok: false, status: 404, motivo: "Proposta não encontrada" };
  if (proposta.removidoEmSenior != null) {
    return { ok: false, status: 400, motivo: "Esta proposta foi excluída no Senior — não é possível alterar a situação" };
  }

  const atual = sitproLabel(proposta.sitpro);
  if (acao === "finalizar") {
    if (proposta.sitpro == null || !SITPRO_FINALIZAVEL.includes(proposta.sitpro)) {
      return { ok: false, status: 400, motivo: `Só é possível finalizar uma proposta Em Execução (esta está ${atual})` };
    }
  } else if (proposta.sitpro !== SITPRO_EXECUTADA) {
    return { ok: false, status: 400, motivo: `Somente uma proposta Executada pode voltar para Em Execução (esta está ${atual})` };
  }

  const emVoo = await pendenciaDeSituacaoEmAndamento(codemp, codpro);
  if (emVoo) {
    return { ok: false, status: 409, motivo: "Já existe uma alteração de situação em andamento para esta proposta" };
  }

  if (acao === "finalizar") {
    // removidoEmSenior != null NÃO bloqueia: a RAT não existe mais no Senior (o sitrat fica congelado em 9) e nem dá para fechá-la; bloquear criaria
    // um impasse sem saída pela tela. sitrat 0 (fora do domínio) também não bloqueia: não é 9 nem 1. Rascunho do CaxHub (sem numrat) BLOQUEIA.
    const bloqueando = await prisma.rat.findMany({
      where: { codemp, codpro, removidoEmSenior: null, sitrat: { in: [...SITRAT_BLOQUEIA_FINALIZAR] } },
      select: { id: true, numrat: true },
      orderBy: [{ sitrat: "asc" }, { numrat: "asc" }],
      take: 11,
    });
    if (bloqueando.length > 0) {
      const lista = bloqueando
        .slice(0, 10)
        .map((r) => (r.numrat != null ? String(r.numrat) : `local ${r.id}`))
        .join(", ");
      const total = bloqueando.length > 10 ? "mais de 10" : String(bloqueando.length);
      return {
        ok: false,
        status: 409,
        motivo: `Há ${total} RAT(s) em situação Digitada ou Fechada nesta proposta — resolva-as antes de finalizar (RAT ${lista}${bloqueando.length > 10 ? ", ..." : ""})`,
      };
    }
  }

  return acao === "finalizar"
    ? { ok: true, proposta, destino: SITPRO_EXECUTADA, tipo: TIPO_FINALIZAR_PROPOSTA }
    : { ok: true, proposta, destino: SITPRO_EM_EXECUCAO, tipo: TIPO_REABRIR_EXECUCAO_PROPOSTA };
}

async function pedirMudancaSituacao(req: Request, res: Response, acao: AcaoSituacao) {
  try {
    const chave = lerChave(req, res);
    if (!chave) return;
    const r = req as AuthenticatedRequest;
    const preparo = await prepararMudancaSituacao(chave, acao);
    if (!preparo.ok) {
      res.status(preparo.status).json({ error: preparo.motivo });
      return;
    }

    // Só a pendência: `propostas.sitpro` muda quando o Senior confirmar (outboxSeniorProposta.ts), nunca aqui.
    const pendenciaId = await enfileirarSituacaoProposta({
      codemp: chave.codemp,
      codpro: chave.codpro,
      tipo: preparo.tipo,
      sitproDe: preparo.proposta.sitpro,
      sitproPara: preparo.destino,
      usuarioId: r.user!.userId,
    });

    await criarEventoAuditoria({
      origem: "tela",
      usuarioId: r.user!.userId,
      codemp: chave.codemp,
      codpro: chave.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
      entidadeId: entidadeIdProposta(chave.codemp, chave.codpro),
      entidadeRotulo: `Proposta ${chave.codemp}/${chave.codpro}`,
      eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_SITUACAO_SOLICITADA,
      alteracoes: null,
      metadata: { tipo: preparo.tipo, de: sitproLabel(preparo.proposta.sitpro), para: sitproLabel(preparo.destino), pendenciaId },
      correlationId: r.correlationId!,
    });

    res.json({
      ok: true,
      pendenciaId,
      // A situação ATUAL (ainda não mudou); a tela mostra "Aguardando ERP" até o Senior confirmar.
      sitpro: preparo.proposta.sitpro,
      sitproLabel: sitproLabel(preparo.proposta.sitpro),
      destino: preparo.destino,
      destinoLabel: sitproLabel(preparo.destino),
      portaPublicada: portaDeSituacaoPublicada(),
    });
  } catch (erro) {
    erroInterno(res, erro, acao);
  }
}

// POST /propostas/:codemp/:codpro/finalizar — sitpro 7 -> 8 (nenhuma RAT Digitada ou Fechada).
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/finalizar", (req, res) => pedirMudancaSituacao(req, res, "finalizar"));
// POST /propostas/:codemp/:codpro/em-execucao — sitpro 8 -> 7 (só Executada volta para execução).
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/em-execucao", (req, res) => pedirMudancaSituacao(req, res, "em-execucao"));

// GET /propostas/:codemp/:codpro/situacao — a situação de agora e a última pendência de mudança, para a tela acompanhar (polling) depois da ação.
gestaoPropostasRouter.get("/propostas/:codemp/:codpro/situacao", async (req, res) => {
  try {
    const chave = lerChave(req, res);
    if (!chave) return;
    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: chave }, select: { sitpro: true } });
    if (!proposta) {
      res.status(404).json({ error: "Proposta não encontrada" });
      return;
    }
    const pendencia = await prisma.sincronizacaoPendenteProposta.findFirst({ where: chave, orderBy: { id: "desc" } });
    res.json({
      sitpro: proposta.sitpro,
      sitproLabel: sitproLabel(proposta.sitpro),
      sitproTone: sitproTone(proposta.sitpro),
      portaPublicada: portaDeSituacaoPublicada(),
      pendencia: pendencia && {
        id: pendencia.id,
        tipo: pendencia.tipo,
        status: pendencia.status,
        tentativas: pendencia.tentativas,
        // Enquanto o ERP não pode receber, o "erro" é só o aviso de espera (ver `aguardando`): a tela mostra "Aguardando ERP", não falha.
        ultimoErro: pendencia.ultimoErro,
        aguardando: pendencia.status === "pendente" && ehAvisoDeEspera(pendencia.ultimoErro),
        sitproPara: pendencia.sitproPara,
        sitproParaLabel: sitproLabel(pendencia.sitproPara),
        criadoEm: pendencia.criadoEm,
        processadoEm: pendencia.processadoEm,
      },
    });
  } catch (erro) {
    erroInterno(res, erro, "situacao");
  }
});
