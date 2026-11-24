import { Response, Router } from "express";
import { Prisma, PlanoApuracao, PlanoCicloResultadoGlobal, PlanoParticipante, PlanoValorBase } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { diffCampos } from "../audit/registrarEvento";
import { EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { codforsDoTime } from "../domain/contextoProjeto";
import { AcessoEficiencia, ehGestor } from "../domain/eficienciaAcesso";
import { hojeIso } from "../domain/eficienciaAcoes";
import { notificarConsultorPorCodfor } from "../domain/notificacoes";
import { depexeLabel } from "../domain/propostasDominio";
import { gerarPdfDaPagina, RelatorioPdfError } from "../lib/relatorioPdf";
import { VIGENCIA_INICIO, somarDias } from "../domain/planoEvolucao/calendario";
import {
  AutomaticoApurado,
  CicloAnterior,
  GlobalFechado,
  Lancamentos,
  ManualLancado,
  SnapshotApuracao,
  StatusApuracao,
  consecutivosAntesDoCiclo,
  eficienciaIndividualDaApuracao,
  lacunasAnteriores,
  lancamentosVazios,
  montarEntrada,
  montarMemoriaDeCalculo,
  pendenciasDeLancamento,
  resultadosDosIndicadores,
  rotuloPendencia,
  rotuloStatusApuracao,
} from "../domain/planoEvolucao/apuracao";
import { baseVigenteEm, carregarHorasPorOrigem, carregarItensDoCiclo, carregarNomesDeConsultores } from "../domain/planoEvolucao/planoEvolucaoDados";
import { IndicadorConfig, montarPrevia } from "../domain/planoEvolucao/previa";
import { apurarCiclo } from "../domain/planoEvolucao/regras";
import { validarContestacao, validarDesfecho, validarDevolutiva, validarLancamentos } from "../domain/planoEvolucao/validacao";
import {
  CicloComIndicadores,
  acessoDe,
  auditar,
  cicloDto,
  dataDeIso,
  exigirAdmin,
  exigirAdminOuGestor,
  handleError,
  idDoParametro,
  isoDaData,
  numOuNulo,
  parametrosDaPrevia,
  rotuloCiclo,
} from "./planoEvolucaoComum";

// Plano de Evolução — Fase 2: apuração do ciclo. Montado dentro de planoEvolucaoRouter (que já exige login e resolve o acesso).
//
// Fluxo de uma apuração (por participante e ciclo):
//   rascunho    o gestor lança portão, requisitos e indicadores manuais (editável)
//   apurado     o sistema junta tudo com os indicadores automáticos e o índice global FECHADO e congela o resultado (snapshot)
//   devolutiva  a reunião com o consultor aconteceu; a memória de cálculo vira visível para ele
//   encerrado   sem contestação pendente; é aqui que a efetivação (10º ciclo) grava o novo Valor Hora Base
// Contestação procedente reabre a apuração (a versão anterior fica em `revisoes`). Sem prazos automáticos: o gestor registra.
//
// Quem pode o quê: admin faz tudo; gestor, só no time dele e sem R$ (valor hora é dado sensível); o consultor só lê o próprio resultado
// depois da devolutiva. Fora do alcance responde 404 (nunca 403, pra não confirmar que existe).
export const planoApuracaoRouter = Router();

type ParticipanteComValores = PlanoParticipante & { valoresBase: PlanoValorBase[] };
type ApuracaoComTudo = PlanoApuracao & { ciclo: CicloComIndicadores; participante: ParticipanteComValores };

const ehEnsaio = (c: { fim: Date }) => isoDaData(c.fim) < VIGENCIA_INICIO;
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const configDoCiclo = (c: CicloComIndicadores): IndicadorConfig[] =>
  c.indicadores.map((i) => ({ chave: i.chave, tipo: i.tipo as "automatico" | "manual", peso: i.peso, meta: numOuNulo(i.meta), ativo: i.ativo }));

function lancamentosDaLinha(a: PlanoApuracao | null): Lancamentos {
  if (!a) return lancamentosVazios();
  return {
    contratoAtivoNoCiclo: a.contratoAtivoNoCiclo,
    cicloCompleto: a.cicloCompleto,
    interrupcaoDias: a.interrupcaoDias,
    competenciasPct: numOuNulo(a.competenciasPct),
    certificacoesCumpriu: a.certificacoesCumpriu,
    clientesMedia: numOuNulo(a.clientesMedia),
    clientesRespostas: a.clientesRespostas,
    caseCumpriu: a.caseCumpriu,
    eficienciaIndividualDecisao: a.eficienciaIndividualDecisao,
    manuais: Array.isArray(a.manuais) ? (a.manuais as unknown as ManualLancado[]) : [],
  };
}
const observacoesDaLinha = (a: PlanoApuracao | null) => (a?.observacoes && typeof a.observacoes === "object" && !Array.isArray(a.observacoes) ? (a.observacoes as Record<string, string | null>) : {});
const snapshotDe = (a: PlanoApuracao | null) => (a?.snapshot ? (a.snapshot as unknown as SnapshotApuracao) : null);

async function podeGerir(a: AcessoEficiencia, codfor: number): Promise<boolean> {
  if (a.admin) return true;
  if (!ehGestor(a)) return false;
  const time = await codforsDoTime("gestor", a.contexto);
  return time != null && time.has(codfor);
}

async function avisar(codfor: number, tipo: string, mensagem: string, autorUserId: number) {
  try {
    await notificarConsultorPorCodfor(codfor, tipo, mensagem, autorUserId);
  } catch (error) {
    console.error("[plano-evolucao:aviso]", error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------- carregadores

async function carregarCicloCompleto(id: number): Promise<CicloComIndicadores | null> {
  return prisma.planoCiclo.findUnique({ where: { id }, include: { indicadores: true } });
}

async function carregarApuracao(id: number): Promise<ApuracaoComTudo | null> {
  return prisma.planoApuracao.findUnique({ where: { id }, include: { ciclo: { include: { indicadores: true } }, participante: { include: { valoresBase: true } } } });
}

function globalDto(g: PlanoCicloResultadoGlobal | null) {
  if (!g) return null;
  return {
    executadoMin: g.executadoMin,
    dentroMin: g.dentroMin,
    acimaMin: g.acimaMin,
    itens: g.itens,
    indice: numOuNulo(g.indice),
    meta: Number(g.meta),
    atingiu: g.atingiu,
    semBase: g.semBase,
    calculadoEm: g.calculadoEm,
  };
}
const globalParaSnapshot = (g: PlanoCicloResultadoGlobal): GlobalFechado => ({
  indice: numOuNulo(g.indice),
  meta: Number(g.meta),
  atingiu: g.atingiu,
  semBase: g.semBase,
  executadoMin: g.executadoMin,
  dentroMin: g.dentroMin,
  acimaMin: g.acimaMin,
  itens: g.itens,
  calculadoEm: g.calculadoEm.toISOString(),
});

/** Indicadores automáticos de todos os participantes de uma vez (uma leitura do ciclo), mais o global da ÁREA calculado agora. */
async function calcularAutomaticos(ciclo: CicloComIndicadores, participantes: { id: number; codfor: number; nome: string }[]) {
  const inicio = isoDaData(ciclo.inicio);
  const fim = isoDaData(ciclo.fim);
  const [itens, horas] = await Promise.all([
    carregarItensDoCiclo({ inicio, fim, departamentosArea: ciclo.departamentosArea }),
    carregarHorasPorOrigem(inicio, fim, participantes.map((p) => p.codfor)),
  ]);
  const previa = montarPrevia(
    parametrosDaPrevia(ciclo),
    participantes.map((p) => ({ id: p.id, codfor: p.codfor, nome: p.nome, baseCentavos: null, consecutivosAntes: 0 })),
    itens,
    horas
  );
  const porCodfor = new Map<number, AutomaticoApurado[]>();
  for (const c of previa.consultores) {
    porCodfor.set(c.codfor, [
      { chave: "produtividade", valor: c.produtividade.indice, horasMin: c.produtividade.horasMin, atingiu: c.produtividade.atingiu, semBase: c.produtividade.semBase },
      { chave: "apontamento_online", valor: c.online.indice, horasMin: c.online.horasMin, atingiu: c.online.atingiu, semBase: c.online.semBase },
    ]);
  }
  return { global: previa.global, porCodfor };
}

/** Os outros ciclos do participante, no formato que o motor usa pra derivar a sequência e achar lacunas. */
async function ciclosDoParticipante(participanteId: number): Promise<CicloAnterior[]> {
  const ciclos = await prisma.planoCiclo.findMany({ where: { status: { not: "rascunho" } }, include: { apuracoes: { where: { participanteId } } }, orderBy: { inicio: "asc" } });
  return ciclos.map((c) => ({
    id: c.id,
    rotulo: rotuloCiclo(c),
    inicio: isoDaData(c.inicio),
    fim: isoDaData(c.fim),
    ensaio: ehEnsaio(c),
    apuracao: c.apuracoes[0] ? { status: c.apuracoes[0].status as StatusApuracao, consecutivosDepois: c.apuracoes[0].consecutivosDepois } : null,
  }));
}

/** Base vigente no início do ciclo (ou no fim); no ENSAIO, sem base vigente, a mais antiga lançada. */
function baseDoCiclo(valores: PlanoValorBase[], inicio: string, fim: string, ensaio: boolean): number | null {
  const vigente = baseVigenteEm(valores, inicio) ?? baseVigenteEm(valores, fim);
  if (vigente != null || !ensaio || valores.length === 0) return vigente;
  return Math.round(Number([...valores].sort((a, b) => a.desde.getTime() - b.desde.getTime())[0].valorHoraBase) * 100);
}

function bloqueiosDeApuracao(ciclo: CicloComIndicadores, global: PlanoCicloResultadoGlobal | null, lacunas: CicloAnterior[], participante: PlanoParticipante, hoje: string): string[] {
  const b: string[] = [];
  const ensaio = ehEnsaio(ciclo);
  if (participante.status !== "ativo") b.push("A participação deste consultor está encerrada.");
  if (ciclo.status === "rascunho" && !ensaio) b.push("Publique o ciclo antes de apurar.");
  if (!ensaio && hoje < isoDaData(ciclo.corteEvidencias)) b.push(`A apuração só abre no corte de evidências (${dataBr(isoDaData(ciclo.corteEvidencias))}).`);
  if (!global) b.push("Feche o índice global do ciclo antes de apurar (ele é o mesmo para todos).");
  if (lacunas.length > 0) b.push(`Apure e encerre antes: ${lacunas.map((l) => l.rotulo).join(", ")}.`);
  return b;
}

// ---------------------------------------------------------------- índice global do ciclo

planoApuracaoRouter.post("/ciclos/:id/global", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCicloCompleto(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    const ensaio = ehEnsaio(ciclo);
    if (ciclo.status === "rascunho" && !ensaio) {
      res.status(409).json({ error: "Publique o ciclo antes de fechar o índice global." });
      return;
    }
    if (!ensaio && hojeIso() < isoDaData(ciclo.corteEvidencias)) {
      res.status(409).json({ error: `O índice global só pode ser fechado a partir do corte de evidências (${dataBr(isoDaData(ciclo.corteEvidencias))}).` });
      return;
    }
    if (ciclo.metaEficienciaGlobal == null) {
      res.status(409).json({ error: "O ciclo não tem meta de eficiência global." });
      return;
    }
    const existente = await prisma.planoCicloResultadoGlobal.findUnique({ where: { cicloId: ciclo.id } });
    const refazer = req.body?.refazer === true;
    if (existente && !refazer) {
      res.status(409).json({ error: "O índice global já foi fechado. Para recalcular, peça explicitamente (refazer)." });
      return;
    }
    if (existente) {
      const jaApuradas = await prisma.planoApuracao.count({ where: { cicloId: ciclo.id, status: { not: "rascunho" } } });
      if (jaApuradas > 0) {
        res.status(409).json({ error: "Há apurações além do rascunho: o índice global não pode mais ser refeito." });
        return;
      }
    }
    const { global } = await calcularAutomaticos(ciclo, []);
    const dados = {
      executadoMin: global.executadoMin,
      dentroMin: global.dentroMin,
      acimaMin: global.acimaMin,
      itens: global.itens,
      indice: global.indice == null ? null : Math.round(global.indice * 100) / 100,
      meta: ciclo.metaEficienciaGlobal,
      atingiu: global.atingiu,
      semBase: global.semBase,
      calculadoEm: new Date(),
      calculadoPor: req.user!.userId,
    };
    const gravado = await prisma.$transaction(async (tx) => {
      const g = await tx.planoCicloResultadoGlobal.upsert({ where: { cicloId: ciclo.id }, create: { cicloId: ciclo.id, ...dados }, update: dados });
      await auditar(tx, req, { tipo: "ciclo", id: ciclo.id, rotulo: `Ciclo ${rotuloCiclo(ciclo)}` }, EVENTOS_AUDITORIA.PLANO_GLOBAL_FECHADO, {
        metadata: { indice: dados.indice, meta: Number(dados.meta), atingiu: dados.atingiu, executadoMin: dados.executadoMin, dentroMin: dados.dentroMin, refeito: !!existente },
      });
      return g;
    });
    res.status(existente ? 200 : 201).json(globalDto(gravado));
  } catch (error) {
    handleError(res, error, "fechar-global");
  }
});

// ---------------------------------------------------------------- lista do ciclo

planoApuracaoRouter.get("/ciclos/:id/apuracao", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCicloCompleto(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    const a = acessoDe(res);
    const ensaio = ehEnsaio(ciclo);
    const hoje = hojeIso();
    const time = await codforsDoTime(a.admin ? "admin" : "gestor", a.contexto);
    let participantes: ParticipanteComValores[] = await prisma.planoParticipante.findMany({
      where: ensaio ? { status: "ativo" } : { OR: [{ status: "ativo", primeiroCicloInicio: { lte: ciclo.fim } }, { apuracoes: { some: { cicloId: ciclo.id } } }] },
      include: { valoresBase: true },
      orderBy: { id: "asc" },
    });
    if (time != null) participantes = participantes.filter((p) => time.has(p.codfor));

    const [nomes, linhas, global] = await Promise.all([
      carregarNomesDeConsultores(participantes.map((p) => p.codfor)),
      prisma.planoApuracao.findMany({ where: { cicloId: ciclo.id, participanteId: { in: participantes.map((p) => p.id) } } }),
      prisma.planoCicloResultadoGlobal.findUnique({ where: { cicloId: ciclo.id } }),
    ]);
    const lista = participantes.map((p) => ({ id: p.id, codfor: p.codfor, nome: nomes.get(p.codfor)?.nome ?? `Consultor ${p.codfor}` }));
    const automaticos = await calcularAutomaticos(ciclo, lista);
    const config = configDoCiclo(ciclo);

    const linhasPor = new Map(linhas.map((l) => [l.participanteId, l]));
    const itens = [];
    for (const p of participantes) {
      const linha = linhasPor.get(p.id) ?? null;
      const status: StatusApuracao | "nao_iniciada" = linha ? (linha.status as StatusApuracao) : "nao_iniciada";
      let pendentes: string[] = [];
      if (!linha || linha.status === "rascunho") {
        const l = lancamentosDaLinha(linha);
        const inds = resultadosDosIndicadores(config, automaticos.porCodfor.get(p.codfor) ?? [], l.manuais);
        pendentes = pendenciasDeLancamento(config, l, eficienciaIndividualDaApuracao(inds, ciclo.notaMinimaEficienciaIndividual, l.eficienciaIndividualDecisao));
      }
      itens.push({
        participanteId: p.id,
        codfor: p.codfor,
        nome: nomes.get(p.codfor)?.nome ?? `Consultor ${p.codfor}`,
        departamento: nomes.get(p.codfor)?.departamento ?? null,
        apuracaoId: linha?.id ?? null,
        status,
        statusRotulo: status === "nao_iniciada" ? "Não iniciada" : rotuloStatusApuracao(status),
        pendentes: pendentes.map((x) => ({ chave: x, rotulo: rotuloPendencia(x) })),
        statusCiclo: linha?.statusCiclo ?? null,
        percentualBp: linha?.percentualBp ?? null,
        efetivou: linha?.efetivou ?? false,
        devolutivaEm: linha?.devolutivaEm ? isoDaData(linha.devolutivaEm) : null,
        contestacaoPendente: !!linha?.contestacaoTexto && !linha?.desfecho,
        // Valor hora: só o admin.
        ...(a.admin ? { valorHora: linha?.valorHoraCentavos != null ? linha.valorHoraCentavos / 100 : null } : {}),
      });
    }
    res.json({
      ciclo: cicloDto(ciclo),
      ensaio,
      mostraValores: a.admin,
      global: globalDto(global),
      // O que o índice global seria AGORA (antes de fechar), pra o admin conferir com a Gerência.
      globalAgora: { executadoMin: automaticos.global.executadoMin, dentroMin: automaticos.global.dentroMin, indice: automaticos.global.indice, atingiu: automaticos.global.atingiu, semBase: automaticos.global.semBase },
      podeFecharGlobal: a.admin && (ciclo.status !== "rascunho" || ensaio) && (ensaio || hoje >= isoDaData(ciclo.corteEvidencias)) && ciclo.metaEficienciaGlobal != null,
      abreEm: isoDaData(ciclo.corteEvidencias),
      participantes: itens.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")),
    });
  } catch (error) {
    handleError(res, error, "lista-apuracao");
  }
});

// ---------------------------------------------------------------- uma apuração

async function resolverAlvo(req: AuthenticatedRequest, res: Response): Promise<{ ciclo: CicloComIndicadores; participante: ParticipanteComValores; linha: PlanoApuracao | null } | null> {
  const cicloId = idDoParametro(req.params.cicloId);
  const participanteId = idDoParametro(req.params.participanteId);
  const [ciclo, participante] = await Promise.all([
    cicloId == null ? null : carregarCicloCompleto(cicloId),
    participanteId == null ? null : prisma.planoParticipante.findUnique({ where: { id: participanteId }, include: { valoresBase: true } }),
  ]);
  if (!ciclo || !participante || !(await podeGerir(acessoDe(res), participante.codfor))) {
    res.status(404).json({ error: "Apuração não encontrada" });
    return null;
  }
  const linha = await prisma.planoApuracao.findUnique({ where: { cicloId_participanteId: { cicloId: ciclo.id, participanteId: participante.id } } });
  return { ciclo, participante, linha };
}

async function montarDetalhe(a: AcessoEficiencia, ciclo: CicloComIndicadores, participante: ParticipanteComValores, linha: PlanoApuracao | null) {
  const hoje = hojeIso();
  const ensaio = ehEnsaio(ciclo);
  const nomes = await carregarNomesDeConsultores([participante.codfor]);
  const nome = nomes.get(participante.codfor)?.nome ?? `Consultor ${participante.codfor}`;
  const [global, anteriores, auto] = await Promise.all([
    prisma.planoCicloResultadoGlobal.findUnique({ where: { cicloId: ciclo.id } }),
    ciclosDoParticipante(participante.id),
    calcularAutomaticos(ciclo, [{ id: participante.id, codfor: participante.codfor, nome }]),
  ]);
  const inicio = isoDaData(ciclo.inicio);
  const lacunas = ensaio ? [] : lacunasAnteriores(anteriores, inicio, isoDaData(participante.primeiroCicloInicio));
  const config = configDoCiclo(ciclo);
  const status = (linha?.status as StatusApuracao) ?? "rascunho";
  const snap = snapshotDe(linha);
  const congelado = status !== "rascunho" && snap != null;

  const l = congelado ? snap!.lancamentos : lancamentosDaLinha(linha);
  const indicadores = congelado ? snap!.indicadores : resultadosDosIndicadores(config, auto.porCodfor.get(participante.codfor) ?? [], l.manuais);
  const eficiencia = congelado
    ? { cumpriu: snap!.eficienciaIndividual.cumpriu, nota: snap!.eficienciaIndividual.nota, semBase: snap!.eficienciaIndividual.semBase, decisaoManual: snap!.eficienciaIndividual.decisaoManual }
    : (() => {
        const e = eficienciaIndividualDaApuracao(indicadores, ciclo.notaMinimaEficienciaIndividual, l.eficienciaIndividualDecisao);
        return { cumpriu: e.cumpriu, nota: e.veredito.nota, semBase: e.veredito.semBase, decisaoManual: e.decisaoManual };
      })();
  const pendentes = status === "rascunho" ? pendenciasDeLancamento(config, l, { cumpriu: eficiencia.cumpriu }) : [];
  const bloqueios = status === "rascunho" ? bloqueiosDeApuracao(ciclo, global, lacunas, participante, hoje) : [];

  const base = baseDoCiclo(participante.valoresBase, inicio, isoDaData(ciclo.fim), ensaio);
  const consecutivos = consecutivosAntesDoCiclo(participante.ciclosConsecutivosAntes, anteriores, inicio);
  const mostrarValores = a.admin;

  return {
    ciclo: cicloDto(ciclo),
    ensaio,
    mostraValores: mostrarValores,
    participante: { id: participante.id, codfor: participante.codfor, nome, departamento: nomes.get(participante.codfor)?.departamento ?? null, primeiroCicloInicio: isoDaData(participante.primeiroCicloInicio) },
    apuracao: {
      id: linha?.id ?? null,
      status,
      statusRotulo: linha ? rotuloStatusApuracao(status) : "Não iniciada",
      lancamentos: l,
      observacoes: observacoesDaLinha(linha),
      lancadoEm: linha?.lancadoEm ?? null,
      indicadores,
      eficienciaIndividual: eficiencia,
      pendentes: pendentes.map((x) => ({ chave: x, rotulo: rotuloPendencia(x) })),
      apuradoEm: linha?.apuradoEm ?? null,
      resultado: linha?.statusCiclo
        ? {
            statusCiclo: linha.statusCiclo,
            pontuacaoBp: linha.pontuacaoBp,
            reforcadorBp: linha.reforcadorBp,
            percentualBp: linha.percentualBp,
            efetivou: linha.efetivou,
            motivos: linha.motivos,
            consecutivosAntes: linha.consecutivosAntes,
            consecutivosDepois: linha.consecutivosDepois,
            ...(mostrarValores ? { valorHora: (linha.valorHoraCentavos ?? 0) / 100, valorHoraBase: (linha.baseCentavos ?? 0) / 100 } : {}),
          }
        : null,
      devolutiva: linha?.devolutivaEm ? { em: isoDaData(linha.devolutivaEm), observacao: linha.devolutivaObs } : null,
      contestacao: linha?.contestacaoTexto ? { recebidaEm: linha.contestacaoRecebidaEm ? isoDaData(linha.contestacaoRecebidaEm) : null, texto: linha.contestacaoTexto } : null,
      desfecho: linha?.desfecho ? { resultado: linha.desfecho, texto: linha.desfechoTexto, em: linha.desfechoEm } : null,
      encerradoEm: linha?.encerradoEm ?? null,
      revisoes: Array.isArray(linha?.revisoes) ? (linha!.revisoes as unknown[]).length : 0,
    },
    global: globalDto(global),
    bloqueios,
    podeApurar: status === "rascunho" && bloqueios.length === 0 && pendentes.length === 0,
    estadoAntes: { consecutivos, ...(mostrarValores ? { valorHoraBase: base == null ? null : base / 100 } : {}), temBase: base != null },
    memoria: snap && status !== "rascunho" ? montarMemoriaDeCalculo(snap, mostrarValores) : null,
  };
}

planoApuracaoRouter.get("/apuracoes/:cicloId(\\d+)/:participanteId(\\d+)", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await resolverAlvo(req, res);
    if (!alvo) return;
    res.json(await montarDetalhe(acessoDe(res), alvo.ciclo, alvo.participante, alvo.linha));
  } catch (error) {
    handleError(res, error, "detalhe-apuracao");
  }
});

