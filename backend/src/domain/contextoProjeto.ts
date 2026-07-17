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

export type AcaoProjeto =
  | "visualizar"
  | "criar"
  | "editar"
  | "mover"
  | "excluir"
  | "aprovar"
  | "exportar"
  | "importar";

interface AtividadeParaPermissao {
  depexe: number;
  codfor: number;
}

const ACOES_LIDER_TECNICO: AcaoProjeto[] = ["visualizar", "editar", "mover", "aprovar", "excluir"];

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
    return ACOES_LIDER_TECNICO.includes(acao);
  }

  if (contexto.departamentosTime.includes(atividade.depexe)) {
    if (acao === "visualizar") return true;
    if (acao === "mover" || acao === "editar") {
      return contexto.consultor?.codfor === atividade.codfor;
    }
    return false;
  }

  return false;
}
