import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  runSincronizacaoContasReceber,
  sincronizacaoContasReceberEmAndamento,
} from "../sync/contasReceberSyncOrchestrator";

const JOBS_CONTAS_RECEBER = [
  "empresa-sync",
  "filial-sync",
  "cliente-sync",
  "tipos_titulo-sync",
  "transacoes-sync",
  "titulos_receber-sync",
  "movimentos_receber-sync",
  "portadores-sync",
  "contas_correntes-sync",
];

export const financeiroRouter = Router();
financeiroRouter.use(requireAuth, requireRole("admin"));

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
  console.error(`[financeiro:${label}]`, message);
  res.status(500).json({ error: message });
}

// ---------- Opções de filtro (empresa/filial) ----------
financeiroRouter.get("/contas-a-receber/opcoes-filtro", async (_req, res) => {
  try {
    const [empresas, filiais, portadores] = await Promise.all([
      prisma.empresa.findMany({ select: { codemp: true, nomemp: true, sigemp: true }, orderBy: { codemp: "asc" } }),
      prisma.filial.findMany({ select: { codemp: true, codfil: true, nomfil: true, sigfil: true }, orderBy: [{ codemp: "asc" }, { codfil: "asc" }] }),
      prisma.$queryRaw<{ codemp: number; codpor: string; despor: string }[]>`
        SELECT DISTINCT p.codemp, p.codpor, p.despor
        FROM portadores p
        WHERE EXISTS (
          SELECT 1 FROM titulos_receber t WHERE t.codemp = p.codemp AND t.codpor = p.codpor
        )
        ORDER BY p.despor
      `,
    ]);
    res.json({ empresas, filiais, portadores });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// ---------- Busca de clientes (autocomplete multi-seleção) ----------
financeiroRouter.get("/contas-a-receber/clientes-busca", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length === 0) {
      res.json({ clientes: [] });
      return;
    }
    const clientes = await prisma.$queryRaw<{ codcli: number; nomcli: string }[]>`
      SELECT codcli, nomcli
      FROM clientes
      WHERE nomcli ILIKE ${"%" + q + "%"} OR CAST(codcli AS TEXT) ILIKE ${"%" + q + "%"}
      ORDER BY nomcli
      LIMIT 20
    `;
    res.json({ clientes });
  } catch (error) {
    handleError(res, error, "clientes-busca");
  }
});

