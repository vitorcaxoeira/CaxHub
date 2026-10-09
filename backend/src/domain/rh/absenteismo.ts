import { Prisma } from "@prisma/client";
import { consulta, horas, nomeVisivel, pct, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh } from "./filtros";
import { TIPO_COLABORADOR } from "./dominios";

// Absenteísmo pelas situações do ponto (R066SIT, em minutos), classificadas pelo próprio Senior
// (R010SIT.ConAbs). Isso resolve o erro clássico de somar tudo que não é "Trabalhando":
//   ConAbs 2  horas trabalhadas
//   ConAbs 3  faltas não justificadas        } ausência
//   ConAbs 4  faltas justificadas            }
//   ConAbs 5  atestado médico                }
//   ConAbs 1  não considera (férias, licença maternidade, banco de horas, atrasos...)
// Índice de absenteísmo = ausência ÷ (trabalhadas + ausência). Férias e licenças ficam FORA do
// numerador e do denominador, e demitido não conta. Atrasos e saídas antecipadas (situações 101 a
// 106) não são absenteísmo no critério do Senior: aparecem à parte, como pontualidade.

const ATRASO = [103, 104];
const SAIDA_ANTECIPADA = [101, 102, 105, 106];
const DIAS_SEMANA = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function base(f: FiltroRh, cond: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    FROM hcm_situacao_ponto sp
    JOIN hcm_situacoes st ON st.codsit = sp.codsit
    JOIN hcm_colaboradores c ON c.numemp = sp.numemp AND c.tipcol = sp.tipcol AND c.numcad = sp.numcad
    WHERE ${cond} AND sp.datapu BETWEEN ${f.de}::date AND ${f.ate}::date`;
}

const TRABALHADAS = Prisma.sql`sum(sp.qtdhor) FILTER (WHERE st.conabs = 2)`;
const AUSENCIA = Prisma.sql`sum(sp.qtdhor) FILTER (WHERE st.conabs IN (3, 4, 5))`;

export async function absenteismo(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const b = base(f, cond);

  const [t] = await consulta<{ trab: number; naoJust: number; just: number; atestado: number; atraso: number; saida: number; colab: number }>(Prisma.sql`
    SELECT COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 2), 0)::float8 AS trab,
           COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 3), 0)::float8 AS "naoJust",
           COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 4), 0)::float8 AS just,
           COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 5), 0)::float8 AS atestado,
           COALESCE(sum(sp.qtdhor) FILTER (WHERE sp.codsit IN (${Prisma.join(ATRASO)})), 0)::float8 AS atraso,
           COALESCE(sum(sp.qtdhor) FILTER (WHERE sp.codsit IN (${Prisma.join(SAIDA_ANTECIPADA)})), 0)::float8 AS saida,
           count(DISTINCT (sp.numemp, sp.tipcol, sp.numcad))::int AS colab
    ${b}`);
  const ausencia = t.naoJust + t.just + t.atestado;
  const previstas = t.trab + ausencia;

  const mensal = await consulta<{ mes: string; trab: number; ausencia: number }>(Prisma.sql`
    SELECT to_char(date_trunc('month', sp.datapu), 'YYYY-MM') AS mes,
           COALESCE(${TRABALHADAS}, 0)::float8 AS trab, COALESCE(${AUSENCIA}, 0)::float8 AS ausencia
    ${b} GROUP BY 1 ORDER BY 1`);

  const porSituacao = await consulta<{ rotulo: string; conabs: number; minutos: number; dias: number }>(Prisma.sql`
    SELECT btrim(st.dessit) AS rotulo, st.conabs, sum(sp.qtdhor)::float8 AS minutos, count(*)::int AS dias
    ${b} AND (st.conabs IN (3, 4, 5) OR sp.codsit IN (${Prisma.join([...ATRASO, ...SAIDA_ANTECIPADA])}))
    GROUP BY 1, 2 ORDER BY 3 DESC`);

  const porDiaDaSemana = await consulta<{ dow: number; ausencia: number; trab: number }>(Prisma.sql`
    SELECT extract(isodow FROM sp.datapu)::int AS dow, COALESCE(${AUSENCIA}, 0)::float8 AS ausencia, COALESCE(${TRABALHADAS}, 0)::float8 AS trab
    ${b} GROUP BY 1 ORDER BY 1`);

  const porTipoColaborador = await consulta<{ tipcol: number; trab: number; ausencia: number; colab: number }>(Prisma.sql`
    SELECT sp.tipcol, COALESCE(${TRABALHADAS}, 0)::float8 AS trab, COALESCE(${AUSENCIA}, 0)::float8 AS ausencia,
           count(DISTINCT (sp.numemp, sp.tipcol, sp.numcad))::int AS colab
    ${b} GROUP BY 1 ORDER BY 1`);

  const dimensao = (expr: string, join: string) =>
    consulta<{ rotulo: string | null; qtd: number; trab: number; ausencia: number }>(Prisma.sql`
      SELECT ${Prisma.raw(expr)} AS rotulo, count(DISTINCT (sp.numemp, sp.tipcol, sp.numcad))::int AS qtd,
             COALESCE(${TRABALHADAS}, 0)::float8 AS trab, COALESCE(${AUSENCIA}, 0)::float8 AS ausencia
      FROM hcm_situacao_ponto sp
      JOIN hcm_situacoes st ON st.codsit = sp.codsit
      JOIN hcm_colaboradores c ON c.numemp = sp.numemp AND c.tipcol = sp.tipcol AND c.numcad = sp.numcad
      ${Prisma.raw(join)}
      WHERE ${cond} AND sp.datapu BETWEEN ${f.de}::date AND ${f.ate}::date
      GROUP BY 1 HAVING COALESCE(${AUSENCIA}, 0) + COALESCE(${TRABALHADAS}, 0) > 0
      ORDER BY 4 DESC LIMIT 20`);
  const [porCentroCusto, porCargo] = await Promise.all([
    dimensao("COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(c.codccu), ''), 'Sem centro de custo')", "LEFT JOIN hcm_centros_custo cc ON cc.numemp = c.numemp AND cc.codccu = c.codccu"),
    dimensao("COALESCE(NULLIF(btrim(ca.titred), ''), NULLIF(btrim(c.codcar), ''), 'Sem cargo')", "LEFT JOIN hcm_cargos ca ON ca.estcar = c.estcar AND ca.codcar = c.codcar"),
  ]);
  const grupo = (g: { rotulo: string | null; qtd: number; trab: number; ausencia: number }[]) =>
    suprimir(
      g.map((x) => ({ rotulo: x.rotulo ?? "Não informado", qtd: x.qtd, horasAusencia: horas(x.ausencia), indice: pct(x.ausencia, x.trab + x.ausencia, 1) })),
      individual,
      ["horasAusencia", "indice"]
    );

  const afastamentos = await consulta<{ rotulo: string | null; qtd: number; dias_medios: number | null; em_curso: number }>(Prisma.sql`
    SELECT COALESCE(btrim(s.dessit), a.sitafa::text) AS rotulo, count(*)::int AS qtd,
           round(avg(a.datter - a.datafa) FILTER (WHERE a.datter IS NOT NULL)::numeric, 1)::float8 AS dias_medios,
           count(*) FILTER (WHERE a.datter IS NULL)::int AS em_curso
    FROM hcm_afastamentos a
    JOIN hcm_colaboradores c ON c.numemp = a.numemp AND c.tipcol = a.tipcol AND c.numcad = a.numcad
    LEFT JOIN hcm_situacoes s ON s.codsit = a.sitafa
    WHERE ${cond} AND a.sitafa <> 7 AND a.datafa BETWEEN ${f.de}::date AND ${f.ate}::date
    GROUP BY 1 ORDER BY 2 DESC`);

  const ranking = individual
    ? await consulta<{ nome: string; ausencia: number; trab: number; dias: number }>(Prisma.sql`
        SELECT c.nomfun AS nome, COALESCE(${AUSENCIA}, 0)::float8 AS ausencia, COALESCE(${TRABALHADAS}, 0)::float8 AS trab,
               count(DISTINCT sp.datapu) FILTER (WHERE st.conabs IN (3, 4, 5))::int AS dias
        ${b} GROUP BY c.numemp, c.tipcol, c.numcad, c.nomfun
        HAVING COALESCE(${AUSENCIA}, 0) > 0 ORDER BY 2 DESC LIMIT 15`)
    : null;

  return {
    periodo: { de: f.de, ate: f.ate },
    kpis: {
      indice: pct(ausencia, previstas, 2),
      horasPrevistas: horas(previstas),
      horasTrabalhadas: horas(t.trab),
      horasAusencia: horas(ausencia),
      faltasNaoJustificadas: horas(t.naoJust),
      faltasJustificadas: horas(t.just),
      atestados: horas(t.atestado),
      horasDeAtraso: horas(t.atraso),
      horasDeSaidaAntecipada: horas(t.saida),
      colaboradores: t.colab,
    },
    evolucao: mensal.map((m) => ({
      mes: m.mes, rotulo: rotuloMes(m.mes), horasPrevistas: horas(m.trab + m.ausencia), horasTrabalhadas: horas(m.trab),
      horasAusencia: horas(m.ausencia), indice: pct(m.ausencia, m.trab + m.ausencia, 2),
    })),
    porSituacao: porSituacao.map((s) => ({ rotulo: s.rotulo, classe: s.conabs, horas: horas(s.minutos), ocorrencias: s.dias })),
    porDiaDaSemana: porDiaDaSemana.map((d) => ({ rotulo: DIAS_SEMANA[d.dow], horasAusencia: horas(d.ausencia), indice: pct(d.ausencia, d.trab + d.ausencia, 1) })),
    porTipoDeColaborador: porTipoColaborador.map((p) => ({
      rotulo: TIPO_COLABORADOR[p.tipcol] ?? `Tipo ${p.tipcol}`, colaboradores: p.colab, horasAusencia: horas(p.ausencia), indice: pct(p.ausencia, p.trab + p.ausencia, 1),
    })),
    porCentroCusto: grupo(porCentroCusto),
    porCargo: grupo(porCargo),
    afastamentos: afastamentos.map((a) => ({ rotulo: a.rotulo ?? "Não informado", qtd: a.qtd, diasMedios: a.dias_medios, emCurso: a.em_curso })),
    ranking: ranking?.map((r) => ({ nome: nomeVisivel(r.nome, true), horasAusencia: horas(r.ausencia), dias: r.dias, indice: pct(r.ausencia, r.trab + r.ausencia, 1) })) ?? null,
    definicoes: {
      indice: "Horas de ausência (faltas, justificadas e atestados) ÷ (horas trabalhadas + horas de ausência), com a classificação do próprio Senior. Férias, licenças e demitidos ficam fora.",
      pontualidade: "Atrasos e saídas antecipadas não entram no índice no critério do Senior; estão separados.",
    },
  };
}
