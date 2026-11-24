import { Prisma } from "@prisma/client";
import { consulta, horas, nomeVisivel, pct, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh } from "./filtros";

// Conformidade de jornada: os 7 eventos que o BI antigo da Soeltech gravava por dia (regra LSP
// Regra_BI), recalculados aqui a partir das marcações (R070ACC), da apuração (R066APU) e das
// situações do ponto (R066SIT), sem depender de tabela USU_.
//
// Marcações do dia (`datapu`): ordenadas e pareadas na ordem (1ª entrada, 2ª saída, 3ª entrada...). A
// coluna de direção do relógio (DirAcc) não é confiável na base (vem "S" até nas entradas), então
// o par é por posição, como o próprio Senior faz com marcação "não identificada".
//
//   1  Jornada acima do limite    jornada efetiva > 10h OU horas extras do dia > 2h
//   2  Intrajornada               trabalhou mais de 6h e o maior intervalo do dia foi < 1h (ou não houve
//                                 intervalo); soma os dias que o próprio Senior já aponta (situação 909)
//   3  HE em escala 12x36         dia em escala 12x36 com horas extras
//   4  Interjornada < 11h         descanso entre o último registro de um dia e o primeiro do seguinte
//                                 menor que 11h (dias consecutivos); soma a situação 910 do Senior
//   5  12x36 não respeitada       dia trabalhado em escala 12x36 logo após outro dia trabalhado
//   6  DSR trabalhado             7º dia consecutivo (ou mais) com marcação, sem folga
//   7  Horas efetivamente         não é infração: total trabalhado, em horas (KPI)
//      trabalhadas
//
// Os eventos 3 e 5 só existem se houver escala 12x36 no cadastro (nome ou descrição com "12x36",
// "12/36"); a tela diz quantos colaboradores estão nessa escala, para um zero não parecer defeito.

const HE_SITUACOES = [16, 66, 301, 302, 303, 304, 901, 903, 911, 912];

export const EVENTOS_JORNADA = [
  { tipo: 1, chave: "jornadaAcimaDoLimite", rotulo: "Jornada acima de 10h ou mais de 2h extras" },
  { tipo: 2, chave: "intrajornada", rotulo: "Intrajornada menor que 1h" },
  { tipo: 3, chave: "heEm12x36", rotulo: "Hora extra em escala 12x36" },
  { tipo: 4, chave: "interjornada", rotulo: "Menos de 11h de descanso entre jornadas" },
  { tipo: 5, chave: "escala12x36NaoRespeitada", rotulo: "Escala 12x36 não respeitada" },
  { tipo: 6, chave: "dsrTrabalhado", rotulo: "DSR trabalhado: 7 ou mais dias seguidos" },
] as const;

type ChaveEvento = (typeof EVENTOS_JORNADA)[number]["chave"];

interface DiaMarcado {
  numemp: number; tipcol: number; numcad: number; nome: string; ccu: string | null; datapu: Date; mes: string; trab: number;
  e1: boolean; e2: boolean; e3: boolean; e4: boolean; e5: boolean; e6: boolean;
}

