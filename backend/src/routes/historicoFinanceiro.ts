import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const historicoFinanceiroRouter = Router();
historicoFinanceiroRouter.use(requireAuth, requireRole("admin"));

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value.split(",").filter((v) => v !== "");
  return items.length > 0 ? items : null;
}

function parseIntParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[historico-financeiro:${label}]`, message);
  res.status(500).json({ error: message });
}

interface Filtros {
  empFil: string[] | null;
  meses: number;
}

// Janela padrão de 12 meses; aceita 12/24/36 conforme o filtro.
function lerFiltros(req: import("express").Request): Filtros {
  const meses = parseIntParam(req.query.meses);
  return {
    empFil: parseStringListParam(req.query.empFil),
    meses: meses === 24 || meses === 36 ? meses : 12,
  };
}

// ---------- Opções de filtro ----------
historicoFinanceiroRouter.get("/opcoes-filtro", async (_req, res) => {
  try {
    const [empresas, filiais] = await Promise.all([
      prisma.empresa.findMany({ select: { codemp: true, nomemp: true, sigemp: true }, orderBy: { codemp: "asc" } }),
      prisma.filial.findMany({ select: { codemp: true, codfil: true, nomfil: true, sigfil: true }, orderBy: [{ codemp: "asc" }, { codfil: "asc" }] }),
    ]);
    res.json({ empresas, filiais });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// ---------- KPIs ----------
historicoFinanceiroRouter.get("/kpis", async (req, res) => {
  try {
    const { empFil, meses } = lerFiltros(req);

    const rows = await prisma.$queryRawUnsafe<{ emitido: number; recebido: number; qtd_recebido: number }[]>(
      `
      SELECT
        (SELECT COALESCE(SUM(vlrori), 0) FROM titulos_receber
          WHERE datemi >= CURRENT_DATE - INTERVAL '${meses} months'
            AND ($1::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($1::text[])))::float8 AS emitido,
        (SELECT COALESCE(SUM(m.vlrliq), 0) FROM movimentos_receber m
          JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
          WHERE tr.rectpb = 'PG' AND m.datpgt >= CURRENT_DATE - INTERVAL '${meses} months'
            AND ($1::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY($1::text[])))::float8 AS recebido,
        (SELECT COUNT(*) FROM movimentos_receber m
          JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
          WHERE tr.rectpb = 'PG' AND m.datpgt >= CURRENT_DATE - INTERVAL '${meses} months'
            AND ($1::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY($1::text[])))::int AS qtd_recebido
      `,
      empFil
    );

    const r = rows[0];
    const ticketMedio = r.qtd_recebido > 0 ? r.recebido / r.qtd_recebido : 0;

    res.json({ emitido: r.emitido, recebido: r.recebido, ticketMedio });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Série emitido × recebido ----------
historicoFinanceiroRouter.get("/serie", async (req, res) => {
  try {
    const { empFil, meses } = lerFiltros(req);

    const rows = await prisma.$queryRawUnsafe<{ mes: string; emitido: number; recebido: number }[]>(
      `
      WITH meses_serie AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '${meses - 1} months',
          date_trunc('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS mes
      ),
      emitidos AS (
        SELECT date_trunc('month', datemi) AS mes, SUM(vlrori) AS valor
        FROM titulos_receber
        WHERE ($1::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($1::text[]))
        GROUP BY 1
      ),
      recebidos AS (
        SELECT date_trunc('month', m.datpgt) AS mes, SUM(m.vlrliq) AS valor
        FROM movimentos_receber m
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG'
          AND ($1::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY($1::text[]))
        GROUP BY 1
      )
      SELECT to_char(ms.mes, 'MM/YYYY') AS mes,
             COALESCE(em.valor, 0)::float8 AS emitido,
             COALESCE(re.valor, 0)::float8 AS recebido
      FROM meses_serie ms
      LEFT JOIN emitidos em ON em.mes = ms.mes
      LEFT JOIN recebidos re ON re.mes = ms.mes
      ORDER BY ms.mes
      `,
      empFil
    );

    res.json({ serie: rows });
  } catch (error) {
    handleError(res, error, "serie");
  }
});
