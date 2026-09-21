import { prisma } from "../db/prisma";

// Status do usuário consultado a cada requisição autenticada (requireAuth) pra que inativar
// derrube a sessão NA HORA — o JWT sozinho não sabe: vale por até 8h e ainda se renova sozinho
// enquanto a pessoa usa o app (talvezRenovar). Cache curto pra não virar uma consulta ao banco
// por requisição; inativar/reativar limpa a entrada na hora (processo único do backend), então
// o TTL só importa se um dia houver mais de um processo.
const TTL_MS = 30_000;
const cache = new Map<number, { inativo: boolean; expiraEm: number }>();

export async function usuarioInativo(userId: number): Promise<boolean> {
  const agora = Date.now();
  const emCache = cache.get(userId);
  if (emCache && emCache.expiraEm > agora) return emCache.inativo;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  // Usuário inexistente (ex.: excluído) segue o comportamento de sempre — só "inativo" bloqueia.
  const inativo = user?.status === "inativo";
  cache.set(userId, { inativo, expiraEm: agora + TTL_MS });
  return inativo;
}

export function invalidarStatusUsuario(userId: number): void {
  cache.delete(userId);
}