const CAMPOS_LANCAMENTO_AUDITADOS: Record<string, string> = {
  contratoAtivoNoCiclo: "Contrato ativo no ciclo",
  cicloCompleto: "Ciclo completo",
  interrupcaoDias: "Interrupção formal (dias)",
  competenciasPct: "Avaliação de Competências (%)",
  certificacoesCumpriu: "Certificações cumpridas",
  clientesMedia: "Média da avaliação de clientes",
  clientesRespostas: "Avaliações de clientes respondidas",
  caseCumpriu: "Case Técnico cumprido",
  eficienciaIndividualDecisao: "Decisão sobre a eficiência individual",
};

planoApuracaoRouter.put("/apuracoes/:cicloId(\\d+)/:participanteId(\\d+)", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await resolverAlvo(req, res);
    if (!alvo) return;
    const { ciclo, participante, linha } = alvo;
    const ensaio = ehEnsaio(ciclo);
    if (ciclo.status === "rascunho" && !ensaio) {
      res.status(409).json({ error: "Publique o ciclo antes de lançar a apuração." });
      return;
    }
    if (linha && linha.status !== "rascunho") {
      res.status(409).json({ error: "A apuração já foi fechada: os lançamentos estão travados. Se a contestação for procedente, ela é reaberta." });
      return;
    }
    const v = validarLancamentos(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const e = v.dados;
    const antes = lancamentosDaLinha(linha);
    const obsAtuais = observacoesDaLinha(linha);
    const manuaisNovos = e.manuais
      ? [...antes.manuais.filter((m) => !e.manuais!.some((n) => n.chave === m.chave)), ...e.manuais].sort((x, y) => x.chave.localeCompare(y.chave))
      : antes.manuais;
    const dados: Prisma.PlanoApuracaoUncheckedUpdateInput = {
      ...(e.contratoAtivoNoCiclo !== undefined ? { contratoAtivoNoCiclo: e.contratoAtivoNoCiclo } : {}),
      ...(e.cicloCompleto !== undefined ? { cicloCompleto: e.cicloCompleto } : {}),
      ...(e.interrupcaoDias !== undefined ? { interrupcaoDias: e.interrupcaoDias } : {}),
      ...(e.competenciasPct !== undefined ? { competenciasPct: e.competenciasPct } : {}),
      ...(e.certificacoesCumpriu !== undefined ? { certificacoesCumpriu: e.certificacoesCumpriu } : {}),
      ...(e.clientesMedia !== undefined ? { clientesMedia: e.clientesMedia } : {}),
      ...(e.clientesRespostas !== undefined ? { clientesRespostas: e.clientesRespostas } : {}),
      ...(e.caseCumpriu !== undefined ? { caseCumpriu: e.caseCumpriu } : {}),
      ...(e.eficienciaIndividualDecisao !== undefined ? { eficienciaIndividualDecisao: e.eficienciaIndividualDecisao } : {}),
      ...(e.manuais ? { manuais: manuaisNovos as unknown as Prisma.InputJsonValue } : {}),
      ...(e.observacoes ? { observacoes: { ...obsAtuais, ...e.observacoes } as Prisma.InputJsonValue } : {}),
      lancadoPor: req.user!.userId,
      lancadoEm: new Date(),
    };

    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const rotulo = `Apuração ${rotuloCiclo(ciclo)}: ${nomes.get(participante.codfor)?.nome ?? participante.codfor}`;
    await prisma.$transaction(async (tx) => {
      const gravada = linha
        ? await tx.planoApuracao.update({ where: { id: linha.id }, data: dados })
        : await tx.planoApuracao.create({ data: { ...dados, cicloId: ciclo.id, participanteId: participante.id, ensaio } as Prisma.PlanoApuracaoUncheckedCreateInput });
      const diff = diffCampos(CAMPOS_LANCAMENTO_AUDITADOS, antes as unknown as Record<string, unknown>, lancamentosDaLinha(gravada) as unknown as Record<string, unknown>);
      const alteracoes = { ...diff.alteracoes };
      for (const m of e.manuais ?? []) {
        const era = antes.manuais.find((x) => x.chave === m.chave)?.atingiu ?? null;
        if (era !== m.atingiu) alteracoes[`manual_${m.chave}`] = { de: era, para: m.atingiu, rotulo: `Indicador ${m.chave}` };
      }
      if (e.observacoes) alteracoes.observacoes = { de: null, para: Object.keys(e.observacoes).join(", "), rotulo: "Observações editadas" };
      await auditar(tx, req, { tipo: "apuracao", id: gravada.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_LANCADA, { alteracoes });
    });
    const depois = await prisma.planoApuracao.findUnique({ where: { cicloId_participanteId: { cicloId: ciclo.id, participanteId: participante.id } } });
    res.json(await montarDetalhe(acessoDe(res), ciclo, participante, depois));
  } catch (error) {
    handleError(res, error, "lancar-apuracao");
  }
});

