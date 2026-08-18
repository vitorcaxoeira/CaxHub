import { Router } from "express";
import { Consultor } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { depexeLabel } from "../domain/propostasDominio";
import { resolverContextoConsultor, ContextoConsultor, codforsDoTime, consultoresFiltraveis } from "../domain/contextoProjeto";
import { diasDoPeriodo, horasRealizadasNoPeriodo, metaDoPeriodo, valorHoraVigente } from "../domain/resumoConsultor";
import { parseIntListParam } from "../lib/queryParams";

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
        codfor: consultor.codfor,
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

// Consultores que o usuário logado pode escolher no filtro do Dashboard: ele mesmo, e se for
// Líder Técnico ou admin, o time todo (ou todo mundo, no caso do admin) — mesma definição já
// usada no seletor de consultor do apontamento manual (ver domain/contextoProjeto.ts).
dashboardRouter.get("/consultores-filtraveis", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const contexto = await resolverContextoConsultor(user.email);
    res.json({ consultores: await consultoresFiltraveis(req.user!.role, contexto) });
  } catch (error) {
    handleError(res, error, "consultores-filtraveis");
  }
});

// Resolve qual Consultor o pedido quer ver: o do próprio usuário por padrão, ou outro
// (`?codfor=` na query) — desde que o usuário tenha permissão (admin, ou o alvo estar no time
// que ele gerencia; `codforsDoTime` devolve `null` pra admin, "sem restrição"). Compartilhada
// entre /meu-resumo e /anos-com-dado: as duas aceitam o mesmo `codfor` e não podem divergir
// em quem autorizam a ver.
async function resolverConsultorAlvo(
  req: AuthenticatedRequest,
  contexto: ContextoConsultor
): Promise<{ alvo: Consultor | null } | { negado: true }> {
  const codforPedido = typeof req.query.codfor === "string" ? Number(req.query.codfor) : null;
  if (codforPedido == null || !Number.isFinite(codforPedido) || codforPedido === contexto.consultor?.codfor) {
    return { alvo: contexto.consultor };
  }
  const permitidos = await codforsDoTime(req.user!.role, contexto);
  if (permitidos != null && !permitidos.has(codforPedido)) {
    return { negado: true };
  }
  const alvo = await prisma.consultor.findFirst({ where: { codfor: codforPedido } });
  return { alvo };
}

function inicioDoDiaUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Anos com pelo menos um dado real (sessão de execução encerrada ou apontamento já
// sincronizado) pro consultor pedido — mesmo espírito de GET /contabil/resultado/opcoes-filtro
// (não oferecer no filtro um ano que só daria tela vazia), mas escopado ao consultor, não
// global: os anos que fazem sentido pra um consultor recém-chegado são bem menores que os da
// empresa inteira.
dashboardRouter.get("/anos-com-dado", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const contexto = await resolverContextoConsultor(user.email);

    const resolvido = await resolverConsultorAlvo(req, contexto);
    if ("negado" in resolvido) {
      res.status(403).json({ error: "Sem permissão para ver os dados deste consultor" });
      return;
    }
    const alvo = resolvido.alvo;
    if (!alvo || alvo.codfor == null) {
      res.json({ anos: [] });
      return;
    }

    const linhas = await prisma.$queryRaw<{ ano: number }[]>`
      SELECT ano FROM (
        SELECT DISTINCT EXTRACT(YEAR FROM ase.fim)::int AS ano
        FROM atividade_sessoes_execucao ase
        JOIN atividades_consultor ac ON ac.id = ase."atividadeId"
        WHERE ase.confirmada = false AND ase.fim IS NOT NULL AND ase."excluidaEm" IS NULL
          AND ac.codemp = ${alvo.codemp} AND ac.codfor = ${alvo.codfor}
        UNION
        SELECT DISTINCT EXTRACT(YEAR FROM ri.datati)::int AS ano
        FROM rat_itens ri
        JOIN rats r ON r.id = ri."ratId"
        WHERE ri.datati IS NOT NULL AND ri.codemp = ${alvo.codemp} AND r.codfor = ${alvo.codfor}
      ) t
      ORDER BY ano DESC
    `;
    res.json({ anos: linhas.map((l) => Number(l.ano)) });
  } catch (error) {
    handleError(res, error, "anos-com-dado");
  }
});

