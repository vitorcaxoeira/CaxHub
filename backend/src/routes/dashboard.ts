import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel } from "../domain/propostasDominio";
import { resolverContextoConsultor } from "../domain/contextoProjeto";
import { diasDoPeriodo, horasRealizadasNoPeriodo, metaDoPeriodo, valorHoraVigente } from "../domain/resumoConsultor";

export const dashboardRouter = Router();

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dashboard:${label}]`, message);
  res.status(500).json({ error: message });
}

dashboardRouter.get("/ping", requireAuth, (req, res) => {
  res.json({ ok: true, message: "Dashboard API online" });
});

// Casa o e-mail do usuário logado com a tabela de consultores (view USU_VBI00Cons do
// Senior) pra personalizar as boas-vindas e, se ele for gestor de algum departamento
// executor (USU_TDepExeCfg), listar os departamentos e o time de cada um (USU_TDepExeTim).
dashboardRouter.get("/meu-perfil", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const contexto = await resolverContextoConsultor(user.email);
    const { consultor } = contexto;

    if (!consultor) {
      res.json({ consultor: null, departamentosGerenciados: [] });
      return;
    }

    const departamentosGerenciados = await Promise.all(
      contexto.departamentosGerenciados
        .slice()
        .sort((a, b) => a - b)
        .map(async (depexe) => {
          const integrantes = await prisma.departamentoTime.findMany({
            where: { codemp: consultor.codemp, depexe, sitreg: "A" },
          });
          const codusuList = integrantes.map((i) => Number(i.codusu));
          const consultoresDoTime = await prisma.consultor.findMany({
            where: { codemp: consultor.codemp, codusu: { in: codusuList } },
          });
          const nomeParaCodusu = new Map(
            consultoresDoTime.map((c) => [c.codusu, c.nomcom ?? c.nomfor ?? `Usuário ${c.codusu}`])
          );

          return {
            depexe,
            depexeLabel: depexeLabel(depexe),
            integrantes: codusuList
              .map((codusu) => ({ codusu, nome: nomeParaCodusu.get(codusu) ?? `Usuário ${codusu}` }))
              .sort((a, b) => a.nome.localeCompare(b.nome)),
          };
        })
    );

    res.json({
      consultor: {
        nome: consultor.nomcom ?? consultor.nomfor ?? user.nome,
        depexe: consultor.depexe,
        depexeLabel: depexeLabel(consultor.depexe),
      },
      departamentosGerenciados,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dashboard:meu-perfil]", message);
    res.status(500).json({ error: message });
  }
});

function inicioDoMesCorrente(): Date {
  const hoje = new Date();
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
}

function fimDoMesCorrente(): Date {
  const hoje = new Date();
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0));
}

function inicioDoDiaUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Dashboard inicial do consultor (Home) — um payload só, pra não obrigar o front a
// orquestrar 5-6 chamadas soltas (sessões pendentes, RATs pendentes, notificações, horas
// por dia/projeto, meta, valor-hora já eram endpoints/fontes separadas). Ver
// domain/resumoConsultor.ts pras contas de horas/meta/valor-hora — aqui só orquestra e
// junta com as contagens que já existiam em outras rotas.
dashboardRouter.get("/meu-resumo", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const contexto = await resolverContextoConsultor(user.email);
    const { consultor } = contexto;
    if (!consultor || consultor.codfor == null) {
      res.json({ semConsultor: true });
      return;
    }
    const { codemp, codfor } = consultor;

    const de = typeof req.query.de === "string" && req.query.de ? inicioDoDiaUtc(new Date(req.query.de)) : inicioDoMesCorrente();
    const ate = typeof req.query.ate === "string" && req.query.ate ? inicioDoDiaUtc(new Date(req.query.ate)) : fimDoMesCorrente();
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || de.getTime() > ate.getTime()) {
      res.status(400).json({ error: "Período inválido" });
      return;
    }
    // Meta/saldo/ganho-até-agora só olham até HOJE — dia futuro não tem "realizado" pra
    // cobrar meta ainda; o gráfico por dia (porDia) continua indo até `ate` de propósito,
    // é ele que dá a visão do período inteiro escolhido.
    const hoje = inicioDoDiaUtc(new Date());
    const ateParaMeta = hoje.getTime() < ate.getTime() ? hoje : ate;

    const [{ porDia, porProjeto, totalMinutos }, realizadoAteHoje, meta, valorHora, sessoesPendentes, ratsPendentes, notificacoesNaoLidas] =
      await Promise.all([
        horasRealizadasNoPeriodo(codemp, codfor, de, ate),
        horasRealizadasNoPeriodo(codemp, codfor, de, ateParaMeta),
        metaDoPeriodo(codemp, codfor, de, ateParaMeta),
        valorHoraVigente(codemp, codfor),
        prisma.atividadeSessaoExecucao.count({
          where: { fim: { not: null }, confirmada: false, excluidaEm: null, atividade: { codemp, codfor, sitreg: "A" } },
        }),
        prisma.rat.count({ where: { codemp, codfor, sitrat: 9 } }),
        prisma.notificacao.count({ where: { userId: user.id, lida: false } }),
      ]);

    // Nomes dos projetos que aparecem em porProjeto — join com Proposta+Cliente, mesmo
    // padrão de rótulo usado em routes/atividades.ts (`${codcli} - ${nomcli}`).
    const codprosUsados = [...porProjeto.keys()];
    const propostas =
      codprosUsados.length > 0
        ? await prisma.proposta.findMany({ where: { codemp, codpro: { in: codprosUsados } }, include: { cliente: true } })
        : [];
    const nomePorCodpro = new Map(propostas.map((p) => [p.codpro, p.despro?.trim() || `${p.cliente.codcli} - ${p.cliente.nomcli}`]));

    // Projeção de ganho: extrapola a média de minutos por dia ÚTIL já passado (seg-sex,
    // sem levar feriado em conta — feriado é tratado só na tela, via API pública, ver
    // plano) pros dias úteis do período inteiro. Sem contrato de valor-hora, nem entra
    // na conta (ganhoAteAgora/projecaoGanho ficam null).
    let ganhoAteAgora: number | null = null;
    let projecaoGanho: number | null = null;
    if (valorHora) {
      const diasUteis = (de2: Date, ate2: Date) =>
        diasDoPeriodo(de2, ate2).filter((d) => {
          const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
          return dow !== 0 && dow !== 6;
        }).length;
      const diasUteisPassados = diasUteis(de, ateParaMeta);
      const diasUteisTotais = diasUteis(de, ate);
      const mediaMinutosPorDiaUtil = diasUteisPassados > 0 ? realizadoAteHoje.totalMinutos / diasUteisPassados : 0;
      const projecaoMinutos = mediaMinutosPorDiaUtil * diasUteisTotais;
      ganhoAteAgora = (valorHora.vlrhor * realizadoAteHoje.totalMinutos) / 60;
      projecaoGanho = (valorHora.vlrhor * projecaoMinutos) / 60;
    }

    res.json({
      periodo: { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) },
      totalMinutos,
      porDia: diasDoPeriodo(de, ate).map((data) => ({ data, minutos: porDia.get(data) ?? 0 })),
      porProjeto: [...porProjeto.entries()]
        .map(([codpro, minutos]) => ({ chave: String(codpro), nome: nomePorCodpro.get(codpro) ?? `Proposta ${codpro}`, valor: minutos }))
        .sort((a, b) => b.valor - a.valor),
      metaDiariaMinutos: meta.metaDiariaMinutos,
      metaTotalMinutos: meta.metaTotalMinutos,
      saldoMinutos: meta.diasComJornada > 0 ? realizadoAteHoje.totalMinutos - meta.metaTotalMinutos : null,
      valorHora: valorHora?.vlrhor ?? null,
      ganhoAteAgora,
      projecaoGanho,
      sessoesPendentes,
      ratsPendentes,
      notificacoesNaoLidas,
    });
  } catch (error) {
    handleError(res, error, "meu-resumo");
  }
});
