import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel, modproLabel, sitproLabel, sitproTone, SITPRO_ALOCAVEL } from "../domain/propostasDominio";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";
import { enfileirar } from "../sync/outboxSenior";
import { criarEventoAuditoria, criarEventosDeData, diffCampos, paraDiff } from "../audit/registrarEvento";
import { CAMPOS_AUDITADOS_ALOCACAO, CAMPOS_AUDITADOS_ATIVIDADE_DATAS } from "../audit/camposAuditados";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";
import { Prisma } from "@prisma/client";

// Área de alocação: o Líder Técnico (Gestor) distribui as horas de um item de proposta
// entre um ou mais consultores do próprio time (AtividadeConsultor = "Distribuição
// Atividades por Consultor" no Senior — já suporta N linhas por item, uma por consultor).
// Só admin e Líder Técnico têm acesso; Consultor/Comercial não enxergam essa tela.
export const alocacaoRouter = Router();
alocacaoRouter.use(requireAuth);

function parseIdsParam(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const ids = value
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[alocacao:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

// Departamentos que o usuário pode gerenciar nesta área — admin gerencia todos os
// existentes em PropostaItem; Líder Técnico só os que gerencia; qualquer outro papel, nenhum.
async function departamentosPermitidos(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  if (role === "admin") {
    const distintos = await prisma.propostaItem.findMany({
      where: { depexe: { not: null } },
      distinct: ["depexe"],
      select: { depexe: true },
    });
    return distintos.map((d) => d.depexe as number);
  }
  return contexto.departamentosGerenciados;
}

// Ações no nível da proposta inteira (pasta raiz, agrupar/soltar item) não têm um único
// depexe pra checar contra podeExecutarAcao — uma pasta raiz pode reunir itens de
// departamentos diferentes. Autoriza quem gerencia pelo menos um departamento presente
// nos itens desta proposta específica (mesmo espírito de ACOES_LIDER_TECNICO).
async function podeGerenciarProposta(
  role: string,
  contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>,
  codemp: number,
  codpro: number
): Promise<boolean> {
  const permitidos = await departamentosPermitidos(role, contexto);
  if (permitidos.length === 0) return false;
  const itensDaProposta = await prisma.propostaItem.findMany({
    where: { codemp, codpro, depexe: { not: null } },
    distinct: ["depexe"],
    select: { depexe: true },
  });
  return itensDaProposta.some((i) => permitidos.includes(i.depexe as number));
}

// Controle sempre por proposta (uma proposta pode ter muitos itens — misturar tudo
// num feed único de itens fica ruim de gerenciar). Esta lista é o ponto de entrada:
// uma linha por proposta, com o total de horas/alocado agregado só sobre os itens nos
// departamentos permitidos ao usuário (uma proposta pode ter itens de outros deptos,
// que não entram nesse agregado nem aparecem na tela de detalhe).
alocacaoRouter.get("/propostas", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);
    if (permitidos.length === 0) {
      res.status(403).json({ error: "Sem departamentos para gerenciar" });
      return;
    }

    const depexeFiltro = parseIdsParam(req.query.depexe);
    const depexesConsultados =
      depexeFiltro != null ? depexeFiltro.filter((d) => permitidos.includes(d)) : permitidos;

    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().toLowerCase() : "";
    const apenasComSaldo = req.query.apenasComSaldo === "true";
    const compartilhadas = req.query.compartilhadas === "true";
    const situacoesValidas = ["semAlocacao", "saldoPendente", "totalmenteAlocadas", "compartilhadasEmAberto"] as const;
    const situacao = situacoesValidas.includes(req.query.situacao as any)
      ? (req.query.situacao as (typeof situacoesValidas)[number])
      : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const itens = await prisma.propostaItem.findMany({
      where: { depexe: { in: depexesConsultados } },
    });
    if (itens.length === 0) {
      const kpiZerado = { quantidade: 0, horas: 0 };
      res.json({
        rows: [],
        total: 0,
        kpis: {
          totalNoEscopo: 0,
          semAlocacao: kpiZerado,
          saldoPendente: kpiZerado,
          totalmenteAlocadas: kpiZerado,
          compartilhadasEmAberto: kpiZerado,
        },
      });
      return;
    }

    const chavesProposta = [...new Set(itens.map((i) => `${i.codemp}-${i.codpro}`))];
    const propostas = await prisma.proposta.findMany({
      where: {
        OR: chavesProposta.map((chave) => {
          const [codemp, codpro] = chave.split("-").map(Number);
          return { codemp, codpro };
        }),
      },
      include: { cliente: true },
    });
    const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    const alocacoes = await prisma.atividadeConsultor.findMany({
      where: { sitreg: "A", OR: itens.map((i) => ({ codemp: i.codemp, codpro: i.codpro, seqite: i.seqite })) },
    });
    const alocadoPorItem = new Map<string, number>();
    for (const a of alocacoes) {
      const chave = `${a.codemp}-${a.codpro}-${a.seqite}`;
      alocadoPorItem.set(chave, (alocadoPorItem.get(chave) ?? 0) + (a.qtdhor ?? 0));
    }

    interface Agregado {
      codemp: number;
      codpro: number;
      numprj: number;
      cliente: string;
      sitpro: number | null;
      propostaDepexe: number | null;
      propostaModpro: number | null;
      totalItens: number;
      qtdhorTotal: number;
      horasAlocadas: number;
    }
    const porProposta = new Map<string, Agregado>();
    for (const item of itens) {
      const proposta = propostaPorChave.get(`${item.codemp}-${item.codpro}`);
      if (!proposta || item.depexe == null) continue;
      if (proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) continue;

      const chaveProposta = `${item.codemp}-${item.codpro}`;
      if (!porProposta.has(chaveProposta)) {
        porProposta.set(chaveProposta, {
          codemp: item.codemp,
          codpro: item.codpro,
          numprj: proposta.numprj,
          cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
          sitpro: proposta.sitpro,
          propostaDepexe: proposta.depexe,
          propostaModpro: proposta.modpro,
          totalItens: 0,
          qtdhorTotal: 0,
          horasAlocadas: 0,
        });
      }
      const agregado = porProposta.get(chaveProposta)!;
      agregado.totalItens += 1;
      agregado.qtdhorTotal += item.qtdhor ?? 0;
      agregado.horasAlocadas += alocadoPorItem.get(`${item.codemp}-${item.codpro}-${item.seqite}`) ?? 0;
    }

    // "Compartilhada" = a proposta pertence (Proposta.depexe, o depto "dono" dela no
    // Senior) a outro departamento, mas tem pelo menos um item no(s) departamento(s)
    // que o usuário gerencia de verdade — ou seja, item emprestado pro time dele.
    // Usa departamentosGerenciados (não `permitidos`, que pra admin vira "todos").
    const meusDepartamentos = contexto.departamentosGerenciados;

    // KPIs sempre por proposta (nunca por item) e sempre com quantidade + total de horas
    // juntos no mesmo card — refletem o escopo de departamento(s) selecionado, mas não os
    // filtros transitórios de busca/saldo/compartilhadas da tabela abaixo, pra não ficarem
    // pulando enquanto o usuário digita ou alterna um toggle.
    const todasPropostas = [...porProposta.values()];
    // "Sem alocação" e "Saldo pendente" são mutuamente exclusivas: a primeira é quem
    // não teve NENHUMA hora alocada ainda; a segunda é quem já teve alguma alocação
    // mas ainda não fechou o total (senão uma proposta zerada contava nas duas).
    const semAlocacao = todasPropostas.filter((a) => a.horasAlocadas === 0);
    const comSaldoPendente = todasPropostas.filter(
      (a) => a.horasAlocadas > 0 && a.qtdhorTotal - a.horasAlocadas > 0
    );
    const totalmenteAlocadas = todasPropostas.filter(
      (a) => a.qtdhorTotal > 0 && a.qtdhorTotal - a.horasAlocadas <= 0
    );
    const compartilhadasEmAberto = todasPropostas.filter(
      (a) => a.propostaDepexe != null && !meusDepartamentos.includes(a.propostaDepexe) && a.qtdhorTotal - a.horasAlocadas > 0
    );
    const somaHoras = (lista: Agregado[], campo: (a: Agregado) => number) =>
      lista.reduce((soma, a) => soma + campo(a), 0);
    const kpis = {
      totalNoEscopo: todasPropostas.length,
      semAlocacao: { quantidade: semAlocacao.length, horas: somaHoras(semAlocacao, (a) => a.qtdhorTotal) },
      saldoPendente: {
        quantidade: comSaldoPendente.length,
        horas: somaHoras(comSaldoPendente, (a) => a.qtdhorTotal - a.horasAlocadas),
      },
      totalmenteAlocadas: {
        quantidade: totalmenteAlocadas.length,
        horas: somaHoras(totalmenteAlocadas, (a) => a.horasAlocadas),
      },
      compartilhadasEmAberto: {
        quantidade: compartilhadasEmAberto.length,
        horas: somaHoras(compartilhadasEmAberto, (a) => a.qtdhorTotal - a.horasAlocadas),
      },
    };

    // Um KPI clicado vira o único critério de "situação" da tabela (substitui os
    // checkboxes de saldo/compartilhadas, que só valem quando nenhum KPI está ativo) —
    // reaproveita exatamente as mesmas listas já calculadas acima pros cards.
    const porSituacao: Record<(typeof situacoesValidas)[number], Agregado[]> = {
      semAlocacao,
      saldoPendente: comSaldoPendente,
      totalmenteAlocadas,
      compartilhadasEmAberto,
    };
    const baseFiltrada = situacao
      ? porSituacao[situacao]
      : todasPropostas
          .filter((a) => !compartilhadas || a.propostaDepexe == null || !meusDepartamentos.includes(a.propostaDepexe))
          .filter((a) => !apenasComSaldo || a.qtdhorTotal - a.horasAlocadas > 0);

    let linhas = baseFiltrada.map((a) => ({
      codemp: a.codemp,
      codpro: a.codpro,
      numprj: a.numprj,
      cliente: a.cliente,
      sitpro: a.sitpro,
      sitproLabel: sitproLabel(a.sitpro),
      sitproTone: sitproTone(a.sitpro),
      // Sempre o departamento "dono" da proposta no Senior — não os departamentos
      // dos itens (que podem ser só os visíveis pro usuário, e confundiriam numa
      // proposta compartilhada mostrando o depto de quem está vendo, não o real).
      depexeLabel: depexeLabel(a.propostaDepexe),
      modproLabel: modproLabel(a.propostaModpro),
      totalItens: a.totalItens,
      qtdhorTotal: a.qtdhorTotal,
      horasAlocadas: a.horasAlocadas,
      saldo: a.qtdhorTotal - a.horasAlocadas,
    }));

    if (busca) {
      linhas = linhas.filter((l) => l.cliente.toLowerCase().includes(busca) || String(l.codpro).includes(busca));
    }
    if (apenasComSaldo) {
      linhas = linhas.filter((l) => l.saldo > 0);
    }
    linhas.sort((a, b) => b.codpro - a.codpro);

    const total = linhas.length;
    const inicio = (page - 1) * pageSize;
    const pagina = linhas.slice(inicio, inicio + pageSize);

    res.json({ rows: pagina, total, kpis });
  } catch (error) {
    handleError(res, error, "propostas");
  }
});

