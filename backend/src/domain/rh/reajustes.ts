import { Prisma } from "@prisma/client";
import { consulta, nomeVisivel, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh, GRUPO_MINIMO } from "./filtros";

// Reajustes salariais a partir do histórico salarial (R038HSA). Cada linha é uma alteração; o
// percentual compara o salário da linha com o da linha ANTERIOR do mesmo colaborador. A primeira
// linha de cada pessoa é a admissão (não há "antes"), e por isso fica de fora: tratá-la como
// reajuste de 0 para o salário inicial produz percentuais de centenas por cento.
//
// Só entram alterações com salário anterior e atual positivos. "Aumento" = percentual > 0.

const ALTERACOES = (cond: Prisma.Sql, f: FiltroRh) => Prisma.sql`
  WITH h AS (
    SELECT hs.numemp, hs.tipcol, hs.numcad, hs.datalt, hs.seqalt, hs.codmot, hs.valsal,
           lag(hs.valsal) OVER (PARTITION BY hs.numemp, hs.tipcol, hs.numcad ORDER BY hs.datalt, hs.seqalt) AS ant
    FROM hcm_historico_salarial hs
  ), a AS (
    SELECT h.*, c.codccu, c.estcar, c.codcar, c.nomfun, c.sitafa,
           round(((h.valsal / h.ant - 1) * 100)::numeric, 2)::float8 AS pct
    FROM h JOIN hcm_colaboradores c ON c.numemp = h.numemp AND c.tipcol = h.tipcol AND c.numcad = h.numcad
    WHERE ${cond} AND h.ant > 0 AND h.valsal > 0
      AND h.datalt BETWEEN ${f.de}::date AND ${f.ate}::date
  )`;

