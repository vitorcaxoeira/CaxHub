import { Router } from "express";
import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  depexeLabel,
  priproLabel,
  DEPEXE_LABELS,
  PRIPRO_LABELS,
  SITPRO_ATIVIDADES_VISIVEIS,
} from "../domain/propostasDominio";
import { resolverContextoConsultor, podeExecutarAcao, consultoresDosDepartamentos, gerenciaDepartamento } from "../domain/contextoProjeto";
import { notificarConsultorDaAtividade, notificarGestoresDoDepartamento } from "../domain/notificacoes";
import { UPLOADS_DIR } from "../config/uploads";
import { enfileirar } from "../sync/outboxSenior";
import { criarEventoAuditoria, criarEventosDeData, diffCampos, paraDiff } from "../audit/registrarEvento";
import { CAMPOS_AUDITADOS_ATIVIDADE_DATAS, CAMPOS_AUDITADOS_EXCEDENTE } from "../audit/camposAuditados";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { avaliarEntradaEmExecucao, formatarMinutos } from "../domain/tetoAtividade";
import { diaSemanaDaSessao, limitePorExpediente } from "../domain/jornadaConsultor";
import { limiteDaSessaoAberta, prazoDeEncerramento, MENSAGEM_MOTIVO, MotivoLimite } from "../domain/limiteSessao";
import {
  RAIA_A_FAZER,
  RAIA_EM_ANDAMENTO,
  colunaEfetiva,
  descricaoPadraoDaAtividade,
  escolherDescricaoPadrao,
  montarOperacoesMovimentacao,
  podeIniciar,
  podeParar,
} from "../domain/execucaoAtividade";

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
//
// Coalescência: `/`, `/indicadores` e `/opcoes-filtro` chamam essa função de forma
// independente, quase ao mesmo tempo, a cada abertura da tela — sem isso, o cálculo
// pesado abaixo roda 3x em paralelo pra montar exatamente o mesmo resultado. Não é um
// cache com TTL (não fica stale): só reaproveita o resultado enquanto o cálculo já está
// em andamento; a entrada some do Map assim que a promise resolve/rejeita, então uma
// chamada logo depois (ex.: `carregar()` após mover um card) sempre recalcula do zero.
const carregamentosEmAndamento = new Map<string, ReturnType<typeof carregarAtividadesVisiveisImpl>>();

function carregarAtividadesVisiveis(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  const chave = JSON.stringify({
    role,
    codfor: contexto.consultor?.codfor ?? null,
    gerenciados: contexto.departamentosGerenciados,
    time: contexto.departamentosTime,
  });
  const existente = carregamentosEmAndamento.get(chave);
  if (existente) return existente;
  const promessa = carregarAtividadesVisiveisImpl(role, contexto).finally(() => carregamentosEmAndamento.delete(chave));
  carregamentosEmAndamento.set(chave, promessa);
  return promessa;
}

