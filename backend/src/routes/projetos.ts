import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const projetosRouter = Router();
projetosRouter.use(requireAuth);

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

// Domínio "USU_SitPro" do Senior (situação da proposta).
const SITPRO_LABELS: Record<number, string> = {
  1: "Abertura",
  2: "Comercial",
  3: "Enviada p/ Cliente",
  4: "Aprovada",
  5: "Rejeitada",
  6: "Cancelada",
  7: "Em Execução",
  8: "Executada",
  9: "Levantamento Interno",
};
const SITPRO_ORDER = [1, 2, 3, 4, 7, 9, 8, 5, 6];

// "Pipeline em aberto" = ainda não decidida (nem aprovada, nem perdida) e ainda não virou projeto.
const SITPRO_ABERTA = [1, 2, 3, 9];

// Domínio "USU_TipVen" do Senior (tipo de venda de serviços).
const TIPVEN_LABELS: Record<number, string> = {
  1: "Venda Serviços Cliente Novo",
  2: "Venda Consultiva Serviços Base",
  3: "Venda Serviços Reativa Base Clientes",
  4: "Outros Tipos de Propostas",
};

// Domínio "USU_ModPro" do Senior (modalidade da proposta).
const MODPRO_LABELS: Record<number, string> = {
  0: "Serviço",
  1: "Levantamento",
  2: "DRM",
};

function sitproLabel(sitpro: number | null): string {
  if (sitpro === null) return "Sem situação";
  return SITPRO_LABELS[sitpro] ?? `Situação ${sitpro}`;
}

function sitproTone(sitpro: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (sitpro === 7) return "success";
  if (sitpro === 4 || sitpro === 8) return "success";
  if (sitpro === 5 || sitpro === 6) return "destructive";
  if (sitpro === 1 || sitpro === 2 || sitpro === 3 || sitpro === 9) return "warning";
  return "neutral";
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

// ---------- Série temporal (12 meses): criadas vs aprovadas ----------
projetosRouter.get("/propostas/serie-temporal", async (req, res) => {
  try {
    const { clientes, representantes, tipven, modpro } = lerFiltrosComuns(req);

    const rows = await prisma.$queryRaw<{ mes: string; criadas: number; aprovadas: number }[]>`
      WITH meses AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
          date_trunc('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS mes
      ),
      filtradas AS (
        SELECT p.datpro, p.sitpro
        FROM propostas p
        WHERE p.datpro >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
      )
      SELECT to_char(m.mes, 'YYYY-MM') AS mes,
             COUNT(f.datpro)::int AS criadas,
             COUNT(*) FILTER (WHERE f.sitpro = 4)::int AS aprovadas
      FROM meses m
      LEFT JOIN filtradas f ON date_trunc('month', f.datpro) = m.mes
      GROUP BY m.mes
      ORDER BY m.mes
    `;

    res.json({ serie: rows });
  } catch (error) {
    handleError(res, error, "serie-temporal");
  }
});

// ---------- Lista paginada ----------
projetosRouter.get("/propostas", async (req, res) => {
  try {
    const situacao = parseIdsParam(req.query.situacao);
    const { clientes, representantes, tipven, modpro, datproInicio, datproFim } = lerFiltrosComuns(req);
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize) ?? 50));
    const offset = (page - 1) * pageSize;

    const [rows, totalRows] = await Promise.all([
      prisma.$queryRaw<
        {
          codemp: number;
          codpro: number;
          codcli: number;
          nomcli: string;
          datpro: Date | null;
          sitpro: number | null;
          numprj: number | null;
          valor: number;
          pripro: number | null;
          gerente: string;
        }[]
      >`
        WITH item_valor AS (
          SELECT codemp, codpro, SUM(qtdhor::numeric / 60 * COALESCE(valhor, 0))::float8 AS valor
          FROM propostas_itens
          GROUP BY codemp, codpro
        )
        SELECT p.codemp, p.codpro, p.codcli, c.nomcli, p.datpro, p.sitpro, p.numprj,
               COALESCE(iv.valor, 0) AS valor, p.pripro,
               COALESCE(cons.nomcom, 'Consultor não identificado') AS gerente
        FROM propostas p
        JOIN clientes c ON c.codcli = p.codcli
        LEFT JOIN item_valor iv ON iv.codemp = p.codemp AND iv.codpro = p.codpro
        LEFT JOIN consultores cons ON cons.codemp = p.codemp AND cons.codusu = p.usuger
        WHERE (${situacao}::int[] IS NULL OR p.sitpro = ANY(${situacao}::int[]))
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
        ORDER BY p.datpro DESC NULLS LAST, p.codpro DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM propostas p
        WHERE (${situacao}::int[] IS NULL OR p.sitpro = ANY(${situacao}::int[]))
          AND (${clientes}::int[] IS NULL OR p.codcli = ANY(${clientes}::int[]))
          AND (${representantes}::int[] IS NULL OR p.codrep = ANY(${representantes}::int[]))
          AND (${tipven}::int[] IS NULL OR p.tipven = ANY(${tipven}::int[]))
          AND (${modpro}::int[] IS NULL OR p.modpro = ANY(${modpro}::int[]))
          AND (${datproInicio}::date IS NULL OR p.datpro >= ${datproInicio}::date)
          AND (${datproFim}::date IS NULL OR p.datpro <= ${datproFim}::date)
      `,
    ]);

    const rowsComLabel = rows.map((row) => ({
      ...row,
      situacaoLabel: sitproLabel(row.sitpro),
      situacaoTone: sitproTone(row.sitpro),
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
