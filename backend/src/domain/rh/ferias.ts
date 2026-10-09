import { Prisma } from "@prisma/client";
import { consulta, nomeVisivel, num, rotuloMes, suprimir } from "./comum";
import { condicoesColaborador, FiltroRh, somarMeses } from "./filtros";

// Férias. Um período aquisitivo (R040PER) fica "aberto" (SitPer 0) até ser quitado. O colaborador só
// tem direito a gozar depois que o período completa (FimPer); a empresa precisa conceder até o limite
// de concessão (LimCon). Passou do limite com saldo = férias vencidas, risco de pagamento em dobro
// (CLT art. 137).
//
//   Em aquisição       período ainda não completou (FimPer depois da data de referência)
//   No prazo           completo, com saldo, limite de concessão a mais de 120 dias
//   A vencer           limite entre 0 e 120 dias (separado em até 60 e 61 a 120)
//   Vencidas           limite já passou e ainda há saldo de dias
// Estimativa do passivo (só papel rh): cada dia vencido custa o salário diário + 1/3, a mais, porque
// a dobra paga o período de novo. É uma ordem de grandeza para priorização, não provisão contábil.

export async function ferias(f: FiltroRh, individual: boolean) {
  const cond = condicoesColaborador(f);
  const ate = f.ate;

  const periodos = await consulta<{
    numemp: number; tipcol: number; numcad: number; nome: string; ccu: string | null; iniper: Date; fimper: Date; limcon: Date;
    saldo: number; valsal: number | null; classe: string;
  }>(Prisma.sql`
    SELECT c.numemp, c.tipcol, c.numcad, c.nomfun AS nome, c.codccu AS ccu, p.iniper, p.fimper, p.limcon,
           p.qtdsld::float8 AS saldo, c.valsal::float8 AS valsal,
           CASE WHEN p.fimper > ${ate}::date THEN 'aquisicao'
                WHEN p.limcon < ${ate}::date THEN 'vencida'
                WHEN p.limcon <= ${ate}::date + 60 THEN 'vence60'
                WHEN p.limcon <= ${ate}::date + 120 THEN 'vence120'
                ELSE 'noPrazo' END AS classe
    FROM hcm_periodos_ferias p
    JOIN hcm_colaboradores c ON c.numemp = p.numemp AND c.tipcol = p.tipcol AND c.numcad = p.numcad
    WHERE ${cond} AND c.sitafa <> 7 AND c.datadm <= ${ate}::date AND p.sitper = 0 AND p.qtdsld > 0 AND p.iniper <= ${ate}::date`);

  const soma = (classe: string) => periodos.filter((p) => p.classe === classe);
  const pessoas = (lista: typeof periodos) => new Set(lista.map((p) => `${p.numemp}|${p.tipcol}|${p.numcad}`)).size;
  const dias = (lista: typeof periodos) => Math.round(lista.reduce((s, p) => s + p.saldo, 0) * 10) / 10;
  const vencidas = soma("vencida");
  const passivo = vencidas.reduce((s, p) => s + ((p.valsal ?? 0) / 30) * p.saldo * (1 + 1 / 3), 0);

  const faixas = [
    { chave: "vencida", rotulo: "Vencidas (risco de dobra)" },
    { chave: "vence60", rotulo: "A vencer em até 60 dias" },
    { chave: "vence120", rotulo: "A vencer em 61 a 120 dias" },
    { chave: "noPrazo", rotulo: "No prazo" },
    { chave: "aquisicao", rotulo: "Em aquisição" },
  ].map((fx) => ({ rotulo: fx.rotulo, colaboradores: pessoas(soma(fx.chave)), periodos: soma(fx.chave).length, dias: dias(soma(fx.chave)) }));

  const ccuNomes = new Map(
    (await consulta<{ codccu: string; nomccu: string }>(Prisma.sql`SELECT codccu, btrim(nomccu) AS nomccu FROM hcm_centros_custo`)).map((c) => [c.codccu, c.nomccu])
  );
  const porCcu = new Map<string, Set<string>>();
  const diasCcu = new Map<string, number>();
  for (const p of vencidas) {
    const rot = (p.ccu && ccuNomes.get(p.ccu)) || p.ccu?.trim() || "Sem centro de custo";
    if (!porCcu.has(rot)) porCcu.set(rot, new Set());
    porCcu.get(rot)!.add(`${p.numemp}|${p.tipcol}|${p.numcad}`);
    diasCcu.set(rot, (diasCcu.get(rot) ?? 0) + p.saldo);
  }

  // Programação: férias marcadas para os próximos 6 meses, e quem está gozando na data.
  const programadas = await consulta<{ mes: string; colaboradores: number; dias: number }>(Prisma.sql`
    SELECT to_char(date_trunc('month', fe.inifer), 'YYYY-MM') AS mes,
           count(DISTINCT (fe.numemp, fe.tipcol, fe.numcad))::int AS colaboradores, COALESCE(sum(fe.diafer), 0)::float8 AS dias
    FROM hcm_programacao_ferias fe
    JOIN hcm_colaboradores c ON c.numemp = fe.numemp AND c.tipcol = fe.tipcol AND c.numcad = fe.numcad
    WHERE ${cond} AND c.sitafa <> 7 AND fe.inifer BETWEEN ${ate}::date AND (${somarMeses(ate, 6)}::date)
    GROUP BY 1 ORDER BY 1`);

  const [gozando] = await consulta<{ qtd: number }>(Prisma.sql`
    SELECT count(DISTINCT (fe.numemp, fe.tipcol, fe.numcad))::int AS qtd
    FROM hcm_programacao_ferias fe
    JOIN hcm_colaboradores c ON c.numemp = fe.numemp AND c.tipcol = fe.tipcol AND c.numcad = fe.numcad
    WHERE ${cond} AND c.sitafa <> 7 AND fe.inifer <= ${ate}::date AND fe.inifer + (fe.diafer + fe.diaabo)::int > ${ate}::date`);

  const [saldoTotal] = await consulta<{ dias: number; colaboradores: number }>(Prisma.sql`
    SELECT COALESCE(sum(p.qtdsld), 0)::float8 AS dias, count(DISTINCT (p.numemp, p.tipcol, p.numcad))::int AS colaboradores
    FROM hcm_periodos_ferias p
    JOIN hcm_colaboradores c ON c.numemp = p.numemp AND c.tipcol = p.tipcol AND c.numcad = p.numcad
    WHERE ${cond} AND c.sitafa <> 7 AND p.sitper = 0 AND p.qtdsld > 0 AND p.fimper <= ${ate}::date`);

  const lista = individual
    ? (() => {
        const porPessoa = new Map<string, { nome: string; periodos: number; dias: number; maisAntigoLimite: Date; salario: number }>();
        for (const p of vencidas) {
          const chave = `${p.numemp}|${p.tipcol}|${p.numcad}`;
          const a = porPessoa.get(chave) ?? { nome: p.nome, periodos: 0, dias: 0, maisAntigoLimite: p.limcon, salario: 0 };
          a.periodos += 1;
          a.dias += p.saldo;
          if (p.limcon < a.maisAntigoLimite) a.maisAntigoLimite = p.limcon;
          a.salario += ((p.valsal ?? 0) / 30) * p.saldo * (1 + 1 / 3);
          porPessoa.set(chave, a);
        }
        return [...porPessoa.values()].sort((a, b) => b.dias - a.dias).slice(0, 20).map((a) => ({
          nome: nomeVisivel(a.nome, true), periodosVencidos: a.periodos, diasVencidos: Math.round(a.dias * 10) / 10,
          limiteMaisAntigo: a.maisAntigoLimite, passivoEstimado: Math.round(a.salario),
        }));
      })()
    : null;

  return {
    referencia: ate,
    kpis: {
      colaboradoresComFeriasVencidas: pessoas(vencidas),
      diasVencidos: dias(vencidas),
      periodosVencidos: vencidas.length,
      aVencerEm60Dias: pessoas(soma("vence60")),
      aVencerEm120Dias: pessoas(soma("vence60")) + pessoas(soma("vence120")),
      saldoTotalDeDias: Math.round(num(saldoTotal.dias) * 10) / 10,
      colaboradoresComSaldo: saldoTotal.colaboradores,
      gozandoFerias: gozando.qtd,
      passivoEstimadoDaDobra: individual ? Math.round(passivo) : null,
    },
    faixas,
    vencidasPorCentroCusto: suprimir(
      [...porCcu.entries()].map(([rotulo, set]) => ({ rotulo, qtd: set.size, dias: Math.round((diasCcu.get(rotulo) ?? 0) * 10) / 10 })).sort((a, b) => b.dias - a.dias),
      individual,
      ["dias"]
    ),
    programadas: programadas.map((p) => ({ mes: p.mes, rotulo: rotuloMes(p.mes), colaboradores: p.colaboradores, dias: p.dias })),
    lista,
    definicoes: {
      vencida: "Período aquisitivo completo, com saldo de dias, cujo limite de concessão (R040PER.LimCon) já passou: risco de pagar as férias em dobro (CLT art. 137).",
      passivo: "Estimativa para priorizar: dias vencidos × salário diário × 4/3. Não é provisão contábil.",
      escopo: "Por padrão só empregados (CLT): terceiros e parceiros não têm férias controladas por período aquisitivo.",
    },
  };
}