function diasComFlags(f: FiltroRh, cond: Prisma.Sql): Prisma.Sql {
  const desde = f.de;
  return Prisma.sql`
    m AS (
      SELECT mk.numemp, mk.tipcol, mk.numcad, mk.datapu,
             ((mk.datacc - mk.datapu) * 1440 + mk.horacc) AS t,
             row_number() OVER (PARTITION BY mk.numemp, mk.tipcol, mk.numcad, mk.datapu ORDER BY mk.datacc, mk.horacc, mk.seqacc) AS rn
      FROM hcm_marcacoes mk
      JOIN hcm_colaboradores c ON c.numemp = mk.numemp AND c.tipcol = mk.tipcol AND c.numcad = mk.numcad
      WHERE ${cond} AND mk.datapu BETWEEN (${desde}::date - 8) AND ${f.ate}::date
    ), nmarcas AS (
      SELECT numemp, tipcol, numcad, datapu, max(rn) AS n FROM m GROUP BY 1, 2, 3, 4
    ), p AS (
      SELECT a.numemp, a.tipcol, a.numcad, a.datapu, a.rn, a.t AS ent, b.t AS sai,
             lead(a.t) OVER (PARTITION BY a.numemp, a.tipcol, a.numcad, a.datapu ORDER BY a.rn) - b.t AS gap
      FROM m a JOIN m b ON b.numemp = a.numemp AND b.tipcol = a.tipcol AND b.numcad = a.numcad AND b.datapu = a.datapu AND b.rn = a.rn + 1
      WHERE a.rn % 2 = 1 AND b.t > a.t
    ), dia AS (
      SELECT numemp, tipcol, numcad, datapu, sum(sai - ent) AS trab, min(ent) AS primeira, max(sai) AS ultima,
             count(*) AS npares, max(gap) AS maior_intervalo
      FROM p GROUP BY 1, 2, 3, 4
    ), he AS (
      SELECT sp.numemp, sp.tipcol, sp.numcad, sp.datapu,
             sum(sp.qtdhor) FILTER (WHERE sp.codsit IN (${Prisma.join(HE_SITUACOES)})) AS he_min,
             bool_or(sp.codsit = 909) AS sit909, bool_or(sp.codsit = 910) AS sit910
      FROM hcm_situacao_ponto sp
      WHERE sp.datapu BETWEEN (${desde}::date - 8) AND ${f.ate}::date AND sp.codsit IN (${Prisma.join([...HE_SITUACOES, 909, 910])})
      GROUP BY 1, 2, 3, 4
    ), esc AS (
      SELECT ap.numemp, ap.tipcol, ap.numcad, ap.datapu,
             (COALESCE(e.nomesc, '') || ' ' || COALESCE(e.desjor, '')) ~* '12 ?(x|/|por) ?36' AS e12x36
      FROM hcm_apuracao_ponto ap JOIN hcm_escalas e ON e.codesc = ap.codesc
      WHERE ap.datapu BETWEEN (${desde}::date - 8) AND ${f.ate}::date
    ), j AS (
      SELECT d.*, COALESCE(h.he_min, 0) AS he_min, COALESCE(h.sit909, false) AS sit909, COALESCE(h.sit910, false) AS sit910,
             COALESCE(es.e12x36, false) AS e12x36,
             lag(d.datapu) OVER w AS dia_ant, lag(d.ultima) OVER w AS ultima_ant,
             d.datapu - (row_number() OVER w)::int AS grupo_seq
      FROM dia d
      LEFT JOIN he h ON h.numemp = d.numemp AND h.tipcol = d.tipcol AND h.numcad = d.numcad AND h.datapu = d.datapu
      LEFT JOIN esc es ON es.numemp = d.numemp AND es.tipcol = d.tipcol AND es.numcad = d.numcad AND es.datapu = d.datapu
      WINDOW w AS (PARTITION BY d.numemp, d.tipcol, d.numcad ORDER BY d.datapu)
    ), seq AS (
      SELECT j.*, row_number() OVER (PARTITION BY numemp, tipcol, numcad, grupo_seq ORDER BY datapu) AS posicao_sequencia FROM j
    ), flags AS (
      SELECT s.numemp, s.tipcol, s.numcad, s.datapu, s.trab,
             (s.trab > 600 OR s.he_min > 120) AS e1,
             ((s.trab > 360 AND (s.npares = 1 OR s.maior_intervalo < 60)) OR s.sit909) AS e2,
             (s.e12x36 AND s.he_min > 0) AS e3,
             ((s.dia_ant IS NOT NULL AND s.datapu - s.dia_ant = 1
                AND (s.primeira + 1440 * (s.datapu - s.dia_ant)) - s.ultima_ant < 660) OR s.sit910) AS e4,
             (s.e12x36 AND s.dia_ant IS NOT NULL AND s.datapu - s.dia_ant = 1) AS e5,
             (s.posicao_sequencia >= 7) AS e6
      FROM seq s
      WHERE s.datapu BETWEEN ${f.de}::date AND ${f.ate}::date
    )`;
}