planoApuracaoRouter.post("/apuracoes/:cicloId/:participanteId/apurar", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await resolverAlvo(req, res);
    if (!alvo) return;
    const { ciclo, participante, linha } = alvo;
    if (linha && linha.status !== "rascunho") {
      res.status(409).json({ error: "Esta apuração já foi fechada." });
      return;
    }
    const detalhe = await montarDetalhe(acessoDe(res), ciclo, participante, linha);
    if (detalhe.bloqueios.length > 0) {
      res.status(409).json({ error: detalhe.bloqueios.join(" "), bloqueios: detalhe.bloqueios });
      return;
    }
    if (detalhe.apuracao.pendentes.length > 0) {
      res.status(400).json({ error: `Faltam lançamentos: ${detalhe.apuracao.pendentes.map((p) => p.rotulo).join("; ")}.`, pendentes: detalhe.apuracao.pendentes });
      return;
    }

    const ensaio = ehEnsaio(ciclo);
    const inicio = isoDaData(ciclo.inicio);
    const base = baseDoCiclo(participante.valoresBase, inicio, isoDaData(ciclo.fim), ensaio);
    if (base == null) {
      res.status(409).json({ error: "Este participante não tem Valor Hora Base lançado." });
      return;
    }
    const global = (await prisma.planoCicloResultadoGlobal.findUnique({ where: { cicloId: ciclo.id } }))!;
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const nome = nomes.get(participante.codfor)?.nome ?? `Consultor ${participante.codfor}`;
    const anteriores = await ciclosDoParticipante(participante.id);
    const estadoAntes = { baseCentavos: base, consecutivos: consecutivosAntesDoCiclo(participante.ciclosConsecutivosAntes, anteriores, inicio) };

    const lanc = detalhe.apuracao.lancamentos;
    const eficiencia = detalhe.apuracao.eficienciaIndividual;
    // Índice global sem base (poucas horas na área) não trava a apuração de ninguém: o 5º ponto é opcional e, sem como medir, não é concedido.
    const entrada = montarEntrada(lanc, eficiencia.cumpriu, global.atingiu === true);
    const saida = apurarCiclo(estadoAntes, entrada, { naoApuradoQuebraSequencia: ciclo.naoApuradoQuebraSequencia });
    const r = saida.resultado;

    const snapshot: SnapshotApuracao = {
      versao: 1,
      geradoEm: new Date().toISOString(),
      ciclo: {
        id: ciclo.id,
        rotulo: rotuloCiclo(ciclo),
        inicio,
        fim: isoDaData(ciclo.fim),
        ensaio,
        amostraMinimaHoras: ciclo.amostraMinimaHoras,
        notaMinimaEficienciaIndividual: ciclo.notaMinimaEficienciaIndividual,
        definicaoOnline: ciclo.definicaoOnline as "A" | "B",
        departamentosAreaRotulos: ciclo.departamentosArea.map((d) => depexeLabel(d)),
        indicadores: configDoCiclo(ciclo),
      },
      participante: { id: participante.id, codfor: participante.codfor, nome },
      estadoAntes,
      lancamentos: lanc,
      indicadores: detalhe.apuracao.indicadores,
      eficienciaIndividual: { cumpriu: eficiencia.cumpriu, nota: eficiencia.nota, pontos: 0, base: 0, semBase: eficiencia.semBase, decisaoManual: eficiencia.decisaoManual },
      global: globalParaSnapshot(global),
      entrada,
      resultado: r,
      estadoDepois: saida.proximo,
    };
    // pontos/base do requisito 6.4 vêm do veredito (não de `eficiencia`, que só carrega a nota): recalcula pra registrar fielmente.
    const ver = eficienciaIndividualDaApuracao(detalhe.apuracao.indicadores, ciclo.notaMinimaEficienciaIndividual, lanc.eficienciaIndividualDecisao).veredito;
    snapshot.eficienciaIndividual.pontos = ver.pontos;
    snapshot.eficienciaIndividual.base = ver.base;

    const rotulo = `Apuração ${rotuloCiclo(ciclo)}: ${nome}`;
    const gravada = await prisma.$transaction(async (tx) => {
      const dados = {
        status: "apurado",
        apuradoEm: new Date(),
        apuradoPor: req.user!.userId,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        statusCiclo: r.status,
        pontuacaoBp: r.pontuacaoBp,
        reforcadorBp: r.reforcadorBp,
        percentualBp: r.percentualBp,
        baseCentavos: estadoAntes.baseCentavos,
        valorHoraCentavos: r.valorHoraCentavos,
        consecutivosAntes: estadoAntes.consecutivos,
        consecutivosDepois: saida.proximo.consecutivos,
        efetivou: r.efetivou,
        globalAtingido: global.atingiu === true,
        motivos: r.motivos,
      };
      const row = linha
        ? await tx.planoApuracao.update({ where: { id: linha.id }, data: dados })
        : await tx.planoApuracao.create({ data: { cicloId: ciclo.id, participanteId: participante.id, ensaio, ...dados } });
      await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_APURADA, {
        metadata: { statusCiclo: r.status, percentualBp: r.percentualBp, valorHoraCentavos: r.valorHoraCentavos, efetivou: r.efetivou, motivos: r.motivos, consecutivosAntes: estadoAntes.consecutivos },
      });
      return row;
    });
    res.json(await montarDetalhe(acessoDe(res), ciclo, participante, gravada));
  } catch (error) {
    handleError(res, error, "apurar");
  }
});

