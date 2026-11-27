import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { areaDoChamadoSql, filtroBancoDoMesSql, filtroKyriaNoMesSql, filtroPontoTrabalhadoSql } from "./bonificacaoHoras";

// Comprovação das células de Horas Kyria x Trabalhadas: os lançamentos que formam as horas trabalhadas, o saldo do banco de horas e as horas
// do Kyria de um atendente no mês. Os filtros são os MESMOS fragmentos que o relatório e a apuração usam (domain/bonificacaoHoras.ts), então
// a soma das linhas daqui é o número clicado na tela.

export const TIPOS_COMPROVANTE = ["ponto", "banco", "kyria"] as const;
export type TipoComprovante = (typeof TIPOS_COMPROVANTE)[number];
export const eTipoComprovante = (v: unknown): v is TipoComprovante => TIPOS_COMPROVANTE.includes(v as TipoComprovante);

export interface ColaboradorHcm {
  numemp: number;
  tipcol: number;
  numcad: number;
}

export interface LinhaPonto {
  data: string;
  codsit: number;
  situacao: string | null;
  minutos: number;
}

export interface LinhaBanco {
  data: string;
  banco: number;
  codsit: number;
  situacao: string | null;
  origem: string | null;
  /** Minutos com sinal: crédito positivo, débito negativo. */
  minutos: number;
  /** Soma dos movimentos do mês até esta linha (sem o saldo anterior), na ordem cronológica. */
  acumulado: number;
}

export interface LinhaKyria {
  id: string;
  inicio: string;
  fim: string | null;
  minutos: number;
  chamado: string | null;
  titulo: string;
  time: string;
  area: string;
  origem: string;
  motivo: string | null;
}

/** Dias do ponto que somam nas horas trabalhadas (uma linha por dia e situação: o rateio não interessa aqui). */
export function linhasDoPonto(c: ColaboradorHcm, ini: string, fim: string): Promise<LinhaPonto[]> {
  return prisma.$queryRaw<LinhaPonto[]>`
    SELECT to_char(sp.datapu, 'YYYY-MM-DD') AS data, sp.codsit, btrim(st.dessit) AS situacao, sum(sp.qtdhor)::float8 AS minutos
    FROM hcm_situacao_ponto sp JOIN hcm_situacoes st ON st.codsit = sp.codsit
    WHERE ${filtroPontoTrabalhadoSql(c.numemp, c.tipcol, c.numcad, ini, fim)}
    GROUP BY sp.datapu, sp.codsit, st.dessit
    ORDER BY sp.datapu, sp.codsit`;
}

/** Lançamentos do banco de horas datados no mês, com o acumulado dos movimentos. */
export async function linhasDoBanco(c: ColaboradorHcm, ini: string, fim: string): Promise<LinhaBanco[]> {
  const linhas = await prisma.$queryRaw<Omit<LinhaBanco, "acumulado">[]>`
    SELECT to_char(bh.datlan, 'YYYY-MM-DD') AS data, bh.codbhr AS banco, bh.codsit, btrim(st.dessit) AS situacao, btrim(bh.orilan) AS origem,
           (CASE btrim(bh.sinlan) WHEN '+' THEN bh.qtdhor WHEN '-' THEN -bh.qtdhor ELSE 0 END)::float8 AS minutos
    FROM hcm_lancamentos_bh bh LEFT JOIN hcm_situacoes st ON st.codsit = bh.codsit
    WHERE ${filtroBancoDoMesSql(c.numemp, c.tipcol, c.numcad, ini, fim)}
    ORDER BY bh.datlan, bh.codbhr, bh.codsit, bh.orilan`;
  return comAcumulado(linhas);
}

export function comAcumulado<T extends { minutos: number | null }>(linhas: T[]): (T & { minutos: number; acumulado: number })[] {
  let acumulado = 0;
  return linhas.map((l) => {
    const minutos = l.minutos ?? 0;
    acumulado += minutos;
    return { ...l, minutos, acumulado };
  });
}

/** Resumo do banco no mês: créditos, débitos (positivo), saldo e o que entrou como extra. */
export function resumoDoBanco(linhas: { minutos: number }[]) {
  const creditos = linhas.reduce((s, l) => s + Math.max(l.minutos, 0), 0);
  const debitos = linhas.reduce((s, l) => s + Math.max(-l.minutos, 0), 0);
  const saldo = creditos - debitos;
  return { creditos, debitos, saldo, extras: Math.max(saldo, 0) };
}

/** Apontamentos do Kyria do mês (dias de Brasília) de todos os membros ligados ao usuário, com o chamado, o time e a área dele. */
export async function linhasDoKyria(codusu: number, ini: string, fim: string): Promise<LinhaKyria[]> {
  const linhas = await prisma.$queryRaw<(Omit<LinhaKyria, "inicio" | "fim"> & { inicio: Date; fim: Date | null })[]>`
    SELECT en.id, en.started_at AS inicio, en.ended_at AS fim, en.minutes::float8 AS minutos, t.code AS chamado, t.title AS titulo,
           COALESCE(kt.name, '(sem time)') AS time, COALESCE(ar.area, '(sem área)') AS area, en.origem::text AS origem, en.reason AS motivo
    FROM kyria_members m
    JOIN kyria_time_entries en ON en.user_id = m.id AND ${filtroKyriaNoMesSql(ini, fim)}
    JOIN kyria_tickets t ON t.id = en.ticket_id
    LEFT JOIN kyria_teams kt ON kt.id = t.team_id
    LEFT JOIN LATERAL (${areaDoChamadoSql(Prisma.sql`t.id`)}) ar ON TRUE
    WHERE m.codusu = ${codusu}
    ORDER BY en.started_at, en.id`;
  return linhas.map((l) => ({ ...l, inicio: l.inicio.toISOString(), fim: l.fim ? l.fim.toISOString() : null }));
}