// Resumo por consultor de uma proposta — usado no accordion da lista de propostas,
// pra responder "quanto cada consultor já tem alocado nessa proposta" sem precisar
// abrir o detalhe e somar item por item. Não inclui horas em RAT (apontamento real de
// horas trabalhadas) porque essa tabela do Senior ainda não é sincronizada no CaxHub.
alocacaoRouter.get("/propostas/:codemp/:codpro/consultores", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);

    const itens = await prisma.propostaItem.findMany({
      where: { codemp, codpro, depexe: { in: permitidos } },
      select: { codemp: true, codpro: true, seqite: true },
    });
    if (itens.length === 0) {
      res.json({ consultores: [] });
      return;
    }

    const alocacoes = await prisma.atividadeConsultor.findMany({
      where: { sitreg: "A", OR: itens.map((i) => ({ codemp: i.codemp, codpro: i.codpro, seqite: i.seqite })) },
    });

    const horasPorCodfor = new Map<number, number>();
    for (const a of alocacoes) {
      horasPorCodfor.set(a.codfor, (horasPorCodfor.get(a.codfor) ?? 0) + (a.qtdhor ?? 0));
    }

    const codforUnicos = [...horasPorCodfor.keys()];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

    const linhas = codforUnicos
      .map((codfor) => {
        const consultor = consultorPorCodfor.get(codfor);
        return {
          codfor,
          nome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${codfor}`,
          depexeLabel: consultor?.depexedes ?? depexeLabel(consultor?.depexe ?? null),
          horasAlocadas: horasPorCodfor.get(codfor) ?? 0,
        };
      })
      .sort((a, b) => b.horasAlocadas - a.horasAlocadas);

    res.json({ consultores: linhas });
  } catch (error) {
    handleError(res, error, "proposta-consultores");
  }
});

// Detalhe de uma proposta: todos os itens dela (nos departamentos permitidos) já com
// as alocações de cada um — a "aba 2" (item x consultor x fase) fica embutida por item
// em vez de ser uma grade solta que obriga cruzar pelo número de sequência.
alocacaoRouter.get("/propostas/:codemp/:codpro/itens", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, include: { cliente: true } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(404).json({ error: "Proposta não encontrada ou não alocável" });
      return;
    }

    const itens = await prisma.propostaItem.findMany({
      where: { codemp, codpro, depexe: { in: permitidos } },
      orderBy: { seqite: "asc" },
    });
    if (itens.length === 0) {
      res.status(403).json({ error: "Sem itens desta proposta nos seus departamentos" });
      return;
    }

    const alocacoes = await prisma.atividadeConsultor.findMany({
      where: { sitreg: "A", OR: itens.map((i) => ({ codemp: i.codemp, codpro: i.codpro, seqite: i.seqite })) },
      include: { fase: true },
    });
    const codforUnicos = [...new Set(alocacoes.map((a) => a.codfor))];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));

    const alocacoesPorItem = new Map<number, typeof alocacoes>();
    for (const a of alocacoes) {
      if (!alocacoesPorItem.has(a.seqite)) alocacoesPorItem.set(a.seqite, []);
      alocacoesPorItem.get(a.seqite)!.push(a);
    }

    res.json({
      proposta: {
        codemp: proposta.codemp,
        codpro: proposta.codpro,
        numprj: proposta.numprj,
        cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
        sitpro: proposta.sitpro,
        sitproLabel: sitproLabel(proposta.sitpro),
        sitproTone: sitproTone(proposta.sitpro),
      },
      itens: itens.map((item) => {
        const alocacoesDoItem = alocacoesPorItem.get(item.seqite) ?? [];
        const horasAlocadas = alocacoesDoItem.reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);
        const saldo = item.qtdhor != null ? item.qtdhor - horasAlocadas : null;
        return {
          seqite: item.seqite,
          codser: item.codser,
          despro: item.despro,
          depexe: item.depexe,
          depexeLabel: depexeLabel(item.depexe),
          qtdhorItem: item.qtdhor,
          horasAlocadas,
          saldo,
          podeAlocar: item.depexe != null && podeExecutarAcao(role, contexto, "criar", { depexe: item.depexe, codfor: 0 }),
          alocacoes: alocacoesDoItem.map((a) => {
            const consultor = consultorPorCodfor.get(a.codfor);
            return {
              id: a.id,
              codfor: a.codfor,
              consultorNome: consultor?.nomcom ?? consultor?.nomfor ?? `Fornecedor ${a.codfor}`,
              qtdhor: a.qtdhor,
              fasid: a.fasid,
              faseDes: a.fase.fasdes,
              dataPrevistaInicio: a.dataPrevistaInicio,
              dataPrevistaFim: a.dataPrevistaFim,
              seqati: a.seqati != null ? a.seqati.toString() : null,
            };
          }),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "proposta-itens");
  }
});

alocacaoRouter.get("/consultores-elegiveis", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const depexe = Number(req.query.depexe);
    if (!Number.isFinite(depexe)) {
      res.status(400).json({ error: "depexe é obrigatório" });
      return;
    }
    const permitidos = await departamentosPermitidos(role, contexto);
    if (!permitidos.includes(depexe)) {
      res.status(403).json({ error: "Sem permissão sobre este departamento" });
      return;
    }

    const codemp = contexto.consultor?.codemp ?? 1;
    const integrantes = await prisma.departamentoTime.findMany({ where: { codemp, depexe, sitreg: "A" } });
    const codusuList = integrantes.map((i) => Number(i.codusu));
    const consultoresDoTime =
      codusuList.length > 0
        ? await prisma.consultor.findMany({
            where: { codemp, codusu: { in: codusuList }, codfor: { not: null }, sitfor: "A" },
          })
        : [];

    res.json({
      consultores: consultoresDoTime
        .map((c) => ({ codfor: c.codfor as number, nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}` }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    });
  } catch (error) {
    handleError(res, error, "consultores-elegiveis");
  }
});

alocacaoRouter.get("/fases", async (_req, res) => {
  try {
    const fases = await prisma.faseProposta.findMany({ orderBy: { fasid: "asc" } });
    res.json({ fases: fases.map((f) => ({ fasid: f.fasid, fasdes: f.fasdes })) });
  } catch (error) {
    handleError(res, error, "fases");
  }
});

