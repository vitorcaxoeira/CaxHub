import { Consultor } from "@prisma/client";
import { prisma } from "../db/prisma";

// Contexto de autorização do módulo de Gestão de Projetos. "Líder Técnico" e
// "Consultor" não são papéis (Role) — são derivados dinamicamente de
// DepartamentoGestor/DepartamentoTime, o mesmo mecanismo já usado em
// GET /dashboard/meu-perfil. Ver plano "Módulo Gestão de Projetos — Fase 0".
export interface ContextoConsultor {
  consultor: Consultor | null;
  departamentosGerenciados: number[]; // depexe onde o usuário é usuges (Líder Técnico)
  departamentosTime: number[]; // depexe onde o usuário é integrante do time (Consultor)
}

export async function resolverContextoConsultor(email: string): Promise<ContextoConsultor> {
  const consultor = await prisma.consultor.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (!consultor) {
    return { consultor: null, departamentosGerenciados: [], departamentosTime: [] };
  }

  const [gestorDe, timeDe] = await Promise.all([
    prisma.departamentoGestor.findMany({
      where: { codemp: consultor.codemp, usuges: BigInt(consultor.codusu) },
      select: { depexe: true },
    }),
    prisma.departamentoTime.findMany({
      where: { codemp: consultor.codemp, codusu: BigInt(consultor.codusu), sitreg: "A" },
      select: { depexe: true },
    }),
  ]);

  return {
    consultor,
    departamentosGerenciados: gestorDe.map((d) => d.depexe),
    departamentosTime: timeDe.map((d) => d.depexe),
  };
}

// Consultores ativos dos departamentos informados (o "time" de um Líder Técnico). Mora
// aqui, e não numa rota, porque duas telas dependem da MESMA definição de time: o seletor
// de consultor do apontamento manual e o filtro de consultor das RATs. Se cada uma
// derivasse o time do seu próprio jeito, elas divergiriam.
//
// O caminho é DepartamentoTime -> Consultor, e a conversão de tipo é obrigatória:
// `DepartamentoTime.codusu` é BigInt e `Consultor.codusu` é Int. Consultor sem `codfor`
// fica fora — sem ele não há como amarrar a atividades nem a RATs.
export async function consultoresDosDepartamentos(depexes: number[]): Promise<Consultor[]> {
  if (depexes.length === 0) return [];
  const doTime = await prisma.departamentoTime.findMany({
    where: { depexe: { in: depexes }, sitreg: "A" },
    select: { codemp: true, codusu: true },
  });
  if (doTime.length === 0) return [];
  return prisma.consultor.findMany({
    where: {
      OR: doTime.map((t) => ({ codemp: t.codemp, codusu: Number(t.codusu) })),
      codfor: { not: null },
    },
  });
}

// Codfors por quem o usuário pode olhar/lançar como "time": os consultores dos
// departamentos que ele gerencia mais ele próprio. `null` = sem restrição (admin).
export async function codforsDoTime(role: string, contexto: ContextoConsultor): Promise<Set<number> | null> {
  if (role === "admin") return null;
  const doTime = await consultoresDosDepartamentos(contexto.departamentosGerenciados);
  const codfors = new Set<number>();
  for (const c of doTime) if (c.codfor != null) codfors.add(c.codfor);
  if (contexto.consultor?.codfor != null) codfors.add(contexto.consultor.codfor);
  return codfors;
}

export type AcaoProjeto =
  | "visualizar"
  | "criar"
  | "editar"
  | "mover"
  | "excluir"
  | "aprovar"
  | "exportar"
  | "importar"
  | "lancarApontamento";

interface AtividadeParaPermissao {
  depexe: number;
  codfor: number;
}

// "criar" habilitado nesta fase pra área de Alocação (Líder Técnico distribui horas de
// um item de proposta entre os consultores do próprio time).
const ACOES_LIDER_TECNICO: AcaoProjeto[] = ["visualizar", "criar", "editar", "mover", "aprovar", "excluir"];

// role vem do JWT (req.user.role) — o mesmo papel usado pelo requireRole() das rotas.
export function podeExecutarAcao(
  role: string,
  contexto: ContextoConsultor,
  acao: AcaoProjeto,
  atividade: AtividadeParaPermissao
): boolean {
  if (role === "admin") return true;
  if (role === "comercial") return acao === "visualizar";

  if (contexto.departamentosGerenciados.includes(atividade.depexe)) {
    // O Líder Técnico PODE lançar apontamento por qualquer consultor do departamento que
    // gerencia. Isso foi uma revisão consciente (30/07/2026): antes a regra aqui exigia
    // `contexto.consultor?.codfor === atividade.codfor`, com o argumento de que gerenciar
    // o time não é a mesma coisa que ter trabalhado na atividade. Na prática o gestor
    // precisa registrar tempo de quem esqueceu de apontar, e nada se perde em
    // rastreabilidade: o apontamento continua pertencendo a quem executou (a RAT nasce
    // com o `codfor` da atividade, ver buscarOuCriarRatRascunho em routes/apontamentos.ts)
    // e o AuditEvento grava o usuário logado, então fica registrado quem lançou.
    //
    // A liberação é SÓ deste ramo. No ramo de `departamentosTime` abaixo a exigência
    // continua: colega de time não lança por colega.
    return acao === "lancarApontamento" || ACOES_LIDER_TECNICO.includes(acao);
  }

  if (contexto.departamentosTime.includes(atividade.depexe)) {
    if (acao === "visualizar") return true;
    if (acao === "mover" || acao === "editar" || acao === "lancarApontamento") {
      return contexto.consultor?.codfor === atividade.codfor;
    }
    return false;
  }

  return false;
}
