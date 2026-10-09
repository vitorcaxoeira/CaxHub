import { Prisma } from "@prisma/client";
import { consulta, Grupo, nomeVisivel, num, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh, GRUPO_MINIMO } from "./filtros";
import { iniciativaDaCausa, ROTULO_INICIATIVA, TIPO_EVENTO_RESCISAO } from "./dominios";

// Rescisões do período (data de demissão em `de`..`ate`), a partir do cálculo de rescisão do Senior
// (R042RCM). Quem não tem cálculo de rescisão (terceiros, parceiros) não entra aqui, mas entra no
// Turnover, que conta pelo cadastro. Valores: proventos e descontos do próprio cálculo; "líquido" é a
// diferença entre os dois.

export async function rescisoes(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const base = Prisma.sql`
    FROM hcm_rescisoes r
    JOIN hcm_colaboradores c ON c.numemp = r.numemp AND c.tipcol = r.tipcol AND c.numcad = r.numcad
    WHERE ${cond} AND r.datdem BETWEEN ${f.de}::date AND ${f.ate}::date`;

  const [t] = await consulta<{ qtd: number; proventos: number; descontos: number; fgts: number; tempo_medio_dias: number | null; precoces: number }>(Prisma.sql`
    SELECT count(*)::int AS qtd,
           COALESCE(sum(r.totpro), 0)::float8 AS proventos,
           COALESCE(sum(r.totdes), 0)::float8 AS descontos,
           COALESCE(sum(r.sldfgt), 0)::float8 AS fgts,
           round(avg(r.datdem - c.datadm)::numeric, 0)::float8 AS tempo_medio_dias,
           count(*) FILTER (WHERE r.datdem - c.datadm < 90)::int AS precoces
    ${base}`);

  const causas = await consulta<{ caudem: number | null; causa: string | null; qtd: number; proventos: number }>(Prisma.sql`
    SELECT r.caudem, ca.desdem AS causa, count(*)::int AS qtd, COALESCE(sum(r.totpro), 0)::float8 AS proventos
    FROM hcm_rescisoes r
    JOIN hcm_colaboradores c ON c.numemp = r.numemp AND c.tipcol = r.tipcol AND c.numcad = r.numcad
    LEFT JOIN hcm_causas_demissao ca ON ca.caudem = r.caudem
    WHERE ${cond} AND r.datdem BETWEEN ${f.de}::date AND ${f.ate}::date
    GROUP BY 1, 2 ORDER BY 3 DESC`);

  const iniciativa = new Map<string, { qtd: number; proventos: number }>();
  for (const c of causas) {
    const rot = ROTULO_INICIATIVA[iniciativaDaCausa(c.caudem)];
    const atual = iniciativa.get(rot) ?? { qtd: 0, proventos: 0 };
    iniciativa.set(rot, { qtd: atual.qtd + c.qtd, proventos: atual.proventos + c.proventos });
  }

  // Eventos da rescisão por grupo (R042RCV.TclRcs). O sinal vem do tipo do evento: proventos somam,
  // descontos subtraem do "valor líquido do grupo"; aqui mostramos o valor absoluto de cada grupo.
  const eventos = await consulta<{ tclrcs: number; qtd: number; valor: number }>(Prisma.sql`
    SELECT v.tclrcs, count(DISTINCT (v.numemp, v.tipcol, v.numcad))::int AS qtd, COALESCE(sum(v.valeve), 0)::float8 AS valor
    FROM hcm_verbas_rescisao v
    JOIN hcm_rescisoes r ON r.numemp = v.numemp AND r.tipcol = v.tipcol AND r.numcad = v.numcad
    JOIN hcm_colaboradores c ON c.numemp = r.numemp AND c.tipcol = r.tipcol AND c.numcad = r.numcad
    WHERE ${cond} AND r.datdem BETWEEN ${f.de}::date AND ${f.ate}::date
    GROUP BY 1 ORDER BY 3 DESC`);
  const porGrupoEvento = new Map<string, { qtd: number; valor: number }>();
  for (const e of eventos) {
    const rot = TIPO_EVENTO_RESCISAO[e.tclrcs] ?? `Evento ${e.tclrcs}`;
    const atual = porGrupoEvento.get(rot) ?? { qtd: 0, valor: 0 };
    porGrupoEvento.set(rot, { qtd: Math.max(atual.qtd, e.qtd), valor: atual.valor + e.valor });
  }

  const evolucao = await consulta<{ mes: string; qtd: number; proventos: number; descontos: number; fgts: number }>(Prisma.sql`
    SELECT to_char(date_trunc('month', r.datdem), 'YYYY-MM') AS mes, count(*)::int AS qtd,
           COALESCE(sum(r.totpro), 0)::float8 AS proventos, COALESCE(sum(r.totdes), 0)::float8 AS descontos,
           COALESCE(sum(r.sldfgt), 0)::float8 AS fgts
    ${base} GROUP BY 1 ORDER BY 1`);

  const dimensao = async (expr: string, join: string) =>
    consulta<{ rotulo: string | null; qtd: number; proventos: number; descontos: number }>(Prisma.sql`
      SELECT ${Prisma.raw(expr)} AS rotulo, count(*)::int AS qtd,
             COALESCE(sum(r.totpro), 0)::float8 AS proventos, COALESCE(sum(r.totdes), 0)::float8 AS descontos
      FROM hcm_rescisoes r
      JOIN hcm_colaboradores c ON c.numemp = r.numemp AND c.tipcol = r.tipcol AND c.numcad = r.numcad
      ${Prisma.raw(join)}
      WHERE ${cond} AND r.datdem BETWEEN ${f.de}::date AND ${f.ate}::date
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 20`);

  const [porCentroCusto, porCargo, porPosto] = await Promise.all([
    dimensao("COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(c.codccu), ''), 'Sem centro de custo')", "LEFT JOIN hcm_centros_custo cc ON cc.numemp = c.numemp AND cc.codccu = c.codccu"),
    dimensao("COALESCE(NULLIF(btrim(ca.titred), ''), NULLIF(btrim(c.codcar), ''), 'Sem cargo')", "LEFT JOIN hcm_cargos ca ON ca.estcar = c.estcar AND ca.codcar = c.codcar"),
    dimensao("COALESCE(NULLIF(btrim(po.desred), ''), NULLIF(btrim(c.postra), ''), 'Sem posto')", "LEFT JOIN hcm_postos po ON po.estpos = c.estpos AND po.postra = c.postra"),
  ]);
  const grupo = (linhas: { rotulo: string | null; qtd: number; proventos: number; descontos: number }[]) =>
    suprimir(linhas.map((l) => ({ rotulo: l.rotulo ?? "Não informado", qtd: l.qtd, proventos: l.proventos, descontos: l.descontos })), individual, ["proventos", "descontos"]);

  // Lista nominal: só quem vê o individual.
  const lista = individual
    ? await consulta<{ nome: string; datadm: Date; datdem: Date; causa: string | null; proventos: number; descontos: number; fgts: number }>(Prisma.sql`
        SELECT c.nomfun AS nome, c.datadm, r.datdem, ca.desdem AS causa, COALESCE(r.totpro, 0)::float8 AS proventos,
               COALESCE(r.totdes, 0)::float8 AS descontos, COALESCE(r.sldfgt, 0)::float8 AS fgts
        FROM hcm_rescisoes r
        JOIN hcm_colaboradores c ON c.numemp = r.numemp AND c.tipcol = r.tipcol AND c.numcad = r.numcad
        LEFT JOIN hcm_causas_demissao ca ON ca.caudem = r.caudem
        WHERE ${cond} AND r.datdem BETWEEN ${f.de}::date AND ${f.ate}::date
        ORDER BY r.datdem DESC, c.nomfun LIMIT 100`)
    : null;

  const liquido = t.proventos - t.descontos;
  const semDados = t.qtd === 0;
  // Com menos de GRUPO_MINIMO rescisões no recorte, qualquer total é o valor de uma pessoa.
  const escondeValores = !individual && t.qtd > 0 && t.qtd < GRUPO_MINIMO;
  const v = (x: number): number | null => (escondeValores ? null : x);
  return {
    periodo: { de: f.de, ate: f.ate },
    kpis: {
      rescisoes: t.qtd,
      proventos: v(t.proventos),
      descontos: v(t.descontos),
      liquido: v(liquido),
      saldoFgts: v(t.fgts),
      custoMedioPorRescisao: semDados || escondeValores ? null : Math.round(t.proventos / t.qtd),
      tempoMedioDeCasaDias: t.tempo_medio_dias,
      desligamentosPrecoces: t.precoces,
      desligamentosPrecocesPct: semDados ? null : Math.round((t.precoces / t.qtd) * 1000) / 10,
    },
    causas: causas.map((c) => ({ rotulo: c.causa ?? "Não informada", qtd: c.qtd, proventos: !individual && c.qtd < GRUPO_MINIMO ? null : c.proventos })),
    iniciativa: [...iniciativa.entries()].map(([rotulo, g]) => ({ rotulo, qtd: g.qtd, proventos: !individual && g.qtd < GRUPO_MINIMO ? null : g.proventos })),
    eventos: escondeValores ? [] : [...porGrupoEvento.entries()].map(([rotulo, g]) => ({ rotulo, qtd: g.qtd, valor: g.valor })).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    evolucao: evolucao.map((e) => {
      const esconde = !individual && e.qtd < GRUPO_MINIMO;
      return { mes: e.mes, rotulo: rotuloMes(e.mes), qtd: e.qtd, proventos: esconde ? null : e.proventos, descontos: esconde ? null : e.descontos, saldoFgts: esconde ? null : e.fgts };
    }),
    porCentroCusto: grupo(porCentroCusto),
    porCargo: grupo(porCargo),
    porPosto: grupo(porPosto),
    lista: lista?.map((l) => ({ nome: nomeVisivel(l.nome, true), admissao: l.datadm, demissao: l.datdem, causa: l.causa, proventos: l.proventos, descontos: l.descontos, saldoFgts: l.fgts })) ?? null,
    definicoes: {
      proventos: "Total de proventos do cálculo de rescisão (R042RCM.TotPro).",
      descontos: "Total de descontos do cálculo de rescisão (R042RCM.TotDes).",
      precoce: "Desligamento com menos de 90 dias de casa.",
    },
  };
}
