import { Response, Router } from "express";
import { Prisma, PlanoCiclo, PlanoCicloIndicador, PlanoParticipante, PlanoValorBase } from "@prisma/client";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria, diffCampos } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA, EventoAuditoriaTipo } from "../audit/taxonomia";
import { entidadeIdPlanoCiclo, entidadeIdPlanoParticipante } from "../audit/identidadeEntidade";
import { codforsDoTime } from "../domain/contextoProjeto";
import { notificarConsultorPorCodfor } from "../domain/notificacoes";
import { AcessoEficiencia, ehGestor, resolverAcesso } from "../domain/eficienciaAcesso";
import { hojeIso } from "../domain/eficienciaAcoes";
import { DEPEXE_LABELS, depexeLabel } from "../domain/propostasDominio";
import { VIGENCIA_INICIO, calendarioDoCiclo, inicioDoPrimeiroCiclo, periodoDoSemestre } from "../domain/planoEvolucao/calendario";
import { rotuloStatusApuracao } from "../domain/planoEvolucao/apuracao";
import { INDICADORES } from "../domain/planoEvolucao/eficienciaIndividual";
import { carregarHorasPorOrigem, carregarItensDoCiclo, carregarNomesDeConsultores, baseVigenteEm } from "../domain/planoEvolucao/planoEvolucaoDados";
import { INDICADORES_PADRAO, ParametrosDaPrevia, ParticipanteDaPrevia, PreviaConsultor, montarPrevia } from "../domain/planoEvolucao/previa";
import { ProjecaoDoCiclo, ResultadoCiclo, formatarPercentual } from "../domain/planoEvolucao/regras";
import {
  MOTIVOS_VALOR_BASE,
  pendenciasDePublicacao,
  validarCalendario,
  validarEdicaoCiclo,
  validarEncerramento,
  validarNovoCiclo,
  validarNovoParticipante,
  NovoParticipante,
  validarValorBase,
} from "../domain/planoEvolucao/validacao";

