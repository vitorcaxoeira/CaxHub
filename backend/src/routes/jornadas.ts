import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  resolverContextoConsultor,
  consultoresDosDepartamentos,
  departamentosComTime,
  gerenciaDepartamento,
} from "../domain/contextoProjeto";
import { MAX_DIAS_RETROATIVOS, diasRetroativosDoConsultor, janelaDoConsultor } from "../domain/janelaRetroativa";
import { MAX_TOLERANCIA_TETO_MIN, toleranciaTetoDoConsultor } from "../domain/toleranciaTeto";
import { criarEventoAuditoria, diffCampos } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdConsultor } from "../audit/identidadeEntidade";

// Jornada de trabalho por consultor e dia da semana ("Meta diária" na tela). Mantida pelo
// gestor do departamento pra qualquer consultor do time, e por qualquer consultor pra si
// mesmo — 04/09/2026, a pedido do Vitor: acesso liberado ao próprio usuário, mas só ao
// próprio registro (nunca ao de outro consultor sem ser gestor do departamento dele).
export const jornadasRouter = Router();
jornadasRouter.use(requireAuth);

const DIAS_SEMANA = [0, 1, 2, 3, 4, 5, 6];
const MINUTOS_NO_DIA = 24 * 60;

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[jornadas:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

// Consultores cuja jornada este usuário pode ver/editar: os dos departamentos que ele
// gerencia, mais ele próprio (mesmo fora de qualquer time que gerencie — é o que dá acesso
// "só ao usuário dele" pro consultor comum). Admin alcança todos. Mesma fonte de "quem é do
// meu time" usada pelo filtro de consultor das RATs e pelo apontamento manual — se cada tela
// derivasse por conta própria, elas divergiriam.
async function consultoresGerenciados(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  if (role === "admin") {
    // Admin alcança todo departamento QUE TEM TIME — não a tabela de consultores inteira.
    // `Consultor` espelha o cadastro de fornecedores do Senior, então "todo consultor ativo
    // com codfor" trazia 116 nomes onde só 46 são gente de time; o resto é fornecedor e
    // quem saiu dos times. Jornada de trabalho é conceito de quem executa atividade.
    return consultoresDosDepartamentos(await departamentosComTime());
  }
  const doTime = await consultoresDosDepartamentos(contexto.departamentosGerenciados);
  if (contexto.consultor?.codfor != null && !doTime.some((c) => c.codfor === contexto.consultor!.codfor)) {
    return [...doTime, contexto.consultor];
  }
  return doTime;
}

// Quem pode VER a configuração de apontamento (retroatividade + tolerância do teto) de um consultor:
// admin ou o líder do departamento dele. Diferente de podeEditarRetroativo, vale também pro próprio
// registro (um líder olhando o próprio vê o valor, mas não edita). O consultor comum não vê nada.
function podeVerConfiguracao(
  ctx: NonNullable<Awaited<ReturnType<typeof contextoDoUsuario>>>,
  alvo: { depexe: number | null }
): boolean {
  return alvo.depexe != null ? gerenciaDepartamento(ctx.role, ctx.contexto, alvo.depexe) : ctx.role === "admin";
}

// Quem pode mexer na configuração de apontamento de um consultor: admin, ou o líder do departamento
// dele — e NUNCA o próprio consultor, mesmo sendo admin/líder (o consultor não libera os próprios
// dias). Diferente da jornada, onde o próprio usuário edita o próprio registro.
function podeEditarRetroativo(
  ctx: NonNullable<Awaited<ReturnType<typeof contextoDoUsuario>>>,
  alvo: { depexe: number | null },
  codemp: number,
  codfor: number
): boolean {
  const ehOProprio = ctx.contexto.consultor?.codemp === codemp && ctx.contexto.consultor?.codfor === codfor;
  if (ehOProprio) return false;
  return alvo.depexe != null ? gerenciaDepartamento(ctx.role, ctx.contexto, alvo.depexe) : ctx.role === "admin";
}

// Minutos desde a meia-noite, ou null. Aceita null/"" pra "não trabalha neste período".
function lerMinutos(valor: unknown): number | null | undefined {
  if (valor === null || valor === "" || valor === undefined) return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > MINUTOS_NO_DIA) return undefined; // undefined = inválido
  return Math.round(n);
}

