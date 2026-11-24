import { Prisma } from "@prisma/client";
import { consulta, horas, nomeVisivel, pct, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh } from "./filtros";

// Horas extras e banco de horas.
//
// Horas extras vêm das situações do ponto (R066SIT, minutos), em três famílias:
//   pagas            situações 16, 66 e 301 a 304 (HE paga na folha, 70%/100%, diurna e noturna)
//   crédito de banco 901, 903, 911, 912 (HE que vai para o banco de horas)
//   débito de banco  902
// Na Soeltech quase tudo é crédito de banco: não há HE paga no período, então a tela mostra o que
// existe (crédito) em vez de um zero enganoso nas pagas.
//
// Saldo do banco (R011LAN, minutos): cada lançamento tem sinal (+/−), quantidade e a parte já
// liquidada (`qtdpag`). Saldo em aberto = Σ sinal × (quantidade − liquidada). O aging do crédito em
// aberto mostra o que está envelhecendo: o acordo individual de banco de horas vence em 6 meses (CLT
// art. 59, § 5º), então crédito com mais de 180 dias é risco de passivo.

const HE_PAGAS = [16, 66, 301, 302, 303, 304];
const BH_CREDITO = [901, 903, 911, 912];
const BH_DEBITO = [902];
const DIAS_SEMANA = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const SOMA = (codigos: number[]) => Prisma.sql`COALESCE(sum(sp.qtdhor) FILTER (WHERE sp.codsit IN (${Prisma.join(codigos)})), 0)::float8`;

