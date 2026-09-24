import { prisma } from "../db/prisma";
import { ContextoConsultor } from "./contextoProjeto";

// Regras puras do módulo Gestão de Solicitações — Solicitações de Viagem. Mora aqui, e não no
// router, porque permissão, status e validação são consultados por mais de uma rota.

export const FINALIDADES = ["projeto", "comercial", "interna", "treinamento", "outro"] as const;
export type Finalidade = (typeof FINALIDADES)[number];

export const TIPOS_ITEM = ["hospedagem", "aereo", "carro"] as const;
export type TipoItem = (typeof TIPOS_ITEM)[number];

export const STATUS_VIAGEM = [
  "solicitada",
  "em_cotacao",
  "aguardando_aprovacao",
  "aprovada",
  "reprovada",
  "reservada",
  "finalizada",
  "cancelada",
] as const;
export type StatusViagem = (typeof STATUS_VIAGEM)[number];

export const STATUS_TERMINAIS: readonly StatusViagem[] = ["reprovada", "finalizada", "cancelada"];

// Papéis que enxergam o módulo INTEIRO. Liberado só pro admin por enquanto (24/09/2026, pedido do
// Vitor): backend (router), rotas, menu e notificações leem daqui/espelham isto. Para abrir o
// módulo depois, é só ampliar esta lista e os `roles` do menu/rotas no frontend.
export const PAPEIS_MODULO_VIAGEM = ["admin"] as const;

export const PAPEIS_ATENDIMENTO = ["admin", "administrativo"] as const;

export function ehTerminal(status: string): boolean {
  return (STATUS_TERMINAIS as readonly string[]).includes(status);
}

// ---------- CPF ----------

export function soDigitos(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\D/g, "") : "";
}

// Dígito verificador do CPF; recusa sequências repetidas (111.111.111-11 passa na conta, mas
// não é um CPF válido).
export function validarCpf(valor: unknown): boolean {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

// Quem não é o solicitante nem do atendimento (ex.: o gestor que aprova) vê só o miolo.
export function mascararCpf(cpf: string): string {
  const d = soDigitos(cpf);
  if (d === "") return "";
  if (d.length !== 11) return "***";
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

// ---------- Permissões ----------

export interface ContextoViagem {
  userId: number;
  role: string;
  contexto: ContextoConsultor;
}

export interface ViagemPermissao {
  solicitanteId: number | null;
  aprovacaoCodemp: number | null;
  aprovacaoDepexe: number | null;
}

export function ehAtendimento(role: string): boolean {
  return (PAPEIS_ATENDIMENTO as readonly string[]).includes(role);
}

// Gestor do departamento gravado no snapshot da solicitação (Consultor.depexe do solicitante
// na criação) — trocar o gestor no Senior muda o aprovador sozinho, sem migrar dado.
export function ehGestorDoSnapshot(ctx: ContextoViagem, v: ViagemPermissao): boolean {
  return v.aprovacaoDepexe != null && ctx.contexto.departamentosGerenciados.includes(v.aprovacaoDepexe);
}

export function ehSolicitante(ctx: ContextoViagem, v: ViagemPermissao): boolean {
  return v.solicitanteId != null && v.solicitanteId === ctx.userId;
}

export function podeVerViagem(ctx: ContextoViagem, v: ViagemPermissao): boolean {
  return ehSolicitante(ctx, v) || ehAtendimento(ctx.role) || ehGestorDoSnapshot(ctx, v);
}

export function podeAtenderViagem(ctx: ContextoViagem): boolean {
  return ehAtendimento(ctx.role);
}

// Admin sempre; o gestor do snapshot desde que não seja o próprio pedido. Sem gestor
// cadastrado no departamento, só o admin decide (fallback).
export function podeAprovarViagem(ctx: ContextoViagem, v: ViagemPermissao): boolean {
  if (ctx.role === "admin") return true;
  return ehGestorDoSnapshot(ctx, v) && !ehSolicitante(ctx, v);
}

// Só o admin CPF completo + atendimento + o próprio solicitante; gestor vê mascarado.
export function podeVerCpfCompleto(ctx: ContextoViagem, v: ViagemPermissao): boolean {
  return ehSolicitante(ctx, v) || ehAtendimento(ctx.role);
}

// Departamento cujo gestor aprova: o do consultor vinculado ao usuário (por vínculo
// explícito, senão pelo e-mail — o mesmo casamento que resolverContextoConsultor usa).
export async function resolverAprovador(userId: number): Promise<{ codemp: number; depexe: number } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, consultorCodemp: true, consultorCodusu: true } });
  if (!user) return null;
  const consultor =
    user.consultorCodemp != null && user.consultorCodusu != null
      ? await prisma.consultor.findUnique({ where: { codemp_codusu: { codemp: user.consultorCodemp, codusu: user.consultorCodusu } } })
      : await prisma.consultor.findFirst({ where: { email: { equals: user.email, mode: "insensitive" } } });
  if (!consultor || consultor.depexe == null) return null;
  return { codemp: consultor.codemp, depexe: consultor.depexe };
}

// ---------- Transições de status ----------

export const TRANSICOES: Record<string, readonly StatusViagem[]> = {
  assumir: ["solicitada"],
  enviar_aprovacao: ["em_cotacao"],
  decidir: ["aguardando_aprovacao"],
  reservar: ["aprovada"],
  finalizar: ["reservada"],
};

