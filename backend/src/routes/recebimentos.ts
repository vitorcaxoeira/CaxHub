import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const recebimentosRouter = Router();
recebimentosRouter.use(requireAuth);

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
  // Datas com ano fora desse intervalo geralmente vêm de estados intermediários
  // de digitação no <input type="date"> nativo (ex.: "0002-01-01" ao digitar
  // "2026" dígito a dígito) — sem isso, um generate_series com séculos de
  // diferença trava o /por-dia.
  return ano >= 1900 && ano <= 2100 ? value : null;
}

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[recebimentos:${label}]`, message);
  res.status(500).json({ error: message });
}

interface FiltrosRecebimentos {
  empFil: string[] | null;
  portadores: string[] | null;
  contas: string[] | null;
  clientes: number[] | null;
  datpgtInicio: string;
  datpgtFim: string;
}

// Sem período informado, olha os últimos 30 dias por padrão (visão operacional recente).
function lerFiltros(req: import("express").Request): FiltrosRecebimentos {
  const hoje = new Date().toISOString().slice(0, 10);
  const trintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    empFil: parseStringListParam(req.query.empFil),
    portadores: parseStringListParam(req.query.portadores),
    contas: parseStringListParam(req.query.contas),
    clientes: parseIdsParam(req.query.clientes),
    datpgtInicio: parseDateParam(req.query.datpgtInicio) ?? trintaDiasAtras,
    datpgtFim: parseDateParam(req.query.datpgtFim) ?? hoje,
  };
}

// ---------- Opções de filtro ----------
recebimentosRouter.get("/opcoes-filtro", async (_req, res) => {
  try {
    const [empresas, filiais, portadores, contas] = await Promise.all([
      prisma.empresa.findMany({ select: { codemp: true, nomemp: true, sigemp: true }, orderBy: { codemp: "asc" } }),
      prisma.filial.findMany({ select: { codemp: true, codfil: true, nomfil: true, sigfil: true }, orderBy: [{ codemp: "asc" }, { codfil: "asc" }] }),
      prisma.$queryRaw<{ codemp: number; codpor: string; despor: string }[]>`
        SELECT DISTINCT p.codemp, p.codpor, p.despor
        FROM portadores p
        WHERE EXISTS (SELECT 1 FROM movimentos_receber m WHERE m.codpor = p.codpor)
        ORDER BY p.despor
      `,
      prisma.$queryRaw<{ codemp: number; numcco: string; descco: string }[]>`
        SELECT DISTINCT c.codemp, c.numcco, c.descco
        FROM contas_correntes c
        WHERE c.sitcco = 'A'
          AND EXISTS (SELECT 1 FROM movimentos_receber m WHERE m.codemp = c.codemp AND m.numcco = c.numcco)
        ORDER BY c.descco
      `,
    ]);
    res.json({ empresas, filiais, portadores, contas });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// ---------- KPIs ----------
recebimentosRouter.get("/kpis", async (req, res) => {
  try {
    const { empFil, portadores, contas, clientes, datpgtInicio, datpgtFim } = lerFiltros(req);

    const rows = await prisma.$queryRaw<
      { total_recebido: number; qtd: number; qtd_no_prazo: number }[]
    >`
      SELECT
        COALESCE(SUM(m.vlrliq), 0)::float8 AS total_recebido,
        COUNT(*)::int AS qtd,
        COUNT(*) FILTER (WHERE COALESCE(m.diaatr, 0) <= 0)::int AS qtd_no_prazo
      FROM movimentos_receber m
      JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
      JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
      WHERE tr.rectpb = 'PG'
        AND m.datpgt >= ${datpgtInicio}::date
        AND m.datpgt <= ${datpgtFim}::date
        AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
        AND (${portadores}::text[] IS NULL OR m.codpor = ANY(${portadores}::text[]))
        AND (${contas}::text[] IS NULL OR m.numcco = ANY(${contas}::text[]))
        AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
    `;

    const r = rows[0];
    const ticketMedio = r.qtd > 0 ? r.total_recebido / r.qtd : 0;
    const pctNoPrazo = r.qtd > 0 ? (r.qtd_no_prazo / r.qtd) * 100 : 0;

    res.json({ totalRecebido: r.total_recebido, qtdRecebimentos: r.qtd, ticketMedio, pctNoPrazo });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Recebido por dia ----------
recebimentosRouter.get("/por-dia", async (req, res) => {
  try {
    const { empFil, portadores, contas, clientes, datpgtInicio, datpgtFim } = lerFiltros(req);

    // Segunda camada de proteção: mesmo com parseDateParam validando o ano,
    // um intervalo absurdo aqui geraria um generate_series gigante e travaria
    // a resposta (e o navegador, tentando renderizar o gráfico inteiro).
    const MAX_DIAS = 731;
    const inicioMs = new Date(datpgtInicio).getTime();
    const fimMs = new Date(datpgtFim).getTime();
    const diasNoIntervalo = Math.round((fimMs - inicioMs) / (24 * 60 * 60 * 1000));
    const inicioEfetivo =
      diasNoIntervalo > MAX_DIAS
        ? new Date(fimMs - MAX_DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : datpgtInicio;

    const rows = await prisma.$queryRaw<{ dia: string; valor: number }[]>`
      WITH dias AS (
        SELECT generate_series(${inicioEfetivo}::date, ${datpgtFim}::date, INTERVAL '1 day') AS dia
      ),
      pagos AS (
        SELECT m.datpgt, m.vlrliq
        FROM movimentos_receber m
        JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG'
          AND m.datpgt >= ${inicioEfetivo}::date
          AND m.datpgt <= ${datpgtFim}::date
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
          AND (${portadores}::text[] IS NULL OR m.codpor = ANY(${portadores}::text[]))
          AND (${contas}::text[] IS NULL OR m.numcco = ANY(${contas}::text[]))
          AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
      )
      SELECT to_char(d.dia, 'DD/MM') AS dia, COALESCE(SUM(p.vlrliq), 0)::float8 AS valor
      FROM dias d
      LEFT JOIN pagos p ON p.datpgt = d.dia
      GROUP BY d.dia
      ORDER BY d.dia
    `;

    res.json({ serie: rows });
  } catch (error) {
    handleError(res, error, "por-dia");
  }
});

// ---------- Recebido por portador ----------
recebimentosRouter.get("/por-portador", async (req, res) => {
  try {
    const { empFil, portadores, contas, clientes, datpgtInicio, datpgtFim } = lerFiltros(req);

    const rows = await prisma.$queryRaw<{ codpor: string; despor: string; qtd: number; valor: number }[]>`
      SELECT m.codpor, COALESCE(p.despor, 'Portador ' || m.codpor) AS despor,
             COUNT(*)::int AS qtd, COALESCE(SUM(m.vlrliq), 0)::float8 AS valor
      FROM movimentos_receber m
      JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
      JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
      LEFT JOIN portadores p ON p.codemp = m.codemp AND p.codpor = m.codpor
      WHERE tr.rectpb = 'PG'
        AND m.datpgt >= ${datpgtInicio}::date
        AND m.datpgt <= ${datpgtFim}::date
        AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
        AND (${portadores}::text[] IS NULL OR m.codpor = ANY(${portadores}::text[]))
        AND (${contas}::text[] IS NULL OR m.numcco = ANY(${contas}::text[]))
        AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
      GROUP BY m.codpor, p.despor
      ORDER BY valor DESC
      LIMIT 10
    `;

    res.json({ rows });
  } catch (error) {
    handleError(res, error, "por-portador");
  }
});

// ---------- Recebido por conta (só contas ativas, sitcco='A') ----------
recebimentosRouter.get("/por-conta", async (req, res) => {
  try {
    const { empFil, portadores, contas, clientes, datpgtInicio, datpgtFim } = lerFiltros(req);

    const rows = await prisma.$queryRaw<{ numcco: string; descco: string; qtd: number; valor: number }[]>`
      SELECT m.numcco, c.descco, COUNT(*)::int AS qtd, COALESCE(SUM(m.vlrliq), 0)::float8 AS valor
      FROM movimentos_receber m
      JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
      JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
      JOIN contas_correntes c ON c.codemp = m.codemp AND c.numcco = m.numcco AND c.sitcco = 'A'
      WHERE tr.rectpb = 'PG'
        AND m.datpgt >= ${datpgtInicio}::date
        AND m.datpgt <= ${datpgtFim}::date
        AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
        AND (${portadores}::text[] IS NULL OR m.codpor = ANY(${portadores}::text[]))
        AND (${contas}::text[] IS NULL OR m.numcco = ANY(${contas}::text[]))
        AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
      GROUP BY m.numcco, c.descco
      ORDER BY valor DESC
      LIMIT 10
    `;

    res.json({ rows });
  } catch (error) {
    handleError(res, error, "por-conta");
  }
});

// ---------- Lista paginada ----------
recebimentosRouter.get("/", async (req, res) => {
  try {
    const { empFil, portadores, contas, clientes, datpgtInicio, datpgtFim } = lerFiltros(req);
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize) ?? 50));
    const offset = (page - 1) * pageSize;

    const [rows, totalRows] = await Promise.all([
      prisma.$queryRaw<
        {
          codemp: number;
          codfil: number;
          numtit: string;
          codtpt: string;
          codcli: number;
          nomcli: string;
          datpgt: Date;
          vlrliq: number;
          codpor: string | null;
          despor: string | null;
          descco: string | null;
        }[]
      >`
        SELECT m.codemp, m.codfil, m.numtit, m.codtpt, t.codcli, c.nomcli, m.datpgt, m.vlrliq::float8 AS vlrliq,
               m.codpor, p.despor, cc.descco
        FROM movimentos_receber m
        JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
        JOIN clientes c ON c.codcli = t.codcli
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        LEFT JOIN portadores p ON p.codemp = m.codemp AND p.codpor = m.codpor
        LEFT JOIN contas_correntes cc ON cc.codemp = m.codemp AND cc.numcco = m.numcco
        WHERE tr.rectpb = 'PG'
          AND m.datpgt >= ${datpgtInicio}::date
          AND m.datpgt <= ${datpgtFim}::date
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
          AND (${portadores}::text[] IS NULL OR m.codpor = ANY(${portadores}::text[]))
          AND (${contas}::text[] IS NULL OR m.numcco = ANY(${contas}::text[]))
          AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
        ORDER BY m.datpgt DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total
        FROM movimentos_receber m
        JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG'
          AND m.datpgt >= ${datpgtInicio}::date
          AND m.datpgt <= ${datpgtFim}::date
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
          AND (${portadores}::text[] IS NULL OR m.codpor = ANY(${portadores}::text[]))
          AND (${contas}::text[] IS NULL OR m.numcco = ANY(${contas}::text[]))
          AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
      `,
    ]);

    res.json({ rows, page, pageSize, total: totalRows[0]?.total ?? 0 });
  } catch (error) {
    handleError(res, error, "lista");
  }
});
