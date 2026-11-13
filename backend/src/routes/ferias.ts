import { Router, type Response } from "express";
import { Prisma, type Consultor } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { ContextoDoUsuario, contextoDoUsuario, podeLancarFerias, resolverAlvo } from "../domain/acessoCalendario";
import { chaveDia, lerDia } from "../domain/calendarioTrabalho";
import { consultoresFiltraveis, nomeConsultor } from "../domain/contextoProjeto";
import { aquisitivosDoConsultor, aquisitivosDosConsultores, simularFerias, type AquisitivoDto } from "../domain/feriasDados";
import { diasCorridosEntre, diasUteisDoPeriodo, proximoDiaUtil } from "../domain/feriasCalculo";
import { depexeLabel } from "../domain/propostasDominio";

// Controle de férias dos consultores PJ (13/11/2026), no lugar da planilha "Simulação Férias PJs". O PERÍODO AQUISITIVO é o direito (ex.: 05/2025 à 05/2026,
// 20 dias) e o GOZO é o período de férias tirado dele. Só gestor do departamento e admin lançam; o consultor visualiza as próprias. Os dias de gozo aparecem no
// calendário do consultor como "Férias" e saem da meta (domain/calendarioTrabalho.ts). O valor das férias (dias úteis x horas/dia x média do % trabalhado x
// valor-hora) é SIMULADO e gravado no gozo; ele não entra sozinho na nota nem no fechamento de descontos.
export const feriasRouter = Router();
feriasRouter.use(requireAuth);

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ferias:${label}]`, message);
  res.status(500).json({ error: message });
}

const ctxDe = (req: AuthenticatedRequest) => contextoDoUsuario(req.user!.userId, req.user!.role as string);
const num = (v: { toString(): string } | null): number | null => (v == null ? null : Number(v));
const numeroOuNulo = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** "YYYY-MM" ou "YYYY-MM-DD" -> primeiro dia do mês (UTC); vazio -> null; inválido -> undefined. */
function lerCompetencia(v: unknown): Date | null | undefined {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const d = lerDia(/^\d{4}-\d{2}$/.test(v) ? `${v}-01` : v);
  return d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) : undefined;
}

async function consultorDe(codemp: number, codfor: number): Promise<Consultor | null> {
  return prisma.consultor.findFirst({ where: { codemp, codfor } });
}

// GET /ferias/resumo — o time (de quem o usuário é gestor, ou todos para admin) com o saldo e as férias de cada um.
feriasRouter.get("/resumo", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (ctx.role !== "admin" && ctx.contexto.departamentosGerenciados.length === 0) {
      res.status(403).json({ error: "Somente gestores e administradores veem as férias da equipe" });
      return;
    }
    const filtraveis = await consultoresFiltraveis(ctx.role, ctx.contexto);
    const consultores = await prisma.consultor.findMany({ where: { codfor: { in: filtraveis.map((c) => c.codfor) } } });
    const porCodfor = new Map<number, Consultor>();
    for (const c of consultores) if (c.codfor != null && !porCodfor.has(c.codfor)) porCodfor.set(c.codfor, c);

    const codemps = [...new Set([...porCodfor.values()].map((c) => c.codemp))];
    const aquisitivos = new Map<number, AquisitivoDto[]>();
    for (const codemp of codemps) {
      const doEmp = [...porCodfor.values()].filter((c) => c.codemp === codemp).map((c) => c.codfor as number);
      for (const [codfor, lista] of await aquisitivosDosConsultores(codemp, doEmp)) aquisitivos.set(codfor, lista);
    }

    const hoje = chaveDia(new Date());
    const linhas = [...porCodfor.values()]
      .map((c) => {
        const lista = aquisitivos.get(c.codfor as number) ?? [];
        const gozos = lista.flatMap((a) => a.gozos).filter((g) => g.situacao !== "cancelada");
        const atual = lista.find((a) => a.inicio <= hoje && hoje <= a.fim) ?? lista[0] ?? null;
        return {
          codemp: c.codemp,
          codfor: c.codfor as number,
          nome: nomeConsultor(c),
          departamento: c.depexe != null ? depexeLabel(c.depexe) : null,
          aquisitivoAtual: atual ? { id: atual.id, inicio: atual.inicio, fim: atual.fim, diasDireito: atual.diasDireito, saldo: atual.saldo, remunerado: atual.remunerado } : null,
          saldoTotal: lista.reduce((soma, a) => soma + Math.max(0, a.saldo), 0),
          emFerias: gozos.find((g) => g.inicio <= hoje && hoje <= g.fim) ?? null,
          proximasFerias: gozos.filter((g) => g.inicio > hoje).sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null,
          qtdAquisitivos: lista.length,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    res.json({ consultores: linhas });
  } catch (error) {
    handleError(res, error, "resumo");
  }
});

// GET /ferias/consultor/:codfor — períodos aquisitivos, gozos e saldo de um consultor (o próprio, ou do time).
feriasRouter.get("/consultor/:codfor", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const resolvido = await resolverAlvo(ctx, Number(req.params.codfor));
    if ("negado" in resolvido) {
      res.status(403).json({ error: "Sem permissão para ver as férias deste consultor" });
      return;
    }
    const alvo = resolvido.alvo;
    if (!alvo || alvo.codfor == null) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    const [aquisitivos, folgas] = await Promise.all([
      aquisitivosDoConsultor(alvo.codemp, alvo.codfor),
      prisma.calendarioAusencia.findMany({
        where: { codemp: alvo.codemp, codfor: alvo.codfor, descontaFerias: true, diaInteiro: true, excluidaEm: null },
        orderBy: { data: "asc" },
        select: { id: true, data: true, motivo: true, aquisitivoId: true },
      }),
    ]);
    res.json({
      consultor: { codemp: alvo.codemp, codfor: alvo.codfor, nome: nomeConsultor(alvo) },
      aquisitivos,
      folgasDescontadas: folgas.map((f) => ({ id: f.id, data: chaveDia(f.data), motivo: f.motivo, aquisitivoId: f.aquisitivoId })),
      podeLancar: podeLancarFerias(ctx, alvo),
    });
  } catch (error) {
    handleError(res, error, "consultor");
  }
});

/** O consultor-alvo de uma escrita, já com a permissão de lançar férias conferida; ou a resposta de erro. */
async function alvoParaLancar(ctx: ContextoDoUsuario, codemp: number, codfor: number, res: Response): Promise<Consultor | null> {
  const alvo = await consultorDe(codemp, codfor);
  if (!alvo) {
    res.status(404).json({ error: "Consultor não encontrado" });
    return null;
  }
  if (!podeLancarFerias(ctx, alvo)) {
    res.status(403).json({ error: "Somente o gestor do departamento ou o administrador lança férias" });
    return null;
  }
  return alvo;
}

// POST /ferias/simular — { codfor, inicio, fim, horasDia?, mediaPct?, valorHora? } devolve a conta do valor sem gravar nada.
feriasRouter.post("/simular", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const inicio = lerDia(b.inicio);
    const fim = lerDia(b.fim);
    const resolvido = await resolverAlvo(ctx, numeroOuNulo(b.codfor));
    if (!inicio || !fim || fim < inicio) {
      res.status(400).json({ error: "Informe o início e o fim das férias (o fim não pode ser antes do início)." });
      return;
    }
    if ("negado" in resolvido || !resolvido.alvo || resolvido.alvo.codfor == null) {
      res.status(403).json({ error: "Sem permissão para simular férias deste consultor" });
      return;
    }
    const alvo = resolvido.alvo;
    // Período sem férias remuneradas: a tela só quer a conta dos dias (consistência das datas), sem tocar nas horas nem no valor.
    if (b.somenteDias === true) {
      res.json({ inicio: chaveDia(inicio), fim: chaveDia(fim), diasCorridos: diasCorridosEntre(inicio, fim), diasUteis: diasUteisDoPeriodo(inicio, fim) });
      return;
    }
    res.json(
      await simularFerias({ codemp: alvo.codemp, codfor: alvo.codfor as number, inicio, fim, horasDia: numeroOuNulo(b.horasDia), mediaPct: numeroOuNulo(b.mediaPct), valorHora: numeroOuNulo(b.valorHora) }),
    );
  } catch (error) {
    handleError(res, error, "simular");
  }
});

// ---------- Período aquisitivo (o direito) ----------

function lerAquisitivo(b: Record<string, unknown>): { ok: true; inicio: Date; fim: Date; diasDireito: number; remunerado: boolean; observacao: string | null } | { ok: false; erro: string } {
  const inicio = lerDia(b.inicio);
  const fim = lerDia(b.fim);
  const dias = Number(b.diasDireito);
  if (!inicio || !fim || fim <= inicio) return { ok: false, erro: "Informe o período aquisitivo (o fim precisa ser depois do início)." };
  if (!Number.isInteger(dias) || dias < 1 || dias > 60) return { ok: false, erro: "Informe os dias de direito (de 1 a 60, corridos)." };
  const observacao = typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null;
  if (observacao && observacao.length > 300) return { ok: false, erro: "A observação pode ter até 300 caracteres." };
  // Ausente vale sim (cliente antigo e períodos já cadastrados seguem remunerados).
  return { ok: true, inicio, fim, diasDireito: dias, remunerado: b.remunerado !== false, observacao };
}

// POST /ferias/aquisitivos — { codemp, codfor, inicio, fim, diasDireito, remunerado, observacao }
feriasRouter.post("/aquisitivos", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const alvo = await alvoParaLancar(ctx, Number(b.codemp), Number(b.codfor), res);
    if (!alvo) return;
    const lido = lerAquisitivo(b);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const criado = await prisma.feriasPeriodoAquisitivo.create({
      data: { codemp: alvo.codemp, codfor: alvo.codfor as number, inicio: lido.inicio, fim: lido.fim, diasDireito: lido.diasDireito, remunerado: lido.remunerado, observacao: lido.observacao, criadoPor: ctx.userId },
    });
    res.status(201).json({ id: criado.id });
  } catch (error) {
    handleError(res, error, "post-aquisitivo");
  }
});

async function aquisitivoParaEditar(req: AuthenticatedRequest, res: Response) {
  const ctx = await ctxDe(req);
  if (!ctx) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return null;
  }
  const id = Number(req.params.id);
  const aquisitivo = Number.isInteger(id) ? await prisma.feriasPeriodoAquisitivo.findUnique({ where: { id }, include: { gozos: true } }) : null;
  if (!aquisitivo) {
    res.status(404).json({ error: "Período aquisitivo não encontrado" });
    return null;
  }
  const alvo = await alvoParaLancar(ctx, aquisitivo.codemp, aquisitivo.codfor, res);
  return alvo ? { ctx, aquisitivo, alvo } : null;
}

feriasRouter.put("/aquisitivos/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const achado = await aquisitivoParaEditar(req, res);
    if (!achado) return;
    const lido = lerAquisitivo((req.body ?? {}) as Record<string, unknown>);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const usados = achado.aquisitivo.gozos.filter((g) => g.situacao !== "cancelada").reduce((s, g) => s + g.diasCorridos, 0);
    if (lido.diasDireito < usados) {
      res.status(409).json({ error: `Já há ${usados} dia(s) de férias lançados neste período: o direito não pode ser menor que isso.` });
      return;
    }
    // Remunerado -> não remunerado: os gozos já lançados perdem o valor (não há nada a pagar). Não remunerado -> remunerado: o gestor usa "Editar" no gozo, que recalcula.
    const perdeuRemuneracao = achado.aquisitivo.remunerado && !lido.remunerado;
    const gozosSemValor = perdeuRemuneracao ? achado.aquisitivo.gozos.filter((g) => g.valorFerias != null || g.horasFerias != null).length : 0;
    await prisma.$transaction([
      prisma.feriasPeriodoAquisitivo.update({
        where: { id: achado.aquisitivo.id },
        data: { inicio: lido.inicio, fim: lido.fim, diasDireito: lido.diasDireito, remunerado: lido.remunerado, observacao: lido.observacao, atualizadoEm: new Date() },
      }),
      ...(perdeuRemuneracao ? [prisma.feriasGozo.updateMany({ where: { aquisitivoId: achado.aquisitivo.id }, data: DADOS_SEM_VALOR })] : []),
    ]);
    res.json({ ok: true, gozosSemValor, precisaRecalcular: !achado.aquisitivo.remunerado && lido.remunerado && achado.aquisitivo.gozos.some((g) => g.situacao !== "cancelada") });
  } catch (error) {
    handleError(res, error, "put-aquisitivo");
  }
});

feriasRouter.delete("/aquisitivos/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const achado = await aquisitivoParaEditar(req, res);
    if (!achado) return;
    if (achado.aquisitivo.gozos.length > 0) {
      res.status(409).json({ error: "Este período já tem férias lançadas: cancele os gozos antes de excluí-lo." });
      return;
    }
    await prisma.feriasPeriodoAquisitivo.delete({ where: { id: achado.aquisitivo.id } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "delete-aquisitivo");
  }
});

// ---------- Gozo (as férias tiradas) ----------

/** O retrato do valor de um gozo sem férias remuneradas: nada calculado (os dias úteis ficam para o aviso). */
const DADOS_SEM_VALOR = { horasDia: null, mediaPct: null, valorHora: null, horasFerias: null, valorFerias: null, mesesMedia: Prisma.DbNull, calculadoEm: null };

interface GozoLido {
  inicio: Date;
  fim: Date;
  observacao: string | null;
  competenciaPagamento: Date | null;
}

function lerGozo(b: Record<string, unknown>): { ok: true; valor: GozoLido } | { ok: false; erro: string } {
  const inicio = lerDia(b.inicio);
  const fim = lerDia(b.fim);
  if (!inicio || !fim || fim < inicio) return { ok: false, erro: "Informe o início e o fim das férias (o fim não pode ser antes do início)." };
  const competenciaPagamento = lerCompetencia(b.competenciaPagamento);
  if (competenciaPagamento === undefined) return { ok: false, erro: "Informe o mês de pagamento como AAAA-MM." };
  const observacao = typeof b.observacao === "string" && b.observacao.trim() ? b.observacao.trim() : null;
  if (observacao && observacao.length > 300) return { ok: false, erro: "A observação pode ter até 300 caracteres." };
  return { ok: true, valor: { inicio, fim, observacao, competenciaPagamento } };
}

/** O gozo cruza outro gozo (não cancelado) do mesmo consultor? Devolve o primeiro que cruza. */
async function gozoQueCruza(codemp: number, codfor: number, inicio: Date, fim: Date, ignorarId?: number) {
  return prisma.feriasGozo.findFirst({
    where: { situacao: { not: "cancelada" }, inicio: { lte: fim }, fim: { gte: inicio }, aquisitivo: { codemp, codfor }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
  });
}

const dataBr = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

// POST /ferias/gozos — { aquisitivoId, inicio, fim, observacao?, competenciaPagamento?, horasDia?, mediaPct?, valorHora?, permitirExcedente? }
feriasRouter.post("/gozos", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const aquisitivoId = Number(b.aquisitivoId);
    const aquisitivo = Number.isInteger(aquisitivoId) ? await prisma.feriasPeriodoAquisitivo.findUnique({ where: { id: aquisitivoId } }) : null;
    if (!aquisitivo) {
      res.status(404).json({ error: "Período aquisitivo não encontrado" });
      return;
    }
    const alvo = await alvoParaLancar(ctx, aquisitivo.codemp, aquisitivo.codfor, res);
    if (!alvo) return;
    const lido = lerGozo(b);
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const g = lido.valor;
    const cruza = await gozoQueCruza(aquisitivo.codemp, aquisitivo.codfor, g.inicio, g.fim);
    if (cruza) {
      res.status(409).json({ error: `Já existem férias neste intervalo (${dataBr(cruza.inicio)} a ${dataBr(cruza.fim)}).` });
      return;
    }
    const diasCorridos = diasCorridosEntre(g.inicio, g.fim);
    const atual = (await aquisitivosDoConsultor(aquisitivo.codemp, aquisitivo.codfor)).find((a) => a.id === aquisitivo.id);
    if (atual && diasCorridos > atual.saldo && b.permitirExcedente !== true) {
      res.status(409).json({ error: `As férias têm ${diasCorridos} dia(s) e o saldo do período é ${atual.saldo}.`, excedeSaldo: true, saldo: atual.saldo, diasCorridos });
      return;
    }
    // Período sem férias remuneradas: só marca os dias (e consome o saldo); não simula nem grava valor nem mês de pagamento.
    const sim = aquisitivo.remunerado
      ? await simularFerias({
          codemp: aquisitivo.codemp,
          codfor: aquisitivo.codfor,
          inicio: g.inicio,
          fim: g.fim,
          horasDia: numeroOuNulo(b.horasDia),
          mediaPct: numeroOuNulo(b.mediaPct),
          valorHora: numeroOuNulo(b.valorHora),
        })
      : null;
    const criado = await prisma.feriasGozo.create({
      data: {
        aquisitivoId: aquisitivo.id,
        inicio: g.inicio,
        fim: g.fim,
        diasCorridos,
        observacao: g.observacao,
        competenciaPagamento: sim ? g.competenciaPagamento : null,
        diasUteis: sim ? sim.diasUteis : diasUteisDoPeriodo(g.inicio, g.fim),
        ...(sim
          ? { horasDia: sim.horasDia, mediaPct: sim.mediaPct, valorHora: sim.valorHora, horasFerias: sim.horasFerias, valorFerias: sim.valorFerias, mesesMedia: sim.meses, calculadoEm: new Date() }
          : DADOS_SEM_VALOR),
        criadoPor: ctx.userId,
      },
    });
    res.status(201).json({ id: criado.id, simulacao: sim });
  } catch (error) {
    handleError(res, error, "post-gozo");
  }
});

// PUT /ferias/gozos/:id — mesmos campos do POST mais { situacao: "programada" | "cancelada", recalcular?: boolean }.
// Sem `recalcular` o retrato do valor gravado fica como está (o gestor pode ter ajustado à mão); com ele refaz a simulação.
feriasRouter.put("/gozos/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const id = Number(req.params.id);
    const gozo = Number.isInteger(id) ? await prisma.feriasGozo.findUnique({ where: { id }, include: { aquisitivo: true } }) : null;
    if (!gozo) {
      res.status(404).json({ error: "Férias não encontradas" });
      return;
    }
    const alvo = await alvoParaLancar(ctx, gozo.aquisitivo.codemp, gozo.aquisitivo.codfor, res);
    if (!alvo) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const situacao = b.situacao === "cancelada" ? "cancelada" : "programada";
    const lido = lerGozo({ inicio: b.inicio ?? chaveDia(gozo.inicio), fim: b.fim ?? chaveDia(gozo.fim), observacao: b.observacao ?? gozo.observacao, competenciaPagamento: b.competenciaPagamento === undefined ? (gozo.competenciaPagamento ? chaveDia(gozo.competenciaPagamento) : null) : b.competenciaPagamento });
    if (!lido.ok) {
      res.status(400).json({ error: lido.erro });
      return;
    }
    const g = lido.valor;
    const diasCorridos = diasCorridosEntre(g.inicio, g.fim);
    if (situacao === "programada") {
      const cruza = await gozoQueCruza(gozo.aquisitivo.codemp, gozo.aquisitivo.codfor, g.inicio, g.fim, gozo.id);
      if (cruza) {
        res.status(409).json({ error: `Já existem férias neste intervalo (${dataBr(cruza.inicio)} a ${dataBr(cruza.fim)}).` });
        return;
      }
      const atual = (await aquisitivosDoConsultor(gozo.aquisitivo.codemp, gozo.aquisitivo.codfor)).find((a) => a.id === gozo.aquisitivoId);
      // O saldo já desconta ESTE gozo se ele estava programado: o que sobra para ele é saldo + os dias que ele já ocupava.
      const disponivel = (atual?.saldo ?? 0) + (gozo.situacao !== "cancelada" ? gozo.diasCorridos : 0);
      if (diasCorridos > disponivel && b.permitirExcedente !== true) {
        res.status(409).json({ error: `As férias têm ${diasCorridos} dia(s) e o saldo disponível é ${disponivel}.`, excedeSaldo: true, saldo: disponivel, diasCorridos });
        return;
      }
    }
    const dados: Record<string, unknown> = { inicio: g.inicio, fim: g.fim, diasCorridos, situacao, observacao: g.observacao, competenciaPagamento: g.competenciaPagamento, atualizadoEm: new Date() };
    let simulacao = null;
    if (!gozo.aquisitivo.remunerado) {
      // Sem férias remuneradas: nunca há valor nem mês de pagamento; só os dias úteis seguem atualizados com as datas.
      Object.assign(dados, DADOS_SEM_VALOR, { competenciaPagamento: null, diasUteis: diasUteisDoPeriodo(g.inicio, g.fim) });
    } else if (b.recalcular === true) {
      simulacao = await simularFerias({
        codemp: gozo.aquisitivo.codemp,
        codfor: gozo.aquisitivo.codfor,
        inicio: g.inicio,
        fim: g.fim,
        horasDia: numeroOuNulo(b.horasDia),
        mediaPct: numeroOuNulo(b.mediaPct),
        valorHora: numeroOuNulo(b.valorHora),
      });
      Object.assign(dados, { diasUteis: simulacao.diasUteis, horasDia: simulacao.horasDia, mediaPct: simulacao.mediaPct, valorHora: simulacao.valorHora, horasFerias: simulacao.horasFerias, valorFerias: simulacao.valorFerias, mesesMedia: simulacao.meses, calculadoEm: new Date() });
    }
    await prisma.feriasGozo.update({ where: { id: gozo.id }, data: dados });
    res.json({ ok: true, simulacao });
  } catch (error) {
    handleError(res, error, "put-gozo");
  }
});

// GET /ferias/gozos/:id/aviso — os dados do AVISO DE FÉRIAS (documento imprimível com o demonstrativo do cálculo): empresa, consultor, período aquisitivo, as datas
// do gozo, o retorno ao trabalho, a conta do valor (dias úteis x horas/dia x média x valor-hora) com os meses da média, o pagamento e o saldo que sobra. Vale para o
// gestor/admin e para o próprio consultor. Os números são os GRAVADOS no gozo (o retrato do cálculo); os gozos antigos, sem a tabela de meses, têm a tabela refeita.
feriasRouter.get("/gozos/:id/aviso", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await ctxDe(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const id = Number(req.params.id);
    const gozo = Number.isInteger(id) ? await prisma.feriasGozo.findUnique({ where: { id }, include: { aquisitivo: true } }) : null;
    if (!gozo) {
      res.status(404).json({ error: "Férias não encontradas" });
      return;
    }
    const { codemp, codfor } = gozo.aquisitivo;
    const resolvido = await resolverAlvo(ctx, codfor);
    if ("negado" in resolvido || !resolvido.alvo) {
      res.status(403).json({ error: "Sem permissão para ver este aviso de férias" });
      return;
    }
    const alvo = resolvido.alvo;
    const [empresa, aquisitivos, usuario] = await Promise.all([
      prisma.empresa.findUnique({ where: { codemp } }),
      aquisitivosDoConsultor(codemp, codfor),
      prisma.user.findUnique({ where: { id: ctx.userId }, select: { nome: true } }),
    ]);
    const aquisitivo = aquisitivos.find((a) => a.id === gozo.aquisitivoId);
    let meses = Array.isArray(gozo.mesesMedia) ? (gozo.mesesMedia as unknown as { ano: number; mes: number; minutos: number; pct: number }[]) : null;
    let reconstituido = false;
    // Sem férias remuneradas não há demonstrativo de valor nem tabela de meses.
    if (!gozo.aquisitivo.remunerado) meses = [];
    if (!meses) {
      // Gozo anterior à gravação da tabela de meses: refaz a lista (a média usada continua a gravada, a tabela é só informativa).
      meses = (await simularFerias({ codemp, codfor, inicio: gozo.inicio, fim: gozo.fim, horasDia: num(gozo.horasDia), mediaPct: num(gozo.mediaPct), valorHora: num(gozo.valorHora) })).meses;
      reconstituido = true;
    }
    res.json({
      emitidoEm: chaveDia(new Date()),
      emitidoPor: usuario?.nome ?? null,
      empresa: empresa ? { codemp, nome: empresa.nomemp } : { codemp, nome: null },
      consultor: { codemp, codfor, nome: nomeConsultor(alvo), departamento: alvo.depexe != null ? depexeLabel(alvo.depexe) : null },
      aquisitivo: aquisitivo ? { inicio: aquisitivo.inicio, fim: aquisitivo.fim, diasDireito: aquisitivo.diasDireito, saldoDepois: aquisitivo.saldo, remunerado: aquisitivo.remunerado } : null,
      remunerado: gozo.aquisitivo.remunerado,
      gozo: {
        id: gozo.id,
        situacao: gozo.situacao,
        inicio: chaveDia(gozo.inicio),
        fim: chaveDia(gozo.fim),
        diasCorridos: gozo.diasCorridos,
        retorno: chaveDia(proximoDiaUtil(gozo.fim)),
        observacao: gozo.observacao,
        competenciaPagamento: gozo.competenciaPagamento ? chaveDia(gozo.competenciaPagamento) : null,
      },
      calculo: {
        diasUteis: gozo.diasUteis ?? diasUteisDoPeriodo(gozo.inicio, gozo.fim),
        horasDia: num(gozo.horasDia),
        mediaPct: num(gozo.mediaPct),
        valorHora: num(gozo.valorHora),
        horasFerias: num(gozo.horasFerias),
        valorFerias: num(gozo.valorFerias),
        calculadoEm: gozo.calculadoEm ? gozo.calculadoEm.toISOString() : null,
        meses,
        mesesReconstituidos: reconstituido,
      },
    });
  } catch (error) {
    handleError(res, error, "aviso");
  }
});