// Dashboard inicial do consultor (Home) — um payload só, pra não obrigar o front a
// orquestrar 5-6 chamadas soltas (sessões pendentes, RATs pendentes, notificações, horas
// por dia/projeto, meta, valor-hora já eram endpoints/fontes separadas). Ver
// domain/resumoConsultor.ts pras contas de horas/meta/valor-hora — aqui só orquestra e
// junta com as contagens que já existiam em outras rotas.
//
// Período por `anos`/`meses` (multi-seleção, mesmo formato e mesmo parser de
// routes/contabil.ts — "anos=2025,2026&meses=1,2") em vez de `de`/`ate`: dá pra somar vários
// meses (inclusive de anos diferentes) num painel só. Sem parâmetro, cai no mês corrente —
// diferente da visão contábil (que cai em "ano inteiro"), pra manter o comportamento de
// sempre do Dashboard quando ninguém mexeu no filtro ainda.
dashboardRouter.get("/meu-resumo", requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const contexto = await resolverContextoConsultor(user.email);

    const resolvido = await resolverConsultorAlvo(req, contexto);
    if ("negado" in resolvido) {
      res.status(403).json({ error: "Sem permissão para ver o painel deste consultor" });
      return;
    }
    const alvo = resolvido.alvo;
    if (!alvo || alvo.codfor == null) {
      res.json({ semConsultor: true });
      return;
    }
    const { codemp, codfor } = alvo;

    const hoje = new Date();
    const anos = [...new Set(parseIntListParam(req.query.anos) ?? [hoje.getUTCFullYear()])].sort((a, b) => a - b);
    const meses = [
      ...new Set((parseIntListParam(req.query.meses) ?? [hoje.getUTCMonth() + 1]).filter((m) => m >= 1 && m <= 12)),
    ].sort((a, b) => a - b);
    if (anos.length === 0 || meses.length === 0) {
      res.status(400).json({ error: "Período inválido" });
      return;
    }
    // Combinações em ordem cronológica (todo mês do ano mais antigo, depois o próximo ano) —
    // mesma ordem de "colunas" em routes/contabil.ts, só que aqui os meses são somados num
    // painel só, não comparados lado a lado numa tabela.
    const combos = anos.flatMap((ano) => meses.map((mes) => ({ ano, mes })));
    const hojeUtc = inicioDoDiaUtc(hoje);

    // Um combo nunca se sobrepõe a outro (meses diferentes), então concatenar/somar os
    // resultados por chave é seguro sem checar duplicata.
    const porCombo = await Promise.all(
      combos.map(async ({ ano, mes }) => {
        const de = new Date(Date.UTC(ano, mes - 1, 1));
        const ate = new Date(Date.UTC(ano, mes, 0));
        // Meta/saldo/ganho-até-agora só olham até HOJE — dia futuro não tem "realizado" pra
        // cobrar meta ainda; o gráfico por dia (porDia) continua indo até `ate` de propósito.
        const ateParaMeta = hojeUtc.getTime() < ate.getTime() ? hojeUtc : ate;

        const [{ porDia, porProjeto, totalMinutos }, realizadoAteHoje, meta] = await Promise.all([
          horasRealizadasNoPeriodo(codemp, codfor, de, ate),
          horasRealizadasNoPeriodo(codemp, codfor, de, ateParaMeta),
          metaDoPeriodo(codemp, codfor, de, ateParaMeta),
        ]);

        return { de, ate, ateParaMeta, porDia, porProjeto, totalMinutos, realizadoAteHoje, meta };
      })
    );

    const [valorHora, sessoesPendentes, ratsPendentes, notificacoesNaoLidas] = await Promise.all([
      valorHoraVigente(codemp, codfor),
      // Sem filtro de período — são contagens "agora" (pendências em aberto), nunca foram
      // recortadas pelo mês exibido.
      prisma.atividadeSessaoExecucao.count({
        where: { fim: { not: null }, confirmada: false, excluidaEm: null, atividade: { codemp, codfor, sitreg: "A" } },
      }),
      prisma.rat.count({ where: { codemp, codfor, sitrat: 9 } }),
      prisma.notificacao.count({ where: { userId: user.id, lida: false } }),
    ]);

    const diasUteisEntre = (de: Date, ate: Date) =>
      diasDoPeriodo(de, ate).filter((d) => {
        const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
        return dow !== 0 && dow !== 6;
      }).length;

    let totalMinutos = 0;
    let realizadoAteHojeTotal = 0;
    let metaTotalMinutos = 0;
    let diasComJornadaTotal = 0;
    let ganhoAteAgora: number | null = valorHora ? 0 : null;
    let projecaoGanho: number | null = valorHora ? 0 : null;
    const porDiaLista: { data: string; minutos: number }[] = [];
    const porProjetoTotal = new Map<number, number>();

    for (const combo of porCombo) {
      totalMinutos += combo.totalMinutos;
      realizadoAteHojeTotal += combo.realizadoAteHoje.totalMinutos;
      metaTotalMinutos += combo.meta.metaTotalMinutos;
      diasComJornadaTotal += combo.meta.diasComJornada;

      for (const dia of diasDoPeriodo(combo.de, combo.ate)) {
        porDiaLista.push({ data: dia, minutos: combo.porDia.get(dia) ?? 0 });
      }
      for (const [codpro, minutos] of combo.porProjeto) {
        porProjetoTotal.set(codpro, (porProjetoTotal.get(codpro) ?? 0) + minutos);
      }

      // Projeção de ganho: extrapola a média de minutos por dia ÚTIL já passado (seg-sex, sem
      // levar feriado em conta) pros dias úteis do mês inteiro daquele combo, e soma entre
      // combos — cada mês projeta o resto de si mesmo, não o período inteiro junto.
      if (valorHora) {
        const diasUteisPassados = diasUteisEntre(combo.de, combo.ateParaMeta);
        const diasUteisTotais = diasUteisEntre(combo.de, combo.ate);
        const mediaMinutosPorDiaUtil = diasUteisPassados > 0 ? combo.realizadoAteHoje.totalMinutos / diasUteisPassados : 0;
        const projecaoMinutos = mediaMinutosPorDiaUtil * diasUteisTotais;
        ganhoAteAgora = (ganhoAteAgora ?? 0) + (valorHora.vlrhor * combo.realizadoAteHoje.totalMinutos) / 60;
        projecaoGanho = (projecaoGanho ?? 0) + (valorHora.vlrhor * projecaoMinutos) / 60;
      }
    }

    // Nomes dos projetos que aparecem em porProjetoTotal — join com Proposta+Cliente, mesmo
    // padrão de rótulo usado em routes/atividades.ts (`${codcli} - ${nomcli}`).
    const codprosUsados = [...porProjetoTotal.keys()];
    const propostas =
      codprosUsados.length > 0
        ? await prisma.proposta.findMany({ where: { codemp, codpro: { in: codprosUsados } }, include: { cliente: true } })
        : [];
    const nomePorCodpro = new Map(propostas.map((p) => [p.codpro, p.despro?.trim() || `${p.cliente.codcli} - ${p.cliente.nomcli}`]));

    res.json({
      periodo: { anos, meses },
      totalMinutos,
      porDia: porDiaLista,
      porProjeto: [...porProjetoTotal.entries()]
        .map(([codpro, minutos]) => ({ chave: String(codpro), nome: nomePorCodpro.get(codpro) ?? `Proposta ${codpro}`, valor: minutos }))
        .sort((a, b) => b.valor - a.valor),
      // "Xh/dia" só faz sentido descrevendo UM mês — combinar vários meses (com jornadas
      // potencialmente diferentes) não tem uma meta diária única pra mostrar.
      metaDiariaMinutos: combos.length === 1 ? porCombo[0].meta.metaDiariaMinutos : null,
      metaTotalMinutos,
      saldoMinutos: diasComJornadaTotal > 0 ? realizadoAteHojeTotal - metaTotalMinutos : null,
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