// Modo de alocação da proposta: "item" (direto no item, fluxo de sempre) ou "estrutura"
// (EAP — pastas + atividades-folha, ver EstruturaAtividade). Propostas que já tinham
// alocação antes dessa funcionalidade existir (sincronizadas do Senior ou criadas antes
// do gate) resolvem pra "item" automaticamente — sem interromper quem já vinha usando
// o fluxo direto, e sem precisar de uma migração retroativa de dado.
async function resolverModoAlocacao(codemp: number, codpro: number): Promise<"item" | "estrutura" | null> {
  const config = await prisma.propostaModoAlocacao.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
  if (config) return config.modo as "item" | "estrutura";
  // Sem config explícita: sempre "estrutura" — o modo "item" só existe hoje pra
  // propostas com PropostaModoAlocacao="item" explícita (legado migrado em massa via
  // backend/prisma/migrarLegadoParaEstrutura.ts; o que sobrou sem config é só proposta
  // sem nenhuma alocação ainda, ou proposta fora do recorte alocável — SITPRO_ALOCAVEL
  // já bloqueia as duas telas antes de chegar aqui de qualquer forma).
  return "estrutura";
}

alocacaoRouter.get("/propostas/:codemp/:codpro/modo", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }
    const modo = await resolverModoAlocacao(codemp, codpro);
    res.json({ modo });
  } catch (error) {
    handleError(res, error, "modo-alocacao");
  }
});

alocacaoRouter.post("/propostas/:codemp/:codpro/modo", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const modo = req.body?.modo;
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }
    if (modo !== "item" && modo !== "estrutura") {
      res.status(400).json({ error: "modo deve ser 'item' ou 'estrutura'" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const atual = await resolverModoAlocacao(codemp, codpro);
    if (atual) {
      res.status(409).json({ error: `Modo já definido para esta proposta (${atual}) — não é possível trocar depois da primeira alocação` });
      return;
    }

    await prisma.propostaModoAlocacao.create({
      data: { codemp, codpro, modo, definidoPor: ctx.contexto.consultor?.codusu ?? null },
    });

    res.status(201).json({ modo });
  } catch (error) {
    handleError(res, error, "definir-modo-alocacao");
  }
});

function formatHorasSimples(minutos: number): string {
  const totalMinutos = Math.round(minutos);
  const horas = Math.trunc(totalMinutos / 60);
  const resto = Math.abs(totalMinutos % 60);
  return `${horas}:${String(resto).padStart(2, "0")} h`;
}

async function validarSaldo(
  codemp: number,
  codpro: number,
  seqite: number,
  qtdhorNovo: number,
  opts?: { ignorarAtividadeId?: number; estruturaAtividadeId?: number }
): Promise<{ ok: true } | { ok: false; erro: string }> {
  // Modo "estrutura": o teto é a duração do nó-folha da EAP, não o item inteiro — o
  // teto do item já foi garantido quando o nó foi criado/editado (ver validarSomaEstrutura).
  if (opts?.estruturaAtividadeId != null) {
    const no = await prisma.estruturaAtividade.findUnique({ where: { id: opts.estruturaAtividadeId } });
    if (!no) return { ok: false, erro: "Atividade da estrutura não encontrada" };
    if (no.tipo !== "atividade") return { ok: false, erro: "Só é possível alocar consultor em atividades-folha, não em pastas" };
    if (no.duracaoHoras == null) return { ok: false, erro: "Atividade sem duração definida" };

    const existentesNo = await prisma.atividadeConsultor.findMany({
      where: { estruturaAtividadeId: opts.estruturaAtividadeId, sitreg: "A" },
    });
    const somaAtualNo = existentesNo
      .filter((a) => a.id !== opts.ignorarAtividadeId)
      .reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);
    if (somaAtualNo + qtdhorNovo > no.duracaoHoras) {
      return {
        ok: false,
        erro: `Horas excedem o saldo da atividade (disponível: ${formatHorasSimples(no.duracaoHoras - somaAtualNo)}, tentando alocar: ${formatHorasSimples(qtdhorNovo)})`,
      };
    }
    return { ok: true };
  }

  const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
  if (!item) return { ok: false, erro: "Item de proposta não encontrado" };
  if (item.qtdhor == null) return { ok: false, erro: "Item sem horas definidas na proposta" };

  const existentes = await prisma.atividadeConsultor.findMany({
    where: { codemp, codpro, seqite, sitreg: "A" },
  });
  const somaAtual = existentes
    .filter((a) => a.id !== opts?.ignorarAtividadeId)
    .reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);

  if (somaAtual + qtdhorNovo > item.qtdhor) {
    return {
      ok: false,
      erro: `Horas excedem o saldo do item (disponível: ${formatHorasSimples(item.qtdhor - somaAtual)}, tentando alocar: ${formatHorasSimples(qtdhorNovo)})`,
    };
  }
  return { ok: true };
}

// Checagem 2 da EAP: soma da duração de todas as atividades-folha da árvore não pode
// passar do total de horas do item — roda ao criar/editar um nó, não ao alocar
// consultor (isso é a checagem 1, dentro de validarSaldo acima).
async function validarSomaEstrutura(
  codemp: number,
  codpro: number,
  seqite: number,
  ignorarNoId: number | null,
  duracaoNova: number
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
  if (!item || item.qtdhor == null) return { ok: false, erro: "Item sem horas definidas na proposta" };

  const folhas = await prisma.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, tipo: "atividade" } });
  const somaAtual = folhas
    .filter((n) => n.id !== ignorarNoId)
    .reduce((soma, n) => soma + (n.duracaoHoras ?? 0), 0);

  if (somaAtual + duracaoNova > item.qtdhor) {
    return {
      ok: false,
      erro: `Duração excede o saldo do item (disponível: ${formatHorasSimples(item.qtdhor - somaAtual)}, tentando usar: ${formatHorasSimples(duracaoNova)})`,
    };
  }
  return { ok: true };
}

