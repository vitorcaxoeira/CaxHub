import { Prisma } from "@prisma/client";
import { ativoEm, consulta, fimDoMes, Grupo, inicioDoMes, mesesDoPeriodo, nomeVisivel, num, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh } from "./filtros";
import { ESTADO_CIVIL, GRAU_INSTRUCAO, SEXO, TIPO_COLABORADOR } from "./dominios";

// Quadro de Pessoal: quem trabalha aqui na data final do período (`ate`), com o recorte de cadastro
// do filtro. Headcount = admitido até a data e, se desligado, desligado depois dela; afastado conta.

const DEMAIS_ROTULO = "Não informado";

function rotular(linhas: { chave: string | number | null; qtd: number }[], mapa?: Record<string | number, string>): Grupo[] {
  return linhas.map((l) => ({ rotulo: l.chave == null ? DEMAIS_ROTULO : (mapa?.[l.chave] ?? String(l.chave)), qtd: l.qtd }));
}

async function distribuicao(
  f: FiltroRh,
  expressao: string,
  opcoes: { join?: string; ordem?: string; limite?: number } = {}
): Promise<{ chave: string | number | null; qtd: number }[]> {
  const cond = condicoesColaborador(f);
  return consulta(Prisma.sql`
    SELECT ${Prisma.raw(expressao)} AS chave, count(*)::int AS qtd
    FROM hcm_colaboradores c ${Prisma.raw(opcoes.join ?? "")}
    WHERE ${cond} AND ${ativoEm("c", f.ate)}
    GROUP BY 1
    ORDER BY ${Prisma.raw(opcoes.ordem ?? "2 DESC, 1")}
    ${Prisma.raw(opcoes.limite ? `LIMIT ${Number(opcoes.limite)}` : "")}`);
}

const FAIXA_ETARIA = (ate: string) => `CASE
  WHEN c.datnas IS NULL THEN NULL
  WHEN age('${ate}'::date, c.datnas) < interval '20 years' THEN '1 até 19'
  WHEN age('${ate}'::date, c.datnas) < interval '30 years' THEN '2 20 a 29'
  WHEN age('${ate}'::date, c.datnas) < interval '40 years' THEN '3 30 a 39'
  WHEN age('${ate}'::date, c.datnas) < interval '50 years' THEN '4 40 a 49'
  WHEN age('${ate}'::date, c.datnas) < interval '60 years' THEN '5 50 a 59'
  ELSE '6 60 ou mais' END`;

const FAIXA_TEMPO_CASA = (ate: string) => `CASE
  WHEN age('${ate}'::date, c.datadm) < interval '1 year' THEN '1 Menos de 1 ano'
  WHEN age('${ate}'::date, c.datadm) < interval '3 years' THEN '2 1 a 3 anos'
  WHEN age('${ate}'::date, c.datadm) < interval '5 years' THEN '3 3 a 5 anos'
  WHEN age('${ate}'::date, c.datadm) < interval '10 years' THEN '4 5 a 10 anos'
  ELSE '5 10 anos ou mais' END`;

function semPrefixoDeOrdem(linhas: { chave: string | number | null; qtd: number }[]) {
  return linhas.map((l) => ({ ...l, chave: typeof l.chave === "string" ? l.chave.replace(/^\d /, "") : l.chave }));
}

