import { prisma } from "../db/prisma";

export async function criarNotificacao(
  userId: number,
  tipo: string,
  mensagem: string,
  atividadeId?: number
): Promise<void> {
  await prisma.notificacao.create({ data: { userId, tipo, mensagem, atividadeId } });
}

// Notifica quem executa a atividade. O caminho é `codfor` -> Consultor.email -> User,
// porque a atividade guarda o fornecedor do Senior e a notificação é do usuário do
// CaxHub — nem todo consultor do Senior tem login aqui, e nesses casos não há a quem
// notificar (silencioso de propósito: não é erro da ação que disparou).
//
// `excluirUserId` evita notificar a si mesmo — o gestor que libera horas excedentes na
// própria atividade não precisa de aviso do que acabou de fazer.
export async function notificarConsultorDaAtividade(
  atividade: { codemp: number; codfor: number; id: number },
  tipo: string,
  mensagem: string,
  excluirUserId?: number
): Promise<void> {
  const consultor = await prisma.consultor.findFirst({
    where: { codemp: atividade.codemp, codfor: atividade.codfor },
  });
  if (!consultor?.email) return;

  const usuario = await prisma.user.findFirst({
    where: { email: { equals: consultor.email, mode: "insensitive" } },
  });
  if (!usuario || usuario.id === excluirUserId) return;

  await criarNotificacao(usuario.id, tipo, mensagem, atividade.id);
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