import {
  CicloComIndicadores,
  acessoDe,
  auditar,
  carregarAcesso,
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
import { planoApuracaoRouter } from "./planoEvolucaoApuracao";

// Plano de Evolução Profissional e Eficiência (consultores PJ) — Fase 1. Plano completo: docs/plano-evolucao/PLANO.md.
//
// Quem pode o quê:
//   admin     tudo: ciclos e parâmetros, participantes, Valor Hora Base (dado sensível), prévia com valores
//   gestor    (gerencia algum departamento) lê ciclos e a prévia SÓ do time dele e SEM valores em R$
//   consultor GET /meu: só o próprio andamento, sem colegas
// Parâmetros de ciclo publicado são TRAVADOS (o regulamento proíbe mudar com o ciclo em andamento): o PUT responde 409.
export const planoEvolucaoRouter = Router();
planoEvolucaoRouter.use(requireAuth);

planoEvolucaoRouter.use(carregarAcesso);

// ---------------------------------------------------------------- DTOs

const rotuloStatusCiclo = (r: ResultadoCiclo) => (r.status === "cumprido" ? "cumprido" : r.status === "descumprido" ? "descumprido" : "não apurado");

function resultadoDto(r: ResultadoCiclo, mostrarValor: boolean) {
  return {
    status: r.status,
    statusRotulo: rotuloStatusCiclo(r),
    motivos: r.motivos,
    pontuacaoBp: r.pontuacaoBp,
    reforcadorBp: r.reforcadorBp,
    percentualBp: r.percentualBp,
    percentualRotulo: formatarPercentual(r.percentualBp),
    cicloNaSequencia: r.cicloNaSequencia,
    efetivou: r.efetivou,
    // Valor hora em R$: dado sensível, só admin e o próprio consultor.
    ...(mostrarValor ? { valorHora: r.valorHoraCentavos / 100 } : {}),
  };
}

function projecaoDto(p: ProjecaoDoCiclo | null, mostrarValor: boolean) {
  if (!p) return null;
  return { comGlobal: resultadoDto(p.comGlobal, mostrarValor), semGlobal: resultadoDto(p.semGlobal, mostrarValor) };
}

function consultorDaPreviaDto(c: PreviaConsultor, mostrarValor: boolean) {
  const { projecao, baseCentavos, ...resto } = c;
  return { ...resto, ...(mostrarValor ? { valorHoraBase: baseCentavos == null ? null : baseCentavos / 100 } : {}), projecao: projecaoDto(projecao, mostrarValor) };
}

type ParticipanteComValores = PlanoParticipante & { valoresBase: PlanoValorBase[] };

function valoresBaseDto(valores: PlanoValorBase[]) {
  return [...valores]
    .sort((a, b) => b.desde.getTime() - a.desde.getTime() || b.id - a.id)
    .map((v) => ({
      id: v.id,
      valorHoraBase: Number(v.valorHoraBase),
      desde: isoDaData(v.desde),
      motivo: v.motivo,
      motivoRotulo: v.motivo === "adesao" ? "Adesão" : MOTIVOS_VALOR_BASE.find((m) => m.chave === v.motivo)?.rotulo ?? v.motivo,
      observacao: v.observacao,
    }));
}

// ---------------------------------------------------------------- ciclos

async function carregarCiclo(id: number): Promise<CicloComIndicadores | null> {
  return prisma.planoCiclo.findUnique({ where: { id }, include: { indicadores: true } });
}

// O ciclo "atual": o publicado que contém hoje; senão o último publicado; senão o último rascunho.
function escolherCicloAtual(ciclos: CicloComIndicadores[], hoje: string): CicloComIndicadores | null {
  const publicados = ciclos.filter((c) => c.status !== "rascunho");
  return (
    publicados.find((c) => isoDaData(c.inicio) <= hoje && hoje <= isoDaData(c.fim)) ??
    [...publicados].sort((a, b) => b.inicio.getTime() - a.inicio.getTime())[0] ??
    [...ciclos].sort((a, b) => b.inicio.getTime() - a.inicio.getTime())[0] ??
    null
  );
}

planoEvolucaoRouter.get("/ciclos", exigirAdminOuGestor, async (_req, res) => {
  try {
    // A tela decide o que é editável por este flag (admin do Plano = admin ou gestor da Consultoria ERP/HCM), não pelo papel.
    const podeEditar = acessoDe(res).admin;
    const ciclos = await prisma.planoCiclo.findMany({ include: { indicadores: true }, orderBy: [{ ano: "desc" }, { semestre: "desc" }] });
    const hoje = hojeIso();
    const atual = escolherCicloAtual(ciclos, hoje);
    res.json({
      hoje,
      atualId: atual?.id ?? null,
      podeEditar,
      ciclos: ciclos.map(cicloDto),
      indicadoresDisponiveis: INDICADORES.map((i) => ({ chave: i.chave, rotulo: i.rotulo, tipo: i.tipo, descricao: i.descricao })),
      departamentos: Object.entries(DEPEXE_LABELS).map(([valor, rotulo]) => ({ valor: Number(valor), rotulo })),
      motivosValorBase: MOTIVOS_VALOR_BASE,
    });
  } catch (error) {
    handleError(res, error, "listar-ciclos");
  }
});

planoEvolucaoRouter.post("/ciclos", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const v = validarNovoCiclo(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const { ano, semestre } = v.dados;
    if (await prisma.planoCiclo.findUnique({ where: { ano_semestre: { ano, semestre } } })) {
      res.status(409).json({ error: `O ciclo do ${semestre}º semestre de ${ano} já existe.` });
      return;
    }
    const periodo = periodoDoSemestre(ano, semestre);
    const cal = calendarioDoCiclo(periodo.inicio, periodo.fim);
    const criado = await prisma.$transaction(async (tx) => {
      const ciclo = await tx.planoCiclo.create({
        data: {
          ano,
          semestre,
          inicio: dataDeIso(periodo.inicio),
          fim: dataDeIso(periodo.fim),
          corteEvidencias: dataDeIso(cal.corteEvidencias),
          apuracaoAte: dataDeIso(cal.apuracaoAte),
          devolutivaEm: dataDeIso(cal.devolutivaEm),
          contestacaoAte: dataDeIso(cal.contestacaoAte),
          criadoPor: req.user!.userId,
          indicadores: { create: INDICADORES_PADRAO.map((i) => ({ chave: i.chave, tipo: i.tipo, peso: i.peso, ativo: i.ativo, ordem: i.ordem })) },
        },
        include: { indicadores: true },
      });
      await auditar(tx, req, { tipo: "ciclo", id: ciclo.id, rotulo: `Ciclo ${rotuloCiclo(ciclo)}` }, EVENTOS_AUDITORIA.PLANO_CICLO_CRIADO, { metadata: { ano, semestre } });
      return ciclo;
    });
    res.status(201).json(cicloDto(criado));
  } catch (error) {
    handleError(res, error, "criar-ciclo");
  }
});

const CAMPOS_CICLO_AUDITADOS: Record<string, string> = {
  metaEficienciaGlobal: "Meta do índice global (%)",
  departamentosArea: "Departamentos da área",
  amostraMinimaHoras: "Amostra mínima (h)",
  definicaoOnline: "Definição de apontamento online",
  notaMinimaEficienciaIndividual: "Nota mínima da eficiência individual (%)",
  naoApuradoQuebraSequencia: "Ciclo não apurado quebra a sequência",
  certificacoesExigidas: "Certificações exigidas",
  atividadesElegiveisClientes: "Atividades elegíveis à avaliação de clientes",
  corteEvidencias: "Corte de evidências",
  apuracaoAte: "Apuração até",
  devolutivaEm: "Devolutiva em",
  contestacaoAte: "Contestação até",
};

const paraComparar = (c: PlanoCiclo) => ({
  ...c,
  metaEficienciaGlobal: numOuNulo(c.metaEficienciaGlobal),
  departamentosArea: c.departamentosArea.join(","),
  corteEvidencias: isoDaData(c.corteEvidencias),
  apuracaoAte: isoDaData(c.apuracaoAte),
  devolutivaEm: isoDaData(c.devolutivaEm),
  contestacaoAte: isoDaData(c.contestacaoAte),
});

