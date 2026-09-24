import { prisma } from "../db/prisma";
import { DEPEXE_COMERCIAL, DEPEXE_DIRETORIA } from "./propostasDominio";
import { PAPEIS_MODULO_VIAGEM } from "./solicitacoesViagem";

export async function criarNotificacao(
  userId: number,
  tipo: string,
  mensagem: string,
  atividadeId?: number,
  solicitacaoViagemId?: number
): Promise<void> {
  await prisma.notificacao.create({ data: { userId, tipo, mensagem, atividadeId, solicitacaoViagemId } });
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
    where: { email: { in: emails, mode: "insensitive" }, status: { not: "inativo" } },
  });

  for (const usuario of usuarios) {
    if (usuario.id === excluirUserId) continue;
    await criarNotificacao(usuario.id, tipo, mensagem, atividadeId);
  }
}

// Notifica quem tem alçada pra decidir configuração de proposta: gestor do Comercial +
// gestor da Diretoria + todo admin — o mesmo conjunto de podeAprovarConfiguracaoProposta
// (domain/contextoProjeto.ts).
//
// Função própria porque as três acima não servem: notificarGestoresDoDepartamento é de UM
// departamento e exige `atividadeId`, e aqui a solicitação é da PROPOSTA (não existe
// atividade envolvida) e o conjunto inclui admins, que não são gestores de departamento
// nenhum. `atividadeId` fica de fora — criarNotificacao já aceita sem ele.
//
// Mesmo silêncio das outras em cada etapa (gestor sem Consultor casando, ou Consultor sem
// User): quem não tem login aqui simplesmente não recebe, e isso não derruba a ação.
export async function notificarAprovadoresConfiguracaoProposta(
  codemp: number,
  mensagem: string,
  excluirUserId?: number
): Promise<void> {
  const gestores = await prisma.departamentoGestor.findMany({
    where: { codemp, depexe: { in: [DEPEXE_COMERCIAL, DEPEXE_DIRETORIA] } },
  });
  const codusuList = gestores.map((g) => Number(g.usuges));
  const consultores =
    codusuList.length > 0 ? await prisma.consultor.findMany({ where: { codemp, codusu: { in: codusuList } } }) : [];
  const emails = consultores.map((c) => c.email).filter((e): e is string => !!e);

  const [gestoresUsuarios, admins] = await Promise.all([
    emails.length > 0
      ? prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" }, status: { not: "inativo" } } })
      : Promise.resolve([]),
    prisma.user.findMany({ where: { role: { name: "admin" }, status: { not: "inativo" } } }),
  ]);

  // Um admin que também seja gestor de um desses departamentos apareceria duas vezes.
  const idsUnicos = new Set([...gestoresUsuarios, ...admins].map((u) => u.id));
  for (const userId of idsUnicos) {
    if (userId === excluirUserId) continue;
    await criarNotificacao(userId, "config_proposta_solicitada", mensagem);
  }
}

// ---------- Solicitações de Viagem ----------

async function usuariosPorPapel(papeis: string[]) {
  return prisma.user.findMany({ where: { role: { name: { in: papeis } }, status: { not: "inativo" } } });
}

// Atendimento (administrativo + admin): quem cota e reserva.
export async function notificarAtendimentoViagem(tipo: string, mensagem: string, solicitacaoId: number, excluirUserId?: number): Promise<void> {
  for (const u of await usuariosPorPapel([...PAPEIS_MODULO_VIAGEM])) {
    if (u.id === excluirUserId) continue;
    await criarNotificacao(u.id, tipo, mensagem, undefined, solicitacaoId);
  }
}

// Quem aprova: gestores do departamento do snapshot (departamento do solicitante) + admins.
// Sem gestor cadastrado, os admins ficam sozinhos — é o fallback da regra de aprovação.
export async function notificarAprovadoresViagem(
  aprovacao: { codemp: number | null; depexe: number | null },
  mensagem: string,
  solicitacaoId: number,
  excluirUserId?: number
): Promise<void> {
  const ids = new Set<number>((await usuariosPorPapel([...PAPEIS_MODULO_VIAGEM])).map((u) => u.id));
  if (aprovacao.codemp != null && aprovacao.depexe != null) {
    const gestores = await prisma.departamentoGestor.findMany({ where: { codemp: aprovacao.codemp, depexe: aprovacao.depexe } });
    const consultores =
      gestores.length > 0
        ? await prisma.consultor.findMany({ where: { codemp: aprovacao.codemp, codusu: { in: gestores.map((g) => Number(g.usuges)) } } })
        : [];
    const emails = consultores.map((c) => c.email).filter((e): e is string => !!e);
    if (emails.length > 0) {
      const usuarios = await prisma.user.findMany({ where: { email: { in: emails, mode: "insensitive" }, status: { not: "inativo" }, role: { name: { in: [...PAPEIS_MODULO_VIAGEM] } } } });
      for (const u of usuarios) ids.add(u.id);
    }
  }
  for (const id of ids) {
    if (id === excluirUserId) continue;
    await criarNotificacao(id, "viagem_aguardando_aprovacao", mensagem, undefined, solicitacaoId);
  }
}