// ---------------------------------------------------------------- devolutiva, contestação, desfecho e encerramento

type AcaoDeLinha = { tipo: "nenhuma" };

async function carregarLinhaExistente(req: AuthenticatedRequest, res: Response) {
  const alvo = await resolverAlvo(req, res);
  if (!alvo) return null;
  if (!alvo.linha) {
    res.status(409).json({ error: "Esta apuração ainda não foi iniciada." });
    return null;
  }
  const completo = await carregarApuracao(alvo.linha.id);
  return completo ? { ...alvo, linha: completo } : null;
}

planoApuracaoRouter.post("/apuracoes/:cicloId/:participanteId/devolutiva", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await carregarLinhaExistente(req, res);
    if (!alvo) return;
    const { linha, ciclo, participante } = alvo;
    if (linha.status !== "apurado") {
      res.status(409).json({ error: linha.status === "rascunho" ? "Apure antes de registrar a devolutiva." : "A devolutiva já foi registrada." });
      return;
    }
    const v = validarDevolutiva(req.body, hojeIso());
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const rotulo = `Apuração ${rotuloCiclo(ciclo)}: ${nomes.get(participante.codfor)?.nome ?? participante.codfor}`;
    const atualizada = await prisma.$transaction(async (tx) => {
      const row = await tx.planoApuracao.update({ where: { id: linha.id }, data: { status: "devolutiva", devolutivaEm: dataDeIso(v.dados.devolutivaEm), devolutivaPor: req.user!.userId, devolutivaObs: v.dados.observacao } });
      await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_DEVOLUTIVA, { metadata: { devolutivaEm: v.dados.devolutivaEm, observacao: v.dados.observacao } });
      return row;
    });
    if (!linha.ensaio) await avisar(participante.codfor, "plano_resultado_disponivel", `O resultado do ${rotuloCiclo(ciclo)} no Plano de Evolução está disponível, com a memória de cálculo. Veja em Meu plano.`, req.user!.userId);
    res.json(await montarDetalhe(acessoDe(res), ciclo, participante, atualizada));
  } catch (error) {
    handleError(res, error, "devolutiva");
  }
});

