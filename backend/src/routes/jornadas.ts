import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  resolverContextoConsultor,
  consultoresDosDepartamentos,
  departamentosComTime,
  gerenciaDepartamento,
} from "../domain/contextoProjeto";

// Jornada de trabalho por consultor e dia da semana. Quem mantém é o gestor do
// departamento do consultor — o próprio consultor não edita a própria jornada, pelo mesmo
// motivo de não autorizar as próprias horas excedentes.
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
// gerencia. Admin alcança todos. Mesma fonte de "quem é do meu time" usada pelo filtro de
// consultor das RATs e pelo apontamento manual — se cada tela derivasse por conta própria,
// elas divergiriam.
async function consultoresGerenciados(role: string, contexto: Awaited<ReturnType<typeof resolverContextoConsultor>>) {
  if (role === "admin") {
    // Admin alcança todo departamento QUE TEM TIME — não a tabela de consultores inteira.
    // `Consultor` espelha o cadastro de fornecedores do Senior, então "todo consultor ativo
    // com codfor" trazia 116 nomes onde só 46 são gente de time; o resto é fornecedor e
    // quem saiu dos times. Jornada de trabalho é conceito de quem executa atividade.
    return consultoresDosDepartamentos(await departamentosComTime());
  }
  return consultoresDosDepartamentos(contexto.departamentosGerenciados);
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
    if (!permitidos.some((c) => c.codfor === codfor)) {
      res.status(403).json({ error: "Este consultor não está num departamento que você gerencia" });
      return;
    }

    const linhas = await prisma.jornadaConsultor.findMany({ where: { codemp, codfor } });
    const porDia = new Map(linhas.map((l) => [l.diaSemana, l]));
    res.json({
      codemp,
      codfor,
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
    if (alvo.depexe != null && !gerenciaDepartamento(ctx.role, ctx.contexto, alvo.depexe)) {
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
