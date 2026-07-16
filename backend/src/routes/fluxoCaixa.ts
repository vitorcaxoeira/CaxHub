import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const fluxoCaixaRouter = Router();
fluxoCaixaRouter.use(requireAuth);

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value.split(",").filter((v) => v !== "");
  return items.length > 0 ? items : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fluxo-caixa:${label}]`, message);
  res.status(500).json({ error: message });
}

interface Filtros {
  empFil: string[] | null;
  granularidade: "semana" | "mes";
}

function lerFiltros(req: import("express").Request): Filtros {
  const granularidade = req.query.granularidade === "mes" ? "mes" : "semana";
  return { empFil: parseStringListParam(req.query.empFil), granularidade };
}

// ---------- Opções de filtro ----------
fluxoCaixaRouter.get("/opcoes-filtro", async (_req, res) => {
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
fluxoCaixaRouter.get("/kpis", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);

    const [previstoRows, realizadoRows] = await Promise.all([
      // Previsto: títulos em aberto com vencimento nas próximas 8 semanas.
      prisma.$queryRaw<{ previsto: number }[]>`
        SELECT COALESCE(SUM(vlrabe), 0)::float8 AS previsto
        FROM titulos_receber
        WHERE vlrabe > 0
          AND vctpro >= CURRENT_DATE AND vctpro < CURRENT_DATE + INTERVAL '56 days'
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
      // Realizado: pago nas últimas 8 semanas (mesma janela de tamanho, mas olhando pra trás).
      prisma.$queryRaw<{ realizado: number }[]>`
        SELECT COALESCE(SUM(m.vlrliq), 0)::float8 AS realizado
        FROM movimentos_receber m
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG'
          AND m.datpgt >= CURRENT_DATE - INTERVAL '56 days' AND m.datpgt < CURRENT_DATE
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
      `,
    ]);

    const previsto = previstoRows[0]?.previsto ?? 0;
    const realizado = realizadoRows[0]?.realizado ?? 0;

    res.json({ previsto, realizado });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Série previsto × realizado ----------
fluxoCaixaRouter.get("/serie", async (req, res) => {
  try {
    const { empFil, granularidade } = lerFiltros(req);
    const intervalo = granularidade === "mes" ? "1 month" : "1 week";
    const janelaPassado = granularidade === "mes" ? "6 months" : "8 weeks";
    const janelaFuturo = granularidade === "mes" ? "6 months" : "8 weeks";
    const trunc = granularidade === "mes" ? "month" : "week";

    const rows = await prisma.$queryRawUnsafe<{ periodo: string; previsto: number; realizado: number }[]>(
      `
      WITH periodos AS (
        SELECT generate_series(
          date_trunc('${trunc}', CURRENT_DATE) - INTERVAL '${janelaPassado}',
          date_trunc('${trunc}', CURRENT_DATE) + INTERVAL '${janelaFuturo}',
          INTERVAL '${intervalo}'
        ) AS periodo
      ),
      previstos AS (
        SELECT date_trunc('${trunc}', vctpro) AS periodo, SUM(vlrabe) AS valor
        FROM titulos_receber
        WHERE vlrabe > 0
          AND ($1::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($1::text[]))
        GROUP BY 1
      ),
      realizados AS (
        SELECT date_trunc('${trunc}', m.datpgt) AS periodo, SUM(m.vlrliq) AS valor
        FROM movimentos_receber m
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG'
          AND ($1::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY($1::text[]))
        GROUP BY 1
      )
      SELECT to_char(p.periodo, 'DD/MM') AS periodo,
             COALESCE(pr.valor, 0)::float8 AS previsto,
             COALESCE(re.valor, 0)::float8 AS realizado
      FROM periodos p
      LEFT JOIN previstos pr ON pr.periodo = p.periodo
      LEFT JOIN realizados re ON re.periodo = p.periodo
      ORDER BY p.periodo
      `,
      empFil
    );

    res.json({ serie: rows });
  } catch (error) {
    handleError(res, error, "serie");
  }
});
