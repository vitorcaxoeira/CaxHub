import type { Consultor } from "@prisma/client";
import { prisma } from "../db/prisma";
import { type ContextoConsultor, codforsDoTime, gerenciaDepartamento, resolverContextoConsultor } from "./contextoProjeto";

// Quem pode ver e mexer no calendário de trabalho e nas férias de um consultor (13/11/2026). Mesma fonte de "meu time" do resto do módulo de projetos
// (domain/contextoProjeto.ts): o consultor vê e mexe no PRÓPRIO calendário; o gestor do departamento (e o admin) no de quem é do time dele.
// Férias (o direito e os gozos) só gestor e admin lançam; o consultor visualiza as dele.

export interface ContextoDoUsuario {
  userId: number;
  role: string;
  contexto: ContextoConsultor;
}

export async function contextoDoUsuario(userId: number, role: string): Promise<ContextoDoUsuario | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return { userId, role, contexto: await resolverContextoConsultor(user.email) };
}

export function ehOProprio(ctx: ContextoDoUsuario, alvo: { codemp: number; codfor: number | null }): boolean {
  return ctx.contexto.consultor?.codemp === alvo.codemp && ctx.contexto.consultor?.codfor === alvo.codfor;
}

/** Admin, ou gestor do departamento do consultor. Consultor sem departamento só o admin alcança. */
export function podeGerir(ctx: ContextoDoUsuario, alvo: { depexe: number | null }): boolean {
  return alvo.depexe != null ? gerenciaDepartamento(ctx.role, ctx.contexto, alvo.depexe) : ctx.role === "admin";
}

/** Mexe no calendário do consultor (folgas): ele mesmo, o gestor do departamento dele ou o admin. */
export function podeMexerNoCalendario(ctx: ContextoDoUsuario, alvo: { codemp: number; codfor: number | null; depexe: number | null }): boolean {
  return ehOProprio(ctx, alvo) || podeGerir(ctx, alvo);
}

/** Lança férias (período aquisitivo e gozo): admin, ou gestor do departamento — nunca o próprio consultor sem ser admin (não libera as próprias férias). */
export function podeLancarFerias(ctx: ContextoDoUsuario, alvo: { codemp: number; codfor: number | null; depexe: number | null }): boolean {
  if (ctx.role === "admin") return true;
  return podeGerir(ctx, alvo) && !ehOProprio(ctx, alvo);
}

/**
 * O consultor cujo calendário/férias a requisição quer: sem `codfor` (ou o próprio), o do usuário logado; outro codfor só se estiver no time que o usuário
 * gerencia (admin alcança todos). `alvo` nulo = o usuário não tem registro de consultor.
 */
export async function resolverAlvo(ctx: ContextoDoUsuario, codforPedido: number | null): Promise<{ alvo: Consultor | null } | { negado: true }> {
  if (codforPedido == null || !Number.isFinite(codforPedido) || codforPedido === ctx.contexto.consultor?.codfor) {
    return { alvo: ctx.contexto.consultor };
  }
  const permitidos = await codforsDoTime(ctx.role, ctx.contexto);
  if (permitidos != null && !permitidos.has(codforPedido)) return { negado: true };
  return { alvo: await prisma.consultor.findFirst({ where: { codfor: codforPedido } }) };
}
