import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { FiltroRh, GRUPO_MINIMO } from "./filtros";

// Peças compartilhadas pelas consultas de RH. Tudo aqui lê do espelho local (hcm_*): nenhuma tela
// do RH consulta o Senior ao vivo.

export function consulta<T>(sql: Prisma.Sql): Promise<T[]> {
  return prisma.$queryRaw<T[]>(sql);
}

/** Colaborador `alias` estava ativo em `data` (AAAA-MM-DD): já admitido e, se desligado, desligado
 * depois. Afastado (férias, licença, auxílio) conta como ativo, como no quadro do Senior. */
export function ativoEm(alias: string, data: string): Prisma.Sql {
  const a = Prisma.raw(alias);
  return Prisma.sql`(${a}.datadm <= ${data}::date AND (${a}.sitafa <> 7 OR ${a}.datafa > ${data}::date))`;
}

/** Série de inícios de mês entre `de` e `ate`, como tabela `m(mes date)`. */
export function mesesDoPeriodo(f: FiltroRh): Prisma.Sql {
  return Prisma.sql`generate_series(date_trunc('month', ${f.de}::date), date_trunc('month', ${f.ate}::date), interval '1 month') AS ms(mes)`;
}

/** Último dia do mês `mes`, limitado ao fim do período (o mês corrente fecha em `ate`). */
export function fimDoMes(coluna: string, f: FiltroRh): Prisma.Sql {
  return Prisma.sql`LEAST((${Prisma.raw(coluna)}::date + interval '1 month' - interval '1 day')::date, ${f.ate}::date)`;
}

/** Início do mês, limitado ao começo do período (o primeiro mês pode abrir no meio). */
export function inicioDoMes(coluna: string, f: FiltroRh): Prisma.Sql {
  return Prisma.sql`GREATEST(${Prisma.raw(coluna)}::date, ${f.de}::date)`;
}

export interface Grupo {
  rotulo: string;
  qtd: number;
  [campo: string]: string | number | null;
}

/** Supressão de grupos pequenos para quem não vê o individual (papel só-agregado): grupos com menos de
 * GRUPO_MINIMO pessoas viram uma linha "Demais" só com a quantidade; os valores deles somem. */
export function suprimir<T extends Grupo>(linhas: T[], individual: boolean, campoValores: string[] = []): Grupo[] {
  if (individual) return linhas;
  const grandes = linhas.filter((l) => l.qtd >= GRUPO_MINIMO);
  const pequenos = linhas.filter((l) => l.qtd < GRUPO_MINIMO);
  const soma = pequenos.reduce((acc, l) => acc + l.qtd, 0);
  const resultado: Grupo[] = [...grandes];
  if (soma >= GRUPO_MINIMO) {
    const demais: Grupo = { rotulo: `Demais (grupos com menos de ${GRUPO_MINIMO})`, qtd: soma };
    for (const c of campoValores) demais[c] = null;
    resultado.push(demais);
  }
  return resultado;
}

/** Nome do colaborador para exibição: o papel rh vê o nome; os outros, nada. */
export function nomeVisivel(nome: string | null, individual: boolean): string | null {
  return individual ? nome : null;
}

export const num = (v: unknown): number => (v == null ? 0 : Number(v));

export function pct(parte: number, total: number, casas = 1): number | null {
  if (!total) return null;
  return Math.round((parte / total) * 100 * 10 ** casas) / 10 ** casas;
}

export function horas(minutos: number | null): number {
  return Math.round(((minutos ?? 0) / 60) * 10) / 10;
}

export const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-03" -> "mar/26" */
export function rotuloMes(aaaaMm: string): string {
  const [a, m] = aaaaMm.split("-");
  return `${MESES_ABREV[Number(m) - 1]}/${a.slice(2)}`;
}