planoEvolucaoRouter.put("/ciclos/:id", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCiclo(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    if (ciclo.status !== "rascunho") {
      res.status(409).json({ error: "Ciclo publicado: os parâmetros estão travados. O regulamento não permite mudar com o ciclo em andamento." });
      return;
    }
    const v = validarEdicaoCiclo(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const e = v.dados;
    const erroCalendario = validarCalendario({
      inicio: isoDaData(ciclo.inicio),
      fim: isoDaData(ciclo.fim),
      corteEvidencias: e.corteEvidencias ?? isoDaData(ciclo.corteEvidencias),
      apuracaoAte: e.apuracaoAte ?? isoDaData(ciclo.apuracaoAte),
      devolutivaEm: e.devolutivaEm ?? isoDaData(ciclo.devolutivaEm),
      contestacaoAte: e.contestacaoAte ?? isoDaData(ciclo.contestacaoAte),
    });
    if (erroCalendario) {
      res.status(400).json({ error: erroCalendario });
      return;
    }

    const depois = await prisma.$transaction(async (tx) => {
      const row = await tx.planoCiclo.update({
        where: { id: ciclo.id },
        data: {
          ...(e.metaEficienciaGlobal !== undefined ? { metaEficienciaGlobal: e.metaEficienciaGlobal } : {}),
          ...(e.departamentosArea !== undefined ? { departamentosArea: e.departamentosArea } : {}),
          ...(e.amostraMinimaHoras !== undefined ? { amostraMinimaHoras: e.amostraMinimaHoras } : {}),
          ...(e.definicaoOnline !== undefined ? { definicaoOnline: e.definicaoOnline } : {}),
          ...(e.notaMinimaEficienciaIndividual !== undefined ? { notaMinimaEficienciaIndividual: e.notaMinimaEficienciaIndividual } : {}),
          ...(e.naoApuradoQuebraSequencia !== undefined ? { naoApuradoQuebraSequencia: e.naoApuradoQuebraSequencia } : {}),
          ...(e.certificacoesExigidas !== undefined ? { certificacoesExigidas: e.certificacoesExigidas } : {}),
          ...(e.atividadesElegiveisClientes !== undefined ? { atividadesElegiveisClientes: e.atividadesElegiveisClientes } : {}),
          ...(e.corteEvidencias ? { corteEvidencias: dataDeIso(e.corteEvidencias) } : {}),
          ...(e.apuracaoAte ? { apuracaoAte: dataDeIso(e.apuracaoAte) } : {}),
          ...(e.devolutivaEm ? { devolutivaEm: dataDeIso(e.devolutivaEm) } : {}),
          ...(e.contestacaoAte ? { contestacaoAte: dataDeIso(e.contestacaoAte) } : {}),
          atualizadoPor: req.user!.userId,
        },
      });
      const diff = diffCampos(CAMPOS_CICLO_AUDITADOS, paraComparar(ciclo), paraComparar(row));
      const alteracoes = { ...diff.alteracoes };

      if (e.indicadores) {
        for (const i of e.indicadores) {
          const antes = ciclo.indicadores.find((x) => x.chave === i.chave);
          if (!antes) continue;
          const textoAntes = `peso ${antes.peso}${antes.meta != null ? `, meta ${Number(antes.meta)}%` : ""}${antes.ativo ? "" : ", desativado"}`;
          const textoDepois = `peso ${i.peso}${i.meta != null ? `, meta ${i.meta}%` : ""}${i.ativo ? "" : ", desativado"}`;
          if (textoAntes !== textoDepois) {
            alteracoes[`indicador_${i.chave}`] = { de: textoAntes, para: textoDepois, rotulo: `Indicador ${INDICADORES.find((d) => d.chave === i.chave)?.rotulo ?? i.chave}` };
          }
          await tx.planoCicloIndicador.update({ where: { cicloId_chave: { cicloId: ciclo.id, chave: i.chave } }, data: { peso: i.peso, meta: i.meta, ativo: i.ativo } });
        }
      }
      if (Object.keys(alteracoes).length > 0) {
        await auditar(tx, req, { tipo: "ciclo", id: ciclo.id, rotulo: `Ciclo ${rotuloCiclo(ciclo)}` }, EVENTOS_AUDITORIA.PLANO_CICLO_ALTERADO, { alteracoes });
      }
      return tx.planoCiclo.findUniqueOrThrow({ where: { id: ciclo.id }, include: { indicadores: true } });
    });
    res.json(cicloDto(depois));
  } catch (error) {
    handleError(res, error, "editar-ciclo");
  }
});

