import { prisma } from "../db/prisma";
import { resolverContextoConsultor } from "./contextoProjeto";
import { DEPEXE_COMERCIAL } from "./propostasDominio";

// Quem entra na Gestão Propostas e o que enxerga/faz (19/11/2026). Líder não é Role: vem de DepartamentoGestor (resolverContextoConsultor).
//  - admin: todos os departamentos e todas as ações;
//  - papel comercial: todos os departamentos, só Sinc. ERP;
//  - líder do Comercial (gerencia o depexe 2): todos os departamentos, só Sinc. ERP;
//  - outro líder: só os departamentos que gerencia (da proposta OU de algum item), só Sinc. ERP;
//  - demais: sem acesso.
export interface AcessoGestaoPropostas {
  /** Departamentos que a pessoa enxerga. `null` = todos (sem recorte). */
  departamentos: number[] | null;
  /** Finalizar, Em Execução, Rejeitar, Cancelar e Declinar: só o admin. */
  podeMudarSituacao: boolean;
}

/** Regra pura. `null` = sem acesso à tela. */
export function acessoGestaoPropostas(role: string, departamentosGerenciados: readonly number[]): AcessoGestaoPropostas | null {
  if (role === "admin") return { departamentos: null, podeMudarSituacao: true };
  if (role === "comercial" || departamentosGerenciados.includes(DEPEXE_COMERCIAL)) return { departamentos: null, podeMudarSituacao: false };
  if (departamentosGerenciados.length > 0) return { departamentos: [...departamentosGerenciados], podeMudarSituacao: false };
  return null;
}

export async function resolverAcessoGestaoPropostas(userId: number, role: string): Promise<AcessoGestaoPropostas | null> {
  if (role === "admin") return acessoGestaoPropostas(role, []);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const contexto = user ? await resolverContextoConsultor(user.email) : { departamentosGerenciados: [] as number[] };
  return acessoGestaoPropostas(role, contexto.departamentosGerenciados);
}