async function carregarAtividadesVisiveisImpl(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  const [atividades, primeiraColuna] = await Promise.all([
    prisma.atividadeConsultor.findMany({
      where: { sitreg: "A" },
      include: { coluna: true },
      orderBy: { id: "asc" },
    }),
    prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } }),
  ]);

  // Chaves derivadas só de `atividades` (sem I/O) — as 7 queries abaixo não dependem
  // umas das outras, só desse array, então disparam todas juntas num único Promise.all.
  const codempsUnicos = [...new Set(atividades.map((a) => a.codemp))];
  const codprosUnicos = [...new Set(atividades.map((a) => a.codpro))];
  const seqatisValidos = [...new Set(atividades.map((a) => a.seqati).filter((s): s is bigint => s != null))];
  const atividadeIds = atividades.map((a) => a.id);
  const idsEstrutura = [...new Set(atividades.map((a) => a.estruturaAtividadeId).filter((id): id is number => id != null))];
  const codforUnicos = [...new Set(atividades.map((a) => a.codfor))];

  const [itens, ratItemsComHoras, sessoesNaoConfirmadas, sessoesAbertas, nosEstrutura, propostas, consultores] = await Promise.all([
    // `IN` em vez de `OR` por chave composta: com 2000+ atividades ativas, um `OR` com uma
    // cláusula por atividade explode o planning time do Postgres (medido: ~1,4s só de
    // planejamento, pra ~46ms de execução). Traz um pequeno superset (todos os itens dos
    // codpro referenciados, não só o seqite exato) — sem problema, `itemPorChave` filtra
    // pela chave exata codemp-codpro-seqite logo abaixo.
    codprosUnicos.length > 0
      ? prisma.propostaItem.findMany({
          where: { codemp: { in: codempsUnicos }, codpro: { in: codprosUnicos } },
          select: { codemp: true, codpro: true, seqite: true, depexe: true, despro: true, qtdhor: true },
        })
      : Promise.resolve([]),
    seqatisValidos.length > 0
      ? prisma.ratItem.findMany({
          where: { seqati: { in: seqatisValidos }, horini: { not: null }, horfim: { not: null } },
          select: { seqati: true, horini: true, horfim: true },
        })
      : Promise.resolve([]),
    atividadeIds.length > 0
      ? prisma.atividadeSessaoExecucao.findMany({
          where: { atividadeId: { in: atividadeIds }, confirmada: false, fim: { not: null } },
          select: { atividadeId: true, inicio: true, fim: true },
        })
      : Promise.resolve([]),
    atividadeIds.length > 0
      ? prisma.atividadeSessaoExecucao.findMany({
          where: { atividadeId: { in: atividadeIds }, fim: null },
          // expedienteProrrogadoAte entra aqui porque o limite depende dela: sem a
          // prorrogacao o card continuaria travando o cronometro no fim do expediente
          // mesmo depois do consultor confirmar que segue trabalhando.
          select: { atividadeId: true, inicio: true, expedienteProrrogadoAte: true },
        })
      : Promise.resolve([]),
    idsEstrutura.length > 0
      ? prisma.estruturaAtividade.findMany({
          where: { id: { in: idsEstrutura } },
          select: { id: true, nome: true, percentualConcluido: true },
        })
      : Promise.resolve([]),
    // Mesmo motivo do `propostaItem` acima: `IN` composto em vez de `OR` por chave.
    codprosUnicos.length > 0
      ? prisma.proposta.findMany({
          where: { codemp: { in: codempsUnicos }, codpro: { in: codprosUnicos } },
          include: { cliente: true },
        })
      : Promise.resolve([]),
    codforUnicos.length > 0
      ? prisma.consultor.findMany({
          where: { codfor: { in: codforUnicos } },
          include: { usuariosCaxHub: { select: { fotoUrl: true } } },
        })
      : Promise.resolve([]),
  ]);

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
  const minutosRealizadosPorSeqati = new Map<bigint, number>();
  for (const item of ratItemsComHoras) {
    if (item.seqati == null || item.horini == null || item.horfim == null) continue;
    const atual = minutosRealizadosPorSeqati.get(item.seqati) ?? 0;
    minutosRealizadosPorSeqati.set(item.seqati, atual + (item.horfim - item.horini));
  }

  // Acumula em MILISSEGUNDOS e arredonda uma vez por atividade — ver o mesmo cuidado em
  // domain/tetoAtividade.ts. Arredondar sessao a sessao zerava as de menos de 30s.
  const msRealizadosPorAtividadeId = new Map<number, number>();
  for (const s of sessoesNaoConfirmadas) {
    if (s.fim == null) continue;
    msRealizadosPorAtividadeId.set(s.atividadeId, (msRealizadosPorAtividadeId.get(s.atividadeId) ?? 0) + (s.fim.getTime() - s.inicio.getTime()));
  }
  const minutosRealizadosPorAtividadeId = new Map<number, number>();
  for (const [id, ms] of msRealizadosPorAtividadeId) minutosRealizadosPorAtividadeId.set(id, Math.round(ms / 60000));
  function horasRealizadasDaAtividade(a: (typeof atividades)[number]): number {
    return (a.seqati != null ? minutosRealizadosPorSeqati.get(a.seqati) ?? 0 : 0) + (minutosRealizadosPorAtividadeId.get(a.id) ?? 0);
  }

  // Sessão ABERTA (fim: null) de cada atividade — alimenta o cronômetro ao vivo no
  // Kanban/Lista (card em "Em Andamento" mostra o timer contando a partir daqui). No
  // máximo 1 por atividade (a regra de start/stop garante isso), então um Map simples.
  const sessaoAbertaPorAtividadeId = new Map(sessoesAbertas.map((s) => [s.atividadeId, s.inicio]));

  // Até quando cada sessão aberta pode contar — é o instante em que o cronômetro do card
  // trava e a tela pede a baixa, sem esperar a varredura de 5 em 5 minutos.
  //
  // Calculado só pras sessões abertas (raramente mais que um punhado), fora do Promise.all
  // acima porque depende de `atividades` e da jornada de quem está executando. Usa a MESMA
  // função da varredura (limiteDaSessaoAberta): se divergissem, o cronômetro travaria numa
  // hora e o servidor fecharia em outra.
  const limitePorAtividadeId = new Map<number, { instante: string; motivo: string }>();
  if (sessoesAbertas.length > 0) {
    const atividadePorId = new Map(atividades.map((a) => [a.id, a]));
    const codforsExecutando = [
      ...new Set(sessoesAbertas.map((s) => atividadePorId.get(s.atividadeId)?.codfor).filter((c): c is number => c != null)),
    ];
    const jornadas =
      codforsExecutando.length > 0
        ? await prisma.jornadaConsultor.findMany({ where: { codfor: { in: codforsExecutando } } })
        : [];
    const jornadaPorChave = new Map(jornadas.map((j) => [`${j.codemp}-${j.codfor}-${j.diaSemana}`, j]));

    for (const sessao of sessoesAbertas) {
      const atividade = atividadePorId.get(sessao.atividadeId);
      if (!atividade) continue;
      const jornada = jornadaPorChave.get(`${atividade.codemp}-${atividade.codfor}-${diaSemanaDaSessao(sessao.inicio)}`) ?? null;
      const limite = await limiteDaSessaoAberta(sessao, atividade, jornada);
      if (limite) limitePorAtividadeId.set(atividade.id, { instante: limite.instante.toISOString(), motivo: limite.motivo });
    }
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

  const nosEstruturaPorId = new Map(nosEstrutura.map((n) => [n.id, n]));
  const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));
  const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

  return atividades
    .map((a) => {
      const depexe = depexePorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`);
      const proposta = propostaPorChave.get(`${a.codemp}-${a.codpro}`);
      // Sem item/proposta correspondente (órfão) — não dá pra saber departamento/cliente, não exibe.
      if (depexe == null || !proposta) return null;

      // Recorte por situação da proposta. Aqui, e não em cada rota, pra valer de uma vez
      // no quadro, na lista, no calendário, na timeline, nos KPIs e nos indicadores.
      if (proposta.sitpro == null || !SITPRO_ATIVIDADES_VISIVEIS.includes(proposta.sitpro)) return null;

      if (!podeExecutarAcao(role, contexto, "visualizar", { depexe, codfor: a.codfor })) return null;

      const consultor = consultorPorCodfor.get(a.codfor);
      const coluna = colunaEfetiva(a.coluna, primeiraColuna);
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
        // Vínculo opcional Consultor -> User (ver schema.prisma) — só existe foto quando o
        // consultor também tem uma conta CaxHub com avatar próprio configurado.
        consultorFotoUrl: consultor?.usuariosCaxHub[0]?.fotoUrl ?? null,
        codfor: a.codfor,
        qtdhorPrevisto: a.qtdhor,
        // Excedente autorizado pelo gestor. Vai separado do previsto de propósito: o card
        // mostra o teto somado (previsto + excedente) mas precisa saber a parcela extra
        // pra sinalizar que aquele número já não é o planejado original.
        horasExcedentes: a.horasExcedentes,
        // Derivado de `coluna` (e não de `a.colunaId`) pra não haver como os dois
        // divergirem — o card renderiza por `coluna` e o drag-and-drop compara por este id.
        colunaId: coluna?.id ?? null,
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
        // Início da sessão em aberto (fim: null) — presente só quando a atividade está
        // "Em Andamento" agora; o cronômetro do frontend conta a partir deste timestamp.
        sessaoAtualInicio: sessaoAbertaPorAtividadeId.get(a.id)?.toISOString() ?? null,
        // Instante em que esta sessão precisa parar, e por quê. Nulo quando nada a limita
        // (atividade sem alocação e consultor sem jornada).
        sessaoLimite: limitePorAtividadeId.get(a.id)?.instante ?? null,
        sessaoLimiteMotivo: limitePorAtividadeId.get(a.id)?.motivo ?? null,
        estruturaAtividadeId: a.estruturaAtividadeId,
        estruturaNome: noEstrutura?.nome ?? null,
        estruturaPercentual: noEstrutura?.percentualConcluido ?? null,
        // Texto com que o modal "O que foi feito?" abre preenchido ao parar. Sai do
        // servidor, e não de um `estruturaNome ?? itemDescricao` no front, porque é a MESMA
        // escolha que a parada automática grava — em dois lugares elas divergiriam.
        descricaoPadrao: escolherDescricaoPadrao(noEstrutura?.nome ?? null, item?.despro ?? null),
        // Mesma regra de acesso da Alocação (departamentosPermitidos/podeGerenciarProposta
        // em alocacao.ts) — evita mandar um consultor comum pra rota do cronograma, que
        // devolveria 403 por não gerenciar o departamento.
        podeVerCronograma: gerenciaDepartamento(role, contexto, depexe),
        // Mesma regra do cronograma, nome próprio: liberar horas acima do planejado é
        // decisão de gestor, e o dono da atividade não autoriza as próprias horas.
        podeAutorizarExcedente: gerenciaDepartamento(role, contexto, depexe),
        // O outro lado: pedir horas é ato de quem executa. `> 0` porque codfor 0 circula
        // como sentinela de "não se aplica a um consultor" (ver alocacao.ts).
        souOExecutor:
          contexto.consultor?.codfor != null && contexto.consultor.codfor > 0 && contexto.consultor.codfor === a.codfor,
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
    const { contexto, role } = ctx;
    // "Gestor" aqui é o mesmo Líder Técnico derivado de DepartamentoGestor que o resto do
    // módulo usa — não um papel (Role). Admin entra junto por ver o módulo inteiro.
    const ehGestor = role === "admin" || contexto.departamentosGerenciados.length > 0;

    const consultoresPorCodfor = new Map<number, string>();
    // Colegas de departamento: quem divide time comigo mais quem está nos departamentos
    // que eu gerencio. Vem do cadastro, não das atividades — um colega que ainda não tem
    // nenhuma atividade precisa aparecer no filtro do mesmo jeito.
    const meusDepartamentos = [...new Set([...contexto.departamentosTime, ...contexto.departamentosGerenciados])];
    if (role !== "admin") {
      for (const c of await consultoresDosDepartamentos(meusDepartamentos)) {
        if (c.codfor != null) consultoresPorCodfor.set(c.codfor, c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`);
      }
      // Eu mesmo: estar num DepartamentoTime não é garantido (gestor costuma só gerenciar),
      // e o filtro tem que oferecer no mínimo o próprio usuário.
      const eu = contexto.consultor;
      if (eu?.codfor != null) consultoresPorCodfor.set(eu.codfor, eu.nomcom ?? eu.nomfor ?? `Fornecedor ${eu.codfor}`);
    }

    // Admin, e quem não está em departamento nenhum, cairia num filtro vazio. Nesses casos
    // a lista volta a ser derivada das atividades visíveis (todo `visiveis`, não só o
    // backlog, pra incluir quem só tem atividade concluída).
    if (consultoresPorCodfor.size === 0) {
      const visiveis = await carregarAtividadesVisiveis(role, contexto);
      for (const v of visiveis) consultoresPorCodfor.set(v.codfor, v.consultorNome);
    }

    const consultores = [...consultoresPorCodfor.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    // Seleção inicial da tela: quem não é gestor abre vendo só as próprias atividades —
    // hoje o quadro abre com o de todo mundo. Gestor abre sem recorte, com o time inteiro.
    const meuCodfor = contexto.consultor?.codfor ?? null;
    const consultorPadrao = !ehGestor && meuCodfor != null ? [meuCodfor] : [];

    res.json({ departamentos, prioridades, consultores, consultorPadrao, ehGestor });
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
    // Lista separada por vírgula ("134,207") — o seletor da tela é multi-seleção. Number("")
    // é 0, não NaN, então sem a guarda de string vazia um filtro ausente viraria [0] e
    // esconderia todas as atividades. Mesmo padrão de rats.ts e de Mercado > Pedidos.
    const filtroCodfors = (typeof req.query.codfor === "string" ? req.query.codfor : "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v !== 0);
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
      .filter((item) => filtroCodfors.length === 0 || filtroCodfors.includes(item.codfor))
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

// GET /:id/detalhe — os mesmos dados de cabeçalho que a tela de Atividades passa por prop
// pro AtividadeDetalhe, mas para UMA atividade. Existe porque "Meus Apontamentos" precisa
// abrir esse mesmo detalhe a partir de um apontamento, e lá só se tem o atividadeId.
//
// Reaproveita `carregarAtividadesVisiveis` de propósito, mesmo carregando mais do que
// precisa: é o que garante que a regra de visibilidade e os campos derivados (itemAlocado,
// itemRealizado, percentual da estrutura, podeEditar, podeVerCronograma) sejam
// exatamente os mesmos da listagem. Duplicar essa derivação aqui seria a receita pra
// divergir silenciosamente depois. Como a busca é por id dentro da lista visível, uma
// atividade que o usuário não pode ver simplesmente não é encontrada -> 404.
atividadesRouter.get("/:id/detalhe", async (req: AuthenticatedRequest, res) => {
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

    const visiveis = await carregarAtividadesVisiveis(ctx.role, ctx.contexto);
    const atividade = visiveis.find((a) => a.id === id);
    if (!atividade) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }

    res.json({ atividade });
  } catch (error) {
    handleError(res, error, "detalhe");
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

    // Mesma regra de teto do botão Iniciar, e pelo mesmo motivo: arrastar o card pra uma
    // raia que conta como execução abre sessão igual. Sem isto o bloqueio do Iniciar teria
    // uma porta dos fundos a um arrasto de distância.
    //
    // Só quando ENTRA em execução: tirar o card de lá pra qualquer outra raia continua
    // livre, senão uma atividade estourada ficaria presa em "Em Andamento".
    const entradaEmExecucao = colunaNova.contaComoExecucao ? await avaliarEntradaEmExecucao(atividade) : null;
    if (entradaEmExecucao && !entradaEmExecucao.permitida) {
      res.status(409).json({ error: entradaEmExecucao.mensagem, teto: entradaEmExecucao.teto, saldo: entradaEmExecucao.saldo });
      return;
    }

    // Sessão de execução: sair de qualquer coluna fecha a sessão aberta (se houver);
    // entrar numa coluna marcada como "em execução" abre uma nova. Lógica compartilhada
    // com POST /:id/start e /:id/stop — ver backend/src/domain/execucaoAtividade.ts.
    const agora = new Date();
    // Mesma resolução de coluna da listagem e do start/stop. Aqui não há validação contra
    // ela, mas é o que a auditoria registra como raia de origem — sem o fallback, mover um
    // card que estava em "A Fazer" na tela ficaria gravado como vindo de lugar nenhum.
    const [colunaGravada, primeiraColuna] = await Promise.all([
      atividade.colunaId != null ? prisma.quadroColuna.findUnique({ where: { id: atividade.colunaId } }) : null,
      prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } }),
    ]);
    const colunaAnterior = colunaEfetiva(colunaGravada, primeiraColuna);
    const correlationId = req.correlationId!;

    const observacao = typeof req.body?.observacao === "string" ? req.body.observacao.trim() || null : null;

    const { operacoes } = await montarOperacoesMovimentacao({
      atividade,
      colunaAnterior,
      colunaNova,
      usuarioId: user.id,
      origemSessao: "movimentacao_kanban",
      correlationId,
      agora,
      observacaoFechamento: observacao,
    });
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

    res.json({ id, colunaId: colunaIdNovo, aviso: entradaEmExecucao?.mensagem ?? null });
  } catch (error) {
    handleError(res, error, "mover");
  }
});