// GET /jornadas/consultores — quem eu posso configurar.
jornadasRouter.get("/consultores", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const consultores = await consultoresGerenciados(ctx.role, ctx.contexto);
    res.json({
      consultores: consultores
        .filter((c) => c.codfor != null)
        .map((c) => ({
          codemp: c.codemp,
          codfor: c.codfor as number,
          nome: c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`,
          depexeLabel: c.depexedes ?? null,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    });
  } catch (error) {
    handleError(res, error, "consultores");
  }
});

// GET /jornadas/minha-janela — a janela de retroatividade do consultor logado, pras telas de pedido
// travarem o calendário (o backend recusa de qualquer jeito; isto só evita o 409).
jornadasRouter.get("/minha-janela", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const consultor = ctx.contexto.consultor;
    if (!consultor || consultor.codfor == null || consultor.codfor <= 0) {
      res.status(404).json({ error: "Usuário sem consultor vinculado" });
      return;
    }
    res.json(await janelaDoConsultor(consultor.codemp, consultor.codfor));
  } catch (error) {
    handleError(res, error, "minha-janela");
  }
});

// GET /jornadas/:codemp/:codfor — os 7 dias, sempre completos. Dia sem linha no banco vem
// com os quatro horários nulos, pra tela não precisar distinguir "não cadastrado" de
// "folga" no desenho da grade. A distinção que importa é feita na varredura, que só olha
// as linhas existentes.
jornadasRouter.get("/:codemp/:codfor", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codfor = Number(req.params.codfor);
    if (!Number.isFinite(codemp) || !Number.isFinite(codfor)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const permitidos = await consultoresGerenciados(ctx.role, ctx.contexto);
    const alvo = permitidos.find((c) => c.codfor === codfor);
    if (!alvo) {
      res.status(403).json({ error: "Este consultor não está num departamento que você gerencia" });
      return;
    }

    const linhas = await prisma.jornadaConsultor.findMany({ where: { codemp, codfor } });
    const porDia = new Map(linhas.map((l) => [l.diaSemana, l]));
    // Configuração de apontamento (retroatividade + tolerância do teto): só admin ou líder do
    // departamento VÊEM — pro consultor comum os campos nem saem da API. Editar é mais estreito
    // ainda (podeEditarRetroativo: nunca o próprio consultor).
    const veConfiguracao = podeVerConfiguracao(ctx, alvo);
    res.json({
      codemp,
      codfor,
      podeVerConfiguracao: veConfiguracao,
      podeEditarConfiguracao: podeEditarRetroativo(ctx, alvo, codemp, codfor),
      ...(veConfiguracao
        ? {
            diasRetroativos: await diasRetroativosDoConsultor(codemp, codfor),
            toleranciaTetoMin: await toleranciaTetoDoConsultor(codemp, codfor),
          }
        : {}),
      dias: DIAS_SEMANA.map((diaSemana) => {
        const l = porDia.get(diaSemana);
        return {
          diaSemana,
          manhaInicio: l?.manhaInicio ?? null,
          manhaFim: l?.manhaFim ?? null,
          tardeInicio: l?.tardeInicio ?? null,
          tardeFim: l?.tardeFim ?? null,
          cadastrado: l != null,
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "obter");
  }
});

// PUT /jornadas/:codemp/:codfor — grava a semana inteira de uma vez. Substituição total e
// não patch por dia: a tela edita a grade toda, e assim não sobra dia órfão de uma edição
// anterior.
jornadasRouter.put("/:codemp/:codfor", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codfor = Number(req.params.codfor);
    if (!Number.isFinite(codemp) || !Number.isFinite(codfor)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const permitidos = await consultoresGerenciados(ctx.role, ctx.contexto);
    const alvo = permitidos.find((c) => c.codfor === codfor);
    if (!alvo) {
      res.status(403).json({ error: "Este consultor não está num departamento que você gerencia" });
      return;
    }
    // "É o meu próprio registro" autoriza junto com "eu gerencio o departamento dele" —
    // sem isso, o consultor comum passava pelo `permitidos.find` acima (ele mesmo entra em
    // `consultoresGerenciados`) e caía 403 aqui, porque não gerencia departamento nenhum.
    const ehOProprio = ctx.contexto.consultor?.codemp === codemp && ctx.contexto.consultor?.codfor === codfor;
    if (!ehOProprio && alvo.depexe != null && !gerenciaDepartamento(ctx.role, ctx.contexto, alvo.depexe)) {
      res.status(403).json({ error: "Sem permissão sobre o departamento deste consultor" });
      return;
    }

    const diasBody = Array.isArray(req.body?.dias) ? req.body.dias : null;
    if (!diasBody) {
      res.status(400).json({ error: "dias é obrigatório" });
      return;
    }

    const linhas: { diaSemana: number; manhaInicio: number | null; manhaFim: number | null; tardeInicio: number | null; tardeFim: number | null }[] = [];
    for (const bruto of diasBody) {
      const diaSemana = Number(bruto?.diaSemana);
      if (!DIAS_SEMANA.includes(diaSemana)) {
        res.status(400).json({ error: `diaSemana inválido: ${bruto?.diaSemana}` });
        return;
      }
      const campos = {
        manhaInicio: lerMinutos(bruto?.manhaInicio),
        manhaFim: lerMinutos(bruto?.manhaFim),
        tardeInicio: lerMinutos(bruto?.tardeInicio),
        tardeFim: lerMinutos(bruto?.tardeFim),
      };
      for (const [nome, valor] of Object.entries(campos)) {
        if (valor === undefined) {
          res.status(400).json({ error: `${nome} inválido no dia ${diaSemana} — informe minutos entre 0 e ${MINUTOS_NO_DIA}` });
          return;
        }
      }
      const { manhaInicio, manhaFim, tardeInicio, tardeFim } = campos as Record<string, number | null>;
      // Fim antes do início não é "período vazio", é erro de digitação — recusar aqui
      // evita uma jornada que a varredura silenciosamente ignoraria (periodosDoDia
      // descarta período inconsistente).
      if (manhaInicio != null && manhaFim != null && manhaFim <= manhaInicio) {
        res.status(400).json({ error: `Manhã com fim antes do início no dia ${diaSemana}` });
        return;
      }
      if (tardeInicio != null && tardeFim != null && tardeFim <= tardeInicio) {
        res.status(400).json({ error: `Tarde com fim antes do início no dia ${diaSemana}` });
        return;
      }
      if (manhaFim != null && tardeInicio != null && tardeInicio < manhaFim) {
        res.status(400).json({ error: `Tarde começa antes de a manhã terminar no dia ${diaSemana}` });
        return;
      }
      linhas.push({ diaSemana, manhaInicio, manhaFim, tardeInicio, tardeFim });
    }

    await prisma.$transaction([
      prisma.jornadaConsultor.deleteMany({ where: { codemp, codfor } }),
      // Dia inteiramente nulo NÃO é gravado: a ausência de linha é o que significa "sem
      // jornada cadastrada", e é ela que faz a varredura não parar o consultor por
      // expediente. Gravar quatro nulos diria "folga", que é outra coisa.
      prisma.jornadaConsultor.createMany({
        data: linhas
          .filter((l) => l.manhaInicio != null || l.manhaFim != null || l.tardeInicio != null || l.tardeFim != null)
          .map((l) => ({ codemp, codfor, ...l, atualizadoPor: ctx.user.id })),
      }),
    ]);

    res.json({ codemp, codfor, dias: linhas.length });
  } catch (error) {
    handleError(res, error, "salvar");
  }
});

// PUT /jornadas/:codemp/:codfor/configuracao-apontamento — configuração de apontamento do consultor:
// `diasRetroativos` (quantos dias úteis antes de hoje ele ainda pode pedir apontamento/ajuste; 0 =
// só hoje) e `toleranciaTetoMin` (folga do teto na confirmação de sessão). Os dois são opcionais,
// mas ao menos um é obrigatório. Exceção a uma ordem da Diretoria, então só admin ou o líder do
// departamento do consultor, nunca ele mesmo, e fica na auditoria com de/para.
jornadasRouter.put("/:codemp/:codfor/configuracao-apontamento", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codfor = Number(req.params.codfor);
    if (!Number.isFinite(codemp) || !Number.isFinite(codfor)) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }
    const dias = req.body?.diasRetroativos === undefined ? undefined : Number(req.body.diasRetroativos);
    const tolerancia = req.body?.toleranciaTetoMin === undefined ? undefined : Number(req.body.toleranciaTetoMin);
    if (dias === undefined && tolerancia === undefined) {
      res.status(400).json({ error: "Informe diasRetroativos e/ou toleranciaTetoMin" });
      return;
    }
    if (dias !== undefined && (!Number.isInteger(dias) || dias < 0 || dias > MAX_DIAS_RETROATIVOS)) {
      res.status(400).json({ error: `diasRetroativos deve ser um inteiro de 0 a ${MAX_DIAS_RETROATIVOS}` });
      return;
    }
    if (tolerancia !== undefined && (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > MAX_TOLERANCIA_TETO_MIN)) {
      res.status(400).json({ error: `toleranciaTetoMin deve ser um inteiro de 0 a ${MAX_TOLERANCIA_TETO_MIN}` });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const permitidos = await consultoresGerenciados(ctx.role, ctx.contexto);
    const alvo = permitidos.find((c) => c.codfor === codfor);
    if (!alvo) {
      res.status(403).json({ error: "Este consultor não está num departamento que você gerencia" });
      return;
    }
    if (!podeEditarRetroativo(ctx, alvo, codemp, codfor)) {
      res.status(403).json({ error: "Só o líder do departamento ou o admin podem alterar esta configuração — nunca o próprio consultor" });
      return;
    }

    const [diasAntes, toleranciaAntes] = await Promise.all([
      diasRetroativosDoConsultor(codemp, codfor),
      toleranciaTetoDoConsultor(codemp, codfor),
    ]);
    const diasDepois = dias ?? diasAntes;
    const toleranciaDepois = tolerancia ?? toleranciaAntes;
    const diffDias = diffCampos({ diasRetroativos: "Dias retroativos" }, { diasRetroativos: diasAntes }, { diasRetroativos: diasDepois });
    const diffTolerancia = diffCampos(
      { toleranciaTetoMin: "Tolerância do teto (min)" },
      { toleranciaTetoMin: toleranciaAntes },
      { toleranciaTetoMin: toleranciaDepois }
    );
    const rotulo = `Consultor — ${alvo.nomcom ?? alvo.nomfor ?? codfor}`;
    await prisma.$transaction(async (tx) => {
      await tx.configuracaoApontamentoConsultor.upsert({
        where: { codemp_codfor: { codemp, codfor } },
        create: { codemp, codfor, diasRetroativos: diasDepois, toleranciaTetoMin: toleranciaDepois, atualizadoPor: ctx.user.id },
        update: { diasRetroativos: diasDepois, toleranciaTetoMin: toleranciaDepois, atualizadoPor: ctx.user.id },
      });
      // Um evento por assunto alterado, cada um com o seu de/para.
      for (const [diff, eventoTipo] of [
        [diffDias, EVENTOS_AUDITORIA.APONTAMENTO_RETROATIVO_ALTERADO],
        [diffTolerancia, EVENTOS_AUDITORIA.APONTAMENTO_TOLERANCIA_TETO_ALTERADA],
      ] as const) {
        if (!diff.algumaMudanca) continue;
        await criarEventoAuditoria(
          {
            origem: "tela",
            usuarioId: ctx.user.id,
            codemp,
            entidadeTipo: ENTIDADES_AUDITORIA.CONSULTOR,
            entidadeId: entidadeIdConsultor(codemp, codfor),
            entidadeRotulo: rotulo,
            eventoTipo,
            alteracoes: diff.alteracoes,
            metadata: { codfor },
            correlationId: req.correlationId!,
          },
          tx
        );
      }
    });

    res.json({ codemp, codfor, diasRetroativos: diasDepois, toleranciaTetoMin: toleranciaDepois });
  } catch (error) {
    handleError(res, error, "configuracao-apontamento");
  }
});
