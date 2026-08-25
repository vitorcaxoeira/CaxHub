import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";

// Módulo Mercado (mesmo padrão de pedidos.ts) — só admin.
export const analiseFaturamentoRouter = Router();
analiseFaturamentoRouter.use(requireAuth, requireRole("admin"));

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[analiseFaturamento:${label}]`, message);
  res.status(500).json({ error: message });
}

// Filtro de "NF válida pra faturamento" usado em toda query deste router — mesmo filtro da
// query original de Faturamento que o Vitor deu no início da sessão (WHERE sitnfv='2'), mais o
// par de removido_em_senior de sempre (item e cabeçalho da NF podem ter sumido do Senior
// independentemente um do outro).
const SITNFV_FECHADA = "2";

function parseAno(req: Request, res: Response): number | null {
  const anoBase = req.query.ano ? Number(req.query.ano) : new Date().getFullYear();
  if (!Number.isInteger(anoBase)) {
    res.status(400).json({ error: "Parâmetro 'ano' inválido." });
    return null;
  }
  return anoBase;
}

// ---------- Fonte canônica de "item faturado" — usada por TODA rota deste módulo ----------
// Nasceu do bug de 24/08/2026 (ver migration/plano): usar rateios_nfv.vlrrat como valor de
// faturamento subestimava o total em ~4,35%, porque o rateio contábil (conta × centro de
// custo) nem sempre fecha 100% do valor bruto do item. A fonte certa é o ITEM da NF
// (itens_servico_nfv/itens_produto_nfv), nunca o rateio. Toda visão nova neste arquivo parte
// desta MESMA CTE — garante que cliente+serviço+UF+recorrência são todos particionamentos do
// mesmo total de /dashboard (conferir isso é o item 1 da seção de Verificação do plano).
//
// Params posicionais fixos em toda query que usa esta CTE: $1=sitnfv, $2=anoMin, $3=anoMax.
// Params adicionais específicos de cada rota começam em $4.
const CTE_ITENS = `
  itens AS (
    SELECT nf.codcli, nf.codrep, nf.codsnf, nf.numnfv,
           EXTRACT(YEAR FROM nf.datemi)::int AS ano, EXTRACT(MONTH FROM nf.datemi)::int AS mes,
           isv.codser AS codigo, 'S' AS tipo, isv.vlrbru AS valor, isv.numctr AS numctr
    FROM itens_servico_nfv isv
    JOIN notas_fiscais_venda nf
      ON nf.codemp = isv.codemp AND nf.codfil = isv.codfil
      AND nf.codsnf = isv.codsnf AND nf.numnfv = isv.numnfv
    WHERE nf.sitnfv = $1
      AND nf.removido_em_senior IS NULL
      AND isv.removido_em_senior IS NULL
      AND EXTRACT(YEAR FROM nf.datemi) BETWEEN $2 AND $3

    UNION ALL

    SELECT nf.codcli, nf.codrep, nf.codsnf, nf.numnfv,
           EXTRACT(YEAR FROM nf.datemi)::int, EXTRACT(MONTH FROM nf.datemi)::int,
           ipv.codpro, 'P', ipv.vlrbru, ipv.numctr
    FROM itens_produto_nfv ipv
    JOIN notas_fiscais_venda nf
      ON nf.codemp = ipv.codemp AND nf.codfil = ipv.codfil
      AND nf.codsnf = ipv.codsnf AND nf.numnfv = ipv.numnfv
    WHERE nf.sitnfv = $1
      AND nf.removido_em_senior IS NULL
      AND ipv.removido_em_senior IS NULL
      AND EXTRACT(YEAR FROM nf.datemi) BETWEEN $2 AND $3
  )
