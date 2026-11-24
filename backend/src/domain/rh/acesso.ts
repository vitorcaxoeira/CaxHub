import { prisma } from "../../db/prisma";
import { resolverContextoConsultor } from "../contextoProjeto";

// Departamento executor (USU_LDepExe do Senior) cujo gestor, além do admin, acessa o módulo RH (menu Pessoas).
// "Gestor do DHO" não é um papel (Role): vem de DepartamentoGestor, então trocar o gestor no Senior troca quem
// entra, sem deploy. Em sincronia com DEPEXE_DHO de frontend/src/auth/acessoRh.ts.
export const DEPEXE_DHO = 11;

/** Admin, ou quem consta como gestor do departamento 11 (DHO). */
export async function podeAcessarRh(userId: number, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return false;
  const contexto = await resolverContextoConsultor(user.email);
  return contexto.departamentosGerenciados.includes(DEPEXE_DHO);
}
