import { Router } from "express";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";

export const fluxoCaixaRouter = Router();
fluxoCaixaRouter.use(requireAuth, requireRole("admin"));

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
  console.error(`[fluxo-caixa:${label}]`, message);
  res.status(500).json({ error: message });
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function lerFiltros(req: import("express").Request): { empFil: string[] | null } {
  return { empFil: parseStringListParam(req.query.empFil) };
}

interface Periodo {
  inicio: string;
  fim: string;
}

const MAX_DIAS_PERIODO = 731;

// Presets 30/60/90 dias sempre simétricos (N dias atrás .. N dias à frente),
// já que os KPIs precisam de uma janela passada E uma futura de mesmo tamanho.
function lerPeriodo(req: import("express").Request): Periodo {
  const hoje = hojeISO();
  const preset = typeof req.query.periodo === "string" ? req.query.periodo : "30";
  const custIni = parseDateParam(req.query.periodoInicio);
  const custFim = parseDateParam(req.query.periodoFim);

  if (preset === "custom" && custIni && custFim) {
    const inicioMs = new Date(custIni).getTime();
    const fimMs = new Date(custFim).getTime();
    const dias = Math.round((fimMs - inicioMs) / (24 * 60 * 60 * 1000));
    if (dias > MAX_DIAS_PERIODO) {
      const inicioEfetivo = new Date(fimMs - MAX_DIAS_PERIODO * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { inicio: inicioEfetivo, fim: custFim };
    }
    return { inicio: custIni, fim: custFim };
  }

  const dias = preset === "60" ? 60 : preset === "90" ? 90 : 30;
  const inicio = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fim = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { inicio, fim };
}

// Descrições do domínio "LSitTit" do Senior (situação do título a receber) —
// mesmo mapa de financeiro.ts, duplicado localmente (padrão já usado em todo o app).
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

// Buckets de aging próprios dessa tela (1-15/16-30/31-60/61-90/90+) — chaves
// deliberadamente diferentes dos buckets de inadimplencia.ts (d1_30 etc.) pra
// nunca confundir os dois esquemas.
const RISCO_BUCKET_ORDER = ["risco_1_15", "risco_16_30", "risco_31_60", "risco_61_90", "risco_90_mais"] as const;
const RISCO_BUCKET_LABELS: Record<string, string> = {
  risco_1_15: "1–15 dias",
  risco_16_30: "16–30 dias",
  risco_31_60: "31–60 dias",
  risco_61_90: "61–90 dias",
  risco_90_mais: "90+ dias",
};

function bucketRiscoSql(col: string): string {
  return `CASE
    WHEN CURRENT_DATE - ${col} BETWEEN 1 AND 15 THEN 'risco_1_15'
    WHEN CURRENT_DATE - ${col} BETWEEN 16 AND 30 THEN 'risco_16_30'
    WHEN CURRENT_DATE - ${col} BETWEEN 31 AND 60 THEN 'risco_31_60'
    WHEN CURRENT_DATE - ${col} BETWEEN 61 AND 90 THEN 'risco_61_90'
    ELSE 'risco_90_mais'
  END`;
}

function ordenacaoClientesRisco(sort: unknown, dir: unknown): string {
  const direcao = dir === "asc" ? "ASC" : "DESC";
  switch (sort) {
    case "valorAberto":
      return `valor_aberto ${direcao}`;
    case "valorVencido":
      return `valor_vencido ${direcao}`;
    case "atrasoMedio":
      return `atraso_medio ${direcao}`;
    case "maiorAtraso":
      return `maior_atraso ${direcao}`;
    case "score":
    default:
      return `score ${direcao}`;
  }
}

function condicaoCorte(corte: string | null): string {
  switch (corte) {
    case "vencendo_7d":
      return "t.vlrabe > 0 AND t.vctpro > CURRENT_DATE AND t.vctpro <= CURRENT_DATE + 7";
    case "sem_baixa_5d":
      return "t.vlrabe > 0 AND t.vctpro < CURRENT_DATE - 5";
    case "vencendo_hoje":
    default:
      return "t.vlrabe > 0 AND t.vctpro = CURRENT_DATE";
  }
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

// ================= ABA EXECUTIVA =================

// ---------- KPIs ----------
fluxoCaixaRouter.get("/kpis", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);
    const { inicio, fim } = lerPeriodo(req);
    const hoje = hojeISO();

    const passadoIni = inicio;
    const passadoFim = fim < hoje ? fim : hoje;
    const futuroIni = inicio > hoje ? inicio : hoje;
    const futuroFim = fim;
    const temJanelaPassado = passadoIni < passadoFim;

    const [previstoRows, realizadoRows, previstoPassadoRows, inadimplenciaRows, prazosRows] = await Promise.all([
      // Previsto no período — estritamente futuro, vlrabe (saldo em aberto).
      prisma.$queryRaw<{ valor: number; qtd: number }[]>`
        SELECT COALESCE(SUM(vlrabe), 0)::float8 AS valor, COUNT(*)::int AS qtd
        FROM titulos_receber
        WHERE vlrabe > 0
          AND vctpro >= ${futuroIni}::date AND vctpro < ${futuroFim}::date
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
      // Realizado no período — estritamente passado, baixas confirmadas.
      prisma.$queryRaw<{ valor: number; qtd: number }[]>`
        SELECT COALESCE(SUM(m.vlrliq), 0)::float8 AS valor, COUNT(*)::int AS qtd
        FROM movimentos_receber m
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG'
          AND m.datpgt >= ${passadoIni}::date AND m.datpgt < ${passadoFim}::date
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
      `,
      // Previsto DAQUELE passado (denominador da acuracidade) — vlrori+vctpro,
      // nunca vlrabe (que já mutou pra 0 nos títulos pagos).
      prisma.$queryRaw<{ valor: number }[]>`
        SELECT COALESCE(SUM(vlrori), 0)::float8 AS valor
        FROM titulos_receber
        WHERE vctpro >= ${passadoIni}::date AND vctpro < ${passadoFim}::date
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
      // Índice de inadimplência — snapshot atual da carteira, independente do período.
      prisma.$queryRaw<{ total_vencido: number; total_aberto: number }[]>`
        SELECT
          COALESCE(SUM(vlrabe) FILTER (WHERE vctpro < CURRENT_DATE), 0)::float8 AS total_vencido,
          COALESCE(SUM(vlrabe), 0)::float8 AS total_aberto
        FROM titulos_receber
        WHERE vlrabe > 0
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
      // DSO (prazo médio efetivo, por datpgt) e prazo médio concedido (por datemi/vctori), mesma janela passada.
      prisma.$queryRaw<{ prazo_medio_dias: number; prazo_concedido_dias: number }[]>`
        SELECT
          COALESCE(
            (SELECT SUM((m.datpgt - t.datemi) * m.vlrliq) / NULLIF(SUM(m.vlrliq), 0)
             FROM movimentos_receber m
             JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
             JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
             WHERE tr.rectpb = 'PG'
               AND m.datpgt >= ${passadoIni}::date AND m.datpgt < ${passadoFim}::date
               AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
            ), 0
          )::float8 AS prazo_medio_dias,
          COALESCE(
            (SELECT SUM((vctori - datemi) * vlrori) / NULLIF(SUM(vlrori), 0)
             FROM titulos_receber
             WHERE datemi >= ${passadoIni}::date AND datemi < ${passadoFim}::date
               AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
            ), 0
          )::float8 AS prazo_concedido_dias
      `,
    ]);

    const previsto = previstoRows[0] ?? { valor: 0, qtd: 0 };
    const realizado = realizadoRows[0] ?? { valor: 0, qtd: 0 };
    const previstoPassado = previstoPassadoRows[0]?.valor ?? 0;
    const inad = inadimplenciaRows[0] ?? { total_vencido: 0, total_aberto: 0 };
    const prazos = prazosRows[0] ?? { prazo_medio_dias: 0, prazo_concedido_dias: 0 };

    const acuracidadePct = temJanelaPassado && previstoPassado > 0 ? (realizado.valor / previstoPassado) * 100 : null;
    const inadimplenciaPct = inad.total_aberto > 0 ? (inad.total_vencido / inad.total_aberto) * 100 : 0;

    res.json({
      previsto: { valor: previsto.valor, qtd: previsto.qtd },
      realizado: { valor: realizado.valor, qtd: realizado.qtd },
      acuracidadePct,
      inadimplencia: { pct: inadimplenciaPct, variacaoPP: null },
      dso: { prazoMedioDias: prazos.prazo_medio_dias, prazoConcedidoDias: prazos.prazo_concedido_dias },
    });
  } catch (error) {
    handleError(res, error, "kpis");
  }
});

// ---------- Previsto x Realizado acumulado ----------
fluxoCaixaRouter.get("/serie-acumulada", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);
    const { inicio, fim } = lerPeriodo(req);
    const granularidade = req.query.granularidade === "mes" ? "mes" : "semana";
    const trunc = granularidade === "mes" ? "month" : "week";
    const intervalo = granularidade === "mes" ? "1 month" : "1 week";

    const rows = await prisma.$queryRawUnsafe<
      { periodo: string; eh_futuro: boolean; eh_atual: boolean; realizado: number; previsto_passado: number; previsto_futuro: number }[]
    >(
      `
      WITH periodos AS (
        SELECT generate_series(date_trunc('${trunc}', $1::date), date_trunc('${trunc}', $2::date), INTERVAL '${intervalo}') AS periodo
      ),
      realizados AS (
        SELECT date_trunc('${trunc}', m.datpgt) AS periodo, SUM(m.vlrliq) AS valor
        FROM movimentos_receber m
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG' AND m.datpgt < CURRENT_DATE
          AND ($3::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY($3::text[]))
        GROUP BY 1
      ),
      previstos_passado AS (
        SELECT date_trunc('${trunc}', vctpro) AS periodo, SUM(vlrori) AS valor
        FROM titulos_receber
        WHERE vctpro < CURRENT_DATE
          AND ($3::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($3::text[]))
        GROUP BY 1
      ),
      previstos_futuro AS (
        SELECT date_trunc('${trunc}', vctpro) AS periodo, SUM(vlrabe) AS valor
        FROM titulos_receber
        WHERE vlrabe > 0 AND vctpro >= CURRENT_DATE
          AND ($3::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($3::text[]))
        GROUP BY 1
      )
      SELECT to_char(p.periodo, 'DD/MM') AS periodo,
             (p.periodo > date_trunc('${trunc}', CURRENT_DATE)) AS eh_futuro,
             (p.periodo = date_trunc('${trunc}', CURRENT_DATE)) AS eh_atual,
             COALESCE(r.valor, 0)::float8 AS realizado,
             COALESCE(pp.valor, 0)::float8 AS previsto_passado,
             COALESCE(pf.valor, 0)::float8 AS previsto_futuro
      FROM periodos p
      LEFT JOIN realizados r ON r.periodo = p.periodo
      LEFT JOIN previstos_passado pp ON pp.periodo = p.periodo
      LEFT JOIN previstos_futuro pf ON pf.periodo = p.periodo
      ORDER BY p.periodo
      `,
      inicio,
      fim,
      empFil
    );

    let realizadoAcc = 0;
    let previstoPassadoAcc = 0;
    let previstoFuturoAcc = 0;
    const serie = rows.map((r) => {
      realizadoAcc += r.realizado;
      previstoPassadoAcc += r.previsto_passado;
      previstoFuturoAcc += r.previsto_futuro;
      return {
        periodo: r.periodo,
        realizadoAcumulado: r.eh_futuro ? null : realizadoAcc,
        previstoPassadoAcumulado: r.eh_futuro ? null : previstoPassadoAcc,
        previstoFuturoAcumulado: r.eh_futuro || r.eh_atual ? previstoFuturoAcc : null,
      };
    });

    res.json({ serie });
  } catch (error) {
    handleError(res, error, "serie-acumulada");
  }
});

// ---------- Curva de caixa projetada (só futuro) ----------
fluxoCaixaRouter.get("/curva-projetada", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);
    const { fim } = lerPeriodo(req);
    const diasFuturo = Math.max(7, Math.round((new Date(fim).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    const numSemanas = Math.min(52, Math.max(1, Math.ceil(diasFuturo / 7)));

    const rows = await prisma.$queryRawUnsafe<{ janela: string; previsto: number }[]>(
      `
      WITH janelas AS (
        SELECT generate_series(
          date_trunc('week', CURRENT_DATE),
          date_trunc('week', CURRENT_DATE) + ($1::int - 1) * INTERVAL '1 week',
          INTERVAL '1 week'
        ) AS janela
      ),
      previstos AS (
        SELECT date_trunc('week', vctpro) AS janela, SUM(vlrabe) AS valor
        FROM titulos_receber
        WHERE vlrabe > 0 AND vctpro >= CURRENT_DATE
          AND ($2::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($2::text[]))
        GROUP BY 1
      )
      SELECT to_char(j.janela, 'DD/MM') AS janela, COALESCE(p.valor, 0)::float8 AS previsto
      FROM janelas j LEFT JOIN previstos p ON p.janela = j.janela
      ORDER BY j.janela
      `,
      numSemanas,
      empFil
    );

    let saldoAcumulado = 0;
    const serie = rows.map((r) => {
      saldoAcumulado += r.previsto;
      return { janela: r.janela, previsto: r.previsto, saldoAcumulado };
    });

    res.json({ serie });
  } catch (error) {
    handleError(res, error, "curva-projetada");
  }
});

// ---------- Preferências (limiar de caixa mínimo por usuário) ----------
fluxoCaixaRouter.get("/preferencias", async (req: AuthenticatedRequest, res) => {
  try {
    const pref = await prisma.preferenciaFluxoCaixa.findUnique({ where: { userId: req.user!.userId } });
    res.json({ limiarCaixaMin: pref ? Number(pref.limiarCaixaMin) : 0 });
  } catch (error) {
    handleError(res, error, "preferencias-get");
  }
});

fluxoCaixaRouter.put("/preferencias", async (req: AuthenticatedRequest, res) => {
  try {
    const valor = Number(req.body?.limiarCaixaMin);
    if (!Number.isFinite(valor) || valor < 0) {
      res.status(400).json({ error: "Valor inválido" });
      return;
    }
    const pref = await prisma.preferenciaFluxoCaixa.upsert({
      where: { userId: req.user!.userId },
      update: { limiarCaixaMin: valor },
      create: { userId: req.user!.userId, limiarCaixaMin: valor },
    });
    res.json({ limiarCaixaMin: Number(pref.limiarCaixaMin) });
  } catch (error) {
    handleError(res, error, "preferencias-put");
  }
});

// ================= ABA RISCO =================

// ---------- Aging da carteira vencida (buckets próprios dessa tela) ----------
fluxoCaixaRouter.get("/aging", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);
    const rows = await prisma.$queryRawUnsafe<{ bucket: string; valor: number; quantidade: number }[]>(
      `
      SELECT ${bucketRiscoSql("vctpro")} AS bucket, SUM(vlrabe)::float8 AS valor, COUNT(*)::int AS quantidade
      FROM titulos_receber
      WHERE vlrabe > 0 AND vctpro < CURRENT_DATE
        AND ($1::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY($1::text[]))
      GROUP BY 1
      `,
      empFil
    );

    const total = rows.reduce((acc, r) => acc + r.valor, 0);
    const porBucket = new Map(rows.map((r) => [r.bucket, r]));
    const buckets = RISCO_BUCKET_ORDER.map((bucket) => {
      const r = porBucket.get(bucket);
      const valor = r?.valor ?? 0;
      return {
        bucket,
        label: RISCO_BUCKET_LABELS[bucket],
        valor,
        quantidade: r?.quantidade ?? 0,
        pct: total > 0 ? (valor / total) * 100 : 0,
      };
    });

    res.json({ buckets, total });
  } catch (error) {
    handleError(res, error, "aging");
  }
});

// ---------- Concentração de carteira (top 5 vs demais) ----------
fluxoCaixaRouter.get("/concentracao", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);

    const [top5, totalRows] = await Promise.all([
      prisma.$queryRaw<{ codcli: number; nomcli: string; valor: number }[]>`
        SELECT t.codcli, c.nomcli, SUM(t.vlrabe)::float8 AS valor
        FROM titulos_receber t
        JOIN clientes c ON c.codcli = t.codcli
        WHERE t.vlrabe > 0
          AND (${empFil}::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY(${empFil}::text[]))
        GROUP BY t.codcli, c.nomcli
        ORDER BY valor DESC
        LIMIT 5
      `,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(vlrabe), 0)::float8 AS total
        FROM titulos_receber
        WHERE vlrabe > 0
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
    ]);

    const total = totalRows[0]?.total ?? 0;
    const somaTop5 = top5.reduce((acc, r) => acc + r.valor, 0);
    const demaisValor = Math.max(0, total - somaTop5);
    const maiorPct = total > 0 && top5.length > 0 ? (top5[0].valor / total) * 100 : 0;

    res.json({
      top5: top5.map((r) => ({ codcli: r.codcli, nomcli: r.nomcli, valor: r.valor, pct: total > 0 ? (r.valor / total) * 100 : 0 })),
      demais: { valor: demaisValor, pct: total > 0 ? (demaisValor / total) * 100 : 0 },
      total,
      alertaConcentracao: maiorPct > 25,
    });
  } catch (error) {
    handleError(res, error, "concentracao");
  }
});

// ---------- Clientes em risco (paginada, ordenável, score normalizado) ----------
fluxoCaixaRouter.get("/clientes-risco", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);
    const bucket = typeof req.query.bucket === "string" && req.query.bucket !== "" ? req.query.bucket : null;
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseIntParam(req.query.pageSize) ?? 20));
    const offset = (page - 1) * pageSize;
    const ordenacao = ordenacaoClientesRisco(req.query.sort, req.query.dir);

    const rows = await prisma.$queryRawUnsafe<
      {
        codcli: number;
        nomcli: string;
        valor_aberto: number;
        valor_vencido: number;
        atraso_medio: number;
        maior_atraso: number;
        score: number;
        total_geral: number;
      }[]
    >(
      `
      WITH base AS (
        SELECT t.codcli, c.nomcli,
          SUM(t.vlrabe)::float8 AS valor_aberto,
          COALESCE(SUM(t.vlrabe) FILTER (WHERE t.vctpro < CURRENT_DATE), 0)::float8 AS valor_vencido,
          COALESCE(AVG(CURRENT_DATE - t.vctpro) FILTER (WHERE t.vctpro < CURRENT_DATE), 0)::float8 AS atraso_medio,
          COALESCE(MAX(CURRENT_DATE - t.vctpro) FILTER (WHERE t.vctpro < CURRENT_DATE), 0)::int AS maior_atraso
        FROM titulos_receber t
        JOIN clientes c ON c.codcli = t.codcli
        WHERE t.vlrabe > 0
          AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
          AND ($2::text IS NULL OR ${bucketRiscoSql("t.vctpro")} = $2)
        GROUP BY t.codcli, c.nomcli
        HAVING COALESCE(SUM(t.vlrabe) FILTER (WHERE t.vctpro < CURRENT_DATE), 0) > 0
      ),
      scored AS (
        SELECT *, (valor_vencido * atraso_medio) AS raw_score FROM base
      )
      SELECT codcli, nomcli, valor_aberto, valor_vencido, atraso_medio, maior_atraso,
        CASE WHEN MAX(raw_score) OVER () = MIN(raw_score) OVER () THEN 50
             ELSE ROUND((((raw_score - MIN(raw_score) OVER ()) / (MAX(raw_score) OVER () - MIN(raw_score) OVER ())) * 100)::numeric)
        END::int AS score,
        COUNT(*) OVER ()::int AS total_geral
      FROM scored
      ORDER BY ${ordenacao}
      LIMIT $3 OFFSET $4
      `,
      empFil,
      bucket,
      pageSize,
      offset
    );

    res.json({
      rows: rows.map((r) => ({
        codcli: r.codcli,
        nomcli: r.nomcli,
        valorAberto: r.valor_aberto,
        valorVencido: r.valor_vencido,
        atrasoMedio: r.atraso_medio,
        maiorAtraso: r.maior_atraso,
        score: r.score,
      })),
      page,
      pageSize,
      total: rows[0]?.total_geral ?? 0,
    });
  } catch (error) {
    handleError(res, error, "clientes-risco");
  }
});

// ---------- Drill-down: títulos em aberto de um cliente ----------
fluxoCaixaRouter.get("/clientes-risco/:codcli/titulos", async (req, res) => {
  try {
    const codcli = parseIntParam(req.params.codcli);
    if (codcli === null) {
      res.status(400).json({ error: "codcli inválido" });
      return;
    }
    const { empFil } = lerFiltros(req);

    const rows = await prisma.$queryRaw<
      { numtit: string; codtpt: string; vctpro: Date; vlrabe: number; sittit: string; dias_atraso: number }[]
    >`
      SELECT numtit, codtpt, vctpro, vlrabe::float8 AS vlrabe, sittit,
             GREATEST(0, CURRENT_DATE - vctpro)::int AS dias_atraso
      FROM titulos_receber
      WHERE codcli = ${codcli} AND vlrabe > 0
        AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      ORDER BY vctpro ASC
    `;

    res.json({
      rows: rows.map((r) => ({
        numtit: r.numtit,
        codtpt: r.codtpt,
        vctpro: r.vctpro,
        valor: r.vlrabe,
        diasAtraso: r.dias_atraso,
        situacaoLabel: situacaoLabel(r.sittit, r.dias_atraso),
        situacaoTone: situacaoTone(r.sittit, r.dias_atraso),
      })),
    });
  } catch (error) {
    handleError(res, error, "clientes-risco-titulos");
  }
});

// ================= ABA OPERACIONAL =================

// ---------- KPIs dos 4 recortes ----------
fluxoCaixaRouter.get("/operacional/kpis", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);

    const [abertosRows, recebidoHojeRows] = await Promise.all([
      prisma.$queryRaw<
        {
          vencendo_hoje_valor: number;
          vencendo_hoje_qtd: number;
          vencendo_7d_valor: number;
          vencendo_7d_qtd: number;
          sem_baixa_valor: number;
          sem_baixa_qtd: number;
        }[]
      >`
        SELECT
          COALESCE(SUM(vlrabe) FILTER (WHERE vctpro = CURRENT_DATE), 0)::float8 AS vencendo_hoje_valor,
          COUNT(*) FILTER (WHERE vctpro = CURRENT_DATE)::int AS vencendo_hoje_qtd,
          COALESCE(SUM(vlrabe) FILTER (WHERE vctpro > CURRENT_DATE AND vctpro <= CURRENT_DATE + 7), 0)::float8 AS vencendo_7d_valor,
          COUNT(*) FILTER (WHERE vctpro > CURRENT_DATE AND vctpro <= CURRENT_DATE + 7)::int AS vencendo_7d_qtd,
          COALESCE(SUM(vlrabe) FILTER (WHERE vctpro < CURRENT_DATE - 5), 0)::float8 AS sem_baixa_valor,
          COUNT(*) FILTER (WHERE vctpro < CURRENT_DATE - 5)::int AS sem_baixa_qtd
        FROM titulos_receber
        WHERE vlrabe > 0
          AND (${empFil}::text[] IS NULL OR (codemp::text || ':' || codfil::text) = ANY(${empFil}::text[]))
      `,
      prisma.$queryRaw<{ valor: number; qtd: number }[]>`
        SELECT COALESCE(SUM(m.vlrliq), 0)::float8 AS valor, COUNT(*)::int AS qtd
        FROM movimentos_receber m
        JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
        WHERE tr.rectpb = 'PG' AND m.datpgt = CURRENT_DATE
          AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
      `,
    ]);

    const a = abertosRows[0];
    const r = recebidoHojeRows[0] ?? { valor: 0, qtd: 0 };

    res.json({
      vencendoHoje: { valor: a.vencendo_hoje_valor, qtd: a.vencendo_hoje_qtd },
      vencendo7d: { valor: a.vencendo_7d_valor, qtd: a.vencendo_7d_qtd },
      recebidoHoje: { valor: r.valor, qtd: r.qtd },
      semBaixa5d: { valor: a.sem_baixa_valor, qtd: a.sem_baixa_qtd },
    });
  } catch (error) {
    handleError(res, error, "operacional-kpis");
  }
});

// ---------- Tabela do corte ativo (busca + paginação + export CSV) ----------
fluxoCaixaRouter.get("/operacional/titulos", async (req, res) => {
  try {
    const { empFil } = lerFiltros(req);
    const corte = typeof req.query.corte === "string" ? req.query.corte : "vencendo_hoje";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const busca = q === "" ? null : `%${q}%`;
    const formato = req.query.formato === "csv" ? "csv" : "json";
    const page = Math.max(1, parseIntParam(req.query.page) ?? 1);
    const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize) ?? 50));
    const limite = formato === "csv" ? 50000 : pageSize;
    const offset = formato === "csv" ? 0 : (page - 1) * pageSize;

    type Linha = {
      numtit: string;
      codtpt: string;
      codcli: number;
      nomcli: string;
      datemi: Date;
      vctpro: Date;
      valor: number;
      sittit: string;
      dias_atraso: number;
    };

    let rows: Linha[];
    let total: number;

    if (corte === "recebido_hoje") {
      const [linhas, totalRows] = await Promise.all([
        prisma.$queryRaw<Linha[]>`
          SELECT t.numtit, t.codtpt, t.codcli, c.nomcli, t.datemi, t.vctpro, m.vlrliq::float8 AS valor, t.sittit,
                 0::int AS dias_atraso
          FROM movimentos_receber m
          JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
          JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
          JOIN clientes c ON c.codcli = t.codcli
          WHERE tr.rectpb = 'PG' AND m.datpgt = CURRENT_DATE
            AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
            AND (${busca}::text IS NULL OR c.nomcli ILIKE ${busca} OR t.numtit ILIKE ${busca})
          ORDER BY t.vctpro DESC
          LIMIT ${limite} OFFSET ${offset}
        `,
        prisma.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*)::int AS total
          FROM movimentos_receber m
          JOIN transacoes tr ON tr.codemp = m.codemp AND tr.codtns = m.codtns
          JOIN titulos_receber t ON t.codemp = m.codemp AND t.codfil = m.codfil AND t.numtit = m.numtit AND t.codtpt = m.codtpt
          JOIN clientes c ON c.codcli = t.codcli
          WHERE tr.rectpb = 'PG' AND m.datpgt = CURRENT_DATE
            AND (${empFil}::text[] IS NULL OR (m.codemp::text || ':' || m.codfil::text) = ANY(${empFil}::text[]))
            AND (${busca}::text IS NULL OR c.nomcli ILIKE ${busca} OR t.numtit ILIKE ${busca})
        `,
      ]);
      rows = linhas;
      total = totalRows[0]?.total ?? 0;
    } else {
      const condicao = condicaoCorte(corte);
      const [linhas, totalRows] = await Promise.all([
        prisma.$queryRawUnsafe<Linha[]>(
          `
          SELECT t.numtit, t.codtpt, t.codcli, c.nomcli, t.datemi, t.vctpro, t.vlrabe::float8 AS valor, t.sittit,
                 GREATEST(0, CURRENT_DATE - t.vctpro)::int AS dias_atraso
          FROM titulos_receber t
          JOIN clientes c ON c.codcli = t.codcli
          WHERE ${condicao}
            AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
            AND ($2::text IS NULL OR c.nomcli ILIKE $2 OR t.numtit ILIKE $2)
          ORDER BY t.vctpro ASC
          LIMIT $3 OFFSET $4
          `,
          empFil,
          busca,
          limite,
          offset
        ),
        prisma.$queryRawUnsafe<{ total: number }[]>(
          `
          SELECT COUNT(*)::int AS total
          FROM titulos_receber t
          JOIN clientes c ON c.codcli = t.codcli
          WHERE ${condicao}
            AND ($1::text[] IS NULL OR (t.codemp::text || ':' || t.codfil::text) = ANY($1::text[]))
            AND ($2::text IS NULL OR c.nomcli ILIKE $2 OR t.numtit ILIKE $2)
          `,
          empFil,
          busca
        ),
      ]);
      rows = linhas;
      total = totalRows[0]?.total ?? 0;
    }

    const linhasFormatadas = rows.map((r) => ({
      numtit: r.numtit,
      codtpt: r.codtpt,
      codcli: r.codcli,
      nomcli: r.nomcli,
      datemi: r.datemi,
      vctpro: r.vctpro,
      valor: r.valor,
      diasAtraso: r.dias_atraso,
      situacaoLabel: situacaoLabel(r.sittit, r.dias_atraso),
      situacaoTone: situacaoTone(r.sittit, r.dias_atraso),
    }));

    if (formato === "csv") {
      const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
      const moneyFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const csvEscape = (v: string | number) => {
        const s = String(v);
        return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const cabecalho = ["Título", "Cliente", "Emissão", "Vencimento", "Valor", "Dias de Atraso", "Situação"].join(";");
      const linhasCsv = linhasFormatadas.map((r) =>
        [
          csvEscape(`${r.numtit}-${r.codtpt}`),
          csvEscape(`${r.codcli} - ${r.nomcli}`),
          csvEscape(dateFmt.format(new Date(r.datemi))),
          csvEscape(dateFmt.format(new Date(r.vctpro))),
          csvEscape(moneyFmt.format(r.valor)),
          csvEscape(r.diasAtraso),
          csvEscape(r.situacaoLabel),
        ].join(";")
      );
      const csv = [cabecalho, ...linhasCsv].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fluxo-caixa-${corte}-${hojeISO()}.csv"`);
      res.send("﻿" + csv);
      return;
    }

    res.json({ rows: linhasFormatadas, page, pageSize, total });
  } catch (error) {
    handleError(res, error, "operacional-titulos");
  }
});