`;

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

interface LinhaMensal {
  ano: number;
  mes: number;
  valor: number;
}

analiseFaturamentoRouter.get("/dashboard", async (req, res) => {
  try {
    const anoBase = parseAno(req, res);
    if (anoBase == null) return;

    // Busca 7 anos (anoBase-6..anoBase): os 5 exibidos no gráfico (anoBase-4..anoBase) precisam
    // de anoBase-5 pra calcular a taxa de crescimento do primeiro; o KPI "Cresc. Últ. 5 anos"
    // usa os 5 anos COMPLETOS anteriores (anoBase-5..anoBase-1), que por sua vez precisam de
    // anoBase-6 pra calcular a taxa do primeiro deles.
    const anoMin = anoBase - 6;
    const linhas = await prisma.$queryRawUnsafe<LinhaMensal[]>(
      `WITH ${CTE_ITENS}
       SELECT ano, mes, SUM(valor)::float8 AS valor
       FROM itens
       GROUP BY ano, mes`,
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

// ---------- Recorrência: contrato x avulso ----------
// Achado (25/08/2026): % do faturamento vindo de NF com contrato vinculado (numctr) subiu de
// 52,7% (2022) pra 78,7% (ano corrente) — sinal de migração pra receita recorrente, ausente do
// resto da tela.
analiseFaturamentoRouter.get("/recorrencia", async (req, res) => {
  try {
    const anoBase = parseAno(req, res);
    if (anoBase == null) return;
    const anoMin = anoBase - 4;

    const linhas = await prisma.$queryRawUnsafe<{ ano: number; mes: number; recorrente: number; avulso: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT ano, mes,
              SUM(CASE WHEN numctr IS NOT NULL AND numctr <> 0 THEN valor ELSE 0 END)::float8 AS recorrente,
              SUM(CASE WHEN numctr IS NULL OR numctr = 0 THEN valor ELSE 0 END)::float8 AS avulso
       FROM itens
       GROUP BY ano, mes`,
      SITNFV_FECHADA,
      anoMin,
      anoBase
    );

    const porAnoMap = new Map<number, { recorrente: number; avulso: number }>();
    for (const l of linhas) {
      const acc = porAnoMap.get(l.ano) ?? { recorrente: 0, avulso: 0 };
      acc.recorrente += l.recorrente;
      acc.avulso += l.avulso;
      porAnoMap.set(l.ano, acc);
    }
    const porAno = [...porAnoMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ano, v]) => {
        const total = v.recorrente + v.avulso;
        return { ano, recorrente: v.recorrente, avulso: v.avulso, pctRecorrente: total !== 0 ? (v.recorrente / total) * 100 : null };
      });

    const mensalAnoBase = linhas
      .filter((l) => l.ano === anoBase)
      .sort((a, b) => a.mes - b.mes)
      .map((l) => ({ mes: l.mes, recorrente: l.recorrente, avulso: l.avulso }));

    res.json({ anoBase, porAno, mensalAnoBase });
  } catch (error) {
    handleError(res, error, "recorrencia");
  }
});

// ---------- Clientes: ranking, curva ABC, concentração, novos x recorrentes x perdidos ----------
analiseFaturamentoRouter.get("/clientes", async (req, res) => {
  try {
    const anoBase = parseAno(req, res);
    if (anoBase == null) return;

    const porCliente = await prisma.$queryRawUnsafe<{ codcli: number; valor: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT codcli, SUM(valor)::float8 AS valor
       FROM itens
       GROUP BY codcli
       ORDER BY valor DESC`,
      SITNFV_FECHADA,
      anoBase,
      anoBase
    );

    const total = porCliente.reduce((s, c) => s + c.valor, 0);
    const top10 = porCliente.slice(0, 10);
    const nomesRows =
      top10.length > 0
        ? await prisma.cliente.findMany({ where: { codcli: { in: top10.map((c) => c.codcli) } }, select: { codcli: true, nomcli: true } })
        : [];
    const nomeMap = new Map(nomesRows.map((c) => [c.codcli, c.nomcli]));
    const nomeDe = (codcli: number) => nomeMap.get(codcli) ?? `Cliente ${codcli}`;

    const ranking = top10.map((c) => ({ chave: c.codcli, nome: nomeDe(c.codcli), quantidade: 0, valor: c.valor }));

    // Curva ABC — mesma janela SUM() acumulada de inadimplencia.ts (curva-abc), adaptada: aqui
    // já vem ordenado por valor desc da própria query SQL, então o acumulado roda direto em JS.
    let acumulado = 0;
    const porClasse = new Map<string, { qtdClientes: number; valor: number }>();
    for (const c of porCliente) {
      acumulado += c.valor;
      const classe = total === 0 ? "C" : acumulado <= total * 0.8 ? "A" : acumulado <= total * 0.95 ? "B" : "C";
      const acc = porClasse.get(classe) ?? { qtdClientes: 0, valor: 0 };
      acc.qtdClientes += 1;
      acc.valor += c.valor;
      porClasse.set(classe, acc);
    }
    const curvaABC = ["A", "B", "C"]
      .filter((cl) => porClasse.has(cl))
      .map((classe) => {
        const c = porClasse.get(classe)!;
        return { classe, qtdClientes: c.qtdClientes, valor: c.valor, pct: total > 0 ? Math.round((c.valor / total) * 100) : 0 };
      });

    // Concentração — mesmo padrão de fluxoCaixa.ts (/concentracao): top N ÷ total.
    const somaTop = (n: number) => top10.slice(0, n).reduce((s, c) => s + c.valor, 0);
    const demaisValor = Math.max(0, total - somaTop(5));
    const concentracao = {
      top1Pct: total > 0 ? (somaTop(1) / total) * 100 : 0,
      top5Pct: total > 0 ? (somaTop(5) / total) * 100 : 0,
      top10Pct: total > 0 ? (somaTop(10) / total) * 100 : 0,
      donut: [
        ...top10.slice(0, 5).map((c) => ({ chave: c.codcli, nome: nomeDe(c.codcli), valor: c.valor, pct: total > 0 ? (c.valor / total) * 100 : 0 })),
        { chave: "demais", nome: "Demais clientes", valor: demaisValor, pct: total > 0 ? (demaisValor / total) * 100 : 0 },
      ],
    };

    // Movimentação: novos (1º ano de faturamento = ano base) x recorrentes x perdidos (faturou
    // no ano anterior, nada no ano base). Janela ampla só pra achar o primeiro ano de cada
    // cliente — nenhum dado real existe antes de 2000.
    const movimentacaoLinhas = await prisma.$queryRawUnsafe<{ codcli: number; primeiroano: number; valoranobase: number; valoranoanterior: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT codcli, MIN(ano)::int AS primeiroano,
              SUM(CASE WHEN ano = $4 THEN valor ELSE 0 END)::float8 AS valoranobase,
              SUM(CASE WHEN ano = $5 THEN valor ELSE 0 END)::float8 AS valoranoanterior
       FROM itens
       GROUP BY codcli`,
      SITNFV_FECHADA,
      2000,
      anoBase,
      anoBase,
      anoBase - 1
    );
    let novos = 0,
      novosValor = 0,
      recorrentes = 0,
      recorrentesValor = 0,
      perdidos = 0,
      perdidosValor = 0;
    for (const m of movimentacaoLinhas) {
      if (m.valoranobase > 0 && m.primeiroano === anoBase) {
        novos += 1;
        novosValor += m.valoranobase;
      } else if (m.valoranobase > 0) {
        recorrentes += 1;
        recorrentesValor += m.valoranobase;
      } else if (m.valoranoanterior > 0) {
        perdidos += 1;
        perdidosValor += m.valoranoanterior;
      }
    }

    res.json({
      anoBase,
      total,
      ranking,
      curvaABC,
      concentracao,
      movimentacao: {
        novos: { clientes: novos, valor: novosValor },
        recorrentes: { clientes: recorrentes, valor: recorrentesValor },
        perdidos: { clientes: perdidos, valor: perdidosValor },
      },
    });
  } catch (error) {
    handleError(res, error, "clientes");
  }
});