// ---------- Start/Stop (controle manual de execução, independente do drag-and-drop) ----------

async function carregarAtividadeParaExecucao(id: number) {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
  if (!atividade) return null;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) return null;
  // Mesma resolução de coluna que a listagem usa (ver colunaEfetiva) — sem ela, atividade
  // com colunaId nulo aparece em "A Fazer" no quadro e o start recusa com 409.
  const [colunaDaAtividade, primeiraColuna] = await Promise.all([
    atividade.colunaId != null ? prisma.quadroColuna.findUnique({ where: { id: atividade.colunaId } }) : null,
    prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } }),
  ]);
  return { atividade, depexe: item.depexe, colunaAtual: colunaEfetiva(colunaDaAtividade, primeiraColuna) };
}

atividadesRouter.post("/:id/start", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeParaExecucao(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const { atividade, depexe, colunaAtual } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "mover", { depexe, codfor: atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para iniciar esta atividade" });
      return;
    }

    // Validação da mesma regra de negócio do frontend (podeIniciar/podeParar) — o
    // frontend só desabilita o botão; quem garante de verdade é o servidor.
    if (!podeIniciar(colunaAtual?.nome)) {
      res.status(409).json({ error: `Atividade não está em "${RAIA_A_FAZER}" — não pode ser iniciada agora.` });
      return;
    }

    // Teto de horas: bloqueia se já foi consumido, avisa se está perto. O aviso volta no
    // 200 (campo `aviso`) em vez de virar erro — perto do teto ainda é trabalho válido, e
    // interromper o consultor aqui só o faria começar sem registrar.
    const entrada = await avaliarEntradaEmExecucao(atividade);
    if (!entrada.permitida) {
      res.status(409).json({ error: entrada.mensagem, teto: entrada.teto, saldo: entrada.saldo });
      return;
    }

    const [colunaAFazer, colunaEmAndamento] = await Promise.all([
      prisma.quadroColuna.findFirst({ where: { nome: RAIA_A_FAZER } }),
      prisma.quadroColuna.findFirst({ where: { nome: RAIA_EM_ANDAMENTO } }),
    ]);
    if (!colunaAFazer || !colunaEmAndamento) {
      res.status(500).json({ error: "Raias padrão do quadro não configuradas (\"A Fazer\"/\"Em Andamento\")" });
      return;
    }

    const agora = new Date();
    const correlationId = req.correlationId!;
    const operacoes: Prisma.PrismaPromise<unknown>[] = [];

    // Regra de concorrência: 1 atividade em andamento por consultor — se já houver outra
    // com sessão aberta, para ela automaticamente (mesma transação, mesmo correlationId)
    // antes de iniciar esta.
    const sessaoDoConsultor = await prisma.atividadeSessaoExecucao.findFirst({
      where: { fim: null, atividade: { codfor: atividade.codfor, id: { not: id } } },
      include: { atividade: { include: { coluna: true } } },
    });

    let pausada: { id: number; codpro: number } | null = null;
    if (sessaoDoConsultor) {
      const atividadeAnterior = sessaoDoConsultor.atividade;
      const { operacoes: opsPausa } = await montarOperacoesMovimentacao({
        atividade: atividadeAnterior,
        colunaAnterior: atividadeAnterior.coluna,
        colunaNova: colunaAFazer,
        usuarioId: user.id,
        origemSessao: "manual",
        correlationId,
        agora,
      });
      operacoes.push(...opsPausa);
      pausada = { id: atividadeAnterior.id, codpro: atividadeAnterior.codpro };

      if (atividadeAnterior.seqati != null) {
        await enfileirar(atividadeAnterior.id, "mover_coluna", {
          seqati: atividadeAnterior.seqati.toString(),
          colunaAnteriorId: atividadeAnterior.colunaId,
          colunaNovaId: colunaAFazer.id,
          colunaNovaNome: colunaAFazer.nome,
        });
      }
    }

    const { operacoes: opsInicio } = await montarOperacoesMovimentacao({
      atividade,
      colunaAnterior: colunaAtual,
      colunaNova: colunaEmAndamento,
      usuarioId: user.id,
      origemSessao: "manual",
      correlationId,
      agora,
    });
    operacoes.push(...opsInicio);

    await prisma.$transaction(operacoes);

    if (colunaEmAndamento.notificarGestor) {
      const mensagem = `${user.nome} iniciou a atividade da proposta ${atividade.codpro}`;
      await notificarGestoresDoDepartamento(atividade.codemp, depexe, "atividade_movida", mensagem, id, user.id);
    }
    if (atividade.seqati != null) {
      await enfileirar(id, "mover_coluna", {
        seqati: atividade.seqati.toString(),
        colunaAnteriorId: atividade.colunaId,
        colunaNovaId: colunaEmAndamento.id,
        colunaNovaNome: colunaEmAndamento.nome,
      });
    }

    res.json({
      id,
      colunaId: colunaEmAndamento.id,
      sessaoInicio: agora.toISOString(),
      pausada: pausada ? { id: pausada.id, titulo: `Proposta ${pausada.codpro}` } : null,
      aviso: entrada.mensagem,
    });
  } catch (error) {
    handleError(res, error, "start");
  }
});