export async function ponto(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const base = Prisma.sql`
    FROM hcm_situacao_ponto sp
    JOIN hcm_situacoes st ON st.codsit = sp.codsit
    JOIN hcm_colaboradores c ON c.numemp = sp.numemp AND c.tipcol = sp.tipcol AND c.numcad = sp.numcad
    WHERE ${cond} AND sp.datapu BETWEEN ${f.de}::date AND ${f.ate}::date`;

  const [t] = await consulta<{ pagas: number; credito: number; debito: number; trab: number; colab_he: number; colab: number }>(Prisma.sql`
    SELECT ${SOMA(HE_PAGAS)} AS pagas, ${SOMA(BH_CREDITO)} AS credito, ${SOMA(BH_DEBITO)} AS debito,
           COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 2), 0)::float8 AS trab,
           count(DISTINCT (sp.numemp, sp.tipcol, sp.numcad)) FILTER (WHERE sp.codsit IN (${Prisma.join([...HE_PAGAS, ...BH_CREDITO])}))::int AS colab_he,
           count(DISTINCT (sp.numemp, sp.tipcol, sp.numcad)) FILTER (WHERE st.conabs = 2)::int AS colab
    ${base}`);

  const mensal = await consulta<{ mes: string; pagas: number; credito: number; debito: number; trab: number }>(Prisma.sql`
    SELECT to_char(date_trunc('month', sp.datapu), 'YYYY-MM') AS mes, ${SOMA(HE_PAGAS)} AS pagas, ${SOMA(BH_CREDITO)} AS credito,
           ${SOMA(BH_DEBITO)} AS debito, COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 2), 0)::float8 AS trab
    ${base} GROUP BY 1 ORDER BY 1`);

  const porSituacao = await consulta<{ rotulo: string; minutos: number; dias: number }>(Prisma.sql`
    SELECT btrim(st.dessit) AS rotulo, sum(sp.qtdhor)::float8 AS minutos, count(*)::int AS dias
    ${base} AND sp.codsit IN (${Prisma.join([...HE_PAGAS, ...BH_CREDITO, ...BH_DEBITO])})
    GROUP BY 1 ORDER BY 2 DESC`);

  const porDia = await consulta<{ dow: number; minutos: number }>(Prisma.sql`
    SELECT extract(isodow FROM sp.datapu)::int AS dow, ${SOMA([...HE_PAGAS, ...BH_CREDITO])} AS minutos
    ${base} GROUP BY 1 ORDER BY 1`);

  const dimensao = (expr: string, join: string) =>
    consulta<{ rotulo: string | null; qtd: number; extras: number; trab: number }>(Prisma.sql`
      SELECT ${Prisma.raw(expr)} AS rotulo,
             count(DISTINCT (sp.numemp, sp.tipcol, sp.numcad)) FILTER (WHERE sp.codsit IN (${Prisma.join([...HE_PAGAS, ...BH_CREDITO])}))::int AS qtd,
             ${SOMA([...HE_PAGAS, ...BH_CREDITO])} AS extras,
             COALESCE(sum(sp.qtdhor) FILTER (WHERE st.conabs = 2), 0)::float8 AS trab
      FROM hcm_situacao_ponto sp
      JOIN hcm_situacoes st ON st.codsit = sp.codsit
      JOIN hcm_colaboradores c ON c.numemp = sp.numemp AND c.tipcol = sp.tipcol AND c.numcad = sp.numcad
      ${Prisma.raw(join)}
      WHERE ${cond} AND sp.datapu BETWEEN ${f.de}::date AND ${f.ate}::date
      GROUP BY 1 HAVING ${SOMA([...HE_PAGAS, ...BH_CREDITO])} > 0 ORDER BY 3 DESC LIMIT 20`);
  const [porCentroCusto, porCargo] = await Promise.all([
    dimensao("COALESCE(NULLIF(btrim(cc.nomccu), ''), NULLIF(btrim(c.codccu), ''), 'Sem centro de custo')", "LEFT JOIN hcm_centros_custo cc ON cc.numemp = c.numemp AND cc.codccu = c.codccu"),
    dimensao("COALESCE(NULLIF(btrim(ca.titred), ''), NULLIF(btrim(c.codcar), ''), 'Sem cargo')", "LEFT JOIN hcm_cargos ca ON ca.estcar = c.estcar AND ca.codcar = c.codcar"),
  ]);
  const grupo = (g: { rotulo: string | null; qtd: number; extras: number; trab: number }[]) =>
    suprimir(g.map((x) => ({ rotulo: x.rotulo ?? "Não informado", qtd: x.qtd, horasExtras: horas(x.extras), pctDasTrabalhadas: pct(x.extras, x.trab, 1) })), individual, ["horasExtras", "pctDasTrabalhadas"]);

  // Banco de horas: saldo em aberto, na data final, de quem está ativo. O aging é FIFO: os débitos e
  // compensações consomem primeiro os créditos mais antigos, então o que sobra do saldo positivo é o
  // crédito mais novo. Sem isso, créditos antigos já compensados por débitos apareceriam como vencidos.
  const saldos = await consulta<{ nome: string; saldo: number; c90: number; c180: number; cmais: number }>(Prisma.sql`
    SELECT c.nomfun AS nome,
           COALESCE(sum((CASE l.sinlan WHEN '+' THEN 1 ELSE -1 END) * (l.qtdhor - COALESCE(l.qtdpag, 0))), 0)::float8 AS saldo,
           COALESCE(sum(l.qtdhor - COALESCE(l.qtdpag, 0)) FILTER (WHERE l.sinlan = '+' AND ${f.ate}::date - l.datlan <= 90), 0)::float8 AS c90,
           COALESCE(sum(l.qtdhor - COALESCE(l.qtdpag, 0)) FILTER (WHERE l.sinlan = '+' AND ${f.ate}::date - l.datlan BETWEEN 91 AND 180), 0)::float8 AS c180,
           COALESCE(sum(l.qtdhor - COALESCE(l.qtdpag, 0)) FILTER (WHERE l.sinlan = '+' AND ${f.ate}::date - l.datlan > 180), 0)::float8 AS cmais
    FROM hcm_colaboradores c
    LEFT JOIN hcm_lancamentos_bh l ON l.numemp = c.numemp AND l.tipcol = c.tipcol AND l.numcad = c.numcad AND l.datlan <= ${f.ate}::date
    WHERE ${cond} AND c.sitafa <> 7 AND c.datadm <= ${f.ate}::date
    GROUP BY c.numemp, c.tipcol, c.numcad, c.nomfun`);
  const comSaldo = saldos.filter((s) => Math.abs(s.saldo) > 0);
  const positivos = comSaldo.filter((s) => s.saldo > 0);
  const negativos = comSaldo.filter((s) => s.saldo < 0);

  const faixas = [
    { rotulo: "Até 90 dias", minutos: 0, colaboradores: 0 },
    { rotulo: "91 a 180 dias", minutos: 0, colaboradores: 0 },
    { rotulo: "Mais de 180 dias (acima do prazo de 6 meses)", minutos: 0, colaboradores: 0 },
  ];
  for (const s of positivos) {
    let resto = s.saldo;
    [s.c90, s.c180, s.cmais].forEach((credito, i) => {
      const usado = Math.min(resto, credito);
      if (usado > 0) {
        faixas[i].minutos += usado;
        faixas[i].colaboradores += 1;
        resto -= usado;
      }
    });
  }

  const maioresSaldos = individual
    ? [...comSaldo].sort((a, b) => b.saldo - a.saldo).slice(0, 15).map((s) => ({ nome: nomeVisivel(s.nome, true), saldoHoras: horas(s.saldo) }))
    : null;

  return {
    periodo: { de: f.de, ate: f.ate },
    kpis: {
      horasExtrasPagas: horas(t.pagas),
      creditoNoBanco: horas(t.credito),
      debitoNoBanco: horas(t.debito),
      totalDeExtras: horas(t.pagas + t.credito),
      pctDasHorasTrabalhadas: pct(t.pagas + t.credito, t.trab, 1),
      colaboradoresComExtras: t.colab_he,
      colaboradoresNoPeriodo: t.colab,
      saldoBancoTotal: horas(saldos.reduce((s, x) => s + x.saldo, 0)),
      saldoPositivo: horas(positivos.reduce((s, x) => s + x.saldo, 0)),
      saldoNegativo: horas(negativos.reduce((s, x) => s + x.saldo, 0)),
      colaboradoresComSaldoPositivo: positivos.length,
      colaboradoresComSaldoNegativo: negativos.length,
    },
    evolucao: mensal.map((m) => ({
      mes: m.mes, rotulo: rotuloMes(m.mes), horasExtrasPagas: horas(m.pagas), creditoNoBanco: horas(m.credito), debitoNoBanco: horas(m.debito),
      pctDasHorasTrabalhadas: pct(m.pagas + m.credito, m.trab, 1),
    })),
    porSituacao: porSituacao.map((s) => ({ rotulo: s.rotulo, horas: horas(s.minutos), ocorrencias: s.dias })),
    porDiaDaSemana: porDia.map((d) => ({ rotulo: DIAS_SEMANA[d.dow], horas: horas(d.minutos) })),
    porCentroCusto: grupo(porCentroCusto),
    porCargo: grupo(porCargo),
    agingDoSaldoPositivo: faixas.map((a) => ({ rotulo: a.rotulo, horas: horas(a.minutos), colaboradores: a.colaboradores })),
    maioresSaldos,
    definicoes: {
      extras: "Situações do ponto: pagas (16, 66, 301-304) + crédito de banco de horas (901, 903, 911, 912).",
      saldo: "Σ sinal × (quantidade − parte já liquidada) dos lançamentos do banco de horas, até a data final.",
      aging: "Saldo positivo por idade, consumindo primeiro os créditos mais antigos (débitos e compensações abatem do mais velho). Acima de 180 dias passa do prazo legal do acordo individual (CLT art. 59, § 5º).",
    },
  };
}
