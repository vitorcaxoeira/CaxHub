import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { aquisitivoDaData, aquisitivosDoConsultor } from "../domain/feriasDados";
import { ContextoDoUsuario, contextoDoUsuario, ehOProprio, podeLancarFerias, podeMexerNoCalendario, resolverAlvo } from "../domain/acessoCalendario";
import { chaveDia, lerAusencia, metaDoDia } from "../domain/calendarioTrabalho";
import { carregarAbonos, contextoDoDia, horasRealizadasNoPeriodo } from "../domain/resumoConsultor";
import { nomeConsultor } from "../domain/contextoProjeto";
import { notificarGestoresDoDepartamento } from "../domain/notificacoes";
import type { Consultor } from "@prisma/client";

// Calendário de trabalho do consultor (13/11/2026): cada dia mostra a meta, as horas apontadas, as férias (gozos lançados pelo gestor) e as folgas que o consultor
// lança sozinho (dia inteiro ou parte do dia, sem aprovação; o gestor é avisado). Férias e folgas saem da meta do "Progresso da meta" (domain/calendarioTrabalho.ts).
export const calendarioRouter = Router();
calendarioRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[calendario:${label}]`, message);
  res.status(500).json({ error: message });
}

const dataBr = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

async function contextoDaRequisicao(req: AuthenticatedRequest): Promise<ContextoDoUsuario | null> {
  return contextoDoUsuario(req.user!.userId, req.user!.role as string);
}

// GET /calendario?codfor=&ano=&mes= — os dias do mês do consultor (o próprio, ou alguém do time de quem é gestor/admin).
calendarioRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDaRequisicao(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const codforPedido = typeof req.query.codfor === "string" ? Number(req.query.codfor) : null;
    const resolvido = await resolverAlvo(ctx, codforPedido);
    if ("negado" in resolvido) {
      res.status(403).json({ error: "Sem permissão para ver o calendário deste consultor" });
      return;
    }
    const alvo = resolvido.alvo;
    if (!alvo || alvo.codfor == null) {
      res.json({ semConsultor: true });
      return;
    }
    const hoje = new Date();
    const ano = Number(req.query.ano) || hoje.getUTCFullYear();
    const mes = Number(req.query.mes) || hoje.getUTCMonth() + 1;
    if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12 || ano < 2000 || ano > 2100) {
      res.status(400).json({ error: "Período inválido" });
      return;
    }
    const { codemp, codfor } = alvo;
    const de = new Date(Date.UTC(ano, mes - 1, 1));
    const ate = new Date(Date.UTC(ano, mes, 0));

    const [abonos, jornadas, ausencias, gozos, { porDia }, aquisitivos] = await Promise.all([
      carregarAbonos(codemp, codfor, de, ate),
      prisma.jornadaConsultor.findMany({ where: { codemp, codfor } }),
      prisma.calendarioAusencia.findMany({ where: { codemp, codfor, data: { gte: de, lte: ate }, excluidaEm: null }, orderBy: [{ data: "asc" }, { inicioMin: "asc" }] }),
      prisma.feriasGozo.findMany({ where: { situacao: { not: "cancelada" }, inicio: { lte: ate }, fim: { gte: de }, aquisitivo: { codemp, codfor } }, select: { id: true, inicio: true, fim: true } }),
      horasRealizadasNoPeriodo(codemp, codfor, de, ate),
      aquisitivosDoConsultor(codemp, codfor),
    ]);
    const porDiaSemana = new Map(jornadas.map((j) => [j.diaSemana, j]));
    const ausenciasPorDia = new Map<string, typeof ausencias>();
    for (const a of ausencias) ausenciasPorDia.set(chaveDia(a.data), [...(ausenciasPorDia.get(chaveDia(a.data)) ?? []), a]);

    const dias: object[] = [];
    let metaMinutos = 0;
    let abonadoFerias = 0;
    let abonadoFolga = 0;
    let apontadoMinutos = 0;
    for (let d = new Date(de); d.getTime() <= ate.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const dia = chaveDia(d);
      const dow = d.getUTCDay();
      const meta = metaDoDia(porDiaSemana.get(dow), contextoDoDia(abonos, dia));
      const gozo = gozos.find((g) => chaveDia(g.inicio) <= dia && dia <= chaveDia(g.fim));
      const apontado = porDia.get(dia) ?? 0;
      metaMinutos += meta.metaMinutos;
      abonadoFerias += meta.abonadoFeriasMinutos;
      abonadoFolga += meta.abonadoFolgaMinutos;
      apontadoMinutos += apontado;
      dias.push({
        data: dia,
        diaSemana: dow,
        baseMinutos: meta.baseMinutos,
        metaMinutos: meta.metaMinutos,
        apontadoMinutos: apontado,
        ferias: abonos.feriasDias.has(dia),
        gozoId: gozo?.id ?? null,
        ausencias: (ausenciasPorDia.get(dia) ?? []).map((a) => ({
          id: a.id,
          diaInteiro: a.diaInteiro,
          inicioMin: a.inicioMin,
          fimMin: a.fimMin,
          motivo: a.motivo,
          descontaFerias: a.descontaFerias,
        })),
      });
    }

    res.json({
      consultor: { codemp, codfor, nome: nomeConsultor(alvo), depexe: alvo.depexe },
      ano,
      mes,
      dias,
      totais: { metaMinutos, abonadoFeriasMinutos: abonadoFerias, abonadoFolgaMinutos: abonadoFolga, apontadoMinutos },
      saldos: aquisitivos,
      permissoes: {
        // Mexer nas folgas: o próprio consultor, ou o gestor/admin dele. Lançar férias: só gestor/admin (a tela de Férias).
        editarFolgas: podeMexerNoCalendario(ctx, alvo),
        lancarFerias: podeLancarFerias(ctx, alvo),
        proprio: ehOProprio(ctx, alvo),
      },
    });
  } catch (error) {
    handleError(res, error, "get");
  }
});

/** Quem lança/edita: o alvo (consultor) e o contexto do usuário, ou o erro HTTP. */
async function alvoDaFolga(req: AuthenticatedRequest, codemp: number, codfor: number): Promise<{ ctx: ContextoDoUsuario; alvo: Consultor } | { status: number; erro: string }> {
  const ctx = await contextoDaRequisicao(req);
  if (!ctx) return { status: 404, erro: "Usuário não encontrado" };
  const alvo = await prisma.consultor.findFirst({ where: { codemp, codfor } });
  if (!alvo) return { status: 404, erro: "Consultor não encontrado" };
  if (!podeMexerNoCalendario(ctx, alvo)) return { status: 403, erro: "Sem permissão para mexer no calendário deste consultor" };
  return { ctx, alvo };
}

/** Avisa os gestores do departamento (menos quem fez a ação) — o consultor lança sem aprovação, mas o gestor precisa saber. */
async function avisarGestores(alvo: Consultor, autorUserId: number, mensagem: string) {
  if (alvo.depexe == null) return;
  try {
    await notificarGestoresDoDepartamento(alvo.codemp, alvo.depexe, "ausencia_calendario", mensagem.slice(0, 500), undefined, autorUserId);
  } catch (error) {
    // O aviso é cortesia: falhar não pode desfazer a folga já gravada.
    console.error("[calendario:aviso]", error instanceof Error ? error.message : error);
  }
}

function descreverFolga(a: { data: Date; diaInteiro: boolean; inicioMin: number | null; fimMin: number | null; motivo: string | null }): string {
  const quando = a.diaInteiro ? "dia inteiro" : `${hhmm(a.inicioMin as number)} às ${hhmm(a.fimMin as number)}`;
  return `${dataBr(a.data)} (${quando})${a.motivo ? ` — ${a.motivo}` : ""}`;
}

// POST /calendario/ausencias — { codfor?, data, diaInteiro, inicioMin, fimMin, motivo, descontaFerias }
calendarioRouter.post("/ausencias", async (req: AuthenticatedRequest, res) => {
  try {
    const lida = lerAusencia(req.body);
    if (!lida.ok) {
      res.status(400).json({ error: lida.erro });
      return;
    }
    const a = lida.valor;
    const ctxBase = await contextoDaRequisicao(req);
    if (!ctxBase) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const codforPedido = (req.body as Record<string, unknown>).codfor;
    const alvoResolvido = await resolverAlvo(ctxBase, codforPedido == null ? null : Number(codforPedido));
    if ("negado" in alvoResolvido) {
      res.status(403).json({ error: "Sem permissão para mexer no calendário deste consultor" });
      return;
    }
    if (!alvoResolvido.alvo || alvoResolvido.alvo.codfor == null) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    const alvo = alvoResolvido.alvo;
    const codfor = alvo.codfor as number;
    if (!podeMexerNoCalendario(ctxBase, alvo)) {
      res.status(403).json({ error: "Sem permissão para mexer no calendário deste consultor" });
      return;
    }

    const dia = chaveDia(a.data);
    const abonos = await carregarAbonos(alvo.codemp, codfor, a.data, a.data);
    if (abonos.feriasDias.has(dia)) {
      res.status(409).json({ error: "Este dia já está em férias." });
      return;
    }
    const doDia = abonos.ausenciasPorDia.get(dia) ?? [];
    if (doDia.some((x) => x.diaInteiro) || (a.diaInteiro && doDia.length > 0)) {
      res.status(409).json({ error: a.diaInteiro ? "Já existe folga neste dia: remova-a antes de lançar o dia inteiro." : "Este dia já está marcado como folga de dia inteiro." });
      return;
    }

    let aquisitivoId: number | null = null;
    if (a.descontaFerias) {
      const aquisitivo = aquisitivoDaData(await aquisitivosDoConsultor(alvo.codemp, codfor), dia);
      if (!aquisitivo) {
        res.status(409).json({ error: "Não há período aquisitivo de férias cadastrado para esta data: peça ao gestor, ou lance a folga sem descontar do saldo." });
        return;
      }
      if (aquisitivo.saldo < 1) {
        res.status(409).json({ error: "O saldo de férias deste período não cobre mais um dia." });
        return;
      }
      aquisitivoId = aquisitivo.id;
    }

    const criada = await prisma.calendarioAusencia.create({
      data: {
        codemp: alvo.codemp,
        codfor,
        data: a.data,
        diaInteiro: a.diaInteiro,
        inicioMin: a.inicioMin,
        fimMin: a.fimMin,
        motivo: a.motivo,
        descontaFerias: a.descontaFerias,
        aquisitivoId,
        criadoPor: ctxBase.userId,
      },
    });
    await avisarGestores(alvo, ctxBase.userId, `${nomeConsultor(alvo)} lançou folga em ${descreverFolga(criada)}`);
    res.status(201).json({ id: criada.id });
  } catch (error) {
    handleError(res, error, "post-ausencia");
  }
});

async function carregarAusencia(req: AuthenticatedRequest, res: import("express").Response) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Folga inválida" });
    return null;
  }
  const ausencia = await prisma.calendarioAusencia.findUnique({ where: { id } });
  if (!ausencia || ausencia.excluidaEm) {
    res.status(404).json({ error: "Folga não encontrada" });
    return null;
  }
  const pode = await alvoDaFolga(req, ausencia.codemp, ausencia.codfor);
  if ("erro" in pode) {
    res.status(pode.status).json({ error: pode.erro });
    return null;
  }
  return { ausencia, ...pode };
}

// DELETE /calendario/ausencias/:id — tira a folga (exclusão lógica); se descontava do saldo, o dia volta para o saldo.
calendarioRouter.delete("/ausencias/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const achada = await carregarAusencia(req, res);
    if (!achada) return;
    await prisma.calendarioAusencia.update({ where: { id: achada.ausencia.id }, data: { excluidaEm: new Date() } });
    await avisarGestores(achada.alvo, achada.ctx.userId, `${nomeConsultor(achada.alvo)} removeu a folga de ${descreverFolga(achada.ausencia)}`);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "delete-ausencia");
  }
});

// PUT /calendario/ausencias/:id — { diaInteiro, inicioMin, fimMin, motivo, descontaFerias } (a data não muda: para mudar o dia, remova e lance de novo).
calendarioRouter.put("/ausencias/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const achada = await carregarAusencia(req, res);
    if (!achada) return;
    const lida = lerAusencia({ ...(req.body as Record<string, unknown>), data: chaveDia(achada.ausencia.data) });
    if (!lida.ok) {
      res.status(400).json({ error: lida.erro });
      return;
    }
    const a = lida.valor;
    const dia = chaveDia(a.data);
    const abonos = await carregarAbonos(achada.ausencia.codemp, achada.ausencia.codfor, a.data, a.data);
    const outras = (await prisma.calendarioAusencia.findMany({ where: { codemp: achada.ausencia.codemp, codfor: achada.ausencia.codfor, data: a.data, excluidaEm: null, id: { not: achada.ausencia.id } } }));
    if (abonos.feriasDias.has(dia)) {
      res.status(409).json({ error: "Este dia já está em férias." });
      return;
    }
    if (outras.some((x) => x.diaInteiro) || (a.diaInteiro && outras.length > 0)) {
      res.status(409).json({ error: "Já existe outra folga neste dia." });
      return;
    }
    let aquisitivoId: number | null = null;
    if (a.descontaFerias) {
      const aquisitivos = await aquisitivosDoConsultor(achada.ausencia.codemp, achada.ausencia.codfor);
      const aquisitivo = aquisitivoDaData(aquisitivos, dia);
      if (!aquisitivo) {
        res.status(409).json({ error: "Não há período aquisitivo de férias cadastrado para esta data." });
        return;
      }
      // Se já descontava deste mesmo período, o dia dela já está fora do saldo: só exige saldo quando é desconto novo.
      const jaDescontava = achada.ausencia.descontaFerias && achada.ausencia.diaInteiro && achada.ausencia.aquisitivoId === aquisitivo.id;
      if (!jaDescontava && aquisitivo.saldo < 1) {
        res.status(409).json({ error: "O saldo de férias deste período não cobre mais um dia." });
        return;
      }
      aquisitivoId = aquisitivo.id;
    }
    await prisma.calendarioAusencia.update({
      where: { id: achada.ausencia.id },
      data: { diaInteiro: a.diaInteiro, inicioMin: a.inicioMin, fimMin: a.fimMin, motivo: a.motivo, descontaFerias: a.descontaFerias, aquisitivoId },
    });
    await avisarGestores(achada.alvo, achada.ctx.userId, `${nomeConsultor(achada.alvo)} alterou a folga de ${descreverFolga({ ...achada.ausencia, ...a })}`);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-ausencia");
  }
});

