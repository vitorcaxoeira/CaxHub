import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { SITRAT_CONTABILIZADO } from "../domain/contabilDominio";
import { montarMatrizResultado, type ContaParaMatriz } from "../domain/matrizContabil";

export const contabilRouter = Router();
// v1: só admin. O gancho pro "gestor vê só seu departamento" é o filtro de grupo (`despar`)
// + DESPAR_PARA_DEPEXE em contabilDominio.ts — ainda não ligado ao papel do usuário.
contabilRouter.use(requireAuth, requireRole("admin"));

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

function parseBoolParam(value: unknown): boolean {
  return value === "true" || value === "1";
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[contabil:${label}]`, message);
  res.status(500).json({ error: message });
}

const NUM_MESES = 12;

// ---------- Opções de filtro ----------
contabilRouter.get("/resultado/opcoes-filtro", async (_req, res) => {
  try {
    const [anosRows, gruposRows, centrosCusto] = await Promise.all([
      prisma.$queryRaw<{ ano: number }[]>`
        SELECT DISTINCT EXTRACT(YEAR FROM datlct)::int AS ano
        FROM rateios_lancamento
        WHERE sitrat = ${SITRAT_CONTABILIZADO}
        ORDER BY ano DESC
      `,
      prisma.$queryRaw<{ despar: string }[]>`
        SELECT DISTINCT despar
        FROM plano_contabil
        WHERE despar IS NOT NULL AND btrim(despar) <> ''
        ORDER BY despar
      `,
      prisma.centroCusto.findMany({
        select: { codccu: true, desccu: true },
        orderBy: { codccu: "asc" },
      }),
    ]);

    res.json({
      anos: anosRows.map((r) => r.ano),
      grupos: gruposRows.map((r) => ({ value: r.despar, label: r.despar })),
      centrosCusto: centrosCusto.map((c) => ({ value: c.codccu, label: `${c.codccu} - ${c.desccu}` })),
    });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// ---------- Resultado Analítico (realizado por mês) ----------
contabilRouter.get("/resultado", async (req, res) => {
  try {
    const ano = parseIntParam(req.query.ano) ?? new Date().getFullYear();
    const grupos = parseStringListParam(req.query.grupo);
    const centrosCusto = parseStringListParam(req.query.codccu);
    const incluirSemGrupo = parseBoolParam(req.query.incluirSemGrupo);

    const inicio = `${ano}-01-01`;
    const fim = `${ano + 1}-01-01`;

    // Metadados de TODAS as contas do(s) grupo(s) filtrado(s), com ou sem movimento no
    // período — precisa das contas "guarda-chuva" sem movimento próprio pra árvore não
    // ficar com buracos (ver comentário de montarMatrizResultado).
    const contasMetadata = await prisma.$queryRawUnsafe<
      { ctared: number; clacta: string; descta: string; anasin: string; despar: string }[]
    >(
      `
      SELECT ctared, clacta, descta, anasin, btrim(despar) AS despar
      FROM plano_contabil
      WHERE (btrim(despar) <> '' OR $1::boolean)
        AND ($2::text[] IS NULL OR btrim(despar) = ANY($2::text[]))
      ORDER BY ctared
      `,
      incluirSemGrupo,
      grupos
    );

    // Valores realizados por conta × mês, já filtrados pelo mesmo recorte de grupo/CC —
    // agregação até o nível de folha só (o roll-up da hierarquia é feito em Node).
    const valoresLeaf = await prisma.$queryRawUnsafe<{ ctared: number; mes: number; valor: number }[]>(
      `
      SELECT r.ctared AS ctared,
             EXTRACT(MONTH FROM r.datlct)::int AS mes,
             SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
      FROM rateios_lancamento r
      JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
      WHERE r.sitrat = $1
        AND r.datlct >= $2::date AND r.datlct < $3::date
        AND (btrim(pc.despar) <> '' OR $4::boolean)
        AND ($5::text[] IS NULL OR btrim(pc.despar) = ANY($5::text[]))
        AND ($6::text[] IS NULL OR r.codccu = ANY($6::text[]))
      GROUP BY r.ctared, EXTRACT(MONTH FROM r.datlct)
      `,
      SITRAT_CONTABILIZADO,
      inicio,
      fim,
      incluirSemGrupo,
      grupos,
      centrosCusto
    );

    const valoresPorCtared = new Map<number, number[]>();
    for (const linha of valoresLeaf) {
      const vetor = valoresPorCtared.get(linha.ctared) ?? new Array(NUM_MESES).fill(0);
      vetor[linha.mes - 1] = linha.valor;
      valoresPorCtared.set(linha.ctared, vetor);
    }

    const contas: ContaParaMatriz[] = contasMetadata.map((c) => ({
      ctared: c.ctared,
      clacta: c.clacta,
      descta: c.descta,
      anasin: c.anasin,
      despar: c.despar || "Sem grupo",
    }));

    const { linhas, totalGeral } = montarMatrizResultado(contas, valoresPorCtared, NUM_MESES);

    const meses = Array.from({ length: NUM_MESES }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);

    res.json({
      meses,
      linhas,
      totalGeral: { valores: totalGeral, total: totalGeral.reduce((a, b) => a + b, 0) },
    });
  } catch (error) {
    handleError(res, error, "resultado");
  }
});