planoEvolucaoRouter.post("/ciclos/:id/publicar", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCiclo(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    if (ciclo.status !== "rascunho") {
      res.status(409).json({ error: "O ciclo já foi publicado." });
      return;
    }
    const dto = cicloDto(ciclo);
    if (dto.pendenciasPublicacao.length > 0) {
      res.status(400).json({ error: `Faltam parâmetros para publicar: ${dto.pendenciasPublicacao.join(" ")}`, pendencias: dto.pendenciasPublicacao });
      return;
    }
    const publicado = await prisma.$transaction(async (tx) => {
      const row = await tx.planoCiclo.update({ where: { id: ciclo.id }, data: { status: "publicado", publicadoEm: new Date(), publicadoPor: req.user!.userId, atualizadoPor: req.user!.userId }, include: { indicadores: true } });
      await auditar(tx, req, { tipo: "ciclo", id: ciclo.id, rotulo: `Ciclo ${rotuloCiclo(ciclo)}` }, EVENTOS_AUDITORIA.PLANO_CICLO_PUBLICADO, {
        metadata: { metaEficienciaGlobal: numOuNulo(ciclo.metaEficienciaGlobal), departamentosArea: ciclo.departamentosArea, indicadores: dto.indicadores.filter((i) => i.ativo).map((i) => ({ chave: i.chave, peso: i.peso, meta: i.meta })) },
      });
      return row;
    });
    // Aviso pelo sino a cada participante ativo (ciclo de ensaio é simulação: não avisa ninguém). Nunca derruba a publicação, que já está gravada.
    if (isoDaData(publicado.fim) >= VIGENCIA_INICIO) {
      const ativos = await prisma.planoParticipante.findMany({ where: { status: "ativo" }, select: { codfor: true } });
      for (const p of ativos) {
        try {
          await notificarConsultorPorCodfor(p.codfor, "plano_ciclo_publicado", `O ciclo ${rotuloCiclo(publicado)} do Plano de Evolução foi publicado. Veja as metas e o seu andamento em Meu plano.`, req.user!.userId);
        } catch (erroAviso) {
          console.error("[plano-evolucao:aviso]", erroAviso instanceof Error ? erroAviso.message : erroAviso);
        }
      }
    }
    res.json(cicloDto(publicado));
  } catch (error) {
    handleError(res, error, "publicar-ciclo");
  }
});

planoEvolucaoRouter.post("/ciclos/:id/encerrar", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCiclo(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    if (ciclo.status !== "publicado") {
      res.status(409).json({ error: ciclo.status === "rascunho" ? "Publique o ciclo antes de encerrá-lo." : "O ciclo já está encerrado." });
      return;
    }
    if (hojeIso() <= isoDaData(ciclo.fim)) {
      res.status(409).json({ error: `O ciclo só pode ser encerrado depois do último dia (${isoDaData(ciclo.fim).split("-").reverse().join("/")}).` });
      return;
    }
    const encerrado = await prisma.$transaction(async (tx) => {
      const row = await tx.planoCiclo.update({ where: { id: ciclo.id }, data: { status: "encerrado", atualizadoPor: req.user!.userId }, include: { indicadores: true } });
      await auditar(tx, req, { tipo: "ciclo", id: ciclo.id, rotulo: `Ciclo ${rotuloCiclo(ciclo)}` }, EVENTOS_AUDITORIA.PLANO_CICLO_ENCERRADO);
      return row;
    });
    res.json(cicloDto(encerrado));
  } catch (error) {
    handleError(res, error, "encerrar-ciclo");
  }
});

// ---------------------------------------------------------------- prévia ao vivo

// Base vigente no início do ciclo (ou, na falta, no fim). No ENSAIO de um ciclo anterior à adesão do consultor não existe base vigente:
// usa a mais antiga lançada como aproximação, pra simulação mostrar um valor em vez de nada.
function baseDoCiclo(valores: PlanoValorBase[], inicio: string, fim: string, ensaio: boolean): number | null {
  const vigente = baseVigenteEm(valores, inicio) ?? baseVigenteEm(valores, fim);
  if (vigente != null || !ensaio || valores.length === 0) return vigente;
  const maisAntigo = [...valores].sort((a, b) => a.desde.getTime() - b.desde.getTime())[0];
  return Math.round(Number(maisAntigo.valorHoraBase) * 100);
}

