import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const inadimplenciaRouter = Router();
inadimplenciaRouter.use(requireAuth, requireRole("admin"));

function parseIntParam(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value.split(",").filter((v) => v !== "");
  return items.length > 0 ? items : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[inadimplencia:${label}]`, message);
  res.status(500).json({ error: message });
}

interface Filtros {
  empFil: string[] | null;
  faixa: string | null;
}

function lerFiltros(req: import("express").Request): Filtros {
  return {
    empFil: parseStringListParam(req.query.empFil),
    faixa: typeof req.query.faixa === "string" && req.query.faixa !== "" ? req.query.faixa : null,
  };
}

// Mesma condição de faixa usada na Aging List da Fase 1 (financeiro.ts).
function condicaoFaixa(faixa: string | null): string {
  if (!faixa) return "TRUE";
  switch (faixa) {
    case "d1_30":
      return "CURRENT_DATE - t.vctpro BETWEEN 1 AND 30";
    case "d31_60":
      return "CURRENT_DATE - t.vctpro BETWEEN 31 AND 60";
    case "d61_90":
      return "CURRENT_DATE - t.vctpro BETWEEN 61 AND 90";
    case "d91_180":
      return "CURRENT_DATE - t.vctpro BETWEEN 91 AND 180";
    case "d180_mais":
      return "CURRENT_DATE - t.vctpro > 180";
    default:
      return "TRUE";
  }
}

// ---------- Opções de filtro ----------
inadimplenciaRouter.get("/opcoes-filtro", async (_req, res) => {
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
inadimplenciaRouter.get("/kpis", async (req, res) => {
  try {
    const { empFil, faixa } = lerFiltros(req);

    const rows = await prisma.$queryRawUnsafe<
      { total_vencido: number; total_aberto: number; qtd_clientes: number; vencido_90d: number }[]
    >(`
      SELECT
        COALESCE(SUM(t.vlrabe), 0)::float8 AS total_vencido,
        (SELECT COALESCE(SUM(vlrabe), 0) FROM titulos_receber WHERE vlrabe > 0
          AND ($1::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($1::text[])))::float8 AS total_aberto,
        COUNT(DISTINCT t.codcli)::int AS qtd_clientes,
        COALESCE(SUM(t.vlrabe) FILTER (WHERE CURRENT_DATE - t.vctpro > 90), 0)::float8 AS vencido_90d
      FROM titulos_receber t
      WHERE t.vlrabe > 0
        AND t.vctpro < CURRENT_DATE
        AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
        AND (${condicaoFaixa(faixa)})
    `, empFil);

    const r = rows[0];
    const pctCarteiraVencida = r.total_aberto > 0 ? (r.total_vencido / r.total_aberto) * 100 : 0;

    res.json({
      totalVencido: r.total_vencido,
      qtdClientesInadimplentes: r.qtd_clientes,
      pctCarteiraVencida,
      vencidoMais90d: r.vencido_90d,
    });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Ranking de devedores ----------
inadimplenciaRouter.get("/ranking-devedores", async (req, res) => {
  try {
    const { empFil, faixa } = lerFiltros(req);

    const rows = await prisma.$queryRawUnsafe<{ codcli: number; nomcli: string; qtd: number; valor: number }[]>(`
      SELECT t.codcli, c.nomcli, COUNT(*)::int AS qtd, SUM(t.vlrabe)::float8 AS valor
      FROM titulos_receber t
      JOIN clientes c ON c.codcli = t.codcli
      WHERE t.vlrabe > 0
        AND t.vctpro < CURRENT_DATE
        AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
        AND (${condicaoFaixa(faixa)})
      GROUP BY t.codcli, c.nomcli
      ORDER BY valor DESC
      LIMIT 20
    `, empFil);

    res.json({ rows });
  } catch (error) {
    handleError(res, error, "ranking-devedores");
  }
});

// ---------- Curva ABC ----------
inadimplenciaRouter.get("/curva-abc", async (req, res) => {
  try {
    const { empFil, faixa } = lerFiltros(req);

    const rows = await prisma.$queryRawUnsafe<{ classe: string; qtd_clientes: number; valor: number }[]>(`
      WITH devedores AS (
        SELECT t.codcli, SUM(t.vlrabe) AS valor
        FROM titulos_receber t
        WHERE t.vlrabe > 0
          AND t.vctpro < CURRENT_DATE
          AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
          AND (${condicaoFaixa(faixa)})
        GROUP BY t.codcli
      ),
      ranked AS (
        SELECT codcli, valor,
               SUM(valor) OVER (ORDER BY valor DESC) AS acumulado,
               SUM(valor) OVER ()::float8 AS total
        FROM devedores
      ),
      classificados AS (
        SELECT codcli, valor,
               CASE
                 WHEN total = 0 THEN 'C'
                 WHEN acumulado <= total * 0.8 THEN 'A'
                 WHEN acumulado <= total * 0.95 THEN 'B'
                 ELSE 'C'
               END AS classe
        FROM ranked
      )
      SELECT classe, COUNT(*)::int AS qtd_clientes, SUM(valor)::float8 AS valor
      FROM classificados
      GROUP BY classe
      ORDER BY classe
    `, empFil);

    const totalValor = rows.reduce((sum, r) => sum + r.valor, 0);
    const curva = rows.map((r) => ({
      classe: r.classe,
      qtdClientes: r.qtd_clientes,
      valor: r.valor,
      pct: totalValor > 0 ? Math.round((r.valor / totalValor) * 100) : 0,
    }));

    res.json({ curva });
  } catch (error) {
    handleError(res, error, "curva-abc");
  }
});

// ---------- Lista paginada (títulos vencidos) ----------
inadimplenciaRouter.get("/", async (req, res) => {
  try {
    const { empFil, faixa } = lerFiltros(req);
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize) ?? 50));
    const offset = (page - 1) * pageSize;

    const rows = await prisma.$queryRawUnsafe<
      {
        codemp: number;
        codfil: number;
        numtit: string;
        codcli: number;
        nomcli: string;
        vctpro: Date;
        vlrabe: number;
        dias_atraso: number;
      }[]
    >(`
      SELECT t.codemp, t.codfil, t.numtit, t.codcli, c.nomcli, t.vctpro, t.vlrabe::float8 AS vlrabe,
             (CURRENT_DATE - t.vctpro)::int AS dias_atraso
      FROM titulos_receber t
      JOIN clientes c ON c.codcli = t.codcli
      WHERE t.vlrabe > 0
        AND t.vctpro < CURRENT_DATE
        AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
        AND (${condicaoFaixa(faixa)})
      ORDER BY dias_atraso DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `, empFil);

    const totalRows = await prisma.$queryRawUnsafe<{ total: number }[]>(`
      SELECT COUNT(*)::int AS total
      FROM titulos_receber t
      WHERE t.vlrabe > 0
        AND t.vctpro < CURRENT_DATE
        AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
        AND (${condicaoFaixa(faixa)})
    `, empFil);

    res.json({ rows, page, pageSize, total: totalRows[0]?.total ?? 0 });
  } catch (error) {
    handleError(res, error, "lista");
  }
});