export function podeTransicionar(acao: keyof typeof TRANSICOES, status: string): boolean {
  return (TRANSICOES[acao] as readonly string[]).includes(status);
}

// ---------- Validação de payload ----------

export interface ViajanteEntrada {
  userId?: number | null;
  nome: string;
  cpf: string;
}

export interface ItemEntrada {
  tipo: TipoItem;
  viajantes: number[]; // índices em `viajantes`
  cidade?: string | null;
  origem?: string | null;
  destino?: string | null;
  dataInicio?: string | null;
  dataFim?: string | null;
  horaInicio?: string | null;
  horaFim?: string | null;
  tipoAcomodacao?: string | null;
  hotelPreferencia?: string | null;
  necessidades?: string | null;
  flexibilidadeHorario?: string | null;
  bagagem?: string | null;
  companhiaPreferencia?: string | null;
  localRetirada?: string | null;
  localDevolucao?: string | null;
  categoriaVeiculo?: string | null;
  observacoes?: string | null;
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function ehDataIso(v: unknown): v is string {
  return typeof v === "string" && RE_DATA.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && Number(v.slice(0, 4)) >= 2000;
}

const preenchido = (v: unknown) => typeof v === "string" && v.trim().length > 0;

// Devolve a primeira mensagem de erro, ou null se o item está coerente com o tipo.
export function validarItem(item: ItemEntrada, nViajantes: number, indice: number): string | null {
  const rot = `Item ${indice + 1}`;
  if (!(TIPOS_ITEM as readonly string[]).includes(item.tipo)) return `${rot}: tipo inválido`;
  if (!Array.isArray(item.viajantes) || item.viajantes.length === 0) return `${rot}: informe ao menos um viajante`;
  if (item.viajantes.some((i) => !Number.isInteger(i) || i < 0 || i >= nViajantes)) return `${rot}: viajante inválido`;
  if (new Set(item.viajantes).size !== item.viajantes.length) return `${rot}: viajante repetido`;
  if (item.dataInicio != null && item.dataInicio !== "" && !ehDataIso(item.dataInicio)) return `${rot}: data inicial inválida`;
  if (item.dataFim != null && item.dataFim !== "" && !ehDataIso(item.dataFim)) return `${rot}: data final inválida`;
  if (item.dataInicio && item.dataFim && item.dataFim < item.dataInicio) return `${rot}: a data final é anterior à inicial`;
  for (const h of [item.horaInicio, item.horaFim]) {
    if (h && !RE_HORA.test(h)) return `${rot}: horário inválido (use HH:MM)`;
  }

  if (item.tipo === "hospedagem") {
    if (!preenchido(item.cidade)) return `${rot}: informe a cidade da hospedagem`;
    if (!item.dataInicio || !item.dataFim) return `${rot}: informe check-in e check-out`;
    if (item.tipoAcomodacao && !["individual", "compartilhado"].includes(item.tipoAcomodacao)) return `${rot}: tipo de acomodação inválido`;
  } else if (item.tipo === "aereo") {
    if (!preenchido(item.origem) || !preenchido(item.destino)) return `${rot}: informe origem e destino`;
    if (!item.dataInicio) return `${rot}: informe a data de ida`;
    if (item.viajantes.length < 1) return `${rot}: informe ao menos um passageiro`;
  } else {
    if (item.viajantes.length !== 1) return `${rot}: o carro tem um único responsável pela reserva`;
    if (!preenchido(item.localRetirada) || !preenchido(item.localDevolucao)) return `${rot}: informe retirada e devolução`;
    if (!item.dataInicio || !item.dataFim) return `${rot}: informe as datas de retirada e devolução`;
  }
  return null;
}

// Vínculo por finalidade: projeto → proposta obrigatória (o cliente vem dela); comercial →
// cliente obrigatório, proposta opcional; demais → tudo opcional. Devolve os valores
// normalizados a gravar, ou `erro`.
export async function resolverVinculo(
  finalidade: Finalidade,
  entrada: { codcli?: unknown; codemp?: unknown; codpro?: unknown }
): Promise<{ codcli: number | null; codemp: number | null; codpro: number | null; erro?: string }> {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const codcli = num(entrada.codcli);
  const codemp = num(entrada.codemp);
  const codpro = num(entrada.codpro);
  const vazio = { codcli: null, codemp: null, codpro: null };

  if ([codcli, codemp, codpro].some((v) => v !== null && !Number.isFinite(v))) return { ...vazio, erro: "Cliente/proposta inválidos" };
  if ((codemp === null) !== (codpro === null)) return { ...vazio, erro: "Informe empresa e proposta juntas" };

  if (codemp !== null && codpro !== null) {
    const proposta = await prisma.proposta.findUnique({ where: { codemp_codpro: { codemp, codpro } }, select: { codcli: true } });
    if (!proposta) return { ...vazio, erro: "Proposta não encontrada" };
    return { codcli: proposta.codcli, codemp, codpro };
  }

  if (finalidade === "projeto") return { ...vazio, erro: "Para viagem de projeto, informe a proposta" };
  if (codcli !== null) {
    const cliente = await prisma.cliente.findUnique({ where: { codcli }, select: { codcli: true } });
    if (!cliente) return { ...vazio, erro: "Cliente não encontrado" };
    return { codcli, codemp: null, codpro: null };
  }
  if (finalidade === "comercial") return { ...vazio, erro: "Para visita comercial, informe o cliente" };
  return { ...vazio };
}