// Opções de prorrogação oferecidas no alerta de fim de jornada: de 15 em 15 minutos até
// 2 horas. Validadas no servidor e não só no <select> — o valor chega pelo body.
const OPCOES_PRORROGACAO_MIN = [15, 30, 45, 60, 75, 90, 105, 120];

// Sessão aberta do consultor LOGADO, com o limite e o prazo de resposta. Endpoint enxuto
// de propósito: é consultado a cada 30s pelo vigia que roda em qualquer tela, e puxar o
// payload inteiro de GET /atividades (centenas de KB) pra isso seria desproporcional.
atividadesRouter.get("/minha-sessao-aberta", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const meuCodfor = ctx.contexto.consultor?.codfor;
    // Usuário sem Consultor vinculado não executa atividade nenhuma — nada a vigiar.
    if (meuCodfor == null) {
      res.json({ sessao: null });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.findFirst({
      where: { fim: null, atividade: { codfor: meuCodfor } },
      include: { atividade: true },
    });
    if (!sessao) {
      res.json({ sessao: null });
      return;
    }

    const jornada = await prisma.jornadaConsultor.findUnique({
      where: {
        codemp_codfor_diaSemana: {
          codemp: sessao.atividade.codemp,
          codfor: sessao.atividade.codfor,
          diaSemana: diaSemanaDaSessao(sessao.inicio),
        },
      },
    });
    const limite = await limiteDaSessaoAberta(sessao, sessao.atividade, jornada);

    res.json({
      sessao: {
        atividadeId: sessao.atividade.id,
        codpro: sessao.atividade.codpro,
        inicio: sessao.inicio.toISOString(),
        limite: limite?.instante.toISOString() ?? null,
        motivo: limite?.motivo ?? null,
        // Até quando o alerta espera resposta. Igual ao limite quando o motivo é teto —
        // ali não há pergunta a fazer.
        prazoResposta: limite ? prazoDeEncerramento(limite).toISOString() : null,
        prorrogavel: limite?.motivo === "fora_do_expediente",
        // A sessão NASCEU fora do expediente (limitePorExpediente devolve o próprio início
        // quando não há período válido depois dele). Muda o texto do alerta: "o expediente
        // terminou" é falso pra quem começou às 22h de um sábado — ali o recado é que a
        // atividade está sendo iniciada fora do horário.
        iniciouForaDoExpediente:
          limitePorExpediente(sessao.inicio, jornada)?.getTime() === sessao.inicio.getTime(),
        opcoesProrrogacao: OPCOES_PRORROGACAO_MIN,
        // Pré-preenche o "O que foi feito?" do "Encerrar agora" — mesma origem do modal de
        // parada no quadro e da herança da parada automática.
        descricaoPadrao: await descricaoPadraoDaAtividade(sessao.atividade),
      },
    });
  } catch (error) {
    handleError(res, error, "minha-sessao-aberta");
  }
});

