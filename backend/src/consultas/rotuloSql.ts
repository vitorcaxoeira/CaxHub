import { Prisma } from "@prisma/client";

/**
 * CASE de rótulo em SQL a partir de um mapa código → texto (os mesmos mapas de domain/*Dominio.ts), para a lista filtrar e ordenar pelo
 * rótulo no servidor (funil por coluna). Código fora do mapa vira `<prefixo> <código>`; nulo vira `nulo`.
 */
export function rotuloSql(expr: Prisma.Sql, mapa: Record<number, string>, prefixo: string, nulo: string | null = "—"): Prisma.Sql {
  const quando = Object.entries(mapa).map(([k, v]) => Prisma.sql`WHEN ${expr} = ${Number(k)} THEN ${v}`);
  return Prisma.sql`(CASE WHEN ${expr} IS NULL THEN ${nulo}::text ${Prisma.join(quando, " ")} ELSE ${prefixo + " "} || ${expr}::text END)`;
}