planoApuracaoRouter.post("/apuracoes/:cicloId/:participanteId/contestacao", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await carregarLinhaExistente(req, res);
    if (!alvo) return;
    const { linha, ciclo, participante } = alvo;
    if (linha.status !== "devolutiva") {
      res.status(409).json({ error: linha.status === "encerrado" ? "A apuração já foi encerrada." : "A contestação vem depois da devolutiva." });
      return;
    }
    if (linha.contestacaoTexto && !linha.desfecho) {
      res.status(409).json({ error: "Já existe uma contestação aguardando desfecho." });
      return;
    }
    const v = validarContestacao(req.body, hojeIso());
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const rotulo = `Apuração ${rotuloCiclo(ciclo)}: ${nomes.get(participante.codfor)?.nome ?? participante.codfor}`;
    const atualizada = await prisma.$transaction(async (tx) => {
      // Nova contestação (depois de um desfecho "mantida") começa limpa: o desfecho anterior fica na auditoria.
      const row = await tx.planoApuracao.update({
        where: { id: linha.id },
        data: { contestacaoRecebidaEm: dataDeIso(v.dados.recebidaEm), contestacaoTexto: v.dados.texto, contestacaoRegistradaPor: req.user!.userId, desfecho: null, desfechoTexto: null, desfechoEm: null, desfechoPor: null },
      });
      await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_CONTESTADA, { metadata: { recebidaEm: v.dados.recebidaEm, texto: v.dados.texto } });
      return row;
    });
    res.json(await montarDetalhe(acessoDe(res), ciclo, participante, atualizada));
  } catch (error) {
    handleError(res, error, "contestacao");
  }
});