// ---------- Serviços mais faturados (+ produtos, hoje ~0,15% do total) ----------
analiseFaturamentoRouter.get("/servicos", async (req, res) => {
  try {
    const anoBase = parseAno(req, res);
    if (anoBase == null) return;

    const linhas = await prisma.$queryRawUnsafe<{ codigo: string; tipo: string; valor: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT codigo, tipo, SUM(valor)::float8 AS valor
       FROM itens
       GROUP BY codigo, tipo
       ORDER BY valor DESC`,
      SITNFV_FECHADA,
      anoBase,
      anoBase
    );

    const total = linhas.reduce((s, l) => s + l.valor, 0);
    const totalServicos = linhas.filter((l) => l.tipo === "S").reduce((s, l) => s + l.valor, 0);
    const totalProdutos = linhas.filter((l) => l.tipo === "P").reduce((s, l) => s + l.valor, 0);

    const top10 = linhas.slice(0, 10);
    const codigosServico = top10.filter((l) => l.tipo === "S").map((l) => l.codigo);
    const codigosProduto = top10.filter((l) => l.tipo === "P").map((l) => l.codigo);
    const [servicos, produtos] = await Promise.all([
      codigosServico.length > 0 ? prisma.servico.findMany({ where: { codser: { in: codigosServico } }, select: { codser: true, desser: true } }) : [],
      codigosProduto.length > 0 ? prisma.produto.findMany({ where: { codpro: { in: codigosProduto } }, select: { codpro: true, despro: true } }) : [],
    ]);
    const nomeServico = new Map(servicos.map((s) => [s.codser, s.desser]));
    const nomeProduto = new Map(produtos.map((p) => [p.codpro, p.despro]));

    const ranking = top10.map((l) => ({
      chave: `${l.tipo}-${l.codigo}`,
      nome: (l.tipo === "S" ? nomeServico.get(l.codigo) : nomeProduto.get(l.codigo)) ?? l.codigo,
      quantidade: 0,
      valor: l.valor,
    }));

    res.json({ anoBase, total, totalServicos, totalProdutos, ranking });
  } catch (error) {
    handleError(res, error, "servicos");
  }
});

// ---------- Sazonalidade + métricas operacionais por ano ----------
analiseFaturamentoRouter.get("/sazonalidade", async (req, res) => {
  try {
    const anoBase = parseAno(req, res);
    if (anoBase == null) return;

    // Índice sazonal: média de cada mês nos 5 anos COMPLETOS anteriores ao ano base (mesma
    // janela do KPI "Cresc. Últ. 5 anos" da Visão Geral — exclui o ano corrente parcial de
    // propósito) ÷ média mensal geral × 100. 100 = mês "médio"; acima/abaixo = alta/baixa
    // temporada.
    const porMes = await prisma.$queryRawUnsafe<{ mes: number; valor: number; anos: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT mes, SUM(valor)::float8 AS valor, COUNT(DISTINCT ano)::int AS anos
       FROM itens
       GROUP BY mes`,
      SITNFV_FECHADA,
      anoBase - 5,
      anoBase - 1
    );
    const porMesOrdenado = [...porMes].sort((a, b) => a.mes - b.mes);
    const mediasPorMes = porMesOrdenado.map((m) => (m.anos > 0 ? m.valor / m.anos : 0));
    const mediaGeral = mediasPorMes.length > 0 ? mediasPorMes.reduce((a, b) => a + b, 0) / mediasPorMes.length : 0;
    const indiceSazonal = porMesOrdenado.map((m, i) => ({
      mes: m.mes,
      indice: mediaGeral > 0 ? (mediasPorMes[i] / mediaGeral) * 100 : 100,
    }));

    // Métricas operacionais — mesma janela de 5 anos exibida na Visão Geral (inclui o ano base
    // parcial; front sinaliza isso).
    const porAnoLinhas = await prisma.$queryRawUnsafe<{ ano: number; nfs: number; clientes: number; valor: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT ano, COUNT(DISTINCT (codsnf || '-' || numnfv))::int AS nfs,
              COUNT(DISTINCT codcli)::int AS clientes, SUM(valor)::float8 AS valor
       FROM itens
       GROUP BY ano`,
      SITNFV_FECHADA,
      anoBase - 4,
      anoBase
    );
    const porAno = porAnoLinhas
      .sort((a, b) => a.ano - b.ano)
      .map((a) => ({ ano: a.ano, nfs: a.nfs, clientesAtivos: a.clientes, ticketMedioNf: a.nfs > 0 ? a.valor / a.nfs : 0 }));

    res.json({ anoBase, indiceSazonal, porAno });
  } catch (error) {
    handleError(res, error, "sazonalidade");
  }
});

// ---------- Geografia (UF / cidade), via clientes.sigufs/cidcli ----------
analiseFaturamentoRouter.get("/geografia", async (req, res) => {
  try {
    const anoBase = parseAno(req, res);
    if (anoBase == null) return;

    const linhas = await prisma.$queryRawUnsafe<{ uf: string | null; cidade: string | null; valor: number; clientes: number }[]>(
      `WITH ${CTE_ITENS}
       SELECT c.sigufs AS uf, c.cidcli AS cidade, SUM(i.valor)::float8 AS valor, COUNT(DISTINCT i.codcli)::int AS clientes
       FROM itens i
       JOIN clientes c ON c.codcli = i.codcli
       GROUP BY c.sigufs, c.cidcli
       ORDER BY valor DESC`,
      SITNFV_FECHADA,
      anoBase,
      anoBase
    );

    const total = linhas.reduce((s, l) => s + l.valor, 0);
    const porCidade = linhas.slice(0, 10).map((l) => ({
      chave: `${l.uf ?? "?"}-${l.cidade ?? "?"}`,
      nome: `${l.cidade ?? "—"}/${l.uf ?? "—"}`,
      quantidade: l.clientes,
      valor: l.valor,
    }));

    // Cada cliente tem 1 só sigufs/cidcli (atributo de cadastro, não de transação), então
    // somar "clientes" entre grupos da mesma UF não duplica contagem.
    const porUfMap = new Map<string, { valor: number; clientes: number }>();
    for (const l of linhas) {
      const uf = l.uf ?? "—";
      const acc = porUfMap.get(uf) ?? { valor: 0, clientes: 0 };
      acc.valor += l.valor;
      acc.clientes += l.clientes;
      porUfMap.set(uf, acc);
    }
    const porUf = [...porUfMap.entries()]
      .map(([uf, v]) => ({ chave: uf, nome: uf, quantidade: v.clientes, valor: v.valor }))
      .sort((a, b) => b.valor - a.valor);

    res.json({ anoBase, total, porUf, porCidade });
  } catch (error) {
    handleError(res, error, "geografia");
  }
});
