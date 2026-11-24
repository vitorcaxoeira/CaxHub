import { prisma } from "../../db/prisma";
import { resolverContextoConsultor } from "../contextoProjeto";
import { DEPEXE_COMERCIAL } from "../propostasDominio";

// Gestão de Metas do Comercial: admin, ou quem consta como gestor do departamento Comercial (depexe 2). "Gestor do Comercial" não é
// papel (Role): vem de DepartamentoGestor, então trocar a gestora no Senior troca quem entra, sem deploy. Em sincronia com
// DEPEXE_COMERCIAL de frontend/src/auth/acessoComercial.ts.
export async function podeGerirMetasComercial(userId: number, role: string): Promise<boolean> {
  if (role === "admin") return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return false;
  const contexto = await resolverContextoConsultor(user.email);
  return contexto.departamentosGerenciados.includes(DEPEXE_COMERCIAL);
}