export async function quadro(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const ativos = Prisma.sql`FROM hcm_colaboradores c WHERE ${cond} AND ${ativoEm("c", f.ate)}`;

  const [kpi] = await consulta<{ ativos: number; afastados: number; tempo_medio: number | null; idade_media: number | null }>(Prisma.sql`
    SELECT count(*)::int AS ativos,
           count(*) FILTER (WHERE c.sitafa NOT IN (1, 7))::int AS afastados,
           round(avg((${f.ate}::date - c.datadm) / 365.25)::numeric, 1)::float8 AS tempo_medio,
           round(avg(extract(year FROM age(${f.ate}::date, c.datnas)))::numeric, 1)::float8 AS idade_media
    ${ativos}`);

  const [mov] = await consulta<{ admitidos: number; desligados: number }>(Prisma.sql`
    SELECT count(*) FILTER (WHERE c.datadm BETWEEN ${f.de}::date AND ${f.ate}::date)::int AS admitidos,
           count(*) FILTER (WHERE c.sitafa = 7 AND c.datafa BETWEEN ${f.de}::date AND ${f.ate}::date)::int AS desligados
    FROM hcm_colaboradores c WHERE ${cond}`);

  const [hcInicio] = await consulta<{ qtd: number }>(Prisma.sql`
    SELECT count(*)::int AS qtd FROM hcm_colaboradores c
    WHERE ${cond} AND ${ativoEm("c", new Date(new Date(`${f.de}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10))}`);

  const [maisNovo] = await consulta<{ nome: string; datadm: Date }>(Prisma.sql`
    SELECT c.nomfun AS nome, c.datadm ${ativos} ORDER BY c.datadm DESC, c.numcad LIMIT 1`);
  const [maisAntigo] = await consulta<{ nome: string; datadm: Date }>(Prisma.sql`
    SELECT c.nomfun AS nome, c.datadm ${ativos} ORDER BY c.datadm ASC, c.numcad LIMIT 1`);

  const [porTipo, porSexo, porEstadoCivil, porEscolaridade, porSituacao, porFaixa, porTempo] = await Promise.all([
    distribuicao(f, "c.tipcol"),
    distribuicao(f, "c.tipsex"),
    distribuicao(f, "c.estciv"),
    distribuicao(f, "c.grains", { ordem: "1" }),
    distribuicao(f, "COALESCE(s.dessit, c.sitafa::text)", { join: "LEFT JOIN hcm_situacoes s ON s.codsit = c.sitafa" }),
    distribuicao(f, FAIXA_ETARIA(f.ate), { ordem: "1" }),
    distribuicao(f, FAIXA_TEMPO_CASA(f.ate), { ordem: "1" }),
  ]);

  const [porCentroCusto, porCargo, porLocal, porPosto] = await Promise.all([
    distribuicao(f, "COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(c.codccu), ''), 'Sem centro de custo')", {
      join: "LEFT JOIN hcm_centros_custo cc ON cc.numemp = c.numemp AND cc.codccu = c.codccu",
      limite: 30,
    }),
    distribuicao(f, "COALESCE(NULLIF(btrim(ca.titred), ''), NULLIF(btrim(c.codcar), ''), 'Sem cargo')", {
      join: "LEFT JOIN hcm_cargos ca ON ca.estcar = c.estcar AND ca.codcar = c.codcar",
      limite: 30,
    }),
    distribuicao(f, "COALESCE(NULLIF(btrim(lo.nomloc), ''), c.numloc::text)", {
      join: "LEFT JOIN hcm_locais lo ON lo.taborg = c.taborg AND lo.numloc = c.numloc",
      limite: 30,
    }),
    distribuicao(f, "COALESCE(NULLIF(btrim(po.desred), ''), NULLIF(btrim(c.postra), ''), 'Sem posto')", {
      join: "LEFT JOIN hcm_postos po ON po.estpos = c.estpos AND po.postra = c.postra",
      limite: 30,
    }),
  ]);

  const evolucao = await consulta<{ mes: string; headcount: number; admissoes: number; desligamentos: number }>(Prisma.sql`
    SELECT to_char(ms.mes, 'YYYY-MM') AS mes,
      (SELECT count(*) FROM hcm_colaboradores c
        WHERE ${cond}
          AND c.datadm <= ${fimDoMes("ms.mes", f)}
          AND (c.sitafa <> 7 OR c.datafa > ${fimDoMes("ms.mes", f)}))::int AS headcount,
      (SELECT count(*) FROM hcm_colaboradores c
        WHERE ${cond} AND c.datadm BETWEEN ${inicioDoMes("ms.mes", f)} AND ${fimDoMes("ms.mes", f)})::int AS admissoes,
      (SELECT count(*) FROM hcm_colaboradores c
        WHERE ${cond} AND c.sitafa = 7 AND c.datafa BETWEEN ${inicioDoMes("ms.mes", f)} AND ${fimDoMes("ms.mes", f)})::int AS desligamentos
    FROM ${mesesDoPeriodo(f)}
    ORDER BY ms.mes`);

  // Aniversário de empresa no mês de `ate`: quem completa 1, 2, 3... anos.
  const aniversarios = await consulta<{ nome: string; anos: number; datadm: Date }>(Prisma.sql`
    SELECT c.nomfun AS nome, (extract(year FROM ${f.ate}::date) - extract(year FROM c.datadm))::int AS anos, c.datadm
    ${ativos}
      AND extract(month FROM c.datadm) = extract(month FROM ${f.ate}::date)
      AND extract(year FROM c.datadm) < extract(year FROM ${f.ate}::date)
    ORDER BY extract(day FROM c.datadm), c.nomfun`);

  const comRotulos = (linhas: { chave: string | number | null; qtd: number }[], mapa?: Record<string | number, string>) =>
    suprimir(rotular(linhas, mapa), individual);

  return {
    referencia: f.ate,
    kpis: {
      headcount: kpi.ativos,
      headcountInicioPeriodo: hcInicio.qtd,
      afastados: kpi.afastados,
      admitidosNoPeriodo: mov.admitidos,
      desligadosNoPeriodo: mov.desligados,
      tempoMedioCasaAnos: kpi.tempo_medio,
      idadeMedia: kpi.idade_media,
    },
    // Nome + data de admissão do mais novo e do mais antigo identificam a pessoa: só para o papel rh.
    extremos: individual
      ? {
          maisNovo: maisNovo ? { nome: nomeVisivel(maisNovo.nome, individual), admissao: maisNovo.datadm } : null,
          maisAntigo: maisAntigo ? { nome: nomeVisivel(maisAntigo.nome, individual), admissao: maisAntigo.datadm } : null,
        }
      : null,
    porTipo: comRotulos(porTipo, TIPO_COLABORADOR),
    porSexo: comRotulos(porSexo, SEXO),
    porEstadoCivil: comRotulos(porEstadoCivil, ESTADO_CIVIL),
    porEscolaridade: comRotulos(porEscolaridade, GRAU_INSTRUCAO),
    porSituacao: comRotulos(porSituacao),
    porFaixaEtaria: comRotulos(semPrefixoDeOrdem(porFaixa)),
    porTempoDeCasa: comRotulos(semPrefixoDeOrdem(porTempo)),
    porCentroCusto: comRotulos(porCentroCusto),
    porCargo: comRotulos(porCargo),
    porLocal: comRotulos(porLocal),
    porPosto: comRotulos(porPosto),
    evolucao: evolucao.map((e) => ({ mes: e.mes, rotulo: rotuloMes(e.mes), headcount: num(e.headcount), admissoes: e.admissoes, desligamentos: e.desligamentos })),
    aniversariosDeEmpresa: individual
      ? aniversarios.map((a) => ({ nome: a.nome, anos: a.anos, admissao: a.datadm }))
      : { quantidade: aniversarios.length },
  };
}