// EAP (Estrutura Analítica de Projeto) — pastas + atividades-folha dentro de um item,
// só existe pra propostas em modo "estrutura" (ver resolverModoAlocacao acima).
// Cronograma exclusivo da proposta inteira (não por item) — todos os itens da proposta
// entram como âncora da lista, e cada um carrega sua própria árvore de pastas/atividades
// (EstruturaAtividade). Uma atividade sempre pertence à árvore de UM item (seqite), então
// "só pode ser adicionada abaixo da pasta do item" já é garantido pela própria FK —
// aqui só juntamos tudo numa resposta só, pra tela ficar numa página única.
alocacaoRouter.get("/propostas/:codemp/:codpro/cronograma", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    const permitidos = await departamentosPermitidos(role, contexto);

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, include: { cliente: true } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(404).json({ error: "Proposta não encontrada ou não alocável" });
      return;
    }

    const itens = await prisma.propostaItem.findMany({
      where: { codemp, codpro, depexe: { in: permitidos } },
      orderBy: { seqite: "asc" },
    });
    if (itens.length === 0) {
      res.status(403).json({ error: "Sem itens desta proposta nos seus departamentos" });
      return;
    }

    const seqites = itens.map((i) => i.seqite);
    // Nós ligados a um item (seqite preenchido) — filtro redundante em runtime (a query
    // já garante isso), só pra o TS parar de tratar seqite como number|null daqui pra
    // frente (o campo virou opcional no schema pra existirem pastas raiz, ver abaixo).
    const nos = (
      await prisma.estruturaAtividade.findMany({
        where: { codemp, codpro, seqite: { in: seqites } },
        orderBy: { ordem: "asc" },
      })
    ).filter((n): n is typeof n & { seqite: number } => n.seqite != null);

    // Pastas raiz da proposta (seqite null) — agrupam itens entre si, ver
    // PropostaItemPosicao. Entram na mesma lista achatada que os nós normais pro
    // frontend montar uma árvore só; carregam junto a posição de cada item (pra saber
    // dentro de qual pasta raiz — ou solto, se não houver linha em PropostaItemPosicao).
    const pastasRaiz = await prisma.estruturaAtividade.findMany({
      where: { codemp, codpro, seqite: null },
      orderBy: { ordem: "asc" },
    });
    const posicoesItens = await prisma.propostaItemPosicao.findMany({ where: { codemp, codpro, seqite: { in: seqites } } });
    const posicaoPorSeqite = new Map(posicoesItens.map((p) => [p.seqite, p.parentId]));

    const todosOsNos = [...nos, ...pastasRaiz];
    const nosIds = todosOsNos.map((n) => n.id);
    const alocacoes =
      nosIds.length > 0
        ? await prisma.atividadeConsultor.findMany({
            where: { estruturaAtividadeId: { in: nosIds }, sitreg: "A" },
            include: { fase: true },
          })
        : [];
    const codforUnicos = [
      ...new Set([...alocacoes.map((a) => a.codfor), ...todosOsNos.map((n) => n.responsavelCodfor).filter((c): c is number => c != null)]),
    ];
    const consultores =
      codforUnicos.length > 0 ? await prisma.consultor.findMany({ where: { codfor: { in: codforUnicos } } }) : [];
    const consultorPorCodfor = new Map(consultores.map((c) => [c.codfor, c]));
    const alocacoesPorNo = new Map<number, typeof alocacoes>();
    for (const a of alocacoes) {
      if (a.estruturaAtividadeId == null) continue;
      if (!alocacoesPorNo.has(a.estruturaAtividadeId)) alocacoesPorNo.set(a.estruturaAtividadeId, []);
      alocacoesPorNo.get(a.estruturaAtividadeId)!.push(a);
    }
    const nomePorId = new Map(todosOsNos.map((n) => [n.id, n.nome]));
    const nosPorSeqite = new Map<number, typeof nos>();
    for (const n of nos) {
      if (!nosPorSeqite.has(n.seqite)) nosPorSeqite.set(n.seqite, []);
      nosPorSeqite.get(n.seqite)!.push(n);
    }

    // "Horas realizadas" por alocação — mesmo cálculo de carregarAtividadesVisiveis em
    // atividades.ts: sessões de execução ainda não confirmadas + RatItem já confirmados/
    // sincronizados (nunca as duas fontes ao mesmo tempo pra mesma sessão).
    const seqatisValidos = [...new Set(alocacoes.map((a) => a.seqati).filter((s): s is bigint => s != null))];
    const ratItemsComHoras =
      seqatisValidos.length > 0
        ? await prisma.ratItem.findMany({
            where: { seqati: { in: seqatisValidos }, horini: { not: null }, horfim: { not: null } },
            select: { seqati: true, horini: true, horfim: true },
          })
        : [];
    const minutosRealizadosPorSeqati = new Map<bigint, number>();
    for (const item of ratItemsComHoras) {
      if (item.seqati == null || item.horini == null || item.horfim == null) continue;
      minutosRealizadosPorSeqati.set(item.seqati, (minutosRealizadosPorSeqati.get(item.seqati) ?? 0) + (item.horfim - item.horini));
    }
    const sessoesNaoConfirmadas =
      alocacoes.length > 0
        ? await prisma.atividadeSessaoExecucao.findMany({
            where: { atividadeId: { in: alocacoes.map((a) => a.id) }, confirmada: false, fim: { not: null } },
            select: { atividadeId: true, inicio: true, fim: true },
          })
        : [];
    const minutosRealizadosPorAtividadeId = new Map<number, number>();
    for (const s of sessoesNaoConfirmadas) {
      if (s.fim == null) continue;
      const minutos = Math.round((s.fim.getTime() - s.inicio.getTime()) / 60000);
      minutosRealizadosPorAtividadeId.set(s.atividadeId, (minutosRealizadosPorAtividadeId.get(s.atividadeId) ?? 0) + minutos);
    }
    function horasRealizadasDaAlocacao(a: (typeof alocacoes)[number]): number {
      return (a.seqati != null ? minutosRealizadosPorSeqati.get(a.seqati) ?? 0 : 0) + (minutosRealizadosPorAtividadeId.get(a.id) ?? 0);
    }

    function mapNo(n: (typeof todosOsNos)[number]) {
      const alocacoesDoNo = alocacoesPorNo.get(n.id) ?? [];
      const horasAlocadas = alocacoesDoNo.reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);
      const horasRealizadas = alocacoesDoNo.reduce((soma, a) => soma + horasRealizadasDaAlocacao(a), 0);
      return {
        id: n.id,
        parentId: n.parentId,
        tipo: n.tipo,
        nome: n.nome,
        ordem: n.ordem,
        duracaoHoras: n.duracaoHoras,
        dataPrevistaInicio: n.dataPrevistaInicio,
        dataPrevistaFim: n.dataPrevistaFim,
        predecessoraId: n.predecessoraId,
        predecessoraNome: n.predecessoraId != null ? nomePorId.get(n.predecessoraId) ?? null : null,
        percentualConcluido: n.percentualConcluido,
        // Manual, só relevante em tipo="atividade" — "bloqueada" nunca vem daqui, é
        // sempre derivada no frontend (derivarStatus) a partir da predecessora.
        status: n.status,
        responsavelCodfor: n.responsavelCodfor,
        responsavelNome:
          n.responsavelCodfor != null
            ? consultorPorCodfor.get(n.responsavelCodfor)?.nomcom ?? consultorPorCodfor.get(n.responsavelCodfor)?.nomfor ?? null
            : null,
        observacao: n.observacao,
        horasAlocadas,
        horasRealizadas,
        saldo: n.duracaoHoras != null ? n.duracaoHoras - horasAlocadas : null,
        alocacoes: alocacoesDoNo.map((a) => ({
          id: a.id,
          codfor: a.codfor,
          consultorNome: consultorPorCodfor.get(a.codfor)?.nomcom ?? consultorPorCodfor.get(a.codfor)?.nomfor ?? `Fornecedor ${a.codfor}`,
          qtdhor: a.qtdhor,
          fasid: a.fasid,
          faseDes: a.fase.fasdes,
          dataPrevistaInicio: a.dataPrevistaInicio,
          dataPrevistaFim: a.dataPrevistaFim,
        })),
      };
    }

    const podeGerenciarEstaProposta = await podeGerenciarProposta(role, contexto, codemp, codpro);

    res.json({
      proposta: {
        codemp,
        codpro,
        numprj: proposta.numprj,
        cliente: `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}`,
        sitproLabel: sitproLabel(proposta.sitpro),
        sitproTone: sitproTone(proposta.sitpro),
        // Cria/renomeia/exclui pasta raiz e agrupa itens dentro dela — ação de nível de
        // proposta inteira, não de um item/departamento específico (ver
        // podeGerenciarProposta).
        podeGerenciarProposta: podeGerenciarEstaProposta,
      },
      // Pastas raiz da proposta — organizacionais, fora do escopo de qualquer item;
      // servem só pra agrupar itens entre si (parentId de EstruturaAtividade normal,
      // igual pasta comum — a diferença é só não ter seqite).
      pastasRaiz: pastasRaiz.map((p) => ({ ...mapNo(p), podeEditar: podeGerenciarEstaProposta })),
      itens: itens.map((item) => ({
        seqite: item.seqite,
        codser: item.codser,
        despro: item.despro,
        depexe: item.depexe,
        depexeLabel: depexeLabel(item.depexe),
        qtdhorItem: item.qtdhor,
        podeEditar: item.depexe != null && podeExecutarAcao(role, contexto, "criar", { depexe: item.depexe, codfor: 0 }),
        // Pasta raiz onde este item foi agrupado, ou null se estiver solto (padrão —
        // comportamento de sempre, direto na raiz da árvore da proposta).
        parentId: posicaoPorSeqite.get(item.seqite) ?? null,
        nos: (nosPorSeqite.get(item.seqite) ?? []).map(mapNo),
      })),
    });
  } catch (error) {
    handleError(res, error, "cronograma");
  }
});

alocacaoRouter.post("/estrutura", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.body?.codemp);
    const codpro = Number(req.body?.codpro);
    // seqite ausente = pasta raiz da proposta (agrupa itens entre si, ver
    // PropostaItemPosicao) — só tipo "pasta" pode ser raiz, atividade sempre pertence a
    // um item.
    const seqiteRaw = req.body?.seqite;
    const seqite = seqiteRaw != null ? Number(seqiteRaw) : null;
    const tipo = req.body?.tipo;
    const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
    const parentId = req.body?.parentId != null ? Number(req.body.parentId) : null;
    if (![codemp, codpro].every(Number.isFinite) || (tipo !== "pasta" && tipo !== "atividade") || nome === "") {
      res.status(400).json({ error: "codemp, codpro, tipo (pasta|atividade) e nome são obrigatórios" });
      return;
    }
    if (seqite != null && !Number.isFinite(seqite)) {
      res.status(400).json({ error: "seqite inválido" });
      return;
    }
    if (seqite == null && tipo !== "pasta") {
      res.status(400).json({ error: "Só uma pasta pode ser raiz da proposta (sem seqite) — atividade sempre pertence a um item" });
      return;
    }

    const modo = await resolverModoAlocacao(codemp, codpro);
    if (modo !== "estrutura") {
      res.status(400).json({ error: "Esta proposta não está no modo de alocação por estrutura" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (seqite == null) {
      // Pasta raiz: permissão é no nível da proposta inteira (pode reunir itens de
      // departamentos diferentes, não dá pra checar contra um depexe só).
      if (!(await podeGerenciarProposta(role, contexto, codemp, codpro))) {
        res.status(403).json({ error: "Sem permissão para gerenciar esta proposta" });
        return;
      }
      if (parentId != null) {
        const pai = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
        if (!pai || pai.codemp !== codemp || pai.codpro !== codpro || pai.seqite != null) {
          res.status(400).json({ error: "Pasta raiz de destino não encontrada" });
          return;
        }
        if (pai.tipo !== "pasta") {
          res.status(400).json({ error: "Só é possível criar dentro de uma pasta" });
          return;
        }
      }
      const irmaosRaiz = await prisma.estruturaAtividade.findMany({ where: { codemp, codpro, seqite: null, parentId } });
      const ordemRaiz = irmaosRaiz.length > 0 ? Math.max(...irmaosRaiz.map((n) => n.ordem)) + 1 : 0;
      const novaPastaRaiz = await prisma.estruturaAtividade.create({
        data: { codemp, codpro, seqite: null, parentId, tipo: "pasta", nome, ordem: ordemRaiz, criadoPor: contexto.consultor?.codusu ?? null },
      });
      res.status(201).json({ id: novaPastaRaiz.id });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item || item.depexe == null) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    if (!podeExecutarAcao(role, contexto, "criar", { depexe: item.depexe, codfor: 0 })) {
      res.status(403).json({ error: "Sem permissão para editar a estrutura deste departamento" });
      return;
    }

    if (parentId != null) {
      const pai = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
      if (!pai || pai.codemp !== codemp || pai.codpro !== codpro || pai.seqite !== seqite) {
        res.status(400).json({ error: "Pasta pai não encontrada" });
        return;
      }
      if (pai.tipo !== "pasta") {
        res.status(400).json({ error: "Só é possível criar dentro de uma pasta" });
        return;
      }
    }

    let duracaoHoras: number | null = null;
    let dataPrevistaInicio: Date | null = null;
    let dataPrevistaFim: Date | null = null;
    let predecessoraId: number | null = null;
    if (tipo === "atividade") {
      duracaoHoras = req.body?.duracaoHoras != null ? Number(req.body.duracaoHoras) : null;
      if (duracaoHoras != null) {
        const saldo = await validarSomaEstrutura(codemp, codpro, seqite, null, duracaoHoras);
        if (!saldo.ok) {
          res.status(400).json({ error: saldo.erro });
          return;
        }
      }
      dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
      dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
      if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
        res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
        return;
      }
      predecessoraId = req.body?.predecessoraId != null ? Number(req.body.predecessoraId) : null;
    }

    const irmaos = await prisma.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, parentId } });
    const ordem = irmaos.length > 0 ? Math.max(...irmaos.map((n) => n.ordem)) + 1 : 0;

    const novo = await prisma.estruturaAtividade.create({
      data: {
        codemp,
        codpro,
        seqite,
        parentId,
        tipo,
        nome,
        ordem,
        duracaoHoras,
        dataPrevistaInicio,
        dataPrevistaFim,
        predecessoraId,
        criadoPor: contexto.consultor?.codusu ?? null,
      },
    });

    res.status(201).json({ id: novo.id });
  } catch (error) {
    handleError(res, error, "estrutura-criar");
  }
});

