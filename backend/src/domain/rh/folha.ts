import { Prisma } from "@prisma/client";
import { consulta, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh, GRUPO_MINIMO, somarMeses } from "./filtros";
import { TIPO_EVENTO } from "./dominios";

// Folha de pagamento por competência (R044CAL.PerRef), somando as verbas (R046VER) de cálculos
// concluídos ou parciais (cancelados e simulados ficam de fora).
//   Bruto     = proventos (tipo 1) + vantagens (tipo 2)
//   Descontos = tipo 3
//   Líquido   = bruto − descontos
//   Outros    = tipos 4, 5 e 6: bases e encargos informativos do Senior (FGTS, INSS patronal...), que
//               não são pagos ao colaborador e por isso não entram no líquido.
// Grupos de cálculo: "mensal" (11 a 15), "13º" (31, 32) e "outros" (adiantamento, PLR, especiais).
// A tela principal usa o grupo mensal, que é o que se compara mês a mês; o 13º e os especiais
// aparecem à parte para não distorcer a evolução.

const GRUPO = Prisma.sql`CASE WHEN cal.tipcal IN (11, 12, 13, 14, 15) THEN 'mensal'
                              WHEN cal.tipcal IN (31, 32) THEN 'decimo' ELSE 'outros' END`;

function baseVerbas(cond: Prisma.Sql, deIso: string, ate: string): Prisma.Sql {
  return Prisma.sql`
    FROM hcm_verbas_folha v
    JOIN hcm_calculos_folha cal ON cal.numemp = v.numemp AND cal.codcal = v.codcal
    JOIN hcm_eventos e ON e.codtab = v.tabeve AND e.codeve = v.codeve
    JOIN hcm_colaboradores c ON c.numemp = v.numemp AND c.tipcol = v.tipcol AND c.numcad = v.numcad
    WHERE ${cond} AND cal.sitcal IN ('T', 'P')
      AND cal.perref >= date_trunc('month', ${deIso}::date) AND cal.perref <= ${ate}::date`;
}

interface LinhaMes {
  comp: string;
  bruto: number;
  descontos: number;
  outros: number;
  colab: number;
}