export async function jornada(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const cte = diasComFlags(f, cond);

  const [tot] = await consulta<{ dias: number; trab: number; colaboradores: number }>(Prisma.sql`
    WITH ${cte}
    SELECT count(*)::int AS dias, COALESCE(sum(trab), 0)::float8 AS trab, count(DISTINCT (numemp, tipcol, numcad))::int AS colaboradores FROM flags`);

  const [qualidade] = await consulta<{ impares: number }>(Prisma.sql`
    WITH ${cte}
    SELECT count(*) FILTER (WHERE n % 2 = 1)::int AS impares FROM nmarcas
    WHERE datapu BETWEEN ${f.de}::date AND ${f.ate}::date`);

  const ocorrencias = await consulta<DiaMarcado>(Prisma.sql`
    WITH ${cte}
    SELECT fl.numemp, fl.tipcol, fl.numcad, c.nomfun AS nome, c.codccu AS ccu, fl.datapu,
           to_char(date_trunc('month', fl.datapu), 'YYYY-MM') AS mes, fl.trab::float8 AS trab,
           fl.e1, fl.e2, fl.e3, fl.e4, fl.e5, fl.e6
    FROM flags fl JOIN hcm_colaboradores c ON c.numemp = fl.numemp AND c.tipcol = fl.tipcol AND c.numcad = fl.numcad
    WHERE fl.e1 OR fl.e2 OR fl.e3 OR fl.e4 OR fl.e5 OR fl.e6`);

  const [escalas] = await consulta<{ colaboradores: number }>(Prisma.sql`
    SELECT count(DISTINCT (c.numemp, c.tipcol, c.numcad))::int AS colaboradores
    FROM hcm_colaboradores c JOIN hcm_escalas e ON e.codesc = c.codesc
    WHERE ${cond} AND c.sitafa <> 7 AND (COALESCE(e.nomesc, '') || ' ' || COALESCE(e.desjor, '')) ~* '12 ?(x|/|por) ?36'`);

  const chaveDe = (n: number) => `e${n}` as `e${1 | 2 | 3 | 4 | 5 | 6}`;
  const porEvento = EVENTOS_JORNADA.map((ev) => {
    const dias = ocorrencias.filter((o) => o[chaveDe(ev.tipo)]);
    const pessoas = new Set(dias.map((o) => `${o.numemp}|${o.tipcol}|${o.numcad}`));
    return { tipo: ev.tipo, chave: ev.chave as ChaveEvento, rotulo: ev.rotulo, ocorrencias: dias.length, colaboradores: pessoas.size, pctDosDias: pct(dias.length, tot.dias, 1) };
  });

  const mesesSet = new Set(ocorrencias.map((o) => o.mes));
  const evolucao = [...mesesSet].sort().map((mes) => {
    const doMes = ocorrencias.filter((o) => o.mes === mes);
    const linha: Record<string, string | number> = { mes, rotulo: rotuloMes(mes) };
    for (const ev of EVENTOS_JORNADA) linha[ev.chave] = doMes.filter((o) => o[chaveDe(ev.tipo)]).length;
    return linha;
  });

  const porPessoa = new Map<string, { nome: string; ccu: string | null; total: number; porTipo: number[] }>();
  for (const o of ocorrencias) {
    const chave = `${o.numemp}|${o.tipcol}|${o.numcad}`;
    const atual = porPessoa.get(chave) ?? { nome: o.nome, ccu: o.ccu, total: 0, porTipo: [0, 0, 0, 0, 0, 0] };
    for (let i = 1; i <= 6; i++) if (o[chaveDe(i)]) { atual.porTipo[i - 1] += 1; atual.total += 1; }
    porPessoa.set(chave, atual);
  }

  const nomesCcu = new Map(
    (await consulta<{ codccu: string; nomccu: string }>(Prisma.sql`SELECT codccu, btrim(nomccu) AS nomccu FROM hcm_centros_custo`)).map((c) => [c.codccu, c.nomccu])
  );
  const porCcu = new Map<string, { qtd: number; ocorrencias: number }>();
  for (const p of porPessoa.values()) {
    const rot = (p.ccu && nomesCcu.get(p.ccu)) || p.ccu?.trim() || "Sem centro de custo";
    const atual = porCcu.get(rot) ?? { qtd: 0, ocorrencias: 0 };
    atual.qtd += 1;
    atual.ocorrencias += p.total;
    porCcu.set(rot, atual);
  }

  const ranking = individual
    ? [...porPessoa.values()].sort((a, b) => b.total - a.total).slice(0, 15).map((p) => ({
        nome: nomeVisivel(p.nome, true), total: p.total,
        ...Object.fromEntries(EVENTOS_JORNADA.map((ev, i) => [ev.chave, p.porTipo[i]])),
      }))
    : null;

  return {
    periodo: { de: f.de, ate: f.ate },
    kpis: {
      diasAnalisados: tot.dias,
      colaboradoresAnalisados: tot.colaboradores,
      horasEfetivamenteTrabalhadas: horas(tot.trab),
      totalDeOcorrencias: porEvento.reduce((s, e) => s + e.ocorrencias, 0),
      colaboradoresComOcorrencia: porPessoa.size,
      diasComMarcacaoImpar: qualidade.impares,
      colaboradoresEmEscala12x36: escalas.colaboradores,
    },
    porEvento,
    evolucao,
    porCentroCusto: suprimir(
      [...porCcu.entries()].map(([rotulo, v]) => ({ rotulo, qtd: v.qtd, ocorrencias: v.ocorrencias })).sort((a, b) => b.ocorrencias - a.ocorrencias),
      individual,
      ["ocorrencias"]
    ),
    ranking,
    definicoes: {
      parear: "As marcações do dia são pareadas na ordem (entrada, saída, entrada, saída): a direção gravada pelo relógio não é confiável nesta base.",
      intrajornada: "Mais de 6h trabalhadas com o maior intervalo do dia abaixo de 1h (ou sem intervalo). Soma os dias que o Senior já aponta como intrajornada.",
      interjornada: "Menos de 11h entre o último registro de um dia e o primeiro do dia seguinte. Soma os dias que o Senior já aponta como interjornada.",
      dsr: "7º dia seguido (ou mais) com marcação, sem dia de folga.",
      escala12x36: "Os eventos 3 e 5 só valem para quem está em escala 12x36 (nome ou descrição da escala).",
    },
  };
}