async function montarPreviaDoCiclo(ciclo: CicloComIndicadores, filtro: { visiveis: Set<number> | null; soCodfor?: number }, mostrarValores: boolean) {
  const inicio = isoDaData(ciclo.inicio);
  const fim = isoDaData(ciclo.fim);
  // Ciclo anterior à vigência (01/01/2027) é ENSAIO: entram todos os participantes ativos, senão a simulação do 2º semestre de 2026 nunca
  // mostraria ninguém (o 1º ciclo de cada um só começa em 2027).
  const ensaio = isoDaData(ciclo.fim) < VIGENCIA_INICIO;
  let participantes: ParticipanteComValores[] = await prisma.planoParticipante.findMany({
    where: ensaio ? { status: "ativo" } : { status: "ativo", primeiroCicloInicio: { lte: ciclo.fim } },
    include: { valoresBase: true },
    orderBy: { id: "asc" },
  });
  if (filtro.soCodfor != null) participantes = participantes.filter((p) => p.codfor === filtro.soCodfor);
  else if (filtro.visiveis != null) participantes = participantes.filter((p) => filtro.visiveis!.has(p.codfor));

  const codfors = participantes.map((p) => p.codfor);
  const [nomes, itens, horas] = await Promise.all([
    carregarNomesDeConsultores(codfors),
    carregarItensDoCiclo({ inicio, fim, departamentosArea: ciclo.departamentosArea }),
    carregarHorasPorOrigem(inicio, fim, codfors),
  ]);

  const deParticipantes: ParticipanteDaPrevia[] = participantes.map((p) => ({
    id: p.id,
    codfor: p.codfor,
    nome: nomes.get(p.codfor)?.nome ?? `Consultor ${p.codfor}`,
    // Quem não pode ver valores recebe uma base fictícia de R$ 100,00 só pra calcular os PERCENTUAIS; o valor em R$ nunca sai na resposta.
    baseCentavos: mostrarValores ? baseDoCiclo(p.valoresBase, inicio, fim, ensaio) : 10_000,
    consecutivosAntes: p.ciclosConsecutivosAntes,
  }));

  const previa = montarPrevia(parametrosDaPrevia(ciclo), deParticipantes, itens, horas);
  return { previa, deParticipantes, ensaio };
}

planoEvolucaoRouter.get("/ciclos/:id/previa", exigirAdminOuGestor, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const ciclo = id == null ? null : await carregarCiclo(id);
    if (!ciclo) {
      res.status(404).json({ error: "Ciclo não encontrado" });
      return;
    }
    const a = acessoDe(res);
    const visiveis = await codforsDoTime(a.admin ? "admin" : "gestor", a.contexto);
    const mostrarValores = a.admin;
    const { previa, ensaio } = await montarPreviaDoCiclo(ciclo, { visiveis }, mostrarValores);
    res.json({
      calculadoEm: new Date().toISOString(),
      ensaio,
      ciclo: cicloDto(ciclo),
      mostraValores: mostrarValores,
      escopo: a.admin ? "admin" : "gestor",
      global: previa.global,
      consultores: previa.consultores.map((c) => consultorDaPreviaDto(c, mostrarValores)),
    });
  } catch (error) {
    handleError(res, error, "previa");
  }
});

// ---------------------------------------------------------------- participantes

planoEvolucaoRouter.get("/participantes", exigirAdminOuGestor, async (_req, res) => {
  try {
    const a = acessoDe(res);
    const visiveis = await codforsDoTime(a.admin ? "admin" : "gestor", a.contexto);
    let participantes: ParticipanteComValores[] = await prisma.planoParticipante.findMany({ include: { valoresBase: true }, orderBy: { id: "asc" } });
    if (visiveis != null) participantes = participantes.filter((p) => visiveis.has(p.codfor));
    const nomes = await carregarNomesDeConsultores(participantes.map((p) => p.codfor));
    const hoje = hojeIso();
    res.json({
      mostraValores: a.admin,
      participantes: participantes
        .map((p) => ({
          id: p.id,
          codfor: p.codfor,
          nome: nomes.get(p.codfor)?.nome ?? `Consultor ${p.codfor}`,
          departamento: nomes.get(p.codfor)?.departamento ?? null,
          dataAdesao: isoDaData(p.dataAdesao),
          primeiroCicloInicio: isoDaData(p.primeiroCicloInicio),
          versaoRegulamento: p.versaoRegulamento,
          ciclosConsecutivosAntes: p.ciclosConsecutivosAntes,
          status: p.status as "ativo" | "encerrado",
          encerradoEm: p.encerradoEm,
          motivoEncerramento: p.motivoEncerramento,
          ...(a.admin ? { valorHoraBase: baseVigenteEm(p.valoresBase, hoje) == null ? null : baseVigenteEm(p.valoresBase, hoje)! / 100, historicoBase: valoresBaseDto(p.valoresBase) } : {}),
        }))
        .sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")),
    });
  } catch (error) {
    handleError(res, error, "listar-participantes");
  }
});