// "Ainda estou trabalhando": empurra o fim do expediente desta sessão pelo tempo escolhido.
//
// Só o DONO da atividade prorroga. Um gestor com o quadro aberto não responde "estou
// trabalhando" pelo consultor — e é justamente por isso que o alerta também só aparece
// pra quem executa.
atividadesRouter.post("/:id/prorrogar-expediente", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const minutos = Number(req.body?.minutos);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    if (!OPCOES_PRORROGACAO_MIN.includes(minutos)) {
      res.status(400).json({ error: `minutos precisa ser um de: ${OPCOES_PRORROGACAO_MIN.join(", ")}` });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.findFirst({
      where: { atividadeId: id, fim: null },
      include: { atividade: true },
    });
    if (!sessao) {
      res.status(409).json({ error: "Não há sessão em andamento nesta atividade" });
      return;
    }
    if (ctx.contexto.consultor?.codfor !== sessao.atividade.codfor) {
      res.status(403).json({ error: "Só quem está executando a atividade pode prorrogar o expediente" });
      return;
    }

    const jornada = await prisma.jornadaConsultor.findUnique({
      where: {
        codemp_codfor_diaSemana: {
          codemp: sessao.atividade.codemp,
          codfor: sessao.atividade.codfor,
          diaSemana: diaSemanaDaSessao(sessao.inicio),
        },
      },
    });
    const limite = await limiteDaSessaoAberta(sessao, sessao.atividade, jornada);
    if (!limite || limite.motivo !== "fora_do_expediente") {
      res.status(409).json({ error: "Esta sessão não está limitada pelo expediente — não há o que prorrogar" });
      return;
    }
    // Passou da tolerância: a sessão já vai ser encerrada (ou já foi). Prorrogar aqui
    // ressuscitaria tempo que ninguém confirmou estar trabalhando.
    if (prazoDeEncerramento(limite).getTime() <= Date.now()) {
      res.status(409).json({ error: "O prazo para responder já passou — a execução será encerrada" });
      return;
    }

    // Conta a partir do LIMITE, não de agora: quem responde no minuto 4 dos 5 de
    // tolerância ganha os 15 minutos cheios a partir do fim do expediente, não 19.
    const novoLimite = new Date(limite.instante.getTime() + minutos * 60_000);
    await prisma.atividadeSessaoExecucao.update({
      where: { id: sessao.id },
      data: { expedienteProrrogadoAte: novoLimite },
    });

    res.json({ id, prorrogadoAte: novoLimite.toISOString(), minutos });
  } catch (error) {
    handleError(res, error, "prorrogar-expediente");
  }
});