planoApuracaoRouter.post("/apuracoes/:cicloId/:participanteId/desfecho", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await carregarLinhaExistente(req, res);
    if (!alvo) return;
    const { linha, ciclo, participante } = alvo;
    if (linha.status !== "devolutiva" || !linha.contestacaoTexto || linha.desfecho) {
      res.status(409).json({ error: "Não há contestação aguardando desfecho." });
      return;
    }
    const v = validarDesfecho(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const a = acessoDe(res);
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const rotulo = `Apuração ${rotuloCiclo(ciclo)}: ${nomes.get(participante.codfor)?.nome ?? participante.codfor}`;

    if (v.dados.resultado === "mantida") {
      const atualizada = await prisma.$transaction(async (tx) => {
        const row = await tx.planoApuracao.update({ where: { id: linha.id }, data: { desfecho: "mantida", desfechoTexto: v.dados.texto, desfechoEm: new Date(), desfechoPor: req.user!.userId } });
        await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_DESFECHO, { metadata: { resultado: "mantida", texto: v.dados.texto } });
        return row;
      });
      res.json(await montarDetalhe(a, ciclo, participante, atualizada));
      return;
    }

    // Procedente: reabre a apuração. Só o admin (mexe no resultado) e só se NENHUM ciclo posterior deste participante já foi além do rascunho,
    // porque o reforçador dos seguintes depende deste resultado.
    if (!a.admin) {
      res.status(403).json({ error: "Só o administrador reabre uma apuração." });
      return;
    }
    const posteriores = await prisma.planoApuracao.count({ where: { participanteId: participante.id, ensaio: false, status: { not: "rascunho" }, ciclo: { inicio: { gt: ciclo.inicio } } } });
    if (!linha.ensaio && posteriores > 0) {
      res.status(409).json({ error: "Há ciclos posteriores já apurados para este consultor: reabrir este mudaria o reforçador deles." });
      return;
    }
    const revisao = {
      reabertoEm: new Date().toISOString(),
      reabertoPor: req.user!.userId,
      snapshot: linha.snapshot,
      devolutivaEm: linha.devolutivaEm,
      contestacao: { recebidaEm: linha.contestacaoRecebidaEm, texto: linha.contestacaoTexto },
      desfecho: { resultado: "procedente", texto: v.dados.texto },
    };
    const atualizada = await prisma.$transaction(async (tx) => {
      const row = await tx.planoApuracao.update({
        where: { id: linha.id },
        data: {
          status: "rascunho",
          revisoes: [...(Array.isArray(linha.revisoes) ? (linha.revisoes as unknown[]) : []), revisao] as unknown as Prisma.InputJsonValue,
          snapshot: Prisma.DbNull,
          apuradoEm: null,
          apuradoPor: null,
          statusCiclo: null,
          pontuacaoBp: null,
          reforcadorBp: null,
          percentualBp: null,
          baseCentavos: null,
          valorHoraCentavos: null,
          consecutivosAntes: null,
          consecutivosDepois: null,
          efetivou: false,
          globalAtingido: null,
          motivos: [],
          devolutivaEm: null,
          devolutivaPor: null,
          devolutivaObs: null,
          contestacaoRecebidaEm: null,
          contestacaoTexto: null,
          contestacaoRegistradaPor: null,
          desfecho: null,
          desfechoTexto: null,
          desfechoEm: null,
          desfechoPor: null,
        },
      });
      await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_DESFECHO, { metadata: { resultado: "procedente", texto: v.dados.texto } });
      await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_REABERTA, { metadata: { motivo: v.dados.texto, revisoes: (row.revisoes as unknown[]).length } });
      return row;
    });
    res.json(await montarDetalhe(a, ciclo, participante, atualizada));
  } catch (error) {
    handleError(res, error, "desfecho");
  }
});