alocacaoRouter.patch("/estrutura/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const no = await prisma.estruturaAtividade.findUnique({ where: { id } });
    if (!no) {
      res.status(404).json({ error: "Nó não encontrado" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (no.seqite == null) {
      // Pasta raiz: permissão no nível da proposta inteira (ver POST /estrutura).
      if (!(await podeGerenciarProposta(role, contexto, no.codemp, no.codpro))) {
        res.status(403).json({ error: "Sem permissão para gerenciar esta proposta" });
        return;
      }
    } else {
      const item = await prisma.propostaItem.findUnique({
        where: { codemp_codpro_seqite: { codemp: no.codemp, codpro: no.codpro, seqite: no.seqite } },
      });
      if (!item || item.depexe == null) {
        res.status(404).json({ error: "Item de proposta não encontrado" });
        return;
      }
      if (!podeExecutarAcao(role, contexto, "editar", { depexe: item.depexe, codfor: 0 })) {
        res.status(403).json({ error: "Sem permissão para editar a estrutura deste departamento" });
        return;
      }
    }

    const nome = typeof req.body?.nome === "string" && req.body.nome.trim() !== "" ? req.body.nome.trim() : undefined;
    let ordem = req.body?.ordem != null ? Number(req.body.ordem) : undefined;

    // Reorganização (mover pra dentro de outra pasta, ou pra raiz) — vale pra pasta e
    // atividade. Precisa impedir ciclo (mover uma pasta pra dentro de uma das suas
    // próprias subpastas) e recalcula a ordem pro final da nova lista de irmãos.
    let parentId: number | null | undefined;
    if (req.body?.parentId !== undefined) {
      parentId = req.body.parentId != null ? Number(req.body.parentId) : null;
      if (parentId != null) {
        if (parentId === no.id) {
          res.status(400).json({ error: "Não é possível mover um item pra dentro dele mesmo" });
          return;
        }
        const novoPai = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
        // Pasta raiz (seqite null) só reparenta dentro de outra pasta raiz; pasta/atividade
        // ligada a um item só reparenta dentro do mesmo item — nunca mistura os dois
        // escopos (não faria sentido uma atividade "pular" pra debaixo de outro item por
        // aqui; pra mover o ITEM em si, ver POST .../itens/:seqite/posicao).
        if (!novoPai || novoPai.codemp !== no.codemp || novoPai.codpro !== no.codpro || novoPai.seqite !== no.seqite) {
          res.status(400).json({ error: "Pasta de destino não encontrada" });
          return;
        }
        if (novoPai.tipo !== "pasta") {
          res.status(400).json({ error: "Só é possível mover pra dentro de uma pasta" });
          return;
        }
        let atual: typeof novoPai | null = novoPai;
        while (atual?.parentId != null) {
          if (atual.parentId === no.id) {
            res.status(400).json({ error: "Não é possível mover uma pasta pra dentro de uma das suas próprias subpastas" });
            return;
          }
          atual = await prisma.estruturaAtividade.findUnique({ where: { id: atual.parentId } });
        }
      }
      if (ordem === undefined) {
        const irmaos = await prisma.estruturaAtividade.findMany({
          where: { codemp: no.codemp, codpro: no.codpro, seqite: no.seqite, parentId },
        });
        ordem = irmaos.length > 0 ? Math.max(...irmaos.map((n) => n.ordem)) + 1 : 0;
      }
    }

    let percentualConcluido: number | undefined;
    if (req.body?.percentualConcluido != null) {
      percentualConcluido = Number(req.body.percentualConcluido);
      if (!Number.isFinite(percentualConcluido) || percentualConcluido < 0 || percentualConcluido > 100) {
        res.status(400).json({ error: "percentualConcluido deve estar entre 0 e 100" });
        return;
      }
    }

    let duracaoHoras: number | null | undefined;
    let dataPrevistaInicio: Date | null | undefined;
    let dataPrevistaFim: Date | null | undefined;
    let predecessoraId: number | null | undefined;
    let status: string | null | undefined;
    let responsavelCodfor: number | null | undefined;
    let observacao: string | null | undefined;
    if (no.tipo === "atividade") {
      if (req.body?.status !== undefined) {
        const statusValidos = ["nao_iniciada", "em_curso", "concluida"];
        if (req.body.status != null && !statusValidos.includes(req.body.status)) {
          res.status(400).json({ error: "status deve ser 'nao_iniciada', 'em_curso' ou 'concluida' ('bloqueada' é sempre calculada, nunca gravada)" });
          return;
        }
        status = req.body.status ?? null;
      }
      if (req.body?.responsavelCodfor !== undefined) {
        responsavelCodfor = req.body.responsavelCodfor != null ? Number(req.body.responsavelCodfor) : null;
      }
      if (req.body?.observacao !== undefined) {
        observacao = typeof req.body.observacao === "string" && req.body.observacao.trim() !== "" ? req.body.observacao.trim() : null;
      }
      if (req.body?.duracaoHoras !== undefined) {
        duracaoHoras = req.body.duracaoHoras != null ? Number(req.body.duracaoHoras) : null;
        // Distribuição pode ser provisória — `confirmarExcedente` deixa passar mesmo
        // estourando o saldo do item (o usuário já viu o aviso no drawer e confirmou).
        // Sem essa flag, continua bloqueando — é só um "leve" a mais, não uma trava.
        if (duracaoHoras != null && req.body?.confirmarExcedente !== true) {
          // no.seqite nunca é null aqui — só pasta pode ser raiz (tipo="atividade" sempre
          // pertence a um item, garantido na criação em POST /estrutura).
          const saldo = await validarSomaEstrutura(no.codemp, no.codpro, no.seqite!, no.id, duracaoHoras);
          if (!saldo.ok) {
            res.status(400).json({ error: saldo.erro });
            return;
          }
        }
      }
      if (req.body?.dataPrevistaInicio !== undefined) {
        dataPrevistaInicio = req.body.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
      }
      if (req.body?.dataPrevistaFim !== undefined) {
        dataPrevistaFim = req.body.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
      }
      if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
        res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
        return;
      }
      if (req.body?.predecessoraId !== undefined) {
        predecessoraId = req.body.predecessoraId != null ? Number(req.body.predecessoraId) : null;
      }
    }

    await prisma.estruturaAtividade.update({
      where: { id },
      data: {
        nome,
        ordem,
        parentId,
        percentualConcluido,
        duracaoHoras,
        dataPrevistaInicio,
        dataPrevistaFim,
        predecessoraId,
        status,
        responsavelCodfor,
        observacao,
      },
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "estrutura-editar");
  }
});

alocacaoRouter.delete("/estrutura/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const no = await prisma.estruturaAtividade.findUnique({ where: { id } });
    if (!no) {
      res.status(404).json({ error: "Nó não encontrado" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (no.seqite == null) {
      if (!(await podeGerenciarProposta(role, contexto, no.codemp, no.codpro))) {
        res.status(403).json({ error: "Sem permissão para gerenciar esta proposta" });
        return;
      }
    } else {
      const item = await prisma.propostaItem.findUnique({
        where: { codemp_codpro_seqite: { codemp: no.codemp, codpro: no.codpro, seqite: no.seqite } },
      });
      if (!item || item.depexe == null) {
        res.status(404).json({ error: "Item de proposta não encontrado" });
        return;
      }
      if (!podeExecutarAcao(role, contexto, "excluir", { depexe: item.depexe, codfor: 0 })) {
        res.status(403).json({ error: "Sem permissão para editar a estrutura deste departamento" });
        return;
      }
    }

    const filhos = await prisma.estruturaAtividade.count({ where: { parentId: id } });
    if (filhos > 0) {
      res.status(400).json({ error: "Não é possível excluir: existem itens dentro desta pasta/atividade" });
      return;
    }
    // Pasta raiz com item(ns) da proposta agrupados dentro: uma vez que um item entra
    // numa pasta raiz, ela trava — não pode mais ser excluída (só esvaziada, movendo os
    // itens de volta pra fora, um por um).
    const itensAgrupados = await prisma.propostaItemPosicao.count({ where: { parentId: id } });
    if (itensAgrupados > 0) {
      res.status(400).json({ error: "Não é possível excluir: existem itens da proposta agrupados nesta pasta" });
      return;
    }
    const alocacoesVinculadas = await prisma.atividadeConsultor.findMany({ where: { estruturaAtividadeId: id, sitreg: "A" } });
    if (alocacoesVinculadas.length > 1) {
      res.status(400).json({
        error: `Não é possível excluir: existem ${alocacoesVinculadas.length} consultores alocados nesta atividade — remova as alocações primeiro`,
      });
      return;
    }

    if (alocacoesVinculadas.length === 1) {
      // Exclusão em cascata: uma atividade-folha do lote novo sempre tem exatamente 1
      // consultor vinculado (regra estrutural do módulo, ver alocar-lote) — excluir a
      // atividade sem excluir a alocação deixaria um AtividadeConsultor órfão apontando
      // pra um estruturaAtividadeId inexistente. Mesmo padrão (soft-delete + auditoria +
      // outbox) de DELETE /alocacao/alocacoes/:id, só que dentro da mesma transação da
      // exclusão do nó.
      const alocacao = alocacoesVinculadas[0];
      await prisma.$transaction([
        prisma.atividadeConsultor.update({ where: { id: alocacao.id }, data: { sitreg: "I" } }),
        criarEventoAuditoria({
          origem: "tela",
          usuarioId: ctx.user.id,
          codemp: alocacao.codemp,
          codpro: alocacao.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
          entidadeId: entidadeIdAtividade(alocacao.id),
          entidadeRotulo: `Alocação — Item ${alocacao.seqite} da Proposta ${alocacao.codemp}/${alocacao.codpro}`,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA,
          alteracoes: null,
          metadata: null,
          correlationId: req.correlationId!,
        }),
        prisma.estruturaAtividade.delete({ where: { id } }),
      ]);
      await enfileirar(alocacao.id, "remover_atividade", {});
      res.json({ ok: true });
      return;
    }

    await prisma.estruturaAtividade.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "estrutura-excluir");
  }
});

// Agrupa (ou solta) um item de proposta dentro de uma pasta raiz — o item continua
// virtual (nunca uma linha em EstruturaAtividade), só a posição é persistida aqui.
// parentId null = solta o item (volta a ficar direto na raiz da árvore, comportamento
// de sempre). Permissão é a mesma de editar o próprio item (mesmo depexe), não a da
// pasta raiz em si (essa foi checada quando a pasta foi criada).
alocacaoRouter.post("/propostas/:codemp/:codpro/itens/:seqite/posicao", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    const parentId = req.body?.parentId != null ? Number(req.body.parentId) : null;
    if (![codemp, codpro, seqite].every(Number.isFinite) || (req.body?.parentId != null && !Number.isFinite(parentId))) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const modo = await resolverModoAlocacao(codemp, codpro);
    if (modo !== "estrutura") {
      res.status(400).json({ error: "Esta proposta não está no modo de alocação por estrutura" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item || item.depexe == null) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;
    if (!podeExecutarAcao(role, contexto, "mover", { depexe: item.depexe, codfor: 0 })) {
      res.status(403).json({ error: "Sem permissão para mover este item" });
      return;
    }

    if (parentId != null) {
      const pastaRaiz = await prisma.estruturaAtividade.findUnique({ where: { id: parentId } });
      if (!pastaRaiz || pastaRaiz.codemp !== codemp || pastaRaiz.codpro !== codpro || pastaRaiz.seqite != null) {
        res.status(400).json({ error: "Pasta raiz de destino não encontrada" });
        return;
      }
      if (pastaRaiz.tipo !== "pasta") {
        res.status(400).json({ error: "Só é possível agrupar um item dentro de uma pasta" });
        return;
      }
      await prisma.propostaItemPosicao.upsert({
        where: { codemp_codpro_seqite: { codemp, codpro, seqite } },
        create: { codemp, codpro, seqite, parentId },
        update: { parentId },
      });
    } else {
      await prisma.propostaItemPosicao.deleteMany({ where: { codemp, codpro, seqite } });
    }

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "item-posicao");
  }
});