// Baixa imediata de uma sessão que atingiu o limite, disparada pela tela quando o
// cronômetro do card chega lá. Existe pra não esperar até 5 minutos pela varredura com o
// card visivelmente correndo além do que vai contar.
//
// Registrada como parada AUTOMÁTICA (sem usuário, origem "job"), exatamente como o cron:
// quem está com a tela aberta pode ser o gestor olhando o quadro, não o consultor — pôr o
// nome dele na auditoria diria que ele parou a atividade de outra pessoa.
//
// O CLIENTE NÃO DECIDE NADA: ele só avisa que acha que venceu, e o servidor recalcula. Um
// relógio adiantado no navegador encerraria sessões antes da hora.
atividadesRouter.post("/:id/encerrar-automatico", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeParaExecucao(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const { atividade, colunaAtual } = resolvido;

    const sessao = await prisma.atividadeSessaoExecucao.findFirst({ where: { atividadeId: id, fim: null } });
    // Sem sessão aberta não é erro: duas abas podem disparar ao mesmo tempo, e a segunda
    // chega depois da primeira já ter fechado.
    if (!sessao) {
      res.json({ id, encerrada: false, motivo: "sem sessão aberta" });
      return;
    }

    const jornada = await prisma.jornadaConsultor.findUnique({
      where: {
        codemp_codfor_diaSemana: {
          codemp: atividade.codemp,
          codfor: atividade.codfor,
          diaSemana: diaSemanaDaSessao(sessao.inicio),
        },
      },
    });
    const limite = await limiteDaSessaoAberta(sessao, atividade, jornada);
    if (!limite) {
      res.status(409).json({ error: "Esta sessão não tem limite — nada a encerrar" });
      return;
    }
    // Expediente tem tolerância — é a janela em que o alerta espera resposta. Só depois
    // dela a sessão pode ser encerrada. Teto não tem: encerra no instante.
    //
    // A exceção é o encerramento PEDIDO ("Encerrar agora" no alerta): aí o consultor já
    // respondeu, não há o que esperar.
    const imediato = req.body?.imediato === true;
    const prazo = imediato ? limite.instante : prazoDeEncerramento(limite);
    if (prazo.getTime() > Date.now()) {
      res.status(409).json({
        error: "A sessão ainda não atingiu o limite",
        limite: limite.instante.toISOString(),
        prazoResposta: prazo.toISOString(),
      });
      return;
    }

    const colunaAFazer = await prisma.quadroColuna.findFirst({ where: { nome: RAIA_A_FAZER } });
    if (!colunaAFazer) {
      res.status(500).json({ error: `Raia "${RAIA_A_FAZER}" não configurada no quadro` });
      return;
    }

    const { operacoes } = await montarOperacoesMovimentacao({
      atividade,
      colunaAnterior: colunaAtual,
      colunaNova: colunaAFazer,
      usuarioId: null,
      origemSessao: "manual",
      correlationId: req.correlationId!,
      agora: limite.instante,
      origemEvento: "job",
      motivoParada: limite.motivo,
      // Só chega preenchido no encerramento PEDIDO ("Encerrar agora" no alerta), onde há
      // alguém pra descrever o que fez. Encerramento por silêncio e varredura não têm
      // autor, então vão sem texto — a sessão vira pendência e o consultor descreve na
      // hora de confirmar, como qualquer outra.
      observacaoFechamento: typeof req.body?.observacao === "string" ? req.body.observacao.trim() || null : null,
    });
    await prisma.$transaction(operacoes);

    res.json({
      id,
      encerrada: true,
      motivo: limite.motivo,
      mensagem: MENSAGEM_MOTIVO[limite.motivo as MotivoLimite],
      fim: limite.instante.toISOString(),
    });
  } catch (error) {
    handleError(res, error, "encerrar-automatico");
  }
});

