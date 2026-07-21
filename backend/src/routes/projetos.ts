import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  SITPRO_LABELS,
  SITPRO_ORDER,
  SITPRO_ABERTA,
  SITPRO_EM_DECISAO,
  SITPRO_GANHAS,
  SITPRO_PERDIDAS,
  SITPRO_DECIDIDAS,
  TIPVEN_LABELS,
  MODPRO_LABELS,
  SISPRO_LABELS,
  SISPRO_ORDER,
  CLAPRO_LABELS,
  CLAPRO_ORDER,
  sitproLabel,
  sitproTone,
  depexeLabel,
  forfatLabel,
  modproLabel,
} from "../domain/propostasDominio";

export const projetosRouter = Router();
projetosRouter.use(requireAuth, requireRole("admin", "comercial"));

function parseIntParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIdsParam(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const ids = value
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : null;
}

function parseDateParam(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ano = Number(value.slice(0, 4));
  // Ano fora desse intervalo costuma vir de um estado intermediário de
  // digitação no <input type="date"> nativo (ex.: "0002-01-01" ao digitar
  // "2026" dígito a dígito).
  return ano >= 1900 && ano <= 2100 ? value : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[projetos:${label}]`, message);
  res.status(500).json({ error: message });
}

// ---------- Opções de filtro ----------
projetosRouter.get("/propostas/opcoes-filtro", async (_req, res) => {
  try {
    const situacoes = SITPRO_ORDER.map((sitpro) => ({ sitpro, label: sitproLabel(sitpro) }));
    const tiposVenda = Object.entries(TIPVEN_LABELS).map(([tipven, label]) => ({ tipven: Number(tipven), label }));
    const modalidades = Object.entries(MODPRO_LABELS).map(([modpro, label]) => ({ modpro: Number(modpro), label }));

    const representantes = await prisma.$queryRaw<{ codrep: number; nomrep: string }[]>`
      SELECT DISTINCT r.codrep, r.nomrep
      FROM representantes r
      WHERE EXISTS (SELECT 1 FROM propostas p WHERE p.codrep = r.codrep)
      ORDER BY r.nomrep
    `;

    res.json({ situacoes, tiposVenda, modalidades, representantes });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// Filtros dimensionais comuns aos endpoints de análise (kpis, funil, rankings).
// Não inclui `situacao` — cada endpoint decide se essa dimensão faz sentido pra ele.
interface FiltrosComuns {
  clientes: number[] | null;
  representantes: number[] | null;
  tipven: number[] | null;
  modpro: number[] | null;
  datproInicio: string | null;
  datproFim: string | null;
}

function lerFiltrosComuns(req: import("express").Request): FiltrosComuns {
  return {
    clientes: parseIdsParam(req.query.clientes),
    representantes: parseIdsParam(req.query.representantes),
    tipven: parseIdsParam(req.query.tipven),
    modpro: parseIdsParam(req.query.modpro),
    datproInicio: parseDateParam(req.query.datproInicio),
    datproFim: parseDateParam(req.query.datproFim),
  };
}

// ---------- KPIs ----------
projetosRouter.get("/propostas/kpis", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<
      {
        propostas_abertas: number;
        valor_pipeline: number;
        soma_valor_com_valor: number;
        qtd_com_valor: number;
        convertidas: number;
        total: number;
        total_horas: number;
        a_vencer_7d: number;
        a_vencer_30d: number;
      }[]
    >`
      WITH item_valor AS (
        SELECT codemp, codpro,
               SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor,
               SUM(qtdhor::numeric / 60)::float8 AS horas
        FROM propostas_itens
        GROUP BY codemp, codpro
      ),
      filtradas AS (
        SELECT p.sitpro, p.datval, COALESCE(iv.valor, 0) AS valor, COALESCE(iv.horas, 0) AS horas
        FROM propostas p
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      )
      SELECT
        COUNT(*) FILTER (WHERE sitpro = ANY(ARRAY[1,2,3,9]))::int AS propostas_abertas,
        COALESCE(SUM(valor) FILTER (WHERE sitpro = ANY(ARRAY[1,2,3,9])), 0)::float8 AS valor_pipeline,
        COALESCE(SUM(valor) FILTER (WHERE valor > 0), 0)::float8 AS soma_valor_com_valor,
        COUNT(*) FILTER (WHERE valor > 0)::int AS qtd_com_valor,
        COUNT(*) FILTER (WHERE sitpro = ANY(ARRAY[4,7,8]))::int AS convertidas,
        COUNT(*)::int AS total,
        COALESCE(SUM(horas), 0)::float8 AS total_horas,
        COUNT(*) FILTER (
          WHERE sitpro = ANY(ARRAY[1,2,3,9]) AND datval >= CURRENT_DATE AND datval < CURRENT_DATE + INTERVAL '7 days'
        )::int AS a_vencer_7d,
        COUNT(*) FILTER (
          WHERE sitpro = ANY(ARRAY[1,2,3,9]) AND datval >= CURRENT_DATE AND datval < CURRENT_DATE + INTERVAL '30 days'
        )::int AS a_vencer_30d
      FROM filtradas
    `;

    const r = rows[0];
    const ticketMedio = r.qtd_com_valor > 0 ? r.soma_valor_com_valor / r.qtd_com_valor : 0;
    // Conversão = propostas que avançaram pra execução (Aprovada/Em Execução/Executada)
    // dividido pelo total do período. sitpro=4 (Aprovada) sozinho é estado transitório
    // (a proposta some dele assim que a execução começa), então usar só ele subestima
    // brutalmente a conversão real — testado com dado real (60 vs 3.299 propostas).
    const taxaConversaoPct = r.total > 0 ? (r.convertidas / r.total) * 100 : 0;

    res.json({
      totalPropostas: r.total,
      totalHoras: r.total_horas,
      propostasAbertas: r.propostas_abertas,
      valorPipeline: r.valor_pipeline,
      ticketMedio,
      taxaConversaoPct,
      aVencer7d: r.a_vencer_7d,
      aVencer30d: r.a_vencer_30d,
    });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Funil por situação ----------
projetosRouter.get("/propostas/funil", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<{ sitpro: number | null; qtd: number; valor: number }[]>`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens
        GROUP BY codemp, codpro
      )
      SELECT p.sitpro, COUNT(*)::int AS qtd, COALESCE(SUM(iv.valor), 0)::float8 AS valor
      FROM propostas p
      LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
      WHERE (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
        AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
        AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
        AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
        AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      GROUP BY p.sitpro
    `;

    const totalQtd = rows.reduce((sum, r) => sum + r.qtd, 0);
    const funil = SITPRO_ORDER.map((sitpro) => {
      const row = rows.find((r) => r.sitpro === sitpro);
      const qtd = row?.qtd ?? 0;
      return {
        key: String(sitpro),
        label: sitproLabel(sitpro),
        quantidade: qtd,
        valor: row?.valor ?? 0,
        pct: totalQtd > 0 ? Math.round((qtd / totalQtd) * 100) : 0,
        tone: sitproTone(sitpro),
      };
    }).filter((b) => b.quantidade > 0);

    res.json({ funil });
  } catch (error) {
    handleError(res, error, "funil");
  }
});

// ---------- Top clientes por valor ----------
projetosRouter.get("/propostas/por-cliente", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<{ codcli: number; nomcli: string; qtd: number; valor: number }[]>`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens
        GROUP BY codemp, codpro
      )
      SELECT p.codcli, c.nomcli, COUNT(*)::int AS qtd, COALESCE(SUM(iv.valor), 0)::float8 AS valor
      FROM propostas p
      JOIN clientes c ON c.codcli = p.codcli
      LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
      WHERE (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
        AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
        AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
        AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
        AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      GROUP BY p.codcli, c.nomcli
      ORDER BY valor DESC
      LIMIT 10
    `;

    res.json({ rows });
  } catch (error) {
    handleError(res, error, "por-cliente");
  }
});

// ---------- Top clientes por horas ----------
projetosRouter.get("/propostas/por-cliente-horas", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<{ codcli: number; nomcli: string; qtd: number; horas: number }[]>`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60)::float8 AS horas
        FROM propostas_itens
        GROUP BY codemp, codpro
      )
      SELECT p.codcli, c.nomcli, COUNT(*)::int AS qtd, COALESCE(SUM(iv.horas), 0)::float8 AS horas
      FROM propostas p
      JOIN clientes c ON c.codcli = p.codcli
      LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
      WHERE (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
        AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
        AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
        AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
        AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      GROUP BY p.codcli, c.nomcli
      ORDER BY horas DESC
      LIMIT 10
    `;

    res.json({ rows });
  } catch (error) {
    handleError(res, error, "por-cliente-horas");
  }
});

// ===================== Indicadores Comerciais =====================

// ---------- Seção 1: eficiência do funil ----------
// Fórmulas (documentadas aqui pra auditoria futura):
//  - Win Rate = ganhas / (ganhas + perdidas), no período filtrado por datpro.
//  - Taxa de Rejeição/Cancelamento = sitpro=5 (ou 6) / decididas.
//  - Ciclo Médio de Fechamento = média/mediana de (datret - datenv), só decididas com ambas as datas.
//  - Tempo Médio de Preparação = média/mediana de (datenv - datpro), todas as propostas exceto
//    Levantamento Interno (sitpro=9, que é trabalho interno e não segue o fluxo comercial normal).
//  - Valor Ganho/Perdido = soma dos itens das propostas ganhas/perdidas no período.
projetosRouter.get("/propostas/eficiencia", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<
      {
        ganhas: number;
        perdidas: number;
        rejeitadas: number;
        canceladas: number;
        total_decididas: number;
        valor_ganho: number;
        valor_perdido: number;
        ciclo_qtd_validas: number;
        ciclo_qtd_total: number;
        ciclo_medio_dias: number | null;
        ciclo_mediana_dias: number | null;
        preparo_qtd_validas: number;
        preparo_qtd_total: number;
        preparo_medio_dias: number | null;
        preparo_mediana_dias: number | null;
      }[]
    >`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens
        GROUP BY codemp, codpro
      ),
      base AS (
        -- O Senior grava "1900-12-31" como sentinela de "sem data" em datenv/datret
        -- (não é NULL de verdade) — sem o NULLIF aqui, essas linhas geram diferenças
        -- de dezenas de milhares de dias e distorcem completamente média/mediana.
        SELECT p.sitpro, COALESCE(iv.valor, 0) AS valor,
               (NULLIF(p.datret, '1900-12-31') - NULLIF(p.datenv, '1900-12-31')) AS dias_ciclo,
               (NULLIF(p.datenv, '1900-12-31') - p.datpro) AS dias_preparo
        FROM propostas p
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE p.sitpro <> 9
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      )
      SELECT
        COUNT(*) FILTER (WHERE sitpro = ANY(${SITPRO_GANHAS}::int[]))::int AS ganhas,
        COUNT(*) FILTER (WHERE sitpro = ANY(${SITPRO_PERDIDAS}::int[]))::int AS perdidas,
        COUNT(*) FILTER (WHERE sitpro = 5)::int AS rejeitadas,
        COUNT(*) FILTER (WHERE sitpro = 6)::int AS canceladas,
        COUNT(*) FILTER (WHERE sitpro = ANY(${SITPRO_DECIDIDAS}::int[]))::int AS total_decididas,
        COALESCE(SUM(valor) FILTER (WHERE sitpro = ANY(${SITPRO_GANHAS}::int[])), 0)::float8 AS valor_ganho,
        COALESCE(SUM(valor) FILTER (WHERE sitpro = ANY(${SITPRO_PERDIDAS}::int[])), 0)::float8 AS valor_perdido,
        COUNT(dias_ciclo) FILTER (WHERE sitpro = ANY(${SITPRO_DECIDIDAS}::int[]))::int AS ciclo_qtd_validas,
        COUNT(*) FILTER (WHERE sitpro = ANY(${SITPRO_DECIDIDAS}::int[]))::int AS ciclo_qtd_total,
        AVG(dias_ciclo) FILTER (WHERE sitpro = ANY(${SITPRO_DECIDIDAS}::int[]))::float8 AS ciclo_medio_dias,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dias_ciclo)
          FILTER (WHERE sitpro = ANY(${SITPRO_DECIDIDAS}::int[]))::float8 AS ciclo_mediana_dias,
        COUNT(dias_preparo)::int AS preparo_qtd_validas,
        COUNT(*)::int AS preparo_qtd_total,
        AVG(dias_preparo)::float8 AS preparo_medio_dias,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dias_preparo)::float8 AS preparo_mediana_dias
      FROM base
    `;

    const r = rows[0];
    const ganhas = r?.ganhas ?? 0;
    const perdidas = r?.perdidas ?? 0;
    const totalDecididas = r?.total_decididas ?? 0;
    const winRatePct = ganhas + perdidas > 0 ? (ganhas / (ganhas + perdidas)) * 100 : null;
    const rejeicaoPct = totalDecididas > 0 ? ((r?.rejeitadas ?? 0) / totalDecididas) * 100 : 0;
    const cancelamentoPct = totalDecididas > 0 ? ((r?.canceladas ?? 0) / totalDecididas) * 100 : 0;

    res.json({
      winRatePct,
      ganhas,
      perdidas,
      rejeicaoPct,
      cancelamentoPct,
      cicloMedioDias: r?.ciclo_medio_dias ?? null,
      cicloMedianaDias: r?.ciclo_mediana_dias ?? null,
      cicloQtdValidas: r?.ciclo_qtd_validas ?? 0,
      cicloQtdExcluidas: (r?.ciclo_qtd_total ?? 0) - (r?.ciclo_qtd_validas ?? 0),
      preparoMedioDias: r?.preparo_medio_dias ?? null,
      preparoMedianaDias: r?.preparo_mediana_dias ?? null,
      preparoQtdValidas: r?.preparo_qtd_validas ?? 0,
      preparoQtdExcluidas: (r?.preparo_qtd_total ?? 0) - (r?.preparo_qtd_validas ?? 0),
      valorGanho: r?.valor_ganho ?? 0,
      valorPerdido: r?.valor_perdido ?? 0,
    });
  } catch (error) {
    handleError(res, error, "eficiencia");
  }
});

// ---------- Seção 2: alertas de ação ----------
// Estagnadas: em decisão (1,2,3), enviada há mais de N dias sem retorno.
// Enviadas sem retorno: sitpro=3 e datret IS NULL (sem o limiar de N dias).
// Vencidas: validade (datval) já passou e ainda em decisão.
// Paradas na abertura: sitpro=1 há mais de 7 dias desde datpro.
projetosRouter.get("/propostas/alertas", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);
    const estagnadaDias = Math.max(1, Math.min(365, parseIntParam(req.query.estagnadaDias) ?? 15));

    const rows = await prisma.$queryRaw<
      {
        estagnadas_qtd: number;
        estagnadas_valor: number;
        estagnadas_criticas_qtd: number;
        sem_retorno_qtd: number;
        sem_retorno_valor: number;
        vencidas_qtd: number;
        vencidas_valor: number;
        paradas_abertura_qtd: number;
        paradas_abertura_valor: number;
      }[]
    >`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens
        GROUP BY codemp, codpro
      ),
      base AS (
        -- Sentinela do Senior: datenv/datret = "1900-12-31" significa "sem data",
        -- não é NULL de verdade — tratamos como NULL aqui pra não gerar propostas
        -- "estagnadas" com dezenas de milhares de dias de idade.
        SELECT p.sitpro, p.datpro, NULLIF(p.datenv, '1900-12-31') AS datenv, NULLIF(p.datret, '1900-12-31') AS datret,
               p.datval, COALESCE(iv.valor, 0) AS valor
        FROM propostas p
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      )
      SELECT
        COUNT(*) FILTER (
          WHERE sitpro = ANY(${SITPRO_EM_DECISAO}::int[]) AND datenv IS NOT NULL AND datret IS NULL
            AND CURRENT_DATE - datenv > ${estagnadaDias}
        )::int AS estagnadas_qtd,
        COALESCE(SUM(valor) FILTER (
          WHERE sitpro = ANY(${SITPRO_EM_DECISAO}::int[]) AND datenv IS NOT NULL AND datret IS NULL
            AND CURRENT_DATE - datenv > ${estagnadaDias}
        ), 0)::float8 AS estagnadas_valor,
        COUNT(*) FILTER (
          WHERE sitpro = ANY(${SITPRO_EM_DECISAO}::int[]) AND datenv IS NOT NULL AND datret IS NULL
            AND CURRENT_DATE - datenv > 30
        )::int AS estagnadas_criticas_qtd,
        COUNT(*) FILTER (WHERE sitpro = 3 AND datret IS NULL)::int AS sem_retorno_qtd,
        COALESCE(SUM(valor) FILTER (WHERE sitpro = 3 AND datret IS NULL), 0)::float8 AS sem_retorno_valor,
        COUNT(*) FILTER (
          WHERE sitpro = ANY(${SITPRO_EM_DECISAO}::int[]) AND datval IS NOT NULL AND datval < CURRENT_DATE
        )::int AS vencidas_qtd,
        COALESCE(SUM(valor) FILTER (
          WHERE sitpro = ANY(${SITPRO_EM_DECISAO}::int[]) AND datval IS NOT NULL AND datval < CURRENT_DATE
        ), 0)::float8 AS vencidas_valor,
        COUNT(*) FILTER (
          WHERE sitpro = 1 AND datpro IS NOT NULL AND CURRENT_DATE - datpro > 7
        )::int AS paradas_abertura_qtd,
        COALESCE(SUM(valor) FILTER (
          WHERE sitpro = 1 AND datpro IS NOT NULL AND CURRENT_DATE - datpro > 7
        ), 0)::float8 AS paradas_abertura_valor
      FROM base
    `;

    const r = rows[0];
    res.json({
      estagnadas: {
        qtd: r?.estagnadas_qtd ?? 0,
        valor: r?.estagnadas_valor ?? 0,
        tone: (r?.estagnadas_criticas_qtd ?? 0) > 0 ? "destructive" : "warning",
      },
      enviadasSemRetorno: { qtd: r?.sem_retorno_qtd ?? 0, valor: r?.sem_retorno_valor ?? 0 },
      vencidas: { qtd: r?.vencidas_qtd ?? 0, valor: r?.vencidas_valor ?? 0 },
      paradasAbertura: { qtd: r?.paradas_abertura_qtd ?? 0, valor: r?.paradas_abertura_valor ?? 0 },
      estagnadaDias,
    });
  } catch (error) {
    handleError(res, error, "alertas");
  }
});

// ---------- Seção 3: composição do pipeline (abertas em decisão) ----------
projetosRouter.get("/propostas/composicao", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const [porTipoVenda, porProduto, porClassificacao] = await Promise.all([
      prisma.$queryRaw<{ tipven: number | null; qtd: number; valor: number }[]>`
        WITH item_valor AS (
          SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
          FROM propostas_itens GROUP BY codemp, codpro
        )
        SELECT p.tipven, COUNT(*)::int AS qtd, COALESCE(SUM(iv.valor), 0)::float8 AS valor
        FROM propostas p
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE p.sitpro = ANY(${SITPRO_EM_DECISAO}::int[])
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
        GROUP BY p.tipven
      `,
      prisma.$queryRaw<{ sispro: number | null; qtd: number; valor: number }[]>`
        WITH item_valor AS (
          SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
          FROM propostas_itens GROUP BY codemp, codpro
        )
        SELECT p.sispro, COUNT(*)::int AS qtd, COALESCE(SUM(iv.valor), 0)::float8 AS valor
        FROM propostas p
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE p.sitpro = ANY(${SITPRO_EM_DECISAO}::int[])
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
        GROUP BY p.sispro
      `,
      // Classificação de porte não usa mais o campo clapro (na prática, quase sempre
      // "0"/não preenchido — ver histórico) — em vez disso, classifica pela soma de
      // horas dos itens da própria proposta, nas mesmas faixas da label original
      // (USU_ClaPro): >300h Grandes, 100-300h Médios, 25-99h Pequenos, <25h Rápidos.
      prisma.$queryRaw<{ clapro: number; qtd: number; valor: number; horas: number }[]>`
        WITH item_valor AS (
          SELECT codemp, codpro,
                 SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor,
                 SUM(qtdhor::numeric / 60)::float8 AS horas
          FROM propostas_itens GROUP BY codemp, codpro
        )
        SELECT
          CASE
            WHEN COALESCE(iv.horas, 0) > 300 THEN 1
            WHEN COALESCE(iv.horas, 0) >= 100 THEN 2
            WHEN COALESCE(iv.horas, 0) >= 25 THEN 3
            ELSE 4
          END AS clapro,
          COUNT(*)::int AS qtd, COALESCE(SUM(iv.valor), 0)::float8 AS valor,
          COALESCE(SUM(iv.horas), 0)::float8 AS horas
        FROM propostas p
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE p.sitpro = ANY(${SITPRO_EM_DECISAO}::int[])
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
        GROUP BY 1
      `,
    ]);

    res.json({
      porTipoVenda: Object.keys(TIPVEN_LABELS)
        .map(Number)
        .map((tipven) => {
          const row = porTipoVenda.find((r) => r.tipven === tipven);
          return { tipven, label: TIPVEN_LABELS[tipven], qtd: row?.qtd ?? 0, valor: row?.valor ?? 0 };
        }),
      porProduto: SISPRO_ORDER.map((sispro) => {
        const row = porProduto.find((r) => r.sispro === sispro);
        return { sispro, label: SISPRO_LABELS[sispro], qtd: row?.qtd ?? 0, valor: row?.valor ?? 0 };
      }),
      porClassificacao: CLAPRO_ORDER.map((clapro) => {
        const row = porClassificacao.find((r) => r.clapro === clapro);
        return { clapro, label: CLAPRO_LABELS[clapro], qtd: row?.qtd ?? 0, valor: row?.valor ?? 0, horas: row?.horas ?? 0 };
      }),
    });
  } catch (error) {
    handleError(res, error, "composicao");
  }
});

// ---------- Seção 3: ranking de representantes (ordenável/paginado) ----------
function ordenacaoRepresentantes(sort: unknown, dir: unknown): string {
  const direcao = dir === "asc" ? "ASC" : "DESC";
  switch (sort) {
    case "valorPipeline":
      return `valor_pipeline ${direcao}`;
    case "winRate":
      return `win_rate_pct ${direcao} NULLS LAST`;
    case "cicloMedio":
      return `ciclo_medio_dias ${direcao} NULLS LAST`;
    case "propostasAbertas":
    default:
      return `propostas_abertas ${direcao}`;
  }
}

projetosRouter.get("/propostas/representantes-ranking", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseIntParam(req.query.pageSize) ?? 20));
    const offset = (page - 1) * pageSize;
    const ordenacao = ordenacaoRepresentantes(req.query.sort, req.query.dir);

    const rows = await prisma.$queryRawUnsafe<
      {
        codrep: number;
        nomrep: string;
        propostas_abertas: number;
        valor_pipeline: number;
        ganhas: number;
        perdidas: number;
        ciclo_medio_dias: number | null;
        win_rate_pct: number | null;
        total_geral: number;
      }[]
    >(
      `
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens GROUP BY codemp, codpro
      ),
      base AS (
        -- "1900-12-31" é a sentinela de "sem data" do Senior em datenv/datret.
        SELECT p.codrep, r.nomrep, p.sitpro,
               NULLIF(p.datenv, '1900-12-31') AS datenv, NULLIF(p.datret, '1900-12-31') AS datret,
               COALESCE(iv.valor, 0) AS valor
        FROM propostas p
        JOIN representantes r ON r.codrep = p.codrep
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE ($1::int[] IS NULL OR p.codcli = ANY($1::int[]))
          AND ($2::int[] IS NULL OR p.codrep = ANY($2::int[]))
          AND ($3::int[] IS NULL OR p.tipven = ANY($3::int[]))
          AND ($4::int[] IS NULL OR p.modpro = ANY($4::int[]))
          AND ($5::date IS NULL OR p.datpro >= $5::date)
          AND ($6::date IS NULL OR p.datpro <= $6::date)
      ),
      agregado AS (
        SELECT codrep, nomrep,
          COUNT(*) FILTER (WHERE sitpro = ANY($7::int[]))::int AS propostas_abertas,
          COALESCE(SUM(valor) FILTER (WHERE sitpro = ANY($7::int[])), 0)::float8 AS valor_pipeline,
          COUNT(*) FILTER (WHERE sitpro = ANY($8::int[]))::int AS ganhas,
          COUNT(*) FILTER (WHERE sitpro = ANY($9::int[]))::int AS perdidas,
          AVG(datret - datenv) FILTER (WHERE sitpro = ANY($10::int[]))::float8 AS ciclo_medio_dias
        FROM base
        GROUP BY codrep, nomrep
      )
      SELECT *,
        CASE WHEN (ganhas + perdidas) > 0 THEN ROUND((ganhas::numeric / (ganhas + perdidas)) * 100, 1)::float8 ELSE NULL END AS win_rate_pct,
        COUNT(*) OVER ()::int AS total_geral
      FROM agregado
      ORDER BY ${ordenacao}
      LIMIT $11 OFFSET $12
      `,
      clientes,
      representantes,
      tipven,
      modpro,
      datproInicio,
      datproFim,
      SITPRO_EM_DECISAO,
      SITPRO_GANHAS,
      SITPRO_PERDIDAS,
      SITPRO_DECIDIDAS,
      pageSize,
      offset
    );

    res.json({
      rows: rows.map((r) => ({
        codrep: r.codrep,
        nomrep: r.nomrep,
        propostasAbertas: r.propostas_abertas,
        valorPipeline: r.valor_pipeline,
        winRatePct: r.win_rate_pct,
        cicloMedioDias: r.ciclo_medio_dias,
      })),
      page,
      pageSize,
      total: rows[0]?.total_geral ?? 0,
    });
  } catch (error) {
    handleError(res, error, "representantes-ranking");
  }
});

// ---------- Seção 3: drill-down de propostas abertas de um representante ----------
projetosRouter.get("/propostas/representantes-ranking/:codrep/propostas-abertas", async (req, res) => {
  try {
    const codrep = parseIntParam(req.params.codrep);
    if (codrep === null) {
      res.status(400).json({ error: "codrep inválido" });
      return;
    }
    const { clientes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<
      { codpro: number; codcli: number; nomcli: string; datpro: Date | null; sitpro: number | null; valor: number }[]
    >`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens GROUP BY codemp, codpro
      )
      SELECT p.codpro, p.codcli, c.nomcli, p.datpro, p.sitpro, COALESCE(iv.valor, 0) AS valor
      FROM propostas p
      JOIN clientes c ON c.codcli = p.codcli
      LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
      WHERE p.codrep = ${codrep} AND p.sitpro = ANY(${SITPRO_EM_DECISAO}::int[])
        AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
        AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
        AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
        AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      ORDER BY p.datpro DESC
    `;

    res.json({
      rows: rows.map((r) => ({
        codpro: r.codpro,
        codcli: r.codcli,
        nomcli: r.nomcli,
        datpro: r.datpro,
        valor: r.valor,
        situacaoLabel: sitproLabel(r.sitpro),
        situacaoTone: sitproTone(r.sitpro),
      })),
    });
  } catch (error) {
    handleError(res, error, "representantes-ranking-drilldown");
  }
});

// ---------- Seção 4: evolução mensal (criadas × ganhas × perdidas × win rate) ----------
// Substitui o antigo /serie-temporal (removido — só contava sitpro=4 como "aprovadas",
// uma inconsistência conhecida). Criadas = por datpro; ganhas/perdidas = por datret
// (mês em que a decisão realmente aconteceu, não o mês de criação da proposta).
projetosRouter.get("/propostas/tendencia-mensal", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const inicioMes = datproInicio ?? null;
    const fimMes = datproFim ?? null;

    const rows = await prisma.$queryRaw<{ mes: string; criadas: number; ganhas: number; perdidas: number }[]>`
      WITH janela AS (
        SELECT
          COALESCE(${inicioMes}::date, date_trunc('month', CURRENT_DATE) - INTERVAL '11 months') AS inicio,
          COALESCE(${fimMes}::date, date_trunc('month', CURRENT_DATE)) AS fim
      ),
      meses AS (
        SELECT generate_series(date_trunc('month', janela.inicio), date_trunc('month', janela.fim), INTERVAL '1 month') AS mes
        FROM janela
      ),
      criadas_por_mes AS (
        SELECT date_trunc('month', p.datpro) AS mes, COUNT(*)::int AS qtd
        FROM propostas p, janela
        WHERE p.datpro >= janela.inicio AND p.datpro <= janela.fim
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        GROUP BY 1
      ),
      decisoes_por_mes AS (
        SELECT date_trunc('month', p.datret) AS mes,
          COUNT(*) FILTER (WHERE p.sitpro = ANY(${SITPRO_GANHAS}::int[]))::int AS ganhas,
          COUNT(*) FILTER (WHERE p.sitpro = ANY(${SITPRO_PERDIDAS}::int[]))::int AS perdidas
        FROM propostas p, janela
        WHERE p.datret IS NOT NULL AND p.datret >= janela.inicio AND p.datret <= janela.fim
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        GROUP BY 1
      )
      SELECT to_char(m.mes, 'YYYY-MM') AS mes,
             COALESCE(c.qtd, 0)::int AS criadas,
             COALESCE(d.ganhas, 0)::int AS ganhas,
             COALESCE(d.perdidas, 0)::int AS perdidas
      FROM meses m
      LEFT JOIN criadas_por_mes c ON c.mes = m.mes
      LEFT JOIN decisoes_por_mes d ON d.mes = m.mes
      ORDER BY m.mes
    `;

    const serie = rows.map((r) => ({
      mes: r.mes,
      criadas: r.criadas,
      ganhas: r.ganhas,
      perdidas: r.perdidas,
      winRatePct: r.ganhas + r.perdidas > 0 ? (r.ganhas / (r.ganhas + r.perdidas)) * 100 : null,
    }));

    res.json({ serie });
  } catch (error) {
    handleError(res, error, "tendencia-mensal");
  }
});

// ---------- Seção 4: aging do pipeline aberto (em decisão) ----------
projetosRouter.get("/propostas/aging", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<{ bucket: string; quantidade: number; valor: number }[]>`
      WITH item_valor AS (
        SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
        FROM propostas_itens GROUP BY codemp, codpro
      )
      SELECT
        CASE
          WHEN CURRENT_DATE - p.datpro BETWEEN 0 AND 15 THEN 'd0_15'
          WHEN CURRENT_DATE - p.datpro BETWEEN 16 AND 30 THEN 'd16_30'
          WHEN CURRENT_DATE - p.datpro BETWEEN 31 AND 60 THEN 'd31_60'
          ELSE 'd61_mais'
        END AS bucket,
        COUNT(*)::int AS quantidade,
        COALESCE(SUM(iv.valor), 0)::float8 AS valor
      FROM propostas p
      LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
      WHERE p.sitpro = ANY(${SITPRO_EM_DECISAO}::int[]) AND p.datpro IS NOT NULL
        AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
        AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
        AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
        AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
        AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
        AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      GROUP BY 1
    `;

    const BUCKET_ORDER = ["d0_15", "d16_30", "d31_60", "d61_mais"] as const;
    const BUCKET_LABELS: Record<string, string> = {
      d0_15: "0–15 dias",
      d16_30: "16–30 dias",
      d31_60: "31–60 dias",
      d61_mais: "61+ dias",
    };
    const total = rows.reduce((acc, r) => acc + r.valor, 0);
    const porBucket = new Map(rows.map((r) => [r.bucket, r]));
    const buckets = BUCKET_ORDER.map((bucket) => {
      const r = porBucket.get(bucket);
      const valor = r?.valor ?? 0;
      return { bucket, label: BUCKET_LABELS[bucket], quantidade: r?.quantidade ?? 0, valor, pct: total > 0 ? (valor / total) * 100 : 0 };
    });

    res.json({ buckets, total });
  } catch (error) {
    handleError(res, error, "aging");
  }
});

// Drill-down dos cards de alerta (Seção 2) na listagem — sempre "TRUE" (no-op)
// quando nenhum alerta está ativo, garantindo zero mudança de comportamento no
// caso normal. $8/$9 são posições fixas nos params passados pelas duas queries
// abaixo (estagnadaDias e o array "em decisão"), sempre enviadas mesmo quando
// o branch escolhido não as usa.
function condicaoAlertaPropostas(alerta: string | null): string {
  // "1900-12-31" é a sentinela de "sem data" do Senior em datenv/datret — NULLIF
  // trata como NULL de verdade (ver mesmo comentário em /propostas/alertas).
  switch (alerta) {
    case "estagnadas":
      return "p.sitpro = ANY($9::int[]) AND NULLIF(p.datenv, '1900-12-31') IS NOT NULL AND NULLIF(p.datret, '1900-12-31') IS NULL AND CURRENT_DATE - NULLIF(p.datenv, '1900-12-31') > $8";
    case "enviadas_sem_retorno":
      return "p.sitpro = 3 AND NULLIF(p.datret, '1900-12-31') IS NULL";
    case "vencidas":
      return "p.sitpro = ANY($9::int[]) AND p.datval IS NOT NULL AND p.datval < CURRENT_DATE";
    case "paradas_abertura":
      return "p.sitpro = 1 AND p.datpro IS NOT NULL AND CURRENT_DATE - p.datpro > 7";
    default:
      return "TRUE";
  }
}

// ---------- Lista paginada ----------
projetosRouter.get("/propostas", async (req, res) => {
  try {
    const situacao = parseIdsParam(req.query.situacao);
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize) ?? 50));
    const offset = (page - 1) * pageSize;
    const alerta = typeof req.query.alerta === "string" && req.query.alerta !== "" ? req.query.alerta : null;
    const estagnadaDias = Math.max(1, Math.min(365, parseIntParam(req.query.estagnadaDias) ?? 15));
    const condicaoAlerta = condicaoAlertaPropostas(alerta);

    const [rows, totalRows] = await Promise.all([
      prisma.$queryRawUnsafe<
        {
          codemp: number;
          codpro: number;
          codcli: number;
          nomcli: string;
          datpro: Date | null;
          datret: Date | null;
          sitpro: number | null;
          numprj: number | null;
          valor: number;
          horas: number;
          pripro: number | null;
          depexe: number | null;
          forfat: number | null;
          despro: string | null;
          modpro: number | null;
        }[]
      >(
        `
        WITH item_valor AS (
          SELECT codemp, codpro,
                 SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor,
                 SUM(qtdhor::numeric / 60)::float8 AS horas
          FROM propostas_itens
          GROUP BY codemp, codpro
        )
        SELECT p.codemp, p.codpro, p.codcli, c.nomcli, p.datpro, p.datret, p.sitpro, p.numprj,
               COALESCE(iv.valor, 0) AS valor, COALESCE(iv.horas, 0) AS horas, p.pripro, p.depexe,
               p.forfat, p.despro, p.modpro
        FROM propostas p
        JOIN clientes c ON c.codcli = p.codcli
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        WHERE ($1::int[] IS NULL OR p.sitpro = ANY($1::int[]))
          AND ($2::int[] IS NULL OR p.codcli = ANY($2::int[]))
          AND ($3::int[] IS NULL OR p.codrep = ANY($3::int[]))
          AND ($4::int[] IS NULL OR p.tipven = ANY($4::int[]))
          AND ($5::int[] IS NULL OR p.modpro = ANY($5::int[]))
          AND ($6::date IS NULL OR p.datpro >= $6::date)
          AND ($7::date IS NULL OR p.datpro <= $7::date)
          AND (${condicaoAlerta})
        ORDER BY p.datpro DESC NULLS LAST, p.codpro DESC
        LIMIT $10 OFFSET $11
        `,
        situacao,
        clientes,
        representantes,
        tipven,
        modpro,
        datproInicio,
        datproFim,
        estagnadaDias,
        SITPRO_EM_DECISAO,
        pageSize,
        offset
      ),
      prisma.$queryRawUnsafe<{ total: number }[]>(
        `
        SELECT COUNT(*)::int AS total
        FROM propostas p
        WHERE ($1::int[] IS NULL OR p.sitpro = ANY($1::int[]))
          AND ($2::int[] IS NULL OR p.codcli = ANY($2::int[]))
          AND ($3::int[] IS NULL OR p.codrep = ANY($3::int[]))
          AND ($4::int[] IS NULL OR p.tipven = ANY($4::int[]))
          AND ($5::int[] IS NULL OR p.modpro = ANY($5::int[]))
          AND ($6::date IS NULL OR p.datpro >= $6::date)
          AND ($7::date IS NULL OR p.datpro <= $7::date)
          AND (${condicaoAlerta})
        `,
        situacao,
        clientes,
        representantes,
        tipven,
        modpro,
        datproInicio,
        datproFim,
        estagnadaDias,
        SITPRO_EM_DECISAO
      ),
    ]);

    const rowsComLabel = rows.map((row) => ({
      ...row,
      situacaoLabel: sitproLabel(row.sitpro),
      situacaoTone: sitproTone(row.sitpro),
      depexeLabel: depexeLabel(row.depexe),
      forfatLabel: forfatLabel(row.forfat),
      modproLabel: modproLabel(row.modpro),
    }));

    res.json({
      rows: rowsComLabel,
      page,
      pageSize,
      total: totalRows[0]?.total ?? 0,
    });
  } catch (error) {
    handleError(res, error, "propostas");
  }
});

// ---------- Drill-down: itens de uma proposta, ordenados pela sequência ----------
projetosRouter.get("/propostas/:codemp/:codpro/itens", async (req, res) => {
  try {
    const codemp = parseIntParam(req.params.codemp);
    const codpro = parseIntParam(req.params.codpro);
    if (codemp === null || codpro === null) {
      res.status(400).json({ error: "codemp/codpro inválidos" });
      return;
    }

    const rows = await prisma.$queryRaw<
      { seqite: number; codser: string; despro: string | null; qtdhor: number | null; valhor: number | null; depexe: number | null }[]
    >`
      SELECT seqite, codser, despro, qtdhor, valhor::float8 AS valhor, depexe
      FROM propostas_itens
      WHERE codemp = ${codemp} AND codpro = ${codpro}
      ORDER BY seqite ASC
    `;

    res.json({
      rows: rows.map((r) => {
        const horas = (r.qtdhor ?? 0) / 60;
        const valhor = r.valhor ?? 0;
        return {
          seqite: r.seqite,
          codser: r.codser,
          despro: r.despro,
          horas,
          valhor,
          valor: horas * valhor,
          depexeLabel: depexeLabel(r.depexe),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "propostas-itens");
  }
});
