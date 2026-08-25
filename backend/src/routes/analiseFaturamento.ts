import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";

// Módulo Mercado (mesmo padrão de pedidos.ts) — só admin.
export const analiseFaturamentoRouter = Router();
analiseFaturamentoRouter.use(requireAuth, requireRole("admin"));

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[analiseFaturamento:${label}]`, message);
  res.status(500).json({ error: message });
}

// Filtro de "NF válida pra faturamento" usado em toda query deste router — mesmo filtro da
// query original de Faturamento que o Vitor deu no início da sessão (WHERE sitnfv='2'), mais o
// par de removido_em_senior de sempre (rateio e cabeçalho da NF podem ter sumido do Senior
// independentemente um do outro).
const SITNFV_FECHADA = "2";

interface LinhaMensal {
  ano: number;
  mes: number;
  valor: number;
}

analiseFaturamentoRouter.get("/opcoes-filtro", async (req, res) => {
  try {
    const anos = await prisma.$queryRaw<{ ano: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM datemi)::int AS ano
      FROM notas_fiscais_venda
      WHERE sitnfv = ${SITNFV_FECHADA} AND removido_em_senior IS NULL
      ORDER BY ano DESC
    `;
    res.json({ anos: anos.map((a) => a.ano) });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

analiseFaturamentoRouter.get("/dashboard", async (req, res) => {
  try {
    const anoBase = req.query.ano ? Number(req.query.ano) : new Date().getFullYear();
    if (!Number.isInteger(anoBase)) {
      res.status(400).json({ error: "Parâmetro 'ano' inválido." });
      return;
    }

    // Busca 7 anos (anoBase-6..anoBase): os 5 exibidos no gráfico (anoBase-4..anoBase) precisam
    // de anoBase-5 pra calcular a taxa de crescimento do primeiro; o KPI "Cresc. Últ. 5 anos"
    // usa os 5 anos COMPLETOS anteriores (anoBase-5..anoBase-1), que por sua vez precisam de
    // anoBase-6 pra calcular a taxa do primeiro deles.
    const anoMin = anoBase - 6;
    const linhas = await prisma.$queryRawUnsafe<LinhaMensal[]>(
      `
      SELECT EXTRACT(YEAR FROM nf.datemi)::int AS ano,
             EXTRACT(MONTH FROM nf.datemi)::int AS mes,
             SUM(r.vlrrat)::float8 AS valor
      FROM rateios_nfv r
      JOIN notas_fiscais_venda nf
        ON nf.codemp = r.codemp AND nf.codfil = r.codfil
        AND nf.codsnf = r.codsnf AND nf.numnfv = r.numnfv
      WHERE nf.sitnfv = $1
        AND nf.removido_em_senior IS NULL
        AND r.removido_em_senior IS NULL
        AND EXTRACT(YEAR FROM nf.datemi) BETWEEN $2 AND $3
      GROUP BY EXTRACT(YEAR FROM nf.datemi), EXTRACT(MONTH FROM nf.datemi)
      `,
      SITNFV_FECHADA,
      anoMin,
      anoBase
    );

    // Matriz ano -> [12 meses], 0 onde não há dado (ano inteiro ausente OU mês sem NF).
    const mensalPorAno = new Map<number, number[]>();
    for (let ano = anoMin; ano <= anoBase; ano++) mensalPorAno.set(ano, new Array(12).fill(0));
    for (const linha of linhas) {
      const vetor = mensalPorAno.get(linha.ano);
      if (vetor) vetor[linha.mes - 1] = linha.valor;
    }

    const valorMes = (ano: number, mes: number): number => (mensalPorAno.get(ano) ?? new Array(12).fill(0))[mes - 1];
    const totalAno = (ano: number): number => (mensalPorAno.get(ano) ?? new Array(12).fill(0)).reduce((a, b) => a + b, 0);
    // "Tem dado" = existe pelo menos 1 mês não-zero — não confunde "ano sem NF nenhuma" com
    // "ano com NF mas de valor líquido zero" (caso raro, mas 0 não é sinônimo de "sem sync").
    const temDado = (ano: number): boolean => (mensalPorAno.get(ano) ?? []).some((v) => v !== 0);

    // Último mês com dado no ano base — define o corte de todas as métricas "até agora".
    const mesesComDado = (mensalPorAno.get(anoBase) ?? [])
      .map((v, i) => (v !== 0 ? i + 1 : null))
      .filter((m): m is number => m !== null);
    const ultimoMes = mesesComDado.length > 0 ? Math.max(...mesesComDado) : 12;

    // ---------- Meta do ano (tabela metas_anuais, Prisma tipado) ----------
    const metas = await prisma.metaAnual.findMany({ where: { anomet: anoBase } });
    // Hoje só existe 1 empresa/filial nos dados reais — soma cobre o caso de expandir pra mais
    // de uma filial sem quebrar; percre assume o mesmo valor entre filiais (não confirmado pra
    // um cenário multi-filial, sem dado real pra testar ainda).
    const metaAno = metas.length > 0 ? metas.reduce((soma, m) => soma + Number(m.vlrmet), 0) : null;
    const percCrescimentoEsperado = metas.length > 0 ? Number(metas[0].percre) : null;

    // ---------- Gráfico "Evolução" — 5 anos exibidos (anoBase-4..anoBase) ----------
    const evolucaoAnual = [4, 3, 2, 1, 0].map((offset) => {
      const ano = anoBase - offset;
      const valor = totalAno(ano);
      const anoAnterior = ano - 1;
      const valorAnterior = totalAno(anoAnterior);
      const percCrescimento = temDado(anoAnterior) && valorAnterior !== 0 ? ((valor - valorAnterior) / valorAnterior) * 100 : null;
      return { ano, valor, percCrescimento };
    });
    const faturamentoMedio5Anos = evolucaoAnual.reduce((soma, e) => soma + e.valor, 0) / evolucaoAnual.length;

    // ---------- "Cresc. Últ. 5 anos" — 5 anos COMPLETOS anteriores (anoBase-5..anoBase-1) ----------
    // Reconstrução best-effort (ver plano) — exclui o ano base parcial de propósito.
    const taxasAnosCompletos = [5, 4, 3, 2, 1].map((offset) => {
      const ano = anoBase - offset;
      const anoAnterior = ano - 1;
      const valor = totalAno(ano);
      const valorAnterior = totalAno(anoAnterior);
      return temDado(ano) && temDado(anoAnterior) && valorAnterior !== 0 ? ((valor - valorAnterior) / valorAnterior) * 100 : null;
    });
    const taxasValidas = taxasAnosCompletos.filter((t): t is number => t !== null);
    const crescimento5AnosCompletos = taxasValidas.length > 0 ? taxasValidas.reduce((a, b) => a + b, 0) / taxasValidas.length : null;

    // ---------- KPIs do ano base ----------
    const faturamentoAno = totalAno(anoBase);
    const percMetaAtingido = metaAno ? (faturamentoAno / metaAno) * 100 : null;

    // Ano anterior, só nos meses em que o ano base já tem dado — base do "Faturamento Desejado"
    // e do "% Cre." comparável (mesma conta do gauge).
    const anoAntComparavel = Array.from({ length: ultimoMes }, (_, i) => valorMes(anoBase - 1, i + 1)).reduce((a, b) => a + b, 0);
    const faturamentoDesejado = percCrescimentoEsperado != null ? anoAntComparavel * (1 + percCrescimentoEsperado / 100) : null;
    const percCrescimentoComparavel = anoAntComparavel !== 0 ? ((faturamentoAno - anoAntComparavel) / anoAntComparavel) * 100 : null;

    // Faturamento 12 Meses — janela móvel terminando no último mês com dado do ano base.
    let faturamento12Meses = 0;
    {
      let ano = anoBase;
      let mes = ultimoMes;
      for (let i = 0; i < 12; i++) {
        faturamento12Meses += valorMes(ano, mes);
        mes -= 1;
        if (mes === 0) {
          mes = 12;
          ano -= 1;
        }
      }
    }

    // ---------- Gauge "% Meta Atingido" ----------
    const totalAnoAnterior = totalAno(anoBase - 1);
    const percReferenciaAnoAnterior = totalAnoAnterior !== 0 ? (anoAntComparavel / totalAnoAnterior) * 100 : null;

    // ---------- Tabela mensal (5 anos + Total) ----------
    const anosTabela = evolucaoAnual.map((e) => e.ano);
    const tabelaMensal = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const valoresPorAno: Record<number, number> = {};
      for (const ano of anosTabela) valoresPorAno[ano] = valorMes(ano, mes);
      const total = Object.values(valoresPorAno).reduce((a, b) => a + b, 0);
      return { mes, valoresPorAno, total };
    });
    const totalPorAno: Record<number, number> = {};
    for (const ano of anosTabela) totalPorAno[ano] = totalAno(ano);
    const tabelaMensalTotal = {
      valoresPorAno: totalPorAno,
      total: Object.values(totalPorAno).reduce((a, b) => a + b, 0),
    };

    // ---------- Tabela comparativo mensal (Ano Ant. x Ano Atual) ----------
    let acAnt = 0;
    let acAtual = 0;
    const comparativoMensal = Array.from({ length: 12 }, (_, i) => {
      const mes = i + 1;
      const anoAnt = valorMes(anoBase - 1, mes);
      const temAtual = mes <= ultimoMes;
      const anoAtual = temAtual ? valorMes(anoBase, mes) : null;
      const percCre = temAtual && anoAnt !== 0 ? ((anoAtual! - anoAnt) / anoAnt) * 100 : null;
      acAnt += anoAnt;
      if (temAtual) acAtual += anoAtual!;
      const percAc = acAnt !== 0 ? ((acAtual - acAnt) / acAnt) * 100 : null;
      const esperado = percCrescimentoEsperado != null ? anoAnt * (1 + percCrescimentoEsperado / 100) : null;
      return { mes, anoAnt, anoAtual, percCre, anoAntAc: acAnt, anoAtualAc: acAtual, percAc, esperado };
    });
    const comparativoMensalTotal = {
      anoAnt: anoAntComparavel,
      anoAtual: faturamentoAno,
      percCre: percCrescimentoComparavel,
      anoAntAc: totalAnoAnterior,
      anoAtualAc: faturamentoAno,
      percAc: totalAnoAnterior !== 0 ? ((faturamentoAno - totalAnoAnterior) / totalAnoAnterior) * 100 : null,
      esperado: percCrescimentoEsperado != null ? totalAnoAnterior * (1 + percCrescimentoEsperado / 100) : null,
    };

    res.json({
      anoBase,
      kpis: {
        crescimento5AnosCompletos,
        faturamentoMedio5Anos,
        metaAno,
        faturamentoAno,
        percMetaAtingido,
        faturamentoDesejado,
        faturamento12Meses,
        percCrescimentoEsperado,
      },
      gauge: {
        percCrescimentoComparavel,
        percReferenciaAnoAnterior,
      },
      evolucaoAnual,
      tabelaMensal,
      tabelaMensalTotal,
      comparativoMensal,
      comparativoMensalTotal,
    });
  } catch (error) {
    handleError(res, error, "dashboard");
  }
});