atividadesRouter.post("/:id/stop", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAtividadeParaExecucao(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const { atividade, depexe, colunaAtual } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "mover", { depexe, codfor: atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para parar esta atividade" });
      return;
    }

    if (!podeParar(colunaAtual?.nome)) {
      res.status(409).json({ error: `Atividade não está em "${RAIA_EM_ANDAMENTO}" — não pode ser parada agora.` });
      return;
    }

    const colunaAFazer = await prisma.quadroColuna.findFirst({ where: { nome: RAIA_A_FAZER } });
    if (!colunaAFazer) {
      res.status(500).json({ error: `Raia "${RAIA_A_FAZER}" não configurada` });
      return;
    }

    const agora = new Date();
    const correlationId = req.correlationId!;
    const observacao = typeof req.body?.observacao === "string" ? req.body.observacao.trim() || null : null;
    const { operacoes, duracaoSessaoFechadaMin } = await montarOperacoesMovimentacao({
      atividade,
      colunaAnterior: colunaAtual,
      colunaNova: colunaAFazer,
      usuarioId: user.id,
      origemSessao: "manual",
      correlationId,
      agora,
      observacaoFechamento: observacao,
    });
    await prisma.$transaction(operacoes);

    if (colunaAFazer.notificarGestor) {
      const mensagem = `${user.nome} parou a atividade da proposta ${atividade.codpro}`;
      await notificarGestoresDoDepartamento(atividade.codemp, depexe, "atividade_movida", mensagem, id, user.id);
    }
    if (atividade.seqati != null) {
      await enfileirar(id, "mover_coluna", {
        seqati: atividade.seqati.toString(),
        colunaAnteriorId: atividade.colunaId,
        colunaNovaId: colunaAFazer.id,
        colunaNovaNome: colunaAFazer.nome,
      });
    }

    res.json({ id, colunaId: colunaAFazer.id, duracaoMinutos: duracaoSessaoFechadaMin ?? 0 });
  } catch (error) {
    handleError(res, error, "stop");
  }
});