export async function folha(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  // Busca desde 12 meses antes para poder comparar com o mesmo mês do ano anterior.
  const deAmpliado = somarMeses(f.de, -12);
  const base = baseVerbas(cond, deAmpliado, f.ate);

  const mensal = await consulta<LinhaMes>(Prisma.sql`
    SELECT to_char(date_trunc('month', cal.perref), 'YYYY-MM') AS comp,
           COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve IN (1, 2)), 0)::float8 AS bruto,
           COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve = 3), 0)::float8 AS descontos,
           COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve IN (4, 5, 6)), 0)::float8 AS outros,
           count(DISTINCT (v.numemp, v.tipcol, v.numcad)) FILTER (WHERE e.tipeve IN (1, 2))::int AS colab
    ${base} AND ${GRUPO} = 'mensal'
    GROUP BY 1 ORDER BY 1`);

  const porComp = new Map(mensal.map((m) => [m.comp, m]));
  const deMes = f.de.slice(0, 7);
  const noPeriodo = mensal.filter((m) => m.comp >= deMes);
  // Competência com menos de GRUPO_MINIMO pessoas na folha: o total seria a remuneração delas. Para
  // quem não vê o individual, os valores somem (a contagem fica).
  const pequeno = (colab: number) => !individual && colab < GRUPO_MINIMO;
  const evolucao = noPeriodo.map((m) => {
    const anterior = porComp.get(somarMeses(`${m.comp}-01`, -12).slice(0, 7));
    if (pequeno(m.colab) || (anterior && pequeno(anterior.colab))) {
      return { comp: m.comp, rotulo: rotuloMes(m.comp), bruto: null, descontos: null, liquido: null, outros: null, colaboradores: m.colab, custoMedio: null, brutoAnoAnterior: null, variacaoAnoAnterior: null };
    }
    return {
      comp: m.comp,
      rotulo: rotuloMes(m.comp),
      bruto: m.bruto,
      descontos: m.descontos,
      liquido: m.bruto - m.descontos,
      outros: m.outros,
      colaboradores: m.colab,
      custoMedio: m.colab ? Math.round(m.bruto / m.colab) : null,
      brutoAnoAnterior: anterior?.bruto ?? null,
      variacaoAnoAnterior: anterior && anterior.bruto ? Math.round(((m.bruto / anterior.bruto) - 1) * 1000) / 10 : null,
    };
  });

  const ultimo = noPeriodo[noPeriodo.length - 1] ?? null;
  const anterior = ultimo ? porComp.get(somarMeses(`${ultimo.comp}-01`, -1).slice(0, 7)) ?? null : null;
  const anoAnterior = ultimo ? porComp.get(somarMeses(`${ultimo.comp}-01`, -12).slice(0, 7)) ?? null : null;
  const variacao = (atual: number, ref: number | undefined | null) => (ref ? Math.round(((atual / ref) - 1) * 1000) / 10 : null);

  // Totais do período em todos os grupos de cálculo.
  const [totais] = await consulta<{ bruto: number; descontos: number; outros: number; decimo: number }>(Prisma.sql`
    SELECT COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve IN (1, 2)), 0)::float8 AS bruto,
           COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve = 3), 0)::float8 AS descontos,
           COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve IN (4, 5, 6)), 0)::float8 AS outros,
           COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve IN (1, 2) AND ${GRUPO} = 'decimo'), 0)::float8 AS decimo
    ${baseVerbas(cond, f.de, f.ate)}`);

  const porTipoEvento = await consulta<{ tipeve: number; valor: number }>(Prisma.sql`
    SELECT e.tipeve, COALESCE(sum(v.valeve), 0)::float8 AS valor
    ${baseVerbas(cond, f.de, f.ate)} GROUP BY 1 ORDER BY 2 DESC`);

  const topEventos = await consulta<{ evento: string; tipeve: number; valor: number; colab: number }>(Prisma.sql`
    SELECT btrim(e.deseve) AS evento, e.tipeve, COALESCE(sum(v.valeve), 0)::float8 AS valor,
           count(DISTINCT (v.numemp, v.tipcol, v.numcad))::int AS colab
    ${baseVerbas(cond, f.de, f.ate)} AND e.tipeve IN (1, 2, 3)
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`);

  // Ponte da última competência: quanto da variação do bruto veio de quem entrou, de quem saiu e de
  // quem ficou (reajuste, horas extras, variáveis). Fecha por construção: entradas − saídas + permanece
  // = bruto atual − bruto anterior.
  let ponte: { de: string; para: string; brutoAnterior: number; entradas: number | null; saidas: number | null; permanece: number | null; brutoAtual: number; colabEntraram: number; colabSairam: number } | null = null;
  if (ultimo && anterior) {
    const [p] = await consulta<{ entradas: number; saidas: number; permanece: number; e: number; s: number }>(Prisma.sql`
      WITH pessoa AS (
        SELECT to_char(date_trunc('month', cal.perref), 'YYYY-MM') AS comp, v.numemp, v.tipcol, v.numcad,
               sum(v.valeve) FILTER (WHERE e.tipeve IN (1, 2)) AS bruto
        ${baseVerbas(cond, `${anterior.comp}-01`, f.ate)} AND ${GRUPO} = 'mensal'
          AND to_char(date_trunc('month', cal.perref), 'YYYY-MM') IN (${ultimo.comp}, ${anterior.comp})
        GROUP BY 1, 2, 3, 4
      ), j AS (
        SELECT COALESCE(a.numemp, b.numemp) AS numemp, COALESCE(a.tipcol, b.tipcol) AS tipcol, COALESCE(a.numcad, b.numcad) AS numcad,
               a.bruto AS atual, b.bruto AS ant
        FROM (SELECT * FROM pessoa WHERE comp = ${ultimo.comp}) a
        FULL JOIN (SELECT * FROM pessoa WHERE comp = ${anterior.comp}) b
          ON a.numemp = b.numemp AND a.tipcol = b.tipcol AND a.numcad = b.numcad
      )
      SELECT COALESCE(sum(atual) FILTER (WHERE ant IS NULL), 0)::float8 AS entradas,
             COALESCE(sum(ant) FILTER (WHERE atual IS NULL), 0)::float8 AS saidas,
             COALESCE(sum(atual - ant) FILTER (WHERE atual IS NOT NULL AND ant IS NOT NULL), 0)::float8 AS permanece,
             count(*) FILTER (WHERE ant IS NULL)::int AS e, count(*) FILTER (WHERE atual IS NULL)::int AS s
      FROM j`);
    // Entradas ou saídas de 1 ou 2 pessoas expõem o bruto delas; sem o papel rh, a ponte mostra só a
    // variação líquida.
    const esconder = !individual && ((p.e > 0 && p.e < GRUPO_MINIMO) || (p.s > 0 && p.s < GRUPO_MINIMO));
    ponte = {
      de: anterior.comp, para: ultimo.comp, brutoAnterior: anterior.bruto, entradas: esconder ? null : p.entradas,
      saidas: esconder ? null : p.saidas, permanece: esconder ? null : p.permanece, brutoAtual: ultimo.bruto,
      colabEntraram: p.e, colabSairam: p.s,
    };
  }

  const porCentroCusto = ultimo
    ? await consulta<{ rotulo: string | null; qtd: number; bruto: number; descontos: number }>(Prisma.sql`
        SELECT COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(c.codccu), ''), 'Sem centro de custo') AS rotulo,
               count(DISTINCT (v.numemp, v.tipcol, v.numcad)) FILTER (WHERE e.tipeve IN (1, 2))::int AS qtd,
               COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve IN (1, 2)), 0)::float8 AS bruto,
               COALESCE(sum(v.valeve) FILTER (WHERE e.tipeve = 3), 0)::float8 AS descontos
        FROM hcm_verbas_folha v
        JOIN hcm_calculos_folha cal ON cal.numemp = v.numemp AND cal.codcal = v.codcal
        JOIN hcm_eventos e ON e.codtab = v.tabeve AND e.codeve = v.codeve
        JOIN hcm_colaboradores c ON c.numemp = v.numemp AND c.tipcol = v.tipcol AND c.numcad = v.numcad
        LEFT JOIN hcm_centros_custo cc ON cc.numemp = c.numemp AND cc.codccu = c.codccu
        WHERE ${cond} AND cal.sitcal IN ('T', 'P') AND ${GRUPO} = 'mensal'
          AND to_char(date_trunc('month', cal.perref), 'YYYY-MM') = ${ultimo.comp}
        GROUP BY 1 ORDER BY 3 DESC`)
    : [];

  return {
    periodo: { de: f.de, ate: f.ate },
    ultimoFechamento: ultimo
      ? {
          competencia: ultimo.comp,
          rotulo: rotuloMes(ultimo.comp),
          colaboradores: ultimo.colab,
          bruto: ultimo.bruto,
          descontos: ultimo.descontos,
          liquido: ultimo.bruto - ultimo.descontos,
          custoMedio: ultimo.colab ? Math.round(ultimo.bruto / ultimo.colab) : null,
          variacaoMesAnterior: variacao(ultimo.bruto, anterior?.bruto),
          variacaoAnoAnterior: variacao(ultimo.bruto, anoAnterior?.bruto),
        }
      : null,
    totaisDoPeriodo: {
      bruto: totais.bruto,
      descontos: totais.descontos,
      liquido: totais.bruto - totais.descontos,
      outros: totais.outros,
      decimoTerceiroEEspeciais: totais.decimo,
    },
    evolucao,
    porTipoDeEvento: porTipoEvento.map((t) => ({ rotulo: TIPO_EVENTO[t.tipeve] ?? `Tipo ${t.tipeve}`, valor: t.valor })),
    // Evento pago a 1 ou 2 pessoas (pró-labore, gratificação) é o valor de uma pessoa: só o papel rh vê.
    topEventos: topEventos
      .filter((t) => individual || t.colab >= GRUPO_MINIMO)
      .map((t) => ({ evento: t.evento, tipo: TIPO_EVENTO[t.tipeve] ?? "", valor: t.valor, colaboradores: t.colab })),
    ponte,
    porCentroCusto: suprimir(porCentroCusto.map((c) => ({ rotulo: c.rotulo ?? "Não informado", qtd: c.qtd, bruto: c.bruto, descontos: c.descontos })), individual, ["bruto", "descontos"]),
    definicoes: {
      bruto: "Proventos (tipo 1) + vantagens (tipo 2) dos cálculos mensais concluídos ou parciais.",
      liquido: "Bruto − descontos (tipo 3).",
      outros: "Bases e encargos informativos do Senior (tipos 4 a 6): não são pagos ao colaborador.",
      ponte: "Variação do bruto entre duas competências: quem entrou, quem saiu e quem ficou (reajuste, horas extras, variáveis). A soma fecha com a diferença.",
    },
  };
}
