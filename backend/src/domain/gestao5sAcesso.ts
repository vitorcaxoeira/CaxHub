import { prisma } from "../db/prisma";
import { Acesso5S, Papel5S } from "./gestao5s";

// Resolve o acesso do usuário ao módulo 5S. O admin do CaxHub é coordenador implícito; os demais
// dependem do cadastro em Participante5S (ativo). Sem cadastro: papel null → 403 no módulo.
export async function carregarAcesso5S(userId: number, role: string): Promise<Acesso5S> {
  if (role === "admin") return { papel: "coordenador", areasLider: [] };
  const p = await prisma.participante5S.findUnique({
    where: { userId },
    select: { papel: true, ativo: true, areas: { select: { areaId: true } } },
  });
  if (!p || !p.ativo) return { papel: null, areasLider: [] };
  return { papel: p.papel as Papel5S, areasLider: p.areas.map((a) => a.areaId) };
}