alocacaoRouter.post("/itens/:codemp/:codpro/:seqite/alocacoes", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    const codfor = Number(req.body?.codfor);
    const qtdhor = Number(req.body?.qtdhor);
    const fasid = Number(req.body?.fasid);
    if (![codemp, codpro, seqite, codfor, qtdhor, fasid].every(Number.isFinite) || qtdhor <= 0) {
      res.status(400).json({ error: "codfor, qtdhor (>0) e fasid são obrigatórios" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    // Modo "estrutura": a alocação mira o nó-folha da EAP em vez de ir direto no item
    // (ver resolverModoAlocacao/EstruturaAtividade) — o nó precisa existir e pertencer
    // a este mesmo item.
    let estruturaAtividadeId: number | null = null;
    if (req.body?.estruturaAtividadeId != null) {
      estruturaAtividadeId = Number(req.body.estruturaAtividadeId);
      if (!Number.isFinite(estruturaAtividadeId)) {
        res.status(400).json({ error: "estruturaAtividadeId inválido" });
        return;
      }
      const no = await prisma.estruturaAtividade.findUnique({ where: { id: estruturaAtividadeId } });
      if (!no || no.codemp !== codemp || no.codpro !== codpro || no.seqite !== seqite) {
        res.status(400).json({ error: "Atividade da estrutura não encontrada neste item" });
        return;
      }
      if (no.tipo !== "atividade") {
        res.status(400).json({ error: "Só é possível alocar consultor em atividades-folha, não em pastas" });
        return;
      }
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item || item.depexe == null) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(400).json({ error: "Só é possível alocar horas em propostas Aprovada ou Em Execução" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "criar", { depexe: item.depexe, codfor })) {
      res.status(403).json({ error: "Sem permissão para alocar neste departamento" });
      return;
    }

    const integranteTime = await prisma.departamentoTime.findFirst({
      where: { codemp, depexe: item.depexe, sitreg: "A" },
    });
    const consultorAlvo = await prisma.consultor.findFirst({ where: { codemp, codfor } });
    const ehDoTime =
      consultorAlvo != null &&
      (await prisma.departamentoTime.findFirst({
        where: { codemp, depexe: item.depexe, codusu: BigInt(consultorAlvo.codusu), sitreg: "A" },
      })) != null;
    if (!integranteTime || !ehDoTime) {
      res.status(400).json({ error: "Consultor não faz parte do time deste departamento" });
      return;
    }

    const saldo = await validarSaldo(codemp, codpro, seqite, qtdhor, { estruturaAtividadeId: estruturaAtividadeId ?? undefined });
    if (!saldo.ok) {
      res.status(400).json({ error: saldo.erro });
      return;
    }

    const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });

    // Transação interativa (não array): o entidadeId do evento de auditoria é o `id`
    // gerado pelo create, que só existe depois do insert — o padrão "array de operações"
    // usado no resto do projeto não permite essa dependência entre operações da mesma
    // transação.
    const nova = await prisma.$transaction(async (tx) => {
      const criada = await tx.atividadeConsultor.create({
        data: {
          codemp,
          codpro,
          seqite,
          codfor,
          qtdhor,
          sitreg: "A",
          datger: new Date(),
          usuger: contexto.consultor?.codusu ?? null,
          dataPrevistaInicio,
          dataPrevistaFim,
          fasid,
          colunaId: primeiraColuna?.id ?? null,
          estruturaAtividadeId,
        },
      });

      const entidadeRotulo = `Alocação de ${consultorAlvo?.nomcom ?? consultorAlvo?.nomfor ?? `Fornecedor ${codfor}`} — Item ${seqite}`;
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: user.id,
          codemp,
          codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
          entidadeId: entidadeIdAtividade(criada.id),
          entidadeRotulo,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_CRIADA,
          alteracoes: null,
          metadata: { qtdhor, fasid },
          correlationId: req.correlationId!,
        },
        tx
      );

      return criada;
    });

    await enfileirar(nova.id, "criar_atividade", {
      codemp,
      codpro,
      seqite,
      codfor,
      qtdhor,
      fasid,
      dataPrevistaInicio: dataPrevistaInicio?.toISOString() ?? null,
      dataPrevistaFim: dataPrevistaFim?.toISOString() ?? null,
    });

    res.status(201).json({ id: nova.id });
  } catch (error) {
    handleError(res, error, "criar-alocacao");
  }
});