// ---------- KPIs ----------
financeiroRouter.get("/contas-a-receber/kpis", async (req, res) => {
  try {
    const empFil = parseStringListParam(req.query.empFil);
    const clientes = parseIdsParam(req.query.clientes);
    const portadores = parseStringListParam(req.query.portadores);
    const vctproInicio = parseDateParam(req.query.vctproInicio);
    const vctproFim = parseDateParam(req.query.vctproFim);
    const datemiInicio = parseDateParam(req.query.datemiInicio);
    const datemiFim = parseDateParam(req.query.datemiFim);

    const [abertoRows, recebidoRows, prazoRows] = await Promise.all([
      prisma.$queryRaw<
        {
          total_aberto: number;
          total_vencido: number;
          total_a_vencer: number;
          titulos_abertos_qtd: number;
          aging_medio_dias: number;
          vendas_90d: number;
        }[]
      >`
        SELECT
          COALESCE(SUM(CASE WHEN vlrabe > 0 THEN vlrabe END), 0)::float8 AS total_aberto,
          COALESCE(SUM(CASE WHEN vlrabe > 0 AND vctpro < CURRENT_DATE THEN vlrabe END), 0)::float8 AS total_vencido,
          COALESCE(SUM(CASE WHEN vlrabe > 0 AND vctpro >= CURRENT_DATE THEN vlrabe END), 0)::float8 AS total_a_vencer,
          COUNT(*) FILTER (WHERE vlrabe > 0)::int AS titulos_abertos_qtd,
          COALESCE(
            SUM(CASE WHEN vlrabe > 0 AND vctpro < CURRENT_DATE THEN vlrabe * (CURRENT_DATE - vctpro) END)
            / NULLIF(SUM(CASE WHEN vlrabe > 0 AND vctpro < CURRENT_DATE THEN vlrabe END), 0)
          , 0)::float8 AS aging_medio_dias,
          COALESCE(SUM(CASE WHEN datemi >= CURRENT_DATE - INTERVAL '90 days' THEN vlrori END), 0)::float8 AS vendas_90d
        FROM titulos_receber
        WHERE (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
          AND (${clientes}::int[] IS NULL OR codcli = ANY(${clientes}::int[]))
          AND (${portadores}::text[] IS NULL OR codpor = ANY(${portadores}::text[]))
          AND (${vctproInicio}::date IS NULL OR vctpro >= ${vctproInicio}::date)
          AND (${vctproFim}::date IS NULL OR vctpro <= ${vctproFim}::date)
          AND (${datemiInicio}::date IS NULL OR datemi >= ${datemiInicio}::date)
          AND (${datemiFim}::date IS NULL OR datemi <= ${datemiFim}::date)
      `,
      prisma.$queryRaw<
        {
          recebido_hoje: number;
          recebido_semana: number;
          recebido_mes: number;
          recebido_ano: number;
          recebido_mes_anterior: number;
        }[]
      >`
        SELECT
          COALESCE(SUM(CASE WHEN m.datpgt = CURRENT_DATE THEN m.vlrliq END), 0)::float8 AS recebido_hoje,
          COALESCE(SUM(CASE WHEN m.datpgt >= date_trunc('week', CURRENT_DATE)::date
                              AND m.datpgt < (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::date THEN m.vlrliq END), 0)::float8 AS recebido_semana,
          COALESCE(SUM(CASE WHEN m.datpgt >= date_trunc('month', CURRENT_DATE)::date THEN m.vlrliq END), 0)::float8 AS recebido_mes,
          COALESCE(SUM(CASE WHEN m.datpgt >= date_trunc('year', CURRENT_DATE)::date THEN m.vlrliq END), 0)::float8 AS recebido_ano,
          COALESCE(SUM(CASE WHEN m.datpgt >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date
                              AND m.datpgt < date_trunc('month', CURRENT_DATE)::date THEN m.vlrliq END), 0)::float8 AS recebido_mes_anterior
        FROM movimentos_receber m
        JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE m.datpgt IS NOT NULL
          AND tr.rectpb = 'PG'
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
          AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
          AND (${portadores}::text[] IS NULL OR t.codpor = ANY(${portadores}::text[]))
          AND (${vctproInicio}::date IS NULL OR t.vctpro >= ${vctproInicio}::date)
          AND (${vctproFim}::date IS NULL OR t.vctpro <= ${vctproFim}::date)
          AND (${datemiInicio}::date IS NULL OR t.datemi >= ${datemiInicio}::date)
          AND (${datemiFim}::date IS NULL OR t.datemi <= ${datemiFim}::date)
      `,
      prisma.$queryRaw<{ prazo_medio_dias: number }[]>`
        SELECT COALESCE(
          SUM((m.datpgt - t.datemi) * m.vlrliq) / NULLIF(SUM(m.vlrliq), 0)
        , 0)::float8 AS prazo_medio_dias
        FROM movimentos_receber m
        JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE m.datpgt IS NOT NULL AND m.datpgt >= CURRENT_DATE - INTERVAL '90 days'
          AND tr.rectpb = 'PG'
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
          AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
          AND (${portadores}::text[] IS NULL OR t.codpor = ANY(${portadores}::text[]))
          AND (${vctproInicio}::date IS NULL OR t.vctpro >= ${vctproInicio}::date)
          AND (${vctproFim}::date IS NULL OR t.vctpro <= ${vctproFim}::date)
          AND (${datemiInicio}::date IS NULL OR t.datemi >= ${datemiInicio}::date)
          AND (${datemiFim}::date IS NULL OR t.datemi <= ${datemiFim}::date)
      `,
    ]);

    const aberto = abertoRows[0];
    const recebido = recebidoRows[0];
    const prazoMedioDias = prazoRows[0]?.prazo_medio_dias ?? 0;

    const inadimplenciaPct = aberto.total_aberto > 0 ? (aberto.total_vencido / aberto.total_aberto) * 100 : 0;
    const ticketMedio = aberto.titulos_abertos_qtd > 0 ? aberto.total_aberto / aberto.titulos_abertos_qtd : 0;
    const crescimentoMensalPct =
      recebido.recebido_mes_anterior > 0
        ? ((recebido.recebido_mes - recebido.recebido_mes_anterior) / recebido.recebido_mes_anterior) * 100
        : 0;
    const dsoAproximado = aberto.vendas_90d > 0 ? (aberto.total_aberto / aberto.vendas_90d) * 90 : 0;

    res.json({
      totalAberto: aberto.total_aberto,
      totalVencido: aberto.total_vencido,
      totalAVencer: aberto.total_a_vencer,
      titulosAbertosQtd: aberto.titulos_abertos_qtd,
      agingMedioDias: aberto.aging_medio_dias,
      recebidoHoje: recebido.recebido_hoje,
      recebidoSemana: recebido.recebido_semana,
      recebidoMes: recebido.recebido_mes,
      recebidoAno: recebido.recebido_ano,
      prazoMedioDias,
      inadimplenciaPct,
      ticketMedio,
      crescimentoMensalPct,
      dsoAproximado,
    });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Aging buckets ----------
const BUCKET_ORDER = ["a_vencer", "d1_30", "d31_60", "d61_90", "d91_180", "d180_mais"] as const;
const BUCKET_LABELS: Record<(typeof BUCKET_ORDER)[number], string> = {
  a_vencer: "A vencer",
  d1_30: "1–30 dias",
  d31_60: "31–60 dias",
  d61_90: "61–90 dias",
  d91_180: "91–180 dias",
  d180_mais: "180+ dias",
};

financeiroRouter.get("/contas-a-receber/aging-buckets", async (req, res) => {
  try {
    const empFil = parseStringListParam(req.query.empFil);
    const clientes = parseIdsParam(req.query.clientes);
    const portadores = parseStringListParam(req.query.portadores);
    const vctproInicio = parseDateParam(req.query.vctproInicio);
    const vctproFim = parseDateParam(req.query.vctproFim);
    const datemiInicio = parseDateParam(req.query.datemiInicio);
    const datemiFim = parseDateParam(req.query.datemiFim);

    const rows = await prisma.$queryRaw<{ bucket: string; valor: number; quantidade: number }[]>`
      SELECT
        CASE
          WHEN vctpro >= CURRENT_DATE THEN 'a_vencer'
          WHEN CURRENT_DATE - vctpro BETWEEN 1 AND 30 THEN 'd1_30'
          WHEN CURRENT_DATE - vctpro BETWEEN 31 AND 60 THEN 'd31_60'
          WHEN CURRENT_DATE - vctpro BETWEEN 61 AND 90 THEN 'd61_90'
          WHEN CURRENT_DATE - vctpro BETWEEN 91 AND 180 THEN 'd91_180'
          ELSE 'd180_mais'
        END AS bucket,
        SUM(vlrabe)::float8 AS valor,
        COUNT(*)::int AS quantidade
      FROM titulos_receber
      WHERE vlrabe > 0
        AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
        AND (${clientes}::int[] IS NULL OR codcli = ANY(${clientes}::int[]))
        AND (${portadores}::text[] IS NULL OR codpor = ANY(${portadores}::text[]))
        AND (${vctproInicio}::date IS NULL OR vctpro >= ${vctproInicio}::date)
        AND (${vctproFim}::date IS NULL OR vctpro <= ${vctproFim}::date)
        AND (${datemiInicio}::date IS NULL OR datemi >= ${datemiInicio}::date)
        AND (${datemiFim}::date IS NULL OR datemi <= ${datemiFim}::date)
      GROUP BY 1
    `;

    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    const totalValor = rows.reduce((sum, r) => sum + r.valor, 0);

    const buckets = BUCKET_ORDER.map((key) => {
      const row = byBucket.get(key);
      const valor = row?.valor ?? 0;
      return {
        key,
        label: BUCKET_LABELS[key],
        valor,
        quantidade: row?.quantidade ?? 0,
        pct: totalValor > 0 ? Math.round((valor / totalValor) * 100) : 0,
        tone: key === "a_vencer" ? "success" : key === "d1_30" || key === "d31_60" ? "warning" : "destructive",
      };
    });

    res.json({ buckets });
  } catch (error) {
    handleError(res, error, "aging-buckets");
  }
});

// Descrições do domínio "LSitTit" do Senior (situação do título a receber).
const SITTIT_LABELS: Record<string, string> = {
  AO: "Aberto ao Órgão de Proteção ao Crédito",
  AN: "Aberto Negociação",
  AA: "Aberto Advogado",
  AB: "Aberto Normal",
  AC: "Aberto Cartório",
  AE: "Aberto Encontro de Contas",
  AI: "Aberto Impostos",
  AJ: "Aberto Retorno Jurídico",
  AP: "Aberto Protestado",
  AR: "Aberto Representante",
  AS: "Aberto Suspenso",
  AV: "Aberto Gestão de Pessoas",
  AX: "Aberto Externo",
  CA: "Cancelado",
  CE: "Aberto CE (Preparação Cobrança Escritural)",
  CO: "Aberto Cobrança",
  LQ: "Liquidado Normal",
  LC: "Liquidado Cartório",
  LI: "Liquidado Impostos",
  LM: "Liquidado Compensado",
  LO: "Liquidado Cobrança",
  LP: "Liquidado Protestado",
  LS: "Liquidado Substituído",
  LV: "Liquidado Gestão de Pessoas",
  LX: "Liquidado Externo",
  PE: "Aberto PE (Pagamento Eletrônico)",
};

function situacaoLabel(sittit: string, diasAtraso: number): string {
  if (sittit === "AB") return diasAtraso > 0 ? "Vencido" : "A Vencer";
  return SITTIT_LABELS[sittit] ?? sittit;
}

function situacaoTone(sittit: string, diasAtraso: number): "success" | "warning" | "destructive" {
  if (sittit === "AB") return diasAtraso > 0 ? "destructive" : "success";
  if (sittit.startsWith("L")) return "success";
  if (sittit === "CA") return "destructive";
  return "warning";
}

// ---------- Lista paginada (Aging List) ----------
financeiroRouter.get("/contas-a-receber/titulos", async (req, res) => {
  try {
    const empFil = parseStringListParam(req.query.empFil);
    const situacao = parseStringListParam(req.query.situacao);
    const faixa = typeof req.query.faixa === "string" && req.query.faixa !== "" ? req.query.faixa : null;
    const clientes = parseIdsParam(req.query.clientes);
    const portadores = parseStringListParam(req.query.portadores);
    const vctproInicio = parseDateParam(req.query.vctproInicio);
    const vctproFim = parseDateParam(req.query.vctproFim);
    const datemiInicio = parseDateParam(req.query.datemiInicio);
    const datemiFim = parseDateParam(req.query.datemiFim);
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize) ?? 50));
    const offset = (page - 1) * pageSize;

    const [rows, totalsRows] = await Promise.all([
      prisma.$queryRaw<
        {
          codemp: number;
          codfil: number;
          numtit: string;
          codtpt: string;
          abrtpt: string;
          codcli: number;
          nomcli: string;
          nomemp: string;
          nomfil: string;
          datemi: Date;
          vctpro: Date;
          vlrori: number;
          vlrabe: number;
          sittit: string;
          dias_atraso: number;
        }[]
      >`
        SELECT t.codemp, t.codfil, t.numtit, t.codtpt, tt.abrtpt,
               t.codcli, c.nomcli, e.nomemp, f.nomfil,
               t.datemi, t.vctpro, t.vlrori::float8 AS vlrori, t.vlrabe::float8 AS vlrabe, t.sittit,
               GREATEST(0, (CURRENT_DATE - t.vctpro))::int AS dias_atraso
        FROM titulos_receber t
        JOIN clientes c ON c.codcli = t.codcli
        JOIN tipos_titulo tt ON tt.codtpt = t.codtpt
        JOIN empresa e ON e.codemp = t.codemp
        JOIN filial f ON f.codemp = t.codemp AND f.codfil = t.codfil
        WHERE (${situacao}::text[] IS NOT NULL OR t.vlrabe > 0)
          AND (${empFil}::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY(${empFil}::text[]))
          AND (${situacao}::text[] IS NULL OR (
            t.sittit = ANY(${situacao}::text[]) OR
            ('AB_VENCER' = ANY(${situacao}::text[]) AND t.sittit = 'AB' AND t.vctpro >= CURRENT_DATE) OR
            ('AB_VENCIDO' = ANY(${situacao}::text[]) AND t.sittit = 'AB' AND t.vctpro < CURRENT_DATE)
          ))
          AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
          AND (${portadores}::text[] IS NULL OR t.codpor = ANY(${portadores}::text[]))
          AND (${vctproInicio}::date IS NULL OR t.vctpro >= ${vctproInicio}::date)
          AND (${vctproFim}::date IS NULL OR t.vctpro <= ${vctproFim}::date)
          AND (${datemiInicio}::date IS NULL OR t.datemi >= ${datemiInicio}::date)
          AND (${datemiFim}::date IS NULL OR t.datemi <= ${datemiFim}::date)
          AND (${faixa}::text IS NULL OR (
            (${faixa} = 'a_vencer' AND t.vctpro >= CURRENT_DATE) OR
            (${faixa} = 'd1_30' AND CURRENT_DATE - t.vctpro BETWEEN 1 AND 30) OR
            (${faixa} = 'd31_60' AND CURRENT_DATE - t.vctpro BETWEEN 31 AND 60) OR
            (${faixa} = 'd61_90' AND CURRENT_DATE - t.vctpro BETWEEN 61 AND 90) OR
            (${faixa} = 'd91_180' AND CURRENT_DATE - t.vctpro BETWEEN 91 AND 180) OR
            (${faixa} = 'd180_mais' AND CURRENT_DATE - t.vctpro > 180)
          ))
        ORDER BY dias_atraso DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<
        { total: number; total_vencido: number; total_a_vencer: number; total_pago: number }[]
      >`
        WITH titulos_filtrados AS (
          SELECT t.codemp, t.codfil, t.numtit, t.codtpt, t.sittit, t.vctpro, t.vlrabe
          FROM titulos_receber t
          WHERE (${situacao}::text[] IS NOT NULL OR t.vlrabe > 0)
            AND (${empFil}::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY(${empFil}::text[]))
            AND (${situacao}::text[] IS NULL OR (
              t.sittit = ANY(${situacao}::text[]) OR
              ('AB_VENCER' = ANY(${situacao}::text[]) AND t.sittit = 'AB' AND t.vctpro >= CURRENT_DATE) OR
              ('AB_VENCIDO' = ANY(${situacao}::text[]) AND t.sittit = 'AB' AND t.vctpro < CURRENT_DATE)
            ))
            AND (${clientes}::int[] IS NULL OR t.codcli = ANY(${clientes}::int[]))
            AND (${portadores}::text[] IS NULL OR t.codpor = ANY(${portadores}::text[]))
            AND (${vctproInicio}::date IS NULL OR t.vctpro >= ${vctproInicio}::date)
            AND (${vctproFim}::date IS NULL OR t.vctpro <= ${vctproFim}::date)
            AND (${datemiInicio}::date IS NULL OR t.datemi >= ${datemiInicio}::date)
            AND (${datemiFim}::date IS NULL OR t.datemi <= ${datemiFim}::date)
            AND (${faixa}::text IS NULL OR (
              (${faixa} = 'a_vencer' AND t.vctpro >= CURRENT_DATE) OR
              (${faixa} = 'd1_30' AND CURRENT_DATE - t.vctpro BETWEEN 1 AND 30) OR
              (${faixa} = 'd31_60' AND CURRENT_DATE - t.vctpro BETWEEN 31 AND 60) OR
              (${faixa} = 'd61_90' AND CURRENT_DATE - t.vctpro BETWEEN 61 AND 90) OR
              (${faixa} = 'd91_180' AND CURRENT_DATE - t.vctpro BETWEEN 91 AND 180) OR
              (${faixa} = 'd180_mais' AND CURRENT_DATE - t.vctpro > 180)
            ))
        )
        SELECT
          (SELECT COUNT(*) FROM titulos_filtrados)::int AS total,
          (SELECT COALESCE(SUM(CASE WHEN sittit = 'AB' AND vctpro < CURRENT_DATE THEN vlrabe END), 0)
             FROM titulos_filtrados)::float8 AS total_vencido,
          (SELECT COALESCE(SUM(CASE WHEN sittit = 'AB' AND vctpro >= CURRENT_DATE THEN vlrabe END), 0)
             FROM titulos_filtrados)::float8 AS total_a_vencer,
          (
            SELECT COALESCE(SUM(m.vlrliq), 0)
            FROM titulos_filtrados tf
            JOIN movimentos_receber m ON m.codemp = tf.codemp AND m.codfil = tf.codfil AND m.numtit = tf.numtit AND m.codtpt = tf.codtpt
            JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
            WHERE tr.rectpb = 'PG'
          )::float8 AS total_pago
      `,
    ]);

    const rowsComLabel = rows.map((row) => ({
      ...row,
      situacaoLabel: situacaoLabel(row.sittit, row.dias_atraso),
      situacaoTone: situacaoTone(row.sittit, row.dias_atraso),
    }));

    const totals = totalsRows[0];

    res.json({
      rows: rowsComLabel,
      page,
      pageSize,
      total: totals?.total ?? 0,
      totalVencido: totals?.total_vencido ?? 0,
      totalAVencer: totals?.total_a_vencer ?? 0,
      totalPago: totals?.total_pago ?? 0,
    });
  } catch (error) {
    handleError(res, error, "titulos");
  }
});

// ---------- Sincronização manual (status + disparo) ----------
financeiroRouter.get("/contas-a-receber/sincronizacao", async (_req, res) => {
  try {
    const rows = await prisma.$queryRaw<{ ultima: Date | null }[]>`
      SELECT MIN(latest) AS ultima FROM (
        SELECT "jobName", MAX("runAt") AS latest
        FROM "SyncLog"
        WHERE status = 'success' AND "jobName" = ANY(${JOBS_CONTAS_RECEBER}::text[])
        GROUP BY "jobName"
      ) t
    `;
    res.json({
      emAndamento: sincronizacaoContasReceberEmAndamento(),
      ultimaAtualizacao: rows[0]?.ultima ?? null,
    });
  } catch (error) {
    handleError(res, error, "sincronizacao-status");
  }
});

financeiroRouter.post("/contas-a-receber/sincronizacao", async (_req, res) => {
  if (sincronizacaoContasReceberEmAndamento()) {
    res.status(409).json({ error: "Sincronização já em andamento" });
    return;
  }
  runSincronizacaoContasReceber().catch((error) => {
    console.error("[sincronizacao-contas-receber] falhou:", error instanceof Error ? error.message : error);
  });
  res.status(202).json({ status: "iniciado" });
});
