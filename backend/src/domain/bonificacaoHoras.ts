import { Prisma } from "@prisma/client";
import { percentualDe } from "./bonificacao";

// Horas do mês de um atendente (regra do Vitor em 27/11/2026), usada pela tela Horas Kyria x Trabalhadas e pelo indicador "% do ponto apontado":
//   saldo do banco no mês = créditos − débitos dos lançamentos do banco de horas (HCM, R011LAN) DATADOS no mês, sem o saldo anterior
//   extras                = o saldo, só quando positivo (negativo é mostrado, mas não entra no cálculo)
//   total do mês          = horas trabalhadas do ponto + extras
//   ocioso                = total do mês − horas apontadas no Kyria
//   %                     = horas do Kyria ÷ total do mês
// Lançamento apagado no Senior só fica de fora depois de marcado como removido (detecção de excluídos do job do HCM em "Marcar").
// Conferido com o relatório "Banco de Horas Analítico" do colaborador 62 em 10/2026: -02:53 (saldo final 02:28 - saldo inicial 05:21).

// Filtros de cada fonte, usados pelo relatório, pela apuração e pelo modal de comprovação (domain/bonificacaoComprovante.ts): o que é somado
// na tela e o que o modal lista vêm do mesmo lugar. Os parâmetros aceitam valor ou coluna (Prisma.sql).

/** Linhas do ponto que são horas trabalhadas no mês. Apelidos esperados: `sp` (hcm_situacao_ponto) e `st` (hcm_situacoes). */
export function filtroPontoTrabalhadoSql(numemp: unknown, tipcol: unknown, numcad: unknown, ini: string, fim: string): Prisma.Sql {
  return Prisma.sql`sp.numemp = ${numemp} AND sp.tipcol = ${tipcol} AND sp.numcad = ${numcad}
    AND st.conabs = 2 AND sp.removido_em_senior IS NULL AND sp.datapu >= ${ini}::date AND sp.datapu < ${fim}::date`;
}

/** Lançamentos do banco de horas datados no mês. Apelido esperado: `bh` (hcm_lancamentos_bh). */
export function filtroBancoDoMesSql(numemp: unknown, tipcol: unknown, numcad: unknown, ini: string, fim: string): Prisma.Sql {
  return Prisma.sql`bh.numemp = ${numemp} AND bh.tipcol = ${tipcol} AND bh.numcad = ${numcad} AND bh.removido_em_senior IS NULL
    AND bh.datlan >= ${ini}::date AND bh.datlan < ${fim}::date`;
}

/** Apontamentos do Kyria com duração, iniciados no mês (dias de Brasília). Apelido esperado: `en` (kyria_time_entries). */
export function filtroKyriaNoMesSql(ini: string, fim: string): Prisma.Sql {
  return Prisma.sql`en.minutes IS NOT NULL
    AND (en.started_at AT TIME ZONE 'America/Sao_Paulo') >= ${ini}::date AND (en.started_at AT TIME ZONE 'America/Sao_Paulo') < ${fim}::date`;
}

/** Subconsulta (coluna `area`) com a(s) etiqueta(s) do grupo de chave "area" do chamado; duas viram "A + B" (a hora não conta duas vezes). */
export function areaDoChamadoSql(ticketId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT string_agg(l.name, ' + ' ORDER BY l.name) AS area
    FROM kyria_ticket_labels tl
    JOIN kyria_labels l ON l.id = tl.label_id
    JOIN kyria_label_groups g ON g.id = l.group_id AND g.key = 'area'
    WHERE tl.ticket_id = ${ticketId}`;
}

/** Saldo (em minutos, com sinal) dos lançamentos do mês; nulo quando não há lançamento. */
export function saldoBancoDoMesSql(numemp: unknown, tipcol: unknown, numcad: unknown, ini: string, fim: string): Prisma.Sql {
  return Prisma.sql`
    SELECT sum(CASE btrim(bh.sinlan) WHEN '+' THEN bh.qtdhor WHEN '-' THEN -bh.qtdhor ELSE 0 END)::float8 AS minutos
    FROM hcm_lancamentos_bh bh
    WHERE ${filtroBancoDoMesSql(numemp, tipcol, numcad, ini, fim)}`;
}

export interface HorasDoMes {
  minutosExtras: number;
  minutosTotal: number;
  /** Negativo quando o Kyria tem mais horas que o total do mês. */
  minutosOcioso: number;
  percentual: number | null;
}

export function horasDoMes({ trabalhadas, saldoBanco, kyria }: { trabalhadas: number; saldoBanco: number | null; kyria: number }): HorasDoMes {
  const minutosExtras = Math.max(saldoBanco ?? 0, 0);
  const minutosTotal = trabalhadas + minutosExtras;
  return {
    minutosExtras,
    minutosTotal,
    minutosOcioso: Math.round((minutosTotal - kyria) * 100) / 100,
    percentual: percentualDe(kyria, minutosTotal),
  };
}
