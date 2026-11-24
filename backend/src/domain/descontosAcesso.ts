import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { codforsDoTime, consultoresFiltraveis, resolverContextoConsultor, type ConsultorFiltravel } from "./contextoProjeto";

// Quem pode o quê na Gestão de Descontos (05/11/2026, decisão do Vitor):
//   - admin e administrativo ADMINISTRAM: tipos, lançamentos, cancelar, estornar, quitar, fechamento; veem todos os consultores;
//   - gestor de área (gerencia um departamento) só VISUALIZA os consultores do seu time;
//   - consultor vê só os próprios descontos.
// Não existe papel "financeiro" no CaxHub: quem administra é o par admin + administrativo.

export const PAPEIS_QUE_ADMINISTRAM_DESCONTOS: readonly string[] = ["admin", "administrativo"];

export function podeAdministrarDescontos(role: string): boolean {
  return PAPEIS_QUE_ADMINISTRAM_DESCONTOS.includes(role);
}

export interface EscopoDescontos {
  userId: number;
  role: string;
  administra: boolean;
  /** Consultores (codfor) que a pessoa pode ver; `null` = todos. */
  codfors: Set<number> | null;
  /** O consultor da própria pessoa, se ela for um. */
  proprio: { codemp: number; codfor: number } | null;
  /** Gerencia algum departamento (vê o time). */
  ehGestor: boolean;
  /** Lista que a pessoa pode escolher no filtro/seletor (nome por codfor). */
  consultores: () => Promise<ConsultorFiltravel[]>;
}

export async function escopoDoUsuario(userId: number, role: string): Promise<EscopoDescontos | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  const administra = podeAdministrarDescontos(role);
  const proprio =
    contexto.consultor?.codfor != null ? { codemp: contexto.consultor.codemp, codfor: contexto.consultor.codfor } : null;

  let codfors: Set<number> | null;
  if (administra) {
    codfors = null;
  } else {
    // role "admin" devolveria null (todos) em codforsDoTime; aqui quem chega é gestor/consultor, então vem time + ele mesmo.
    codfors = await codforsDoTime(role, contexto);
  }

  return {
    userId,
    role,
    administra,
    codfors,
    proprio,
    ehGestor: contexto.departamentosGerenciados.length > 0,
    // Quem administra escolhe qualquer consultor habilitado (consultoresFiltraveis só dá "todos" para o papel admin: o administrativo usa o mesmo).
    consultores: () => consultoresFiltraveis(administra ? "admin" : role, contexto),
  };
}

export function podeVerConsultor(escopo: EscopoDescontos, codfor: number): boolean {
  return escopo.codfors == null || escopo.codfors.has(codfor);
}

/** Condição SQL sobre a coluna `codfor` (expressão já qualificada) que aplica o escopo; sem acesso nenhum, nada passa. */
export function escopoSql(escopo: EscopoDescontos, colunaCodfor: Prisma.Sql): Prisma.Sql {
  if (escopo.codfors == null) return Prisma.sql`TRUE`;
  if (escopo.codfors.size === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${colunaCodfor} = ANY(${[...escopo.codfors]}::int[])`;
}