// Sinaliza especificamente "o saldo mudou entre o usuário abrir o modal e confirmar" —
// path de erro à parte do 400 de validação normal (ver validarSaldo/validarSomaEstrutura
// acima, que não tem esse precedente de 409): revalidado por último, já dentro da
// transação, imediatamente antes dos create — se alguém mais gravou horas nesse meio-
// tempo, aborta e o cliente recarrega a árvore em vez de só mostrar o erro.
class SaldoDivergenteError extends Error {}

interface ConsultorLoteInput {
  codfor: number;
  qtdhor: number;
}

type DestinoLote = { tipo: "item" } | { tipo: "pasta"; pastaId: number } | { tipo: "nova_pasta"; nome: string };

function parseDestinoLote(body: unknown): DestinoLote | null {
  const destino = (body as { destino?: unknown } | undefined)?.destino as Record<string, unknown> | undefined;
  if (!destino || typeof destino.tipo !== "string") return null;
  if (destino.tipo === "item") return { tipo: "item" };
  if (destino.tipo === "pasta") {
    const pastaId = Number(destino.pastaId);
    return Number.isFinite(pastaId) ? { tipo: "pasta", pastaId } : null;
  }
  if (destino.tipo === "nova_pasta") {
    const nome = typeof destino.nome === "string" ? destino.nome.trim() : "";
    return nome !== "" ? { tipo: "nova_pasta", nome } : null;
  }
  return null;
}

// Alocação em lote (EAP): cria N atividades-folha irmãs — uma por consultor marcado no
// modal "Alocar consultores" — todas filhas do mesmo destino (o próprio item, uma pasta
// já existente, ou uma pasta nova criada na hora). Cada atividade tem sempre exatamente
// 1 consultor (regra estrutural do módulo) — nunca reaproveita um nó existente pra
// receber um 2º consultor, mesmo que o schema tecnicamente permita (AtividadeConsultor.
// estruturaAtividadeId aceita N linhas por nó, usado historicamente pelo fluxo antigo de
// POST .../alocacoes com estruturaAtividadeId de um nó já criado à parte — aqui sempre
// nasce 1 nó novo por consultor).
alocacaoRouter.post("/itens/:codemp/:codpro/:seqite/alocar-lote", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codpro = Number(req.params.codpro);
    const seqite = Number(req.params.seqite);
    if (![codemp, codpro, seqite].every(Number.isFinite)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const destino = parseDestinoLote(req.body);
    if (!destino) {
      res.status(400).json({ error: "destino inválido — use 'item', 'pasta' (com pastaId) ou 'nova_pasta' (com nome)" });
      return;
    }

    const consultoresRaw = Array.isArray(req.body?.consultores) ? (req.body.consultores as unknown[]) : [];
    const consultores: ConsultorLoteInput[] = consultoresRaw.map((c) => ({
      codfor: Number((c as Record<string, unknown>)?.codfor),
      qtdhor: Number((c as Record<string, unknown>)?.qtdhor),
    }));
    if (consultores.length === 0 || consultores.some((c) => !Number.isFinite(c.codfor) || !Number.isFinite(c.qtdhor) || c.qtdhor <= 0)) {
      res.status(400).json({ error: "Informe ao menos 1 consultor, cada um com qtdhor (>0)" });
      return;
    }
    const codforsUnicos = new Set(consultores.map((c) => c.codfor));
    if (codforsUnicos.size !== consultores.length) {
      res.status(400).json({ error: "Consultor duplicado na lista" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    const modo = await resolverModoAlocacao(codemp, codpro);
    if (modo !== "estrutura") {
      res.status(400).json({ error: "Esta proposta não está no modo de alocação por estrutura" });
      return;
    }

    const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
    if (!item) {
      res.status(404).json({ error: "Item de proposta não encontrado" });
      return;
    }
    if (item.depexe == null) {
      res.status(400).json({ error: "Item sem departamento de execução definido" });
      return;
    }

    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
    if (!proposta || proposta.sitpro == null || !SITPRO_ALOCAVEL.includes(proposta.sitpro)) {
      res.status(400).json({ error: "Só é possível alocar horas em propostas Aprovada ou Em Execução" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "criar", { depexe: item.depexe, codfor: 0 })) {
      res.status(403).json({ error: "Sem permissão para alocar neste departamento" });
      return;
    }

    // Resolve o nó de destino (não a pasta nova ainda — essa só nasce dentro da
    // transação, junto com as atividades, pra não deixar uma pasta órfã se o resto
    // falhar).
    let pastaDestinoExistente: Awaited<ReturnType<typeof prisma.estruturaAtividade.findUnique>> = null;
    if (destino.tipo === "pasta") {
      pastaDestinoExistente = await prisma.estruturaAtividade.findUnique({ where: { id: destino.pastaId } });
      if (
        !pastaDestinoExistente ||
        pastaDestinoExistente.codemp !== codemp ||
        pastaDestinoExistente.codpro !== codpro ||
        pastaDestinoExistente.seqite !== seqite ||
        pastaDestinoExistente.tipo !== "pasta"
      ) {
        res.status(400).json({ error: "Pasta de destino não encontrada" });
        return;
      }
    }

    // Consultor precisa existir, estar ativo E integrar o time do departamento do item —
    // mesma checagem de POST .../alocacoes, aplicada a cada linha do lote.
    const codforsAtivos = await prisma.consultor.findMany({
      where: { codemp, codfor: { in: [...codforsUnicos] }, sitfor: "A" },
    });
    const consultorPorCodfor = new Map(codforsAtivos.map((c) => [c.codfor as number, c]));
    const faltantes = [...codforsUnicos].filter((cf) => !consultorPorCodfor.has(cf));
    if (faltantes.length > 0) {
      res.status(400).json({ error: `Consultor(es) não encontrado(s) ou inativo(s): ${faltantes.join(", ")}` });
      return;
    }
    const timeDoDepartamento = await prisma.departamentoTime.findMany({ where: { codemp, depexe: item.depexe, sitreg: "A" } });
    const codususDoTime = new Set(timeDoDepartamento.map((t) => Number(t.codusu)));
    const foraDoTime = codforsAtivos.filter((c) => !codususDoTime.has(c.codusu));
    if (foraDoTime.length > 0) {
      res.status(400).json({
        error: `Consultor(es) fora do time do departamento: ${foraDoTime.map((c) => c.nomcom ?? c.nomfor ?? c.codfor).join(", ")}`,
      });
      return;
    }

    const fasidBody = req.body?.fasid != null ? Number(req.body.fasid) : null;
    let fasid: number;
    if (fasidBody != null) {
      if (!Number.isFinite(fasidBody) || !(await prisma.faseProposta.findUnique({ where: { fasid: fasidBody } }))) {
        res.status(400).json({ error: "fasid inválido" });
        return;
      }
      fasid = fasidBody;
    } else {
      const primeiraFase = await prisma.faseProposta.findFirst({ orderBy: { fasid: "asc" } });
      if (!primeiraFase) {
        res.status(400).json({ error: "Nenhuma fase cadastrada" });
        return;
      }
      fasid = primeiraFase.fasid;
    }

    const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
    const somaLote = consultores.reduce((soma, c) => soma + c.qtdhor, 0);

    let criadas: { id: number; estruturaAtividadeId: number; codfor: number; qtdhor: number }[] = [];
    let pastaCriadaId: number | null = null;

    try {
      await prisma.$transaction(async (tx) => {
        // Revalidação final do saldo do item, já dentro da transação — a mesma conta de
        // validarSomaEstrutura, mas recalculada agora (não com o snapshot que o modal
        // carregou) e incluindo a soma do lote inteiro de uma vez, não consultor a
        // consultor (senão o 1º consultor "reservaria" saldo que o 2º acabaria vendo como
        // livre, mesmo os dois cabendo juntos ou os dois estourando juntos).
        const itemAtual = await tx.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
        if (!itemAtual || itemAtual.qtdhor == null) throw new SaldoDivergenteError("Item sem horas definidas na proposta");
        const folhasAtuais = await tx.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, tipo: "atividade" } });
        const somaAtual = folhasAtuais.reduce((soma, n) => soma + (n.duracaoHoras ?? 0), 0);
        if (somaAtual + somaLote > itemAtual.qtdhor) {
          throw new SaldoDivergenteError(
            `O saldo do item mudou — disponível agora: ${formatHorasSimples(itemAtual.qtdhor - somaAtual)}, tentando alocar: ${formatHorasSimples(somaLote)}`
          );
        }

        let parentId: number | null;
        if (destino.tipo === "item") {
          parentId = null;
        } else if (destino.tipo === "pasta") {
          parentId = destino.pastaId;
        } else {
          const irmaosRaiz = await tx.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, parentId: null } });
          const ordemPasta = irmaosRaiz.length > 0 ? Math.max(...irmaosRaiz.map((n) => n.ordem)) + 1 : 0;
          const novaPasta = await tx.estruturaAtividade.create({
            data: {
              codemp,
              codpro,
              seqite,
              parentId: null,
              tipo: "pasta",
              nome: destino.nome,
              ordem: ordemPasta,
              criadoPor: contexto.consultor?.codusu ?? null,
            },
          });
          pastaCriadaId = novaPasta.id;
          parentId = novaPasta.id;
        }

        const irmaosDestino = await tx.estruturaAtividade.findMany({ where: { codemp, codpro, seqite, parentId } });
        let proximaOrdem = irmaosDestino.length > 0 ? Math.max(...irmaosDestino.map((n) => n.ordem)) + 1 : 0;

        // Nome da atividade = nome do ITEM (mesma regra de useCronograma.ts no
        // frontend: despro se tiver, senão codser) — o consultor não vira o título da
        // atividade, só o responsável (responsavelCodfor abaixo), mostrado como
        // avatar/iniciais na árvore (LinhaNo.tsx já resolve isso, sem mudança de UI).
        const nomeAtividade = item.despro ?? item.codser;

        for (const c of consultores) {
          const consultorInfo = consultorPorCodfor.get(c.codfor)!;
          const nomeConsultor = consultorInfo.nomcom ?? consultorInfo.nomfor ?? `Fornecedor ${c.codfor}`;

          const noEstrutura = await tx.estruturaAtividade.create({
            data: {
              codemp,
              codpro,
              seqite,
              parentId,
              tipo: "atividade",
              nome: nomeAtividade,
              responsavelCodfor: c.codfor,
              ordem: proximaOrdem++,
              duracaoHoras: c.qtdhor,
              dataPrevistaInicio,
              dataPrevistaFim,
              criadoPor: contexto.consultor?.codusu ?? null,
            },
          });

          const atividadeConsultor = await tx.atividadeConsultor.create({
            data: {
              codemp,
              codpro,
              seqite,
              codfor: c.codfor,
              qtdhor: c.qtdhor,
              sitreg: "A",
              datger: new Date(),
              usuger: contexto.consultor?.codusu ?? null,
              dataPrevistaInicio,
              dataPrevistaFim,
              fasid,
              colunaId: primeiraColuna?.id ?? null,
              estruturaAtividadeId: noEstrutura.id,
            },
          });

          const entidadeRotulo = `Alocação de ${nomeConsultor} — Item ${seqite}`;
          await criarEventoAuditoria(
            {
              origem: "tela",
              usuarioId: user.id,
              codemp,
              codpro,
              entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
              entidadeId: entidadeIdAtividade(atividadeConsultor.id),
              entidadeRotulo,
              eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_CRIADA,
              alteracoes: null,
              metadata: { qtdhor: c.qtdhor, fasid, loteDestino: destino.tipo },
              correlationId: req.correlationId!,
            },
            tx
          );

          criadas.push({ id: atividadeConsultor.id, estruturaAtividadeId: noEstrutura.id, codfor: c.codfor, qtdhor: c.qtdhor });
        }
      });
    } catch (error) {
      if (error instanceof SaldoDivergenteError) {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }

    for (const c of criadas) {
      await enfileirar(c.id, "criar_atividade", {
        codemp,
        codpro,
        seqite,
        codfor: c.codfor,
        qtdhor: c.qtdhor,
        fasid,
        dataPrevistaInicio: dataPrevistaInicio?.toISOString() ?? null,
        dataPrevistaFim: dataPrevistaFim?.toISOString() ?? null,
      });
    }

    res.status(201).json({ pastaId: pastaCriadaId, atividades: criadas });
  } catch (error) {
    handleError(res, error, "alocar-lote");
  }
});