// ---------- Planejamento (datas previstas de início/fim, pra Timeline/Gantt) ----------
// Horas excedentes autorizadas pelo gestor. Endpoint próprio, e não o PATCH /alocacoes/:id
// da Alocação, por dois motivos: aquele exige `qtdhor` no body (o planejado, que aqui não
// deve ser tocado) e enfileira um `editar_atividade` pro Senior — e horas excedentes são
// campo só do CaxHub, sem equivalente lá, então não há o que enviar.
//
// A permissão é explicitamente "gerencia o departamento", NÃO podeExecutarAcao("editar"):
// desde a mudança de 31/07/2026 a ação `editar` também é liberada pro dono da atividade,
// e o consultor autorizar o próprio excedente esvaziaria o controle.
atividadesRouter.patch("/:id/horas-excedentes", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const horasExcedentes = Number(req.body?.horasExcedentes);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    if (!Number.isFinite(horasExcedentes) || horasExcedentes < 0) {
      res.status(400).json({ error: "horasExcedentes precisa ser um número maior ou igual a zero (em minutos)" });
      return;
    }

    const resolvido = await carregarAtividadeComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Atividade não encontrada" });
      return;
    }
    const { atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role, user } = ctx;
    if (!gerenciaDepartamento(role, contexto, depexe)) {
      res.status(403).json({ error: "Só o gestor do departamento pode autorizar horas excedentes" });
      return;
    }

    const diff = diffCampos(CAMPOS_AUDITADOS_EXCEDENTE, atividade, paraDiff({ horasExcedentes }));
    const anterior = atividade.horasExcedentes;
    // UMA frase pro histórico e pra notificação. Se fossem duas, um dia divergiriam — e a
    // pessoa leria uma coisa no sino e outra na atividade sobre o mesmo fato.
    //
    // Começa em minúscula porque os dois lugares a emendam depois do nome de quem fez,
    // igual à frase de movimentação ("Fulano moveu de X para Y").
    //
    // Liberar, reduzir e zerar são fatos diferentes: avisar "liberou 1:00" quando o gestor
    // baixou o teto de 4:00 pra 1:00 diria o contrário do que aconteceu — e é justamente a
    // mudança que mais afeta quem está executando.
    const fato =
      horasExcedentes === 0
        ? `removeu as horas excedentes (eram ${formatarMinutos(anterior)})`
        : anterior === 0
          ? `liberou ${formatarMinutos(horasExcedentes)} de horas excedentes`
          : horasExcedentes > anterior
            ? `aumentou as horas excedentes de ${formatarMinutos(anterior)} para ${formatarMinutos(horasExcedentes)}`
            : `reduziu as horas excedentes de ${formatarMinutos(anterior)} para ${formatarMinutos(horasExcedentes)}`;

    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      prisma.atividadeConsultor.update({ where: { id }, data: { horasExcedentes } }),
    ];
    if (diff.algumaMudanca) {
      operacoes.push(
        criarEventoAuditoria({
          origem: "tela",
          usuarioId: user.id,
          codemp: atividade.codemp,
          codpro: atividade.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
          entidadeId: entidadeIdAtividade(id),
          entidadeRotulo: `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`,
          correlationId: req.correlationId!,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_ALTERADA,
          alteracoes: diff.alteracoes,
          metadata: null,
        }),
        // Na mesma transação do update: a linha do tempo da atividade não pode registrar
        // uma liberação que não chegou a acontecer.
        prisma.atividadeHistoricoMovimentacao.create({
          data: { atividadeId: id, tipo: "horas_excedentes", descricao: fato, userId: user.id },
        })
      );
    }
    await prisma.$transaction(operacoes);

    // Fora da transação, como as demais notificações do módulo: falha de notificação não
    // pode desfazer a autorização que o gestor acabou de dar.
    if (diff.algumaMudanca) {
      await notificarConsultorDaAtividade(
        atividade,
        "horas_excedentes",
        `${user.nome} ${fato} na atividade da proposta ${atividade.codpro}`,
        user.id
      );
    }

    res.json({ id, horasExcedentes, teto: (atividade.qtdhor ?? 0) + horasExcedentes });
  } catch (error) {
    handleError(res, error, "horas-excedentes");
  }
});

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

    const operacoes = [
      prisma.atividadeConsultor.update({
        where: { id },
        data: { dataPrevistaInicio, dataPrevistaFim },
      }),
      ...criarEventosDeData(
        CAMPOS_AUDITADOS_ATIVIDADE_DATAS,
        { dataPrevistaInicio: resolvido.atividade.dataPrevistaInicio, dataPrevistaFim: resolvido.atividade.dataPrevistaFim },
        { dataPrevistaInicio, dataPrevistaFim },
        {
          origem: "tela",
          usuarioId: ctx.user.id,
          codemp: resolvido.atividade.codemp,
          codpro: resolvido.atividade.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId: entidadeIdAtividade(id),
          entidadeRotulo: `Atividade — Proposta ${resolvido.atividade.codpro}`,
          correlationId: req.correlationId!,
        }
      ),
    ];
    await prisma.$transaction(operacoes);

    res.json({ id, dataPrevistaInicio, dataPrevistaFim });
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
      // Mais recente primeiro, igual à Auditoria logo abaixo no mesmo painel. O `id` como
      // desempate importa: liberação de excedente e movimentação de card nascem na mesma
      // transação e podem dividir o milissegundo — só por `movidoEm` a ordem entre elas
      // ficaria a cargo do banco.
      orderBy: [{ movidoEm: "desc" }, { id: "desc" }],
      include: { colunaAnterior: true, colunaNova: true, user: { select: { nome: true } } },
    });

    res.json({
      historico: historico.map((h) => ({
        id: h.id,
        tipo: h.tipo,
        // Preenchida só nos eventos que não são movimentação — a tela usa uma ou outra.
        descricao: h.descricao,
        colunaAnteriorNome: h.colunaAnterior?.nome ?? null,
        colunaNovaNome: h.colunaNova?.nome ?? null,
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
    await notificarConsultorDaAtividade(
      resolvido.atividade,
      "novo_comentario",
      `${ctx.user.nome} comentou na atividade da proposta ${resolvido.atividade.codpro}`,
      ctx.user.id
    );

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
