import { buscarImpedimentosDeFinalizar, mensagemDosImpedimentos } from "../domain/impedimentosDeFinalizar";
import { Router, type NextFunction, type Request, type Response } from "express";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { extrasDaConsulta } from "../consultas/camposRelacionados";
import { ErroEntradaConsulta } from "../consultas/consultaColunas";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { entidadeIdProposta } from "../audit/identidadeEntidade";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { resolverContextoConsultor } from "../domain/contextoProjeto";
import { ITENS_DOS_DEPARTAMENTOS } from "../domain/eficienciaDados";
import { resolverAcessoGestaoPropostas, type AcessoGestaoPropostas } from "../domain/gestaoPropostasAcesso";
import {
  consultaGestaoPropostas,
  FONTES_GESTAO_PROPOSTAS,
  ORDEM_PADRAO_GESTAO_PROPOSTAS,
  precisaCalcularConjunto,
  type FiltrosGestaoPropostas,
} from "../domain/gestaoPropostasSql";
import {
  DEPEXE_LABELS,
  lerMotivo,
  MODPRO_LABELS,
  SITPRO_APROVADA,
  SITPRO_CANCELADA,
  SITPRO_DECLINADA,
  SITPRO_EM_EXECUCAO,
  SITPRO_EXECUTADA,
  SITPRO_FINALIZAVEL,
  SITPRO_ORDER,
  SITPRO_REJEITADA,
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
  envioDeSituacaoLigado,
  TIPO_CANCELAR_PROPOSTA,
  TIPO_DECLINAR_PROPOSTA,
  TIPO_FINALIZAR_PROPOSTA,
  TIPO_REABRIR_EXECUCAO_PROPOSTA,
  TIPO_REJEITAR_PROPOSTA,
  type TipoPendenciaSituacao,
} from "../sync/outboxSeniorProposta";
import { runPropostaItemSyncPorCodpro } from "../sync/propostaItemSync";
import { runPropostaSyncPorCodpro } from "../sync/propostaSync";
import { runRatItemSyncPorCodpro } from "../sync/ratItemSync";
import { runRatSyncPorCodpro } from "../sync/ratSync";
import { col, registrarListaConsultavel, type ListaConsultavel } from "./listaConsultavel";

// Tela Gestão Propostas (09/11/2026): gestão das propostas — horas vendidas × executadas em RAT, o que é faturável e as ações que mudam a
// SITUAÇÃO da proposta (Finalizar, Em Execução...). Acesso (19/11/2026, domain/gestaoPropostasAcesso.ts): admin (tudo), papel comercial e líder do
// Comercial (todos os departamentos, só Sinc. ERP) e os demais líderes de departamento (só os departamentos que gerenciam, só Sinc. ERP).
export const gestaoPropostasRouter = Router();

async function exigirAcessoGestaoPropostas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = req as AuthenticatedRequest;
    const acesso = await resolverAcessoGestaoPropostas(r.user!.userId, r.user!.role as string);
    if (!acesso) {
      res.status(403).json({ error: "Sem permissão para acessar este recurso" });
      return;
    }
    res.locals.acessoGestaoPropostas = acesso;
    next();
  } catch (erro) {
    erroInterno(res, erro, "acesso");
  }
}
gestaoPropostasRouter.use(requireAuth, exigirAcessoGestaoPropostas);

const acessoDe = (res: Response) => res.locals.acessoGestaoPropostas as AcessoGestaoPropostas;