async function carregarAlocacaoComDepexe(id: number) {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id } });
  if (!atividade) return null;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) return null;
  return { atividade, depexe: item.depexe };
}

alocacaoRouter.patch("/alocacoes/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const qtdhor = Number(req.body?.qtdhor);
    if (!Number.isFinite(id) || !Number.isFinite(qtdhor) || qtdhor <= 0) {
      res.status(400).json({ error: "qtdhor (>0) é obrigatório" });
      return;
    }

    const dataPrevistaInicio = req.body?.dataPrevistaInicio ? new Date(req.body.dataPrevistaInicio) : null;
    const dataPrevistaFim = req.body?.dataPrevistaFim ? new Date(req.body.dataPrevistaFim) : null;
    if (dataPrevistaInicio && dataPrevistaFim && dataPrevistaInicio > dataPrevistaFim) {
      res.status(400).json({ error: "Data de início não pode ser depois da data de fim" });
      return;
    }

    const resolvido = await carregarAlocacaoComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Alocação não encontrada" });
      return;
    }
    const { atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "editar", { depexe, codfor: atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para editar esta alocação" });
      return;
    }

    const saldo = await validarSaldo(atividade.codemp, atividade.codpro, atividade.seqite, qtdhor, {
      ignorarAtividadeId: id,
      estruturaAtividadeId: atividade.estruturaAtividadeId ?? undefined,
    });
    if (!saldo.ok) {
      res.status(400).json({ error: saldo.erro });
      return;
    }

    const entidadeId = entidadeIdAtividade(id);
    const entidadeRotulo = `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`;
    const correlationId = req.correlationId!;
    const ctxEvento = {
      origem: "tela" as const,
      usuarioId: ctx.user.id,
      codemp: atividade.codemp,
      codpro: atividade.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
      entidadeId,
      entidadeRotulo,
      correlationId,
    };

    const diffHoras = diffCampos(CAMPOS_AUDITADOS_ALOCACAO, atividade, paraDiff({ qtdhor }));
    const operacoes: Prisma.PrismaPromise<unknown>[] = [
      prisma.atividadeConsultor.update({ where: { id }, data: { qtdhor, dataPrevistaInicio, dataPrevistaFim } }),
    ];
    if (diffHoras.algumaMudanca) {
      operacoes.push(
        criarEventoAuditoria({
          ...ctxEvento,
          eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_ALTERADA,
          alteracoes: diffHoras.alteracoes,
          metadata: null,
        })
      );
    }
    operacoes.push(
      ...criarEventosDeData(
        CAMPOS_AUDITADOS_ATIVIDADE_DATAS,
        { dataPrevistaInicio: atividade.dataPrevistaInicio, dataPrevistaFim: atividade.dataPrevistaFim },
        { dataPrevistaInicio, dataPrevistaFim },
        { ...ctxEvento, entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE }
      )
    );
    await prisma.$transaction(operacoes);

    await enfileirar(id, "editar_atividade", {
      qtdhorNovo: qtdhor,
      dataPrevistaInicio: dataPrevistaInicio?.toISOString() ?? null,
      dataPrevistaFim: dataPrevistaFim?.toISOString() ?? null,
    });

    res.json({ id, qtdhor, dataPrevistaInicio, dataPrevistaFim });
  } catch (error) {
    handleError(res, error, "editar-alocacao");
  }
});

alocacaoRouter.delete("/alocacoes/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }

    const resolvido = await carregarAlocacaoComDepexe(id);
    if (!resolvido) {
      res.status(404).json({ error: "Alocação não encontrada" });
      return;
    }
    const { atividade, depexe } = resolvido;

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    if (!podeExecutarAcao(role, contexto, "excluir", { depexe, codfor: atividade.codfor })) {
      res.status(403).json({ error: "Sem permissão para remover esta alocação" });
      return;
    }

    // Soft-delete (mesma convenção do sitreg do ERP: A=Ativo, I=Inativo) — evita mexer
    // no histórico/comentários/anexos já vinculados e é o mesmo filtro que já esconde
    // a atividade das telas de Kanban/Lista/Calendário/Timeline/Workload.
    await prisma.$transaction([
      prisma.atividadeConsultor.update({ where: { id }, data: { sitreg: "I" } }),
      criarEventoAuditoria({
        origem: "tela",
        usuarioId: ctx.user.id,
        codemp: atividade.codemp,
        codpro: atividade.codpro,
        entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
        entidadeId: entidadeIdAtividade(id),
        entidadeRotulo: `Alocação — Item ${atividade.seqite} da Proposta ${atividade.codemp}/${atividade.codpro}`,
        eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA,
        alteracoes: null,
        metadata: null,
        correlationId: req.correlationId!,
      }),
    ]);
    await enfileirar(id, "remover_atividade", {});

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "remover-alocacao");
  }
});