planoApuracaoRouter.post("/apuracoes/:cicloId/:participanteId/encerrar", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const alvo = await carregarLinhaExistente(req, res);
    if (!alvo) return;
    const { linha, ciclo, participante } = alvo;
    if (linha.status !== "devolutiva") {
      res.status(409).json({ error: linha.status === "encerrado" ? "A apuração já está encerrada." : "Registre a devolutiva antes de encerrar." });
      return;
    }
    if (linha.contestacaoTexto && !linha.desfecho) {
      res.status(409).json({ error: "Há uma contestação sem desfecho: registre o desfecho antes de encerrar." });
      return;
    }
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const rotulo = `Apuração ${rotuloCiclo(ciclo)}: ${nomes.get(participante.codfor)?.nome ?? participante.codfor}`;
    const efetivacaoDesde = isoDaData(ciclo.fim) && somarDias(isoDaData(ciclo.fim), 1);
    const atualizada = await prisma.$transaction(async (tx) => {
      const row = await tx.planoApuracao.update({ where: { id: linha.id }, data: { status: "encerrado", encerradoEm: new Date(), encerradoPor: req.user!.userId } });
      let novaBase: number | null = null;
      // Efetivação (10º ciclo consecutivo): o valor do ciclo vira o novo Valor Hora Base a partir do dia seguinte, em definitivo. Ensaio não efetiva.
      if (!linha.ensaio && linha.efetivou && linha.valorHoraCentavos != null) {
        const ja = await tx.planoValorBase.findFirst({ where: { participanteId: participante.id, desde: dataDeIso(efetivacaoDesde), motivo: "efetivacao" } });
        if (!ja) {
          novaBase = linha.valorHoraCentavos / 100;
          await tx.planoValorBase.create({ data: { participanteId: participante.id, valorHoraBase: novaBase, desde: dataDeIso(efetivacaoDesde), motivo: "efetivacao", observacao: `Efetivação do ${rotuloCiclo(ciclo)}`, criadoPor: req.user!.userId } });
        }
      }
      await auditar(tx, req, { tipo: "apuracao", id: row.id, rotulo }, EVENTOS_AUDITORIA.PLANO_APURACAO_ENCERRADA, { metadata: { efetivou: linha.efetivou && !linha.ensaio, novoValorHoraBase: novaBase, desde: novaBase != null ? efetivacaoDesde : null } });
      return row;
    });
    res.json(await montarDetalhe(acessoDe(res), ciclo, participante, atualizada));
  } catch (error) {
    handleError(res, error, "encerrar-apuracao");
  }
});

