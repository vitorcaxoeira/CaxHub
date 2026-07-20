import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel, sitproLabel, sitproTone, sitprzLabel, SITPRO_ALOCAVEL } from "../domain/propostasDominio";
import { resolverContextoConsultor, podeExecutarAcao } from "../domain/contextoProjeto";
import { enfileirar } from "../sync/outboxSenior";

// Área de alocação: o Líder Técnico (Gestor) distribui as horas de um item de proposta
// entre um ou mais consultores do próprio time (AtividadeConsultor = "Distribuição
// Atividades por Consultor" no Senior — já suporta N linhas por item, uma por consultor).
// Só admin e Líder Técnico têm acesso; Consultor/Comercial não enxergam essa tela.
export const alocacaoRouter = Router();
alocacaoRouter.use(requireAuth);

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

    const depexeFiltro = req.query.depexe ? Number(req.query.depexe) : null;
    const depexesConsultados =
      depexeFiltro != null && permitidos.includes(depexeFiltro) ? [depexeFiltro] : permitidos;

    const busca = typeof req.query.busca === "string" ? req.query.busca.trim().toLowerCase() : "";
    const apenasComSaldo = req.query.apenasComSaldo === "true";
    const compartilhadas = req.query.compartilhadas === "true";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const itens = await prisma.propostaItem.findMany({
      where: { depexe: { in: depexesConsultados } },
    });
    if (itens.length === 0) {
      res.json({ rows: [], total: 0 });
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

    let linhas = [...porProposta.values()]
      .filter((a) => !compartilhadas || a.propostaDepexe == null || !meusDepartamentos.includes(a.propostaDepexe))
      .map((a) => ({
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

    res.json({ rows: pagina, total });
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
          sitprz: item.sitprz,
          sitprzLabel: sitprzLabel(item.sitprz),
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
  ignorarAtividadeId?: number
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const item = await prisma.propostaItem.findUnique({ where: { codemp_codpro_seqite: { codemp, codpro, seqite } } });
  if (!item) return { ok: false, erro: "Item de proposta não encontrado" };
  if (item.qtdhor == null) return { ok: false, erro: "Item sem horas definidas na proposta" };

  const existentes = await prisma.atividadeConsultor.findMany({
    where: { codemp, codpro, seqite, sitreg: "A" },
  });
  const somaAtual = existentes
    .filter((a) => a.id !== ignorarAtividadeId)
    .reduce((soma, a) => soma + (a.qtdhor ?? 0), 0);

  if (somaAtual + qtdhorNovo > item.qtdhor) {
    return {
      ok: false,
      erro: `Horas excedem o saldo do item (disponível: ${formatHorasSimples(item.qtdhor - somaAtual)}, tentando alocar: ${formatHorasSimples(qtdhorNovo)})`,
    };
  }
  return { ok: true };
}

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

    const saldo = await validarSaldo(codemp, codpro, seqite, qtdhor);
    if (!saldo.ok) {
      res.status(400).json({ error: saldo.erro });
      return;
    }

    const primeiraColuna = await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });

    const nova = await prisma.atividadeConsultor.create({
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
      },
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

    const saldo = await validarSaldo(atividade.codemp, atividade.codpro, atividade.seqite, qtdhor, id);
    if (!saldo.ok) {
      res.status(400).json({ error: saldo.erro });
      return;
    }

    await prisma.atividadeConsultor.update({ where: { id }, data: { qtdhor, dataPrevistaInicio, dataPrevistaFim } });
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
    await prisma.atividadeConsultor.update({ where: { id }, data: { sitreg: "I" } });
    await enfileirar(id, "remover_atividade", {});

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "remover-alocacao");
  }
});
