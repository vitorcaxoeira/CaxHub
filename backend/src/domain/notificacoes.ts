import { prisma } from "../db/prisma";

export async function criarNotificacao(
  userId: number,
  tipo: string,
  mensagem: string,
  atividadeId?: number
): Promise<void> {
  await prisma.notificacao.create({ data: { userId, tipo, mensagem, atividadeId } });
}

// Notifica os Líderes Técnicos (gestores) do departamento de uma atividade — usado
// pela automação de mudança de coluna (ver PATCH /atividades/:id/mover). Só notifica
// gestores que já têm conta no CaxHub (nem todo consultor do Senior tem login aqui) e
// pula quem foi o próprio autor da ação, pra não notificar a si mesmo.
export async function notificarGestoresDoDepartamento(
  codemp: number,
  depexe: number,
  tipo: string,
  mensagem: string,
  atividadeId: number,
  excluirUserId?: number
): Promise<void> {
  const gestores = await prisma.departamentoGestor.findMany({ where: { codemp, depexe } });
  if (gestores.length === 0) return;

  const codusuList = gestores.map((g) => Number(g.usuges));
  const consultores = await prisma.consultor.findMany({ where: { codemp, codusu: { in: codusuList } } });
  const emails = consultores.map((c) => c.email).filter((e): e is string => !!e);
  if (emails.length === 0) return;

  const usuarios = await prisma.user.findMany({
    where: { email: { in: emails, mode: "insensitive" } },
  });

  for (const usuario of usuarios) {
    if (usuario.id === excluirUserId) continue;
    await criarNotificacao(usuario.id, tipo, mensagem, atividadeId);
  }
}