// ---------------------------------------------------------------- memória de cálculo (tela e PDF)

// Admin vê tudo (com R$); gestor do time vê sem R$; o consultor vê a PRÓPRIA depois da devolutiva (com o valor dele). Fora disso 404.
async function acessoAMemoria(a: AcessoEficiencia, apuracao: ApuracaoComTudo): Promise<{ ok: boolean; valores: boolean }> {
  if (apuracao.status === "rascunho" || !apuracao.snapshot) return { ok: false, valores: false };
  if (a.admin) return { ok: true, valores: true };
  if (a.contexto.consultor?.codfor === apuracao.participante.codfor && (apuracao.status === "devolutiva" || apuracao.status === "encerrado")) return { ok: true, valores: true };
  if (await podeGerir(a, apuracao.participante.codfor)) return { ok: true, valores: false };
  return { ok: false, valores: false };
}

planoApuracaoRouter.get("/apuracoes/:id/memoria", async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const apuracao = id == null ? null : await carregarApuracao(id);
    const acesso = apuracao ? await acessoAMemoria(acessoDe(res), apuracao) : { ok: false, valores: false };
    if (!apuracao || !acesso.ok) {
      res.status(404).json({ error: "Memória de cálculo não encontrada" });
      return;
    }
    res.json({
      id: apuracao.id,
      status: apuracao.status,
      statusRotulo: rotuloStatusApuracao(apuracao.status),
      mostraValores: acesso.valores,
      devolutivaEm: apuracao.devolutivaEm ? isoDaData(apuracao.devolutivaEm) : null,
      contestacao: apuracao.contestacaoTexto ? { recebidaEm: apuracao.contestacaoRecebidaEm ? isoDaData(apuracao.contestacaoRecebidaEm) : null, texto: apuracao.contestacaoTexto } : null,
      desfecho: apuracao.desfecho ? { resultado: apuracao.desfecho, texto: apuracao.desfechoTexto } : null,
      memoria: montarMemoriaDeCalculo(apuracao.snapshot as unknown as SnapshotApuracao, acesso.valores),
    });
  } catch (error) {
    handleError(res, error, "memoria");
  }
});

// PDF da memória: abre a página do próprio frontend num Chromium com o token de quem pediu, então sai igual ao "Imprimir" e só enxerga o que essa pessoa já enxergaria.
planoApuracaoRouter.post("/apuracoes/:id/memoria/pdf", async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const apuracao = id == null ? null : await carregarApuracao(id);
    const acesso = apuracao ? await acessoAMemoria(acessoDe(res), apuracao) : { ok: false, valores: false };
    if (!apuracao || !acesso.ok) {
      res.status(404).json({ error: "Memória de cálculo não encontrada" });
      return;
    }
    const b = req.body ?? {};
    const escolher = <T extends string>(valor: unknown, validos: readonly T[], padrao: T): T => validos.find((x) => x === valor) ?? padrao;
    const params = new URLSearchParams({ tema: escolher(b.tema, ["claro", "escuro"] as const, "claro"), orientacao: escolher(b.orientacao, ["retrato", "paisagem"] as const, "retrato") });
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const pdf = await gerarPdfDaPagina(`/projetos/eficiencia/plano-evolucao/memoria/${apuracao.id}?${params.toString()}`, token);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="memoria-de-calculo-${apuracao.id}.pdf"`);
    res.send(pdf);
  } catch (error) {
    if (error instanceof RelatorioPdfError) {
      console.error("[plano-evolucao:memoria-pdf]", error.message);
      res.status(error.status).json({ error: error.message });
      return;
    }
    handleError(res, error, "memoria-pdf");
  }
});

// ---------------------------------------------------------------- CSV para faturamento e aditivo

const csvCampo = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const reais = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
const pctBp = (bp: number | null) => (bp == null ? "" : (bp / 100).toFixed(2).replace(".", ","));

// O CaxHub não paga, informa: este arquivo diz quanto cada consultor fatura por hora no ciclo (e quem efetiva). Só admin; só apurações ENCERRADAS.
planoApuracaoRouter.get("/ciclos/:id/export", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCicloCompleto(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    const linhas = await prisma.planoApuracao.findMany({ where: { cicloId: ciclo.id, status: "encerrado" }, include: { participante: true } });
    const nomes = await carregarNomesDeConsultores(linhas.map((l) => l.participante.codfor));
    const cabecalho = ["Ciclo", "Ensaio", "Consultor", "Codigo", "Situacao", "Pontuacao %", "Reforcador %", "Percentual %", "Valor hora base (R$)", "Valor hora do ciclo (R$)", "Efetiva (10o ciclo)", "Novo valor base (R$)", "Devolutiva em", "Encerrada em"];
    const corpo = linhas
      .sort((x, y) => (nomes.get(x.participante.codfor)?.nome ?? "").localeCompare(nomes.get(y.participante.codfor)?.nome ?? "", "pt-BR"))
      .map((l) =>
        [
          rotuloCiclo(ciclo),
          l.ensaio ? "SIM" : "não",
          nomes.get(l.participante.codfor)?.nome ?? `Consultor ${l.participante.codfor}`,
          l.participante.codfor,
          l.statusCiclo === "cumprido" ? "cumprido" : l.statusCiclo === "descumprido" ? "descumprido" : "não apurado",
          pctBp(l.pontuacaoBp),
          pctBp(l.reforcadorBp),
          pctBp(l.percentualBp),
          reais(l.baseCentavos),
          reais(l.valorHoraCentavos),
          l.efetivou && !l.ensaio ? "SIM" : "não",
          l.efetivou && !l.ensaio ? reais(l.valorHoraCentavos) : "",
          l.devolutivaEm ? dataBr(isoDaData(l.devolutivaEm)) : "",
          l.encerradoEm ? dataBr(isoDaData(l.encerradoEm)) : "",
        ]
          .map(csvCampo)
          .join(";")
      );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="plano-evolucao-${ciclo.ano}-s${ciclo.semestre}.csv"`);
    // BOM + ponto e vírgula + vírgula decimal: abre direto no Excel em português.
    res.send(`﻿${[cabecalho.join(";"), ...corpo].join("\r\n")}`);
  } catch (error) {
    handleError(res, error, "export-csv");
  }
});