export async function reajustes(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const cte = ALTERACOES(cond, f);

  const [k] = await consulta<{ alteracoes: number; aumentos: number; reducoes: number; mediana: number | null; media: number | null; maior: number | null }>(Prisma.sql`
    ${cte}
    SELECT count(*)::int AS alteracoes,
           count(*) FILTER (WHERE pct > 0)::int AS aumentos,
           count(*) FILTER (WHERE pct < 0)::int AS reducoes,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pct) FILTER (WHERE pct > 0))::numeric, 2)::float8 AS mediana,
           round((avg(pct) FILTER (WHERE pct > 0))::numeric, 2)::float8 AS media,
           max(pct)::float8 AS maior
    FROM a`);

  const porMotivo = await consulta<{ rotulo: string | null; qtd: number; mediana: number | null; media: number | null }>(Prisma.sql`
    ${cte}
    SELECT COALESCE(m.nommot, 'Motivo ' || a.codmot) AS rotulo, count(*) FILTER (WHERE a.pct <> 0)::int AS qtd,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY a.pct) FILTER (WHERE a.pct > 0))::numeric, 2)::float8 AS mediana,
           round((avg(a.pct) FILTER (WHERE a.pct > 0))::numeric, 2)::float8 AS media
    FROM a LEFT JOIN hcm_motivos_alteracao m ON m.codmot = a.codmot
    GROUP BY 1 HAVING count(*) FILTER (WHERE a.pct <> 0) > 0 ORDER BY 2 DESC`);

  const evolucao = await consulta<{ mes: string; aumentos: number; mediana: number | null; media: number | null }>(Prisma.sql`
    ${cte}
    SELECT to_char(date_trunc('month', datalt), 'YYYY-MM') AS mes, count(*) FILTER (WHERE pct > 0)::int AS aumentos,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pct) FILTER (WHERE pct > 0))::numeric, 2)::float8 AS mediana,
           round((avg(pct) FILTER (WHERE pct > 0))::numeric, 2)::float8 AS media
    FROM a GROUP BY 1 ORDER BY 1`);

  const distribuicao = await consulta<{ faixa: string; qtd: number }>(Prisma.sql`
    ${cte}
    SELECT CASE WHEN pct < 0 THEN '0 Redução' WHEN pct = 0 THEN '1 Sem variação' WHEN pct < 3 THEN '2 Até 3%'
                WHEN pct < 5 THEN '3 3% a 5%' WHEN pct < 8 THEN '4 5% a 8%' WHEN pct < 12 THEN '5 8% a 12%'
                WHEN pct < 20 THEN '6 12% a 20%' ELSE '7 Acima de 20%' END AS faixa, count(*)::int AS qtd
    FROM a GROUP BY 1 ORDER BY 1`);

  const dimensao = (expr: string, join: string) =>
    consulta<{ rotulo: string | null; qtd: number; mediana: number | null }>(Prisma.sql`
      ${cte}
      SELECT ${Prisma.raw(expr)} AS rotulo, count(*) FILTER (WHERE a.pct > 0)::int AS qtd,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY a.pct) FILTER (WHERE a.pct > 0))::numeric, 2)::float8 AS mediana
      FROM a ${Prisma.raw(join)}
      GROUP BY 1 HAVING count(*) FILTER (WHERE a.pct > 0) > 0 ORDER BY 2 DESC, 1 LIMIT 20`);
  const [porCentroCusto, porCargo] = await Promise.all([
    dimensao("COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(a.codccu), ''), 'Sem centro de custo')", "LEFT JOIN hcm_centros_custo cc ON cc.numemp = a.numemp AND cc.codccu = a.codccu"),
    dimensao("COALESCE(NULLIF(btrim(ca.titred), ''), NULLIF(btrim(a.codcar), ''), 'Sem cargo')", "LEFT JOIN hcm_cargos ca ON ca.estcar = a.estcar AND ca.codcar = a.codcar"),
  ]);

  // Quem está há mais tempo sem aumento (ativos hoje, último aumento > 0%): fila de revisão salarial.
  const semAumento = await consulta<{ faixa: string; qtd: number }>(Prisma.sql`
    WITH h AS (
      SELECT hs.numemp, hs.tipcol, hs.numcad, hs.datalt, hs.valsal,
             lag(hs.valsal) OVER (PARTITION BY hs.numemp, hs.tipcol, hs.numcad ORDER BY hs.datalt, hs.seqalt) AS ant
      FROM hcm_historico_salarial hs
    ), ultimo AS (
      SELECT numemp, tipcol, numcad, max(datalt) AS ultimo FROM h WHERE ant > 0 AND valsal > ant GROUP BY 1, 2, 3
    )
    SELECT CASE WHEN u.ultimo IS NULL THEN '5 Nunca reajustado'
                WHEN ${f.ate}::date - u.ultimo < 180 THEN '1 Menos de 6 meses'
                WHEN ${f.ate}::date - u.ultimo < 365 THEN '2 6 a 12 meses'
                WHEN ${f.ate}::date - u.ultimo < 730 THEN '3 1 a 2 anos'
                ELSE '4 Mais de 2 anos' END AS faixa, count(*)::int AS qtd
    FROM hcm_colaboradores c LEFT JOIN ultimo u ON u.numemp = c.numemp AND u.tipcol = c.tipcol AND u.numcad = c.numcad
    WHERE ${cond} AND c.sitafa <> 7 AND c.tipcol = 1 AND c.datadm <= ${f.ate}::date
    GROUP BY 1 ORDER BY 1`);

  const maiores = individual
    ? await consulta<{ nome: string; datalt: Date; motivo: string | null; pct: number; salario: number }>(Prisma.sql`
        ${cte}
        SELECT a.nomfun AS nome, a.datalt, m.nommot AS motivo, a.pct, a.valsal::float8 AS salario
        FROM a LEFT JOIN hcm_motivos_alteracao m ON m.codmot = a.codmot
        WHERE a.pct > 0 ORDER BY a.pct DESC, a.datalt DESC LIMIT 15`)
    : null;

  const limpa = (g: { rotulo: string | null; qtd: number; mediana?: number | null; media?: number | null }[]) =>
    suprimir(g.map((x) => ({ rotulo: x.rotulo ?? "Não informado", qtd: x.qtd, mediana: x.mediana ?? null, media: x.media ?? null })), individual, ["mediana", "media"]);

  return {
    periodo: { de: f.de, ate: f.ate },
    kpis: {
      alteracoes: k.alteracoes,
      aumentos: k.aumentos,
      reducoes: k.reducoes,
      medianaAumento: !individual && k.aumentos < GRUPO_MINIMO ? null : k.mediana,
      mediaAumento: !individual && k.aumentos < GRUPO_MINIMO ? null : k.media,
      maiorAumento: individual ? k.maior : null,
    },
    porMotivo: limpa(porMotivo),
    // Mês com 1 ou 2 aumentos: a mediana/média seria o reajuste de uma pessoa (só o papel rh vê).
    evolucao: evolucao.map((e) => {
      const esconder = !individual && e.aumentos < GRUPO_MINIMO;
      return { mes: e.mes, rotulo: rotuloMes(e.mes), aumentos: e.aumentos, mediana: esconder ? null : e.mediana, media: esconder ? null : e.media };
    }),
    distribuicao: distribuicao.map((d) => ({ rotulo: d.faixa.replace(/^\d /, ""), qtd: d.qtd })),
    porCentroCusto: limpa(porCentroCusto),
    porCargo: limpa(porCargo),
    // Todas as faixas aparecem, inclusive as vazias: uma faixa que some do gráfico parece defeito.
    tempoSemAumento: ["1 Menos de 6 meses", "2 6 a 12 meses", "3 1 a 2 anos", "4 Mais de 2 anos", "5 Nunca reajustado"].map((faixa) => ({
      rotulo: faixa.replace(/^\d /, ""),
      qtd: semAumento.find((x) => x.faixa === faixa)?.qtd ?? 0,
    })),
    maioresAumentos: maiores?.map((m) => ({ nome: nomeVisivel(m.nome, true), data: m.datalt, motivo: m.motivo, percentual: m.pct, salario: m.salario })) ?? null,
    definicoes: {
      percentual: "Salário da alteração ÷ salário da alteração anterior do mesmo colaborador − 1. A admissão (primeira linha) não conta.",
      mediana: "Mediana só dos aumentos (percentual > 0): não é puxada por um caso isolado.",
      semAumento: "Empregados ativos, por tempo desde o último aumento de salário.",
    },
  };
}