/** A proposta está dentro do recorte de departamentos da pessoa? (`null` = todos). Usada em tudo que recebe codemp/codpro: fora do recorte é 404, nunca 403. */
async function propostaNoEscopo(codemp: number, codpro: number, departamentos: number[] | null): Promise<boolean> {
  if (departamentos == null) return true;
  if (departamentos.length === 0) return false;
  const linhas = await prisma.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM propostas p
    WHERE p.codemp = ${codemp} AND p.codpro = ${codpro} AND p.removido_em_senior IS NULL AND ${ITENS_DOS_DEPARTAMENTOS(departamentos)}
    LIMIT 1`;
  return linhas.length > 0;
}

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
    // Campos de proposta/cliente que a pessoa ligou no painel de colunas (?campos=cliente__cidcli,...): só entram na consulta os pedidos.
    const extras = extrasDaConsulta(FONTES_GESTAO_PROPOSTAS, req.query as Record<string, unknown>);
    const { com, interna } = consultaGestaoPropostas({ ...lerFiltrosTopo(req), escopoDepartamentos: acessoDe(req.res!).departamentos }, {
      conjunto: precisaCalcularConjunto(req.query as Record<string, unknown>),
      comValores,
      extras,
    });
    return {
      com,
      interna,
      fontes: FONTES_GESTAO_PROPOSTAS,
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
        ...extras.colunas,
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
    if (!(await propostaNoEscopo(codemp, codpro, acessoDe(req.res!).departamentos))) throw new ErroEntradaConsulta("Proposta não encontrada", 404);
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
  const acesso = acessoDe(res);
  res.json({
    // Quem não pode mudar situação não vê as ações na tela (o backend recusa de qualquer forma, em pedirMudancaSituacao).
    podeMudarSituacao: acesso.podeMudarSituacao,
    situacoes: SITPRO_ORDER.map((sitpro) => ({ sitpro, label: sitproLabel(sitpro) })),
    // Líder: só os departamentos que gerencia.
    departamentos: Object.entries(DEPEXE_LABELS)
      .filter(([depexe]) => acesso.departamentos == null || acesso.departamentos.includes(Number(depexe)))
      .map(([depexe, label]) => ({ depexe: Number(depexe), label })),
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
    const { departamentos } = acessoDe(res);
    // Já conhecida e fora do recorte: 404 antes de qualquer chamada ao Senior.
    const jaExiste = (await prisma.proposta.count({ where: { codemp: chave.codemp, codpro: chave.codpro } })) > 0;
    if (jaExiste && !(await propostaNoEscopo(chave.codemp, chave.codpro, departamentos))) {
      res.status(404).json({ error: "Proposta não encontrada" });
      return;
    }
    try {
      const resultado = await sincronizarProposta(chave, { comAtividades: true });
      // Número que o CaxHub nunca tinha visto (Sinc. avulso): só devolve se, depois de trazida, ela está no recorte da pessoa.
      if (!jaExiste && resultado.encontrada && !(await propostaNoEscopo(chave.codemp, chave.codpro, departamentos))) {
        res.status(404).json({ error: "Proposta não encontrada" });
        return;
      }
      res.json({ ok: true, ...resultado });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      res.status(502).json({ error: `Falha ao sincronizar com o ERP: ${message}` });
    }
  } catch (erro) {
    erroInterno(res, erro, "sincronizar");
  }
});

type AcaoSituacao = "finalizar" | "em-execucao" | "rejeitar" | "cancelar" | "declinar";

/**
 * As ações de situação da tela. `origens`: de que situação cada uma pode partir. `motivo`: pede o motivo (obsSit no Senior). Rejeitar, Cancelar e Declinar só partem de
 * Aprovada; Em Execução parte de Aprovada (iniciar a execução) ou de Executada (reabrir); Finalizar parte de Em Execução e não leva motivo (16/11/2026).
 */
const ACOES_SITUACAO: Record<AcaoSituacao, { tipo: TipoPendenciaSituacao; destino: number; origens: number[]; motivo: boolean }> = {
  finalizar: { tipo: TIPO_FINALIZAR_PROPOSTA, destino: SITPRO_EXECUTADA, origens: SITPRO_FINALIZAVEL, motivo: false },
  "em-execucao": { tipo: TIPO_REABRIR_EXECUCAO_PROPOSTA, destino: SITPRO_EM_EXECUCAO, origens: [SITPRO_APROVADA, SITPRO_EXECUTADA], motivo: true },
  rejeitar: { tipo: TIPO_REJEITAR_PROPOSTA, destino: SITPRO_REJEITADA, origens: [SITPRO_APROVADA], motivo: true },
  cancelar: { tipo: TIPO_CANCELAR_PROPOSTA, destino: SITPRO_CANCELADA, origens: [SITPRO_APROVADA], motivo: true },
  declinar: { tipo: TIPO_DECLINAR_PROPOSTA, destino: SITPRO_DECLINADA, origens: [SITPRO_APROVADA], motivo: true },
};

type ResultadoPreparo =
  | { ok: true; proposta: { sitpro: number | null }; destino: number; tipo: TipoPendenciaSituacao; obsSit: string | null }
  | { ok: false; status: 400 | 404 | 409 | 502; motivo: string };

/**
 * Valida a mudança de situação sem tocar `res` (devolve o motivo), na ordem da casa (rats.ts, aprovar/fechar): proposta existe → não foi excluída
 * no Senior → situação de origem exata → nada em voo → regra de negócio (Finalizar: nenhuma RAT Digitada ou Fechada). Antes de validar, traz a
 * proposta (e, no Finalizar, as RATs) do Senior: a validação vale contra o dado de agora, não contra o espelho da madrugada.
 */
async function prepararMudancaSituacao({ codemp, codpro }: ChaveProposta, acao: AcaoSituacao, motivo: string | null): Promise<ResultadoPreparo> {
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

  const regra = ACOES_SITUACAO[acao];
  const atual = sitproLabel(proposta.sitpro);
  if (proposta.sitpro == null || !regra.origens.includes(proposta.sitpro)) {
    const permitidas = regra.origens.map((o) => sitproLabel(o)).join(" ou ");
    const oQue = acao === "finalizar" ? "finalizar" : `${acao === "em-execucao" ? "colocar Em Execução" : acao}`;
    return { ok: false, status: 400, motivo: `Só é possível ${oQue} uma proposta ${permitidas} (esta está ${atual})` };
  }

  const emVoo = await pendenciaDeSituacaoEmAndamento(codemp, codpro);
  if (emVoo) {
    return { ok: false, status: 409, motivo: "Já existe uma alteração de situação em andamento para esta proposta" };
  }

  if (acao === "finalizar") {
    // RATs Digitada/Fechada + sessões em curso + sessões pendentes de RAT: regra única em domain/impedimentosDeFinalizar.ts (a mesma do envio).
    const impedimento = mensagemDosImpedimentos(await buscarImpedimentosDeFinalizar(codemp, codpro));
    if (impedimento) return { ok: false, status: 409, motivo: impedimento };
  }

  return { ok: true, proposta, destino: regra.destino, tipo: regra.tipo, obsSit: motivo };
}

async function pedirMudancaSituacao(req: Request, res: Response, acao: AcaoSituacao) {
  try {
    if (!acessoDe(res).podeMudarSituacao) {
      res.status(403).json({ error: "Somente o administrador altera a situação da proposta" });
      return;
    }
    const chave = lerChave(req, res);
    if (!chave) return;
    const r = req as AuthenticatedRequest;
    const lido = lerMotivo((req.body as { motivo?: unknown } | undefined)?.motivo, ACOES_SITUACAO[acao].motivo);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const preparo = await prepararMudancaSituacao(chave, acao, lido.motivo);
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
      obsSit: preparo.obsSit,
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
      metadata: { tipo: preparo.tipo, de: sitproLabel(preparo.proposta.sitpro), para: sitproLabel(preparo.destino), motivo: preparo.obsSit, pendenciaId },
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
      envioLigado: envioDeSituacaoLigado(),
    });
  } catch (erro) {
    erroInterno(res, erro, acao);
  }
}

// POST /propostas/:codemp/:codpro/finalizar — sitpro 7 -> 8 (nenhuma RAT Digitada ou Fechada). Sem motivo.
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/finalizar", (req, res) => pedirMudancaSituacao(req, res, "finalizar"));
// As demais levam { motivo } no corpo (obrigatório, até 200 caracteres), enviado ao Senior em obsSit:
// POST .../em-execucao — sitpro 4 ou 8 -> 7 | .../rejeitar — 4 -> 5 | .../cancelar — 4 -> 6 | .../declinar — 4 -> 9.
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/em-execucao", (req, res) => pedirMudancaSituacao(req, res, "em-execucao"));
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/rejeitar", (req, res) => pedirMudancaSituacao(req, res, "rejeitar"));
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/cancelar", (req, res) => pedirMudancaSituacao(req, res, "cancelar"));
gestaoPropostasRouter.post("/propostas/:codemp/:codpro/declinar", (req, res) => pedirMudancaSituacao(req, res, "declinar"));

// GET /propostas/:codemp/:codpro/situacao — a situação de agora e a última pendência de mudança, para a tela acompanhar (polling) depois da ação.
gestaoPropostasRouter.get("/propostas/:codemp/:codpro/situacao", async (req, res) => {
  try {
    const chave = lerChave(req, res);
    if (!chave) return;
    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: chave }, select: { sitpro: true } });
    if (!proposta || !(await propostaNoEscopo(chave.codemp, chave.codpro, acessoDe(res).departamentos))) {
      res.status(404).json({ error: "Proposta não encontrada" });
      return;
    }
    const pendencia = await prisma.sincronizacaoPendenteProposta.findFirst({ where: chave, orderBy: { id: "desc" } });
    res.json({
      sitpro: proposta.sitpro,
      sitproLabel: sitproLabel(proposta.sitpro),
      sitproTone: sitproTone(proposta.sitpro),
      envioLigado: envioDeSituacaoLigado(),
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
