import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const clientesFinanceiroRouter = Router();
clientesFinanceiroRouter.use(requireAuth, requireRole("admin"));

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value.split(",").filter((v) => v !== "");
  return items.length > 0 ? items : null;
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
  console.error(`[clientes-financeiro:${label}]`, message);
  res.status(500).json({ error: message });
}

interface Filtros {
  empFil: string[] | null;
  periodoInicio: string;
  periodoFim: string;
}

// Sem período informado, "novo" é avaliado sobre os últimos 90 dias por padrão.
function lerFiltros(req: import("express").Request): Filtros {
  const hoje = new Date().toISOString().slice(0, 10);
  const noventaDiasAtras = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    empFil: parseStringListParam(req.query.empFil),
    periodoInicio: parseDateParam(req.query.periodoInicio) ?? noventaDiasAtras,
    periodoFim: parseDateParam(req.query.periodoFim) ?? hoje,
  };
}

// ---------- Opções de filtro ----------
clientesFinanceiroRouter.get("/opcoes-filtro", async (_req, res) => {
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
clientesFinanceiroRouter.get("/kpis", async (req, res) => {
  try {
    const { empFil, periodoInicio, periodoFim } = lerFiltros(req);

    const [comAberto, novos, perdidos] = await Promise.all([
      prisma.$queryRaw<{ qtd: number }[]>`
        SELECT COUNT(DISTINCT codcli)::int AS qtd
        FROM titulos_receber
        WHERE vlrabe > 0
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
      prisma.$queryRaw<{ qtd: number }[]>`
        WITH primeiro AS (
          SELECT codcli, MIN(datemi) AS primeira_datemi
          FROM titulos_receber
          WHERE sittit NOT IN ('CA', 'LS')
            AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
          GROUP BY codcli
        )
        SELECT COUNT(*)::int AS qtd FROM primeiro
        WHERE primeira_datemi >= ${periodoInicio}::date AND primeira_datemi <= ${periodoFim}::date
      `,
      prisma.$queryRaw<{ qtd: number }[]>`
        WITH atividade AS (
          SELECT codcli, MAX(datemi) AS ultima_datemi
          FROM titulos_receber
          WHERE sittit NOT IN ('CA', 'LS')
            AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
          GROUP BY codcli
        )
        SELECT COUNT(*)::int AS qtd FROM atividade
        WHERE ultima_datemi >= CURRENT_DATE - INTERVAL '12 months'
          AND ultima_datemi < CURRENT_DATE - INTERVAL '3 months'
      `,
    ]);

    res.json({
      qtdClientesComTituloAberto: comAberto[0]?.qtd ?? 0,
      qtdNovos: novos[0]?.qtd ?? 0,
      qtdPerdidos: perdidos[0]?.qtd ?? 0,
    });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Maiores clientes (por valor em aberto) ----------
clientesFinanceiroRouter.get("/maiores", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);

    const rows = await prisma.$queryRaw<{ codcli: number; nomcli: string; qtd: number; valor: number }[]>`
      SELECT t.codcli, c.nomcli, COUNT(*)::int AS qtd, SUM(t.vlrabe)::float8 AS valor
      FROM titulos_receber t
      JOIN clientes c ON c.codcli = t.codcli
      WHERE t.vlrabe > 0
        AND (${empFil}::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY(${empFil}::text[]))
      GROUP BY t.codcli, c.nomcli
      ORDER BY valor DESC
      LIMIT 20
    `;
    res.json({ rows });
  } catch (error) {
    handleError(res, error, "maiores");
  }
});

// ---------- Clientes novos no período ----------
clientesFinanceiroRouter.get("/novos", async (req, res) => {
  try {
    const { empFil, periodoInicio, periodoFim } = lerFiltros(req);

    const rows = await prisma.$queryRaw<{ codcli: number; nomcli: string; qtd: number; valor: number }[]>`
      WITH primeiro AS (
        SELECT codcli, MIN(datemi) AS primeira_datemi
        FROM titulos_receber
        WHERE sittit NOT IN ('CA', 'LS')
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
        GROUP BY codcli
        HAVING MIN(datemi) >= ${periodoInicio}::date AND MIN(datemi) <= ${periodoFim}::date
      )
      SELECT t.codcli, c.nomcli, COUNT(*)::int AS qtd, SUM(t.vlrori)::float8 AS valor
      FROM titulos_receber t
      JOIN primeiro pr ON pr.codcli = t.codcli
      JOIN clientes c ON c.codcli = t.codcli
      WHERE t.sittit NOT IN ('CA', 'LS')
      GROUP BY t.codcli, c.nomcli
      ORDER BY MAX(pr.primeira_datemi) DESC
      LIMIT 20
    `;
    res.json({ rows });
  } catch (error) {
    handleError(res, error, "novos");
  }
});

// ---------- Clientes perdidos ----------
clientesFinanceiroRouter.get("/perdidos", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);

    const rows = await prisma.$queryRaw<{ codcli: number; nomcli: string; qtd: number; valor: number }[]>`
      WITH atividade AS (
        SELECT codcli, MAX(datemi) AS ultima_datemi
        FROM titulos_receber
        WHERE sittit NOT IN ('CA', 'LS')
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
        GROUP BY codcli
        HAVING MAX(datemi) >= CURRENT_DATE - INTERVAL '12 months'
           AND MAX(datemi) < CURRENT_DATE - INTERVAL '3 months'
      )
      SELECT t.codcli, c.nomcli, COUNT(*)::int AS qtd, SUM(t.vlrori)::float8 AS valor
      FROM titulos_receber t
      JOIN atividade a ON a.codcli = t.codcli
      JOIN clientes c ON c.codcli = t.codcli
      WHERE t.sittit NOT IN ('CA', 'LS')
      GROUP BY t.codcli, c.nomcli
      ORDER BY MAX(a.ultima_datemi) DESC
      LIMIT 20
    `;
    res.json({ rows });
  } catch (error) {
    handleError(res, error, "perdidos");
  }
});