// Quem pode aderir: integrante ATIVO de um departamento da área do ciclo atual. Mesma regra de "integrante ativo" da alocação de
// consultores (GET /alocacao/consultores-elegiveis): está no time do departamento (DepartamentoTime, sitreg 'A') e é fornecedor ativo
// (Consultor com codfor, sitfor 'A'). Quem está em dois departamentos da área aparece nos dois. Usado pela tela (opções) e pelo POST.
type IntegranteDaArea = { codfor: number; nome: string; fotoUrl: string | null };
async function integrantesDaArea(departamentos: number[]): Promise<Map<number, IntegranteDaArea[]>> {
  const porDepartamento = new Map<number, IntegranteDaArea[]>(departamentos.map((d) => [d, []]));
  if (departamentos.length === 0) return porDepartamento;
  const times = await prisma.departamentoTime.findMany({ where: { depexe: { in: departamentos }, sitreg: "A" }, select: { codemp: true, depexe: true, codusu: true } });
  if (times.length === 0) return porDepartamento;
  const consultores = await prisma.consultor.findMany({
    where: { OR: times.map((t) => ({ codemp: t.codemp, codusu: Number(t.codusu) })), codfor: { not: null }, sitfor: "A" },
    select: { codemp: true, codusu: true, codfor: true, nomcom: true, nomfor: true, usuariosCaxHub: { select: { fotoUrl: true } } },
  });
  const porUsuario = new Map(consultores.map((c) => [`${c.codemp}:${c.codusu}`, c]));
  for (const t of times) {
    const c = porUsuario.get(`${t.codemp}:${Number(t.codusu)}`);
    const lista = porDepartamento.get(t.depexe);
    if (!c || c.codfor == null || !lista || lista.some((x) => x.codfor === c.codfor)) continue;
    lista.push({ codfor: c.codfor, nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`, fotoUrl: c.usuariosCaxHub[0]?.fotoUrl ?? null });
  }
  for (const lista of porDepartamento.values()) lista.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  return porDepartamento;
}

async function cicloAtualDaAdesao() {
  const ciclos = await prisma.planoCiclo.findMany({ include: { indicadores: true } });
  return escolherCicloAtual(ciclos, hojeIso());
}

// Opções do modal "Registrar adesão": os departamentos da área do ciclo atual, cada um com os integrantes ativos. Quem já está no plano
// (qualquer situação: codfor é único em plano_participantes) vem marcado, para a tela mostrar desabilitado.
planoEvolucaoRouter.get("/participantes/opcoes", exigirAdmin, async (_req, res) => {
  try {
    const ciclo = await cicloAtualDaAdesao();
    if (!ciclo) {
      res.json({ ciclo: null, departamentos: [] });
      return;
    }
    const [porDepartamento, participantes] = await Promise.all([integrantesDaArea(ciclo.departamentosArea), prisma.planoParticipante.findMany({ select: { codfor: true } })]);
    const jaParticipa = new Set(participantes.map((p) => p.codfor));
    res.json({
      ciclo: { id: ciclo.id, rotulo: rotuloCiclo(ciclo) },
      departamentos: ciclo.departamentosArea.map((depexe) => ({
        depexe,
        rotulo: depexeLabel(depexe),
        integrantes: (porDepartamento.get(depexe) ?? []).map((i) => ({ ...i, jaNoPlano: jaParticipa.has(i.codfor) })),
      })),
    });
  } catch (error) {
    handleError(res, error, "opcoes-participantes");
  }
});

// Registra uma ou várias adesões de uma vez, tudo ou nada (uma transação): o modal da tela marca vários consultores e salva uma vez, como
// a alocação em lote. Mesma regra da tela: só integrante ativo de um departamento da área do ciclo atual, ninguém repetido, ninguém que
// já esteja no plano. Cada adesão grava o seu Valor Hora Base inicial e o seu evento de auditoria.
async function registrarAdesoes(req: AuthenticatedRequest, lista: NovoParticipante[]): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const ciclo = await cicloAtualDaAdesao();
  if (!ciclo) return { status: 400, corpo: { error: "Cadastre um ciclo antes de registrar adesões." } };
  const codfors = lista.map((d) => d.codfor);
  if (new Set(codfors).size !== codfors.length) return { status: 400, corpo: { error: "O mesmo consultor apareceu mais de uma vez." } };
  const [porDepartamento, nomes, existentes] = await Promise.all([
    integrantesDaArea(ciclo.departamentosArea),
    carregarNomesDeConsultores(codfors),
    prisma.planoParticipante.findMany({ where: { codfor: { in: codfors } }, select: { codfor: true } }),
  ]);
  const nomeDe = (codfor: number) => nomes.get(codfor)?.nome ?? `Consultor ${codfor}`;
  const daArea = new Set([...porDepartamento.values()].flatMap((l) => l.map((i) => i.codfor)));
  const foraDaArea = codfors.filter((c) => !daArea.has(c));
  if (foraDaArea.length > 0) {
    const area = ciclo.departamentosArea.map((dep) => depexeLabel(dep)).join(", ") || "nenhum departamento marcado";
    const quem = lista.length === 1 ? "O consultor precisa" : `${foraDaArea.map(nomeDe).join(", ")}: precisa${foraDaArea.length === 1 ? "" : "m"}`;
    return { status: 400, corpo: { error: `${quem} ser integrante ativo de um departamento da área do ciclo ${rotuloCiclo(ciclo)} (${area}).` } };
  }
  if (existentes.length > 0) {
    return { status: 409, corpo: { error: lista.length === 1 ? "Este consultor já está no plano." : `Já está no plano: ${existentes.map((e) => nomeDe(e.codfor)).join(", ")}.` } };
  }
  const criados = await prisma.$transaction(async (tx) => {
    const saida: { id: number; codfor: number; nome: string; primeiroCicloInicio: string; valorHoraBase: number }[] = [];
    for (const d of lista) {
      const primeiroCicloInicio = inicioDoPrimeiroCiclo(d.dataAdesao);
      const nome = nomeDe(d.codfor);
      const p = await tx.planoParticipante.create({
        data: {
          codfor: d.codfor,
          dataAdesao: dataDeIso(d.dataAdesao),
          primeiroCicloInicio: dataDeIso(primeiroCicloInicio),
          ciclosConsecutivosAntes: d.ciclosConsecutivosAntes,
          criadoPor: req.user!.userId,
          valoresBase: { create: { valorHoraBase: d.valorHoraBase, desde: dataDeIso(d.dataAdesao), motivo: "adesao", criadoPor: req.user!.userId } },
        },
      });
      await auditar(tx, req, { tipo: "participante", id: p.id, rotulo: `Plano de Evolução: ${nome}` }, EVENTOS_AUDITORIA.PLANO_PARTICIPANTE_ADERIU, {
        metadata: { codfor: d.codfor, dataAdesao: d.dataAdesao, primeiroCicloInicio, valorHoraBase: d.valorHoraBase, ciclosConsecutivosAntes: d.ciclosConsecutivosAntes },
      });
      saida.push({ id: p.id, codfor: p.codfor, nome, primeiroCicloInicio, valorHoraBase: d.valorHoraBase });
    }
    return saida;
  });
  return { status: 201, corpo: { criados } };
}

planoEvolucaoRouter.post("/participantes", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const v = validarNovoParticipante(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const r = await registrarAdesoes(req, [v.dados]);
    res.status(r.status).json(r.status === 201 ? (r.corpo.criados as unknown[])[0] : r.corpo);
  } catch (error) {
    handleError(res, error, "aderir");
  }
});

// Várias adesões de uma vez (modal "Registrar adesão"): data de assinatura e ciclos já cumpridos valem para todos; o Valor Hora Base é
// de cada um. Corpo: { dataAdesao, ciclosConsecutivosAntes, itens: [{ codfor, valorHoraBase }] }.
const MAX_ADESOES_POR_LOTE = 50;
planoEvolucaoRouter.post("/participantes/lote", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const itens = Array.isArray(corpo.itens) ? (corpo.itens as Record<string, unknown>[]) : [];
    if (itens.length === 0) {
      res.status(400).json({ error: "Marque ao menos um consultor." });
      return;
    }
    if (itens.length > MAX_ADESOES_POR_LOTE) {
      res.status(400).json({ error: `No máximo ${MAX_ADESOES_POR_LOTE} adesões por vez.` });
      return;
    }
    const lista: NovoParticipante[] = [];
    for (const item of itens) {
      const v = validarNovoParticipante({ ...item, dataAdesao: corpo.dataAdesao, ciclosConsecutivosAntes: corpo.ciclosConsecutivosAntes });
      if (!v.ok) {
        res.status(400).json({ error: v.erro });
        return;
      }
      lista.push(v.dados);
    }
    const r = await registrarAdesoes(req, lista);
    res.status(r.status).json(r.corpo);
  } catch (error) {
    handleError(res, error, "aderir-lote");
  }
});

planoEvolucaoRouter.post("/participantes/:id/valor-base", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const participante = id == null ? null : await prisma.planoParticipante.findUnique({ where: { id }, include: { valoresBase: true } });
    if (!participante) {
      res.status(404).json({ error: "Participante não encontrado" });
      return;
    }
    const v = validarValorBase(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const d = v.dados;
    if (participante.valoresBase.some((x) => isoDaData(x.desde) === d.desde)) {
      res.status(409).json({ error: "Já existe um Valor Hora Base lançado com essa data de vigência." });
      return;
    }
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const nome = nomes.get(participante.codfor)?.nome ?? `Consultor ${participante.codfor}`;
    const antes = baseVigenteEm(participante.valoresBase, d.desde) ?? baseVigenteEm(participante.valoresBase, hojeIso());
    await prisma.$transaction(async (tx) => {
      await tx.planoValorBase.create({ data: { participanteId: participante.id, valorHoraBase: d.valorHoraBase, desde: dataDeIso(d.desde), motivo: d.motivo, observacao: d.observacao, criadoPor: req.user!.userId } });
      await auditar(tx, req, { tipo: "participante", id: participante.id, rotulo: `Plano de Evolução: ${nome}` }, EVENTOS_AUDITORIA.PLANO_PARTICIPANTE_VALOR_BASE_ALTERADO, {
        alteracoes: { valorHoraBase: { de: antes == null ? null : antes / 100, para: d.valorHoraBase, rotulo: "Valor Hora Base" } },
        metadata: { motivo: d.motivo, motivoRotulo: MOTIVOS_VALOR_BASE.find((m) => m.chave === d.motivo)?.rotulo, desde: d.desde, observacao: d.observacao },
      });
    });
    const atualizado = await prisma.planoValorBase.findMany({ where: { participanteId: participante.id } });
    res.status(201).json({ historicoBase: valoresBaseDto(atualizado) });
  } catch (error) {
    handleError(res, error, "valor-base");
  }
});

planoEvolucaoRouter.post("/participantes/:id/encerrar", exigirAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = idDoParametro(req.params.id);
    const participante = id == null ? null : await prisma.planoParticipante.findUnique({ where: { id } });
    if (!participante) {
      res.status(404).json({ error: "Participante não encontrado" });
      return;
    }
    if (participante.status !== "ativo") {
      res.status(409).json({ error: "A participação já está encerrada." });
      return;
    }
    const v = validarEncerramento(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const nomes = await carregarNomesDeConsultores([participante.codfor]);
    const nome = nomes.get(participante.codfor)?.nome ?? `Consultor ${participante.codfor}`;
    await prisma.$transaction(async (tx) => {
      await tx.planoParticipante.update({ where: { id: participante.id }, data: { status: "encerrado", encerradoEm: new Date(), motivoEncerramento: v.dados.motivo } });
      await auditar(tx, req, { tipo: "participante", id: participante.id, rotulo: `Plano de Evolução: ${nome}` }, EVENTOS_AUDITORIA.PLANO_PARTICIPANTE_ENCERRADO, { metadata: { motivo: v.dados.motivo } });
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "encerrar-participante");
  }
});

// ---------------------------------------------------------------- meu plano (consultor)

// Só o PRÓPRIO andamento, sem colegas: o global da área é um agregado e não identifica ninguém. O valor hora em R$ aparece porque é dele.
planoEvolucaoRouter.get("/meu", async (_req, res) => {
  try {
    const a = acessoDe(res);
    const codfor = a.contexto.consultor?.codfor ?? null;
    const participante = codfor == null ? null : await prisma.planoParticipante.findUnique({ where: { codfor }, include: { valoresBase: true } });
    if (!participante || codfor == null) {
      res.status(404).json({ error: "Você não participa do Plano de Evolução Profissional e Eficiência." });
      return;
    }
    const ciclos = await prisma.planoCiclo.findMany({ where: { status: { not: "rascunho" } }, include: { indicadores: true } });
    const ciclo = escolherCicloAtual(ciclos, hojeIso());
    // Resultados que o consultor já pode ver: só depois da devolutiva (antes disso a apuração é do gestor). O valor hora é dele.
    const apuracoes = await prisma.planoApuracao.findMany({ where: { participanteId: participante.id, status: { in: ["devolutiva", "encerrado"] } }, include: { ciclo: true }, orderBy: { ciclo: { inicio: "desc" } } });
    const historico = apuracoes.map((a) => ({
      apuracaoId: a.id,
      cicloRotulo: rotuloCiclo(a.ciclo),
      inicio: isoDaData(a.ciclo.inicio),
      fim: isoDaData(a.ciclo.fim),
      ensaio: a.ensaio,
      status: a.status,
      statusRotulo: rotuloStatusApuracao(a.status),
      statusCiclo: a.statusCiclo,
      percentualBp: a.percentualBp,
      valorHora: a.valorHoraCentavos == null ? null : a.valorHoraCentavos / 100,
      efetivou: a.efetivou && !a.ensaio,
      devolutivaEm: a.devolutivaEm ? isoDaData(a.devolutivaEm) : null,
      contestacao: a.contestacaoTexto ? { recebidaEm: a.contestacaoRecebidaEm ? isoDaData(a.contestacaoRecebidaEm) : null, texto: a.contestacaoTexto } : null,
      desfecho: a.desfecho ? { resultado: a.desfecho, texto: a.desfechoTexto } : null,
    }));
    const base = {
      historico,
      participante: {
        dataAdesao: isoDaData(participante.dataAdesao),
        primeiroCicloInicio: isoDaData(participante.primeiroCicloInicio),
        versaoRegulamento: participante.versaoRegulamento,
        status: participante.status,
        ciclosConsecutivosAntes: participante.ciclosConsecutivosAntes,
        historicoBase: valoresBaseDto(participante.valoresBase),
      },
    };
    // Ciclo de ENSAIO (anterior à vigência) vale para todo participante ativo, como na prévia da gestão; nos reais, só a partir do 1º ciclo dele.
    const ensaio = ciclo != null && isoDaData(ciclo.fim) < VIGENCIA_INICIO;
    if (!ciclo || participante.status !== "ativo" || (!ensaio && isoDaData(participante.primeiroCicloInicio) > isoDaData(ciclo.fim))) {
      res.json({ ...base, ciclo: null, previa: null, aviso: participante.status !== "ativo" ? "Sua participação está encerrada." : "Ainda não há ciclo publicado para você." });
      return;
    }
    const { previa } = await montarPreviaDoCiclo(ciclo, { visiveis: null, soCodfor: codfor }, true);
    const eu = previa.consultores[0] ?? null;
    res.json({
      ...base,
      calculadoEm: new Date().toISOString(),
      ensaio,
      ciclo: cicloDto(ciclo),
      global: previa.global,
      consultor: eu ? consultorDaPreviaDto(eu, true) : null,
      aviso: null,
    });
  } catch (error) {
    handleError(res, error, "meu");
  }
});

// Fase 2: apuração, devolutiva, contestação, memória de cálculo, PDF e CSV. Montado aqui pra herdar o login e o acesso já resolvidos acima.
planoEvolucaoRouter.use(planoApuracaoRouter);
