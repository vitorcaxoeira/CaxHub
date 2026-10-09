import { Prisma } from "@prisma/client";
import { consulta, fimDoMes, Grupo, inicioDoMes, mesesDoPeriodo, pct, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh, somarMeses } from "./filtros";
import { iniciativaDaCausa, ROTULO_INICIATIVA } from "./dominios";

// Turnover. Fórmula clássica: ((admissões + desligamentos) / 2) / headcount médio. Por contar entradas
// e saídas, ela só mede "giro"; a retenção de verdade (quem fica) sai das coortes de admissão, que
// olham cada leva de admitidos e perguntam quantos continuavam ativos depois de 90 dias, 6 e 12 meses.

const dia = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export async function turnover(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);

  const mensal = await consulta<{ mes: string; hc_ini: number; hc_fim: number; adm: number; desl: number; desl_voluntarios: number; desl_empresa: number }>(Prisma.sql`
    SELECT to_char(ms.mes, 'YYYY-MM') AS mes,
      (SELECT count(*) FROM hcm_colaboradores c WHERE ${cond}
         AND c.datadm < ${inicioDoMes("ms.mes", f)}
         AND (c.sitafa <> 7 OR c.datafa >= ${inicioDoMes("ms.mes", f)}))::int AS hc_ini,
      (SELECT count(*) FROM hcm_colaboradores c WHERE ${cond}
         AND c.datadm <= ${fimDoMes("ms.mes", f)}
         AND (c.sitafa <> 7 OR c.datafa > ${fimDoMes("ms.mes", f)}))::int AS hc_fim,
      (SELECT count(*) FROM hcm_colaboradores c WHERE ${cond}
         AND c.datadm BETWEEN ${inicioDoMes("ms.mes", f)} AND ${fimDoMes("ms.mes", f)})::int AS adm,
      (SELECT count(*) FROM hcm_colaboradores c WHERE ${cond} AND c.sitafa = 7
         AND c.datafa BETWEEN ${inicioDoMes("ms.mes", f)} AND ${fimDoMes("ms.mes", f)})::int AS desl,
      (SELECT count(*) FROM hcm_colaboradores c WHERE ${cond} AND c.sitafa = 7 AND c.caudem IN (3, 4, 11, 14)
         AND c.datafa BETWEEN ${inicioDoMes("ms.mes", f)} AND ${fimDoMes("ms.mes", f)})::int AS desl_voluntarios,
      (SELECT count(*) FROM hcm_colaboradores c WHERE ${cond} AND c.sitafa = 7 AND c.caudem IN (1, 2, 13, 15)
         AND c.datafa BETWEEN ${inicioDoMes("ms.mes", f)} AND ${fimDoMes("ms.mes", f)})::int AS desl_empresa
    FROM ${mesesDoPeriodo(f)}
    ORDER BY ms.mes`);

  const meses = mensal.map((m) => {
    const medio = (m.hc_ini + m.hc_fim) / 2;
    return {
      mes: m.mes,
      rotulo: rotuloMes(m.mes),
      headcountInicio: m.hc_ini,
      headcountFim: m.hc_fim,
      admissoes: m.adm,
      desligamentos: m.desl,
      desligamentosVoluntarios: m.desl_voluntarios,
      desligamentosPelaEmpresa: m.desl_empresa,
      turnover: medio ? pct((m.adm + m.desl) / 2, medio, 2) : null,
    };
  });

  const adm = meses.reduce((s, m) => s + m.admissoes, 0);
  const desl = meses.reduce((s, m) => s + m.desligamentos, 0);
  const voluntarios = meses.reduce((s, m) => s + m.desligamentosVoluntarios, 0);
  const pelaEmpresa = meses.reduce((s, m) => s + m.desligamentosPelaEmpresa, 0);
  const medios = meses.map((m) => (m.headcountInicio + m.headcountFim) / 2);
  const hcMedio = medios.length ? medios.reduce((s, v) => s + v, 0) / medios.length : 0;
  const hcInicio = meses[0]?.headcountInicio ?? 0;
  const hcFim = meses[meses.length - 1]?.headcountFim ?? 0;
  const mesesNoPeriodo = meses.length || 1;

  // Coortes de admissão dos últimos 24 meses até `ate`. Só mostra um horizonte quando a coorte já
  // "amadureceu" (fim do mês da coorte + horizonte <= ate); antes disso a taxa seria inventada.
  const inicioCoortes = `${somarMeses(f.ate, -23).slice(0, 7)}-01`;
  const coortes = await consulta<{ coorte: string; fim_mes: Date; admitidos: number; a90: number; a180: number; a365: number }>(Prisma.sql`
    SELECT to_char(date_trunc('month', c.datadm), 'YYYY-MM') AS coorte,
           (date_trunc('month', c.datadm) + interval '1 month' - interval '1 day')::date AS fim_mes,
           count(*)::int AS admitidos,
           count(*) FILTER (WHERE c.sitafa <> 7 OR c.datafa >= c.datadm + 90)::int AS a90,
           count(*) FILTER (WHERE c.sitafa <> 7 OR c.datafa >= c.datadm + 180)::int AS a180,
           count(*) FILTER (WHERE c.sitafa <> 7 OR c.datafa >= c.datadm + 365)::int AS a365
    FROM hcm_colaboradores c
    WHERE ${cond} AND c.datadm BETWEEN ${inicioCoortes}::date AND ${f.ate}::date
    GROUP BY 1, 2 ORDER BY 1`);

  const coortesOut = coortes.map((c) => {
    const fim = c.fim_mes.toISOString().slice(0, 10);
    const maduro = (h: number) => dia(fim, h) <= f.ate;
    return {
      coorte: c.coorte,
      rotulo: rotuloMes(c.coorte),
      admitidos: c.admitidos,
      retencao90: maduro(90) ? pct(c.a90, c.admitidos, 1) : null,
      retencao180: maduro(180) ? pct(c.a180, c.admitidos, 1) : null,
      retencao365: maduro(365) ? pct(c.a365, c.admitidos, 1) : null,
    };
  });

  // Retenção agregada: só coortes maduras no horizonte.
  const agregada = (campo: "a90" | "a180" | "a365", h: number) => {
    let ret = 0;
    let base = 0;
    for (const c of coortes) {
      if (dia(c.fim_mes.toISOString().slice(0, 10), h) <= f.ate) {
        ret += c[campo];
        base += c.admitidos;
      }
    }
    return { retencao: pct(ret, base, 1), base };
  };

  const porTempo = await consulta<{ faixa: string; qtd: number }>(Prisma.sql`
    SELECT CASE
      WHEN c.datafa - c.datadm < 90 THEN '1 Menos de 90 dias'
      WHEN c.datafa - c.datadm < 365 THEN '2 90 dias a 1 ano'
      WHEN c.datafa - c.datadm < 1095 THEN '3 1 a 3 anos'
      WHEN c.datafa - c.datadm < 1825 THEN '4 3 a 5 anos'
      ELSE '5 5 anos ou mais' END AS faixa,
      count(*)::int AS qtd
    FROM hcm_colaboradores c
    WHERE ${cond} AND c.sitafa = 7 AND c.datafa BETWEEN ${f.de}::date AND ${f.ate}::date
    GROUP BY 1 ORDER BY 1`);

  const porCausa = await consulta<{ caudem: number | null; causa: string | null; qtd: number }>(Prisma.sql`
    SELECT c.caudem, ca.desdem AS causa, count(*)::int AS qtd
    FROM hcm_colaboradores c LEFT JOIN hcm_causas_demissao ca ON ca.caudem = c.caudem
    WHERE ${cond} AND c.sitafa = 7 AND c.datafa BETWEEN ${f.de}::date AND ${f.ate}::date
    GROUP BY 1, 2 ORDER BY 3 DESC`);

  const iniciativa = new Map<string, number>();
  for (const c of porCausa) {
    const rot = ROTULO_INICIATIVA[iniciativaDaCausa(c.caudem)];
    iniciativa.set(rot, (iniciativa.get(rot) ?? 0) + c.qtd);
  }

  const porCentroCusto = await consulta<{ rotulo: string | null; qtd: number }>(Prisma.sql`
    SELECT COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(c.codccu), ''), 'Sem centro de custo') AS rotulo, count(*)::int AS qtd
    FROM hcm_colaboradores c LEFT JOIN hcm_centros_custo cc ON cc.numemp = c.numemp AND cc.codccu = c.codccu
    WHERE ${cond} AND c.sitafa = 7 AND c.datafa BETWEEN ${f.de}::date AND ${f.ate}::date
    GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);

  const semPrefixo = (g: Grupo[]) => g.map((x) => ({ ...x, rotulo: x.rotulo.replace(/^\d /, "") }));

  return {
    periodo: { de: f.de, ate: f.ate, meses: mesesNoPeriodo },
    kpis: {
      turnover: hcMedio ? pct((adm + desl) / 2, hcMedio, 2) : null,
      turnoverMensalMedio: hcMedio ? pct((adm + desl) / 2 / mesesNoPeriodo, hcMedio, 2) : null,
      taxaDesligamento: hcMedio ? pct(desl, hcMedio, 2) : null,
      taxaDesligamentoVoluntario: hcMedio ? pct(voluntarios, hcMedio, 2) : null,
      taxaDesligamentoPelaEmpresa: hcMedio ? pct(pelaEmpresa, hcMedio, 2) : null,
      headcountInicio: hcInicio,
      headcountFim: hcFim,
      headcountMedio: Math.round(hcMedio * 10) / 10,
      admissoes: adm,
      desligamentos: desl,
      retencao90: agregada("a90", 90),
      retencao180: agregada("a180", 180),
      retencao365: agregada("a365", 365),
    },
    meses,
    coortes: coortesOut,
    desligamentosPorTempoDeCasa: semPrefixo(porTempo.map((t) => ({ rotulo: t.faixa, qtd: t.qtd }))),
    desligamentosPorCausa: porCausa.map((c) => ({ rotulo: c.causa ?? "Não informada", qtd: c.qtd })),
    desligamentosPorIniciativa: [...iniciativa.entries()].map(([rotulo, qtd]) => ({ rotulo, qtd })),
    desligamentosPorCentroCusto: suprimir(porCentroCusto.map((c) => ({ rotulo: c.rotulo ?? "Não informado", qtd: c.qtd })), individual),
    definicoes: {
      turnover: "((admissões + desligamentos) / 2) ÷ headcount médio do período.",
      retencao: "Dos admitidos em cada mês, quantos continuavam ativos 90, 180 e 365 dias depois. Só entra a coorte que já completou o horizonte.",
      voluntario: "Desligamento por iniciativa do colaborador (causas 3, 4, 11 e 14 do Senior).",
    },
  };
}
