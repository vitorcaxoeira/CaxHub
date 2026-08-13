import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { SITRAT_CONTABILIZADO, defgruBucket } from "../domain/contabilDominio";
import {
  montarMatrizResultado,
  montarMatrizCentroCusto,
  type ContaParaMatriz,
  type CentroCustoParaMatriz,
} from "../domain/matrizContabil";

export const contabilRouter = Router();
// v1: só admin. O gancho pro "gestor vê só seu departamento" é o filtro de grupo (`despar`)
// + DESPAR_PARA_DEPEXE em contabilDominio.ts — ainda não ligado ao papel do usuário.
contabilRouter.use(requireAuth, requireRole("admin"));

function parseStringListParam(value: unknown): string[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value.split(",").filter((v) => v !== "");
  return items.length > 0 ? items : null;
}

function parseIntListParam(value: unknown): number[] | null {
  if (typeof value !== "string" || value === "") return null;
  const items = value
    .split(",")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
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

// ---------- Período (ano×mês) — compartilhado por todos os endpoints de valor ----------
// Ano e mês são multi-seleção — dá pra comparar vários anos lado a lado (cada combinação
// ano×mês vira uma coluna) e/ou recortar só alguns meses de cada ano (ex.: só o 1º trimestre
// de 2025 e 2026). Sem seleção: ano cai no ano atual (não dá pra abrir a tela sem nenhum ano,
// ela ficaria sempre vazia); mês cai nos 12 — mesmo idioma de "vazio = todos" já usado nos
// outros filtros desta tela (grupo/CC).
interface FiltroPeriodo {
  anos: number[];
  meses: number[];
  colunas: string[];
  colunaPorChave: Map<string, number>;
  numColunas: number;
  inicio: string;
  fim: string;
}

function lerFiltroPeriodo(req: import("express").Request): FiltroPeriodo {
  const anos = [...new Set(parseIntListParam(req.query.anos) ?? [new Date().getFullYear()])].sort((a, b) => a - b);
  const meses = [
    ...new Set((parseIntListParam(req.query.meses) ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).filter((m) => m >= 1 && m <= 12)),
  ].sort((a, b) => a - b);
  // Colunas em ordem cronológica: todo mês do ano mais antigo, depois todo mês do próximo ano,
  // etc. — não intercalado por mês (jan/25, jan/26, fev/25, ...).
  const colunas = anos.flatMap((ano) => meses.map((mes) => `${ano}-${String(mes).padStart(2, "0")}`));
  const colunaPorChave = new Map(colunas.map((chave, indice) => [chave, indice]));
  return {
    anos,
    meses,
    colunas,
    colunaPorChave,
    numColunas: colunas.length,
    // Faixa de datas ampla (do 1º de janeiro do ano mais antigo ao 1º de janeiro do ano
    // seguinte ao mais recente) só pra deixar o filtro por ANO sargável contra o índice
    // (codemp,sitrat,datlct,ctared) — a seleção exata de ano/mês continua sendo feita pelos
    // EXTRACT nas queries, esta faixa só evita o seq scan quando os anos escolhidos são
    // poucos/próximos.
    inicio: `${anos[0]}-01-01`,
    fim: `${anos[anos.length - 1] + 1}-01-01`,
  };
}

// Empilha um valor num vetor indexado por coluna ano×mês, criando o vetor sob demanda.
function empilharValor<K>(mapa: Map<K, number[]>, chave: K, indiceColuna: number | undefined, valor: number, numColunas: number) {
  if (indiceColuna === undefined) return; // não deveria acontecer (mesmo filtro da query), guarda defensiva
  const vetor = mapa.get(chave) ?? new Array(numColunas).fill(0);
  vetor[indiceColuna] = valor;
  mapa.set(chave, vetor);
}

// ---------- Metadados do plano de contas — reaproveitado por resultado/orçado/DRE ----------
// Plano INTEIRO, sem filtro de grupo: a árvore de contas sobe de cada folha até a raiz por
// `paiCtared`, e os ancestrais normalmente NÃO têm `despar` próprio — filtrar aqui quebraria a
// cadeia. O recorte de grupo/CC vive nas queries de valor, que são quem decide o que soma.
async function buscarContasMetadata(): Promise<ContaParaMatriz[]> {
  const linhas = await prisma.$queryRawUnsafe<
    {
      ctared: number;
      clacta: string;
      descta: string;
      anasin: string;
      despar: string;
      defgru: string | null;
      nivcta: number | null;
      pai_ctared: number | null;
    }[]
  >(
    `
    SELECT ctared, clacta, descta, anasin, btrim(COALESCE(despar, '')) AS despar, defgru, nivcta, pai_ctared
    FROM plano_contabil
    ORDER BY ctared
    `
  );
  return linhas.map((c) => ({
    ctared: c.ctared,
    clacta: c.clacta,
    descta: c.descta,
    anasin: c.anasin,
    despar: c.despar || "Sem grupo",
    defgru: c.defgru,
    nivcta: c.nivcta,
    paiCtared: c.pai_ctared,
  }));
}

// ---------- Opções de filtro ----------
contabilRouter.get("/resultado/opcoes-filtro", async (_req, res) => {
  try {
    const [anosRows, gruposRows, niveisRows, centrosCusto] = await Promise.all([
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
      // Níveis que EXISTEM neste plano de contas — não uma lista fixa 1..6. O Senior permite
      // até 15 e cada plano usa quantos quiser (ver domain/hierarquiaPlano.ts), então a opção
      // de filtro sai do dado.
      prisma.$queryRaw<{ nivel: number }[]>`
        SELECT DISTINCT nivcta AS nivel
        FROM plano_contabil
        WHERE nivcta IS NOT NULL
        ORDER BY nivel
      `,
      prisma.centroCusto.findMany({
        select: { codccu: true, desccu: true },
        orderBy: { codccu: "asc" },
      }),
    ]);

    res.json({
      anos: anosRows.map((r) => r.ano),
      grupos: gruposRows.map((r) => ({ value: r.despar, label: r.despar })),
      niveis: niveisRows.map((r) => r.nivel),
      centrosCusto: centrosCusto.map((c) => ({ value: c.codccu, label: `${c.codccu} - ${c.desccu}` })),
    });
  } catch (error) {
    handleError(res, error, "opcoes-filtro");
  }
});

// ---------- Resultado Analítico (realizado por mês) ----------
contabilRouter.get("/resultado", async (req, res) => {
  try {
    const periodo = lerFiltroPeriodo(req);
    const grupos = parseStringListParam(req.query.grupo);
    const centrosCusto = parseStringListParam(req.query.codccu);
    const incluirSemGrupo = parseBoolParam(req.query.incluirSemGrupo);
    // Níveis do plano visíveis na coluna Conta. Vazio/ausente = todos. Recorte só VISUAL: os
    // valores não mudam, os descendentes de um nível omitido sobem pro ancestral visível mais
    // próximo (ver montarMatrizResultado).
    const niveisFiltro = parseIntListParam(req.query.niveis);
    const niveisVisiveis = niveisFiltro ? new Set(niveisFiltro) : null;

    const contas = await buscarContasMetadata();

    // Valores realizados por conta × ano × mês, já filtrados pelo mesmo recorte de grupo/CC —
    // agregação até o nível de folha só (o roll-up da hierarquia é feito em Node).
    const valoresLeaf = await prisma.$queryRawUnsafe<{ ctared: number; ano: number; mes: number; valor: number }[]>(
      `
      SELECT r.ctared AS ctared,
             EXTRACT(YEAR FROM r.datlct)::int AS ano,
             EXTRACT(MONTH FROM r.datlct)::int AS mes,
             SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
      FROM rateios_lancamento r
      JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
      WHERE r.sitrat = $1
        AND r.datlct >= $2::date AND r.datlct < $3::date
        AND EXTRACT(YEAR FROM r.datlct) = ANY($4::int[])
        AND EXTRACT(MONTH FROM r.datlct) = ANY($5::int[])
        AND (btrim(pc.despar) <> '' OR $6::boolean)
        AND ($7::text[] IS NULL OR btrim(pc.despar) = ANY($7::text[]))
        AND ($8::text[] IS NULL OR r.codccu = ANY($8::text[]))
      GROUP BY r.ctared, EXTRACT(YEAR FROM r.datlct), EXTRACT(MONTH FROM r.datlct)
      `,
      SITRAT_CONTABILIZADO,
      periodo.inicio,
      periodo.fim,
      periodo.anos,
      periodo.meses,
      incluirSemGrupo,
      grupos,
      centrosCusto
    );

    const valoresPorCtared = new Map<number, number[]>();
    for (const linha of valoresLeaf) {
      empilharValor(
        valoresPorCtared,
        linha.ctared,
        periodo.colunaPorChave.get(`${linha.ano}-${String(linha.mes).padStart(2, "0")}`),
        linha.valor,
        periodo.numColunas
      );
    }

    const { linhas, totalGeral } = montarMatrizResultado(contas, valoresPorCtared, periodo.numColunas, niveisVisiveis);

    res.json({
      meses: periodo.colunas,
      linhas,
      totalGeral: { valores: totalGeral, total: totalGeral.reduce((a, b) => a + b, 0) },
    });
  } catch (error) {
    handleError(res, error, "resultado");
  }
});

// ---------- Orçado x Realizado ----------
// Mesma árvore da Matriz, mas cada nó carrega DOIS vetores em vez de um — monta-se um só
// (`montarMatrizResultado` não sabe nem precisa saber disso: ele só agrega o que vier no
// vetor, então concatenar realizado+orçado num vetor de `numColunas*2` e fatiar depois é mais
// simples que ensinar a função a lidar com "duas séries").
contabilRouter.get("/orcado-realizado", async (req, res) => {
  try {
    const periodo = lerFiltroPeriodo(req);
    const grupos = parseStringListParam(req.query.grupo);
    const centrosCusto = parseStringListParam(req.query.codccu);
    const incluirSemGrupo = parseBoolParam(req.query.incluirSemGrupo);
    const niveisFiltro = parseIntListParam(req.query.niveis);
    const niveisVisiveis = niveisFiltro ? new Set(niveisFiltro) : null;
    const numColunas = periodo.numColunas;

    const contas = await buscarContasMetadata();

    const [valoresRealizado, valoresOrcado] = await Promise.all([
      prisma.$queryRawUnsafe<{ ctared: number; ano: number; mes: number; valor: number }[]>(
        `
        SELECT r.ctared AS ctared,
               EXTRACT(YEAR FROM r.datlct)::int AS ano,
               EXTRACT(MONTH FROM r.datlct)::int AS mes,
               SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
        FROM rateios_lancamento r
        JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
        WHERE r.sitrat = $1
          AND r.datlct >= $2::date AND r.datlct < $3::date
          AND EXTRACT(YEAR FROM r.datlct) = ANY($4::int[])
          AND EXTRACT(MONTH FROM r.datlct) = ANY($5::int[])
          AND (btrim(pc.despar) <> '' OR $6::boolean)
          AND ($7::text[] IS NULL OR btrim(pc.despar) = ANY($7::text[]))
          AND ($8::text[] IS NULL OR r.codccu = ANY($8::text[]))
        GROUP BY r.ctared, EXTRACT(YEAR FROM r.datlct), EXTRACT(MONTH FROM r.datlct)
        `,
        SITRAT_CONTABILIZADO,
        periodo.inicio,
        periodo.fim,
        periodo.anos,
        periodo.meses,
        incluirSemGrupo,
        grupos,
        centrosCusto
      ),
      // orcamentos_contabeis guarda o valor com o sinal INVERTIDO do realizado — receita vem
      // negativa, despesa vem positiva (confirmado com dado real em 13/08/2026: conta 177
      // "Receita com Vendas Licenças" tem vlrrat=-83.333, e "336 Salários" tem vlrrat=+32.250).
      // `-o.vlrrat` normaliza pra mesma convenção do realizado (crédito/receita positivo).
      prisma.$queryRawUnsafe<{ ctared: number; ano: number; mes: number; valor: number }[]>(
        `
        SELECT o.ctared AS ctared,
               EXTRACT(YEAR FROM o.mesano)::int AS ano,
               EXTRACT(MONTH FROM o.mesano)::int AS mes,
               SUM(-o.vlrrat)::float8 AS valor
        FROM orcamentos_contabeis o
        JOIN plano_contabil pc ON pc.codemp = o.codemp AND pc.ctared = o.ctared
        WHERE EXTRACT(YEAR FROM o.mesano) = ANY($1::int[])
          AND EXTRACT(MONTH FROM o.mesano) = ANY($2::int[])
          AND (btrim(pc.despar) <> '' OR $3::boolean)
          AND ($4::text[] IS NULL OR btrim(pc.despar) = ANY($4::text[]))
          AND ($5::text[] IS NULL OR o.codccu = ANY($5::text[]))
        GROUP BY o.ctared, EXTRACT(YEAR FROM o.mesano), EXTRACT(MONTH FROM o.mesano)
        `,
        periodo.anos,
        periodo.meses,
        incluirSemGrupo,
        grupos,
        centrosCusto
      ),
    ]);

    const valoresCombinados = new Map<number, number[]>();
    for (const linha of valoresRealizado) {
      empilharValor(
        valoresCombinados,
        linha.ctared,
        periodo.colunaPorChave.get(`${linha.ano}-${String(linha.mes).padStart(2, "0")}`),
        linha.valor,
        numColunas * 2
      );
    }
    for (const linha of valoresOrcado) {
      const indice = periodo.colunaPorChave.get(`${linha.ano}-${String(linha.mes).padStart(2, "0")}`);
      empilharValor(valoresCombinados, linha.ctared, indice !== undefined ? indice + numColunas : undefined, linha.valor, numColunas * 2);
    }

    const { linhas, totalGeral } = montarMatrizResultado(contas, valoresCombinados, numColunas * 2, niveisVisiveis);

    // O componente de matriz (MatrizContabil.tsx) só entende um vetor `valores`/`total` por
    // linha — a fatia mostrada na tela troca conforme o seletor Realizado/Orçado/Variação, mas
    // a API sempre manda os dois brutos e quem decide o que exibir é o frontend.
    const fatiar = (valores: number[]) => {
      const valoresRealizado = valores.slice(0, numColunas);
      const valoresOrcado = valores.slice(numColunas);
      return {
        valoresRealizado,
        valoresOrcado,
        totalRealizado: valoresRealizado.reduce((a, b) => a + b, 0),
        totalOrcado: valoresOrcado.reduce((a, b) => a + b, 0),
      };
    };

    res.json({
      meses: periodo.colunas,
      linhas: linhas.map(({ valores, total, ...resto }) => ({ ...resto, ...fatiar(valores) })),
      totalGeral: fatiar(totalGeral),
    });
  } catch (error) {
    handleError(res, error, "orcado-realizado");
  }
});

// ---------- DRE Gerencial (cascata Receitas -> Despesas -> Resultado) ----------
contabilRouter.get("/dre", async (req, res) => {
  try {
    const periodo = lerFiltroPeriodo(req);
    const grupos = parseStringListParam(req.query.grupo);
    const centrosCusto = parseStringListParam(req.query.codccu);

    // DRE é sempre só contas com grupo gerencial — não faz sentido "incluir sem grupo" aqui
    // (conta patrimonial não participa de Receitas/Despesas do resultado do período).
    const [porBucket, porGrupo] = await Promise.all([
      prisma.$queryRawUnsafe<{ defgru: string | null; ano: number; mes: number; valor: number }[]>(
        `
        SELECT pc.defgru AS defgru,
               EXTRACT(YEAR FROM r.datlct)::int AS ano,
               EXTRACT(MONTH FROM r.datlct)::int AS mes,
               SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
        FROM rateios_lancamento r
        JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
        WHERE r.sitrat = $1
          AND r.datlct >= $2::date AND r.datlct < $3::date
          AND EXTRACT(YEAR FROM r.datlct) = ANY($4::int[])
          AND EXTRACT(MONTH FROM r.datlct) = ANY($5::int[])
          AND btrim(pc.despar) <> ''
          AND ($6::text[] IS NULL OR btrim(pc.despar) = ANY($6::text[]))
          AND ($7::text[] IS NULL OR r.codccu = ANY($7::text[]))
        GROUP BY pc.defgru, EXTRACT(YEAR FROM r.datlct), EXTRACT(MONTH FROM r.datlct)
        `,
        SITRAT_CONTABILIZADO,
        periodo.inicio,
        periodo.fim,
        periodo.anos,
        periodo.meses,
        grupos,
        centrosCusto
      ),
      prisma.$queryRawUnsafe<{ despar: string; ano: number; mes: number; valor: number }[]>(
        `
        SELECT btrim(pc.despar) AS despar,
               EXTRACT(YEAR FROM r.datlct)::int AS ano,
               EXTRACT(MONTH FROM r.datlct)::int AS mes,
               SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
        FROM rateios_lancamento r
        JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
        WHERE r.sitrat = $1
          AND r.datlct >= $2::date AND r.datlct < $3::date
          AND EXTRACT(YEAR FROM r.datlct) = ANY($4::int[])
          AND EXTRACT(MONTH FROM r.datlct) = ANY($5::int[])
          AND btrim(pc.despar) <> ''
          AND ($6::text[] IS NULL OR btrim(pc.despar) = ANY($6::text[]))
          AND ($7::text[] IS NULL OR r.codccu = ANY($7::text[]))
        GROUP BY btrim(pc.despar), EXTRACT(YEAR FROM r.datlct), EXTRACT(MONTH FROM r.datlct)
        `,
        SITRAT_CONTABILIZADO,
        periodo.inicio,
        periodo.fim,
        periodo.anos,
        periodo.meses,
        grupos,
        centrosCusto
      ),
    ]);

    // Uma linha por bucket (Receitas/Despesas/e o fallback que aparecer), ordenada por
    // `ordem` — mesma convenção de defgruBucket usada na Matriz.
    const bucketsPorOrdem = new Map<string, { rotulo: string; valores: number[] }>();
    for (const linha of porBucket) {
      const bucket = defgruBucket(linha.defgru);
      const indice = periodo.colunaPorChave.get(`${linha.ano}-${String(linha.mes).padStart(2, "0")}`);
      if (indice === undefined) continue;
      const entrada = bucketsPorOrdem.get(bucket.ordem) ?? { rotulo: bucket.rotulo, valores: new Array(periodo.numColunas).fill(0) };
      entrada.valores[indice] += linha.valor;
      bucketsPorOrdem.set(bucket.ordem, entrada);
    }
    const linhasBucket = [...bucketsPorOrdem.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ordem, { rotulo, valores }]) => ({
        chave: `b:${ordem}`,
        rotulo: `${ordem} - ${rotulo}`,
        valores,
        total: valores.reduce((a, b) => a + b, 0),
      }));

    const resultado = new Array<number>(periodo.numColunas).fill(0);
    for (const linha of linhasBucket) for (let i = 0; i < periodo.numColunas; i++) resultado[i] += linha.valores[i];

    // Margem = Resultado / Receitas — receita é o bucket com ordem "00" (defgruBucket('R')).
    // Sem receita no recorte (ex.: só despesa filtrada), margem fica null pra não dividir por 0.
    const ordemReceita = defgruBucket("R").ordem;
    const receitaPorColuna = linhasBucket.find((l) => l.chave === `b:${ordemReceita}`)?.valores ?? new Array(periodo.numColunas).fill(0);
    const margemPct = resultado.map((r, i) => (receitaPorColuna[i] !== 0 ? (r / receitaPorColuna[i]) * 100 : null));

    const porGrupoMap = new Map<string, number[]>();
    for (const linha of porGrupo) {
      const indice = periodo.colunaPorChave.get(`${linha.ano}-${String(linha.mes).padStart(2, "0")}`);
      if (indice === undefined) continue;
      const vetor = porGrupoMap.get(linha.despar) ?? new Array(periodo.numColunas).fill(0);
      vetor[indice] += linha.valor;
      porGrupoMap.set(linha.despar, vetor);
    }
    const porGrupoResposta = [...porGrupoMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([grupo, valores]) => ({ grupo, valores, total: valores.reduce((a, b) => a + b, 0) }));

    res.json({
      meses: periodo.colunas,
      buckets: linhasBucket,
      resultado: { valores: resultado, total: resultado.reduce((a, b) => a + b, 0) },
      margemPct,
      porGrupo: porGrupoResposta,
    });
  } catch (error) {
    handleError(res, error, "dre");
  }
});

// ---------- Resultado por Centro de Custo ----------
contabilRouter.get("/centros-custo", async (req, res) => {
  try {
    const periodo = lerFiltroPeriodo(req);
    const centrosCusto = parseStringListParam(req.query.codccu);

    // Metadados de TODOS os centros de custo — mesma lógica da conta: os ancestrais (nível 1
    // e 2, sintéticos) precisam estar aqui pra `ccupai` fechar a cadeia, mesmo que o filtro
    // de CC não os inclua diretamente.
    const centrosMetadata = await prisma.centroCusto.findMany({
      select: { codccu: true, desccu: true, claccu: true, nivccu: true, ccupai: true, anasin: true },
      orderBy: { codccu: "asc" },
    });
    const centros: CentroCustoParaMatriz[] = centrosMetadata.map((c) => ({
      codccu: c.codccu,
      desccu: c.desccu,
      claccu: c.claccu ?? c.codccu,
      anasin: c.anasin,
      nivccu: c.nivccu,
      // O Senior manda " " (espaço) pro CC raiz, não NULL — normaliza aqui, senão a árvore
      // trataria "espaço" como um código de pai de verdade.
      ccupai: c.ccupai && c.ccupai.trim() !== "" ? c.ccupai.trim() : null,
    }));

    // Realizado por CC, cruzando SÓ com sitrat/data — sem filtro de despar/grupo, de propósito:
    // esta aba é a outra dimensão da mesma SQL (centro de custo, não conta), e não deve herdar
    // o recorte de "Conta Paralela" que só faz sentido do lado da conta.
    const valoresLeaf = await prisma.$queryRawUnsafe<{ codccu: string; ano: number; mes: number; valor: number }[]>(
      `
      SELECT r.codccu AS codccu,
             EXTRACT(YEAR FROM r.datlct)::int AS ano,
             EXTRACT(MONTH FROM r.datlct)::int AS mes,
             SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
      FROM rateios_lancamento r
      WHERE r.sitrat = $1
        AND r.datlct >= $2::date AND r.datlct < $3::date
        AND EXTRACT(YEAR FROM r.datlct) = ANY($4::int[])
        AND EXTRACT(MONTH FROM r.datlct) = ANY($5::int[])
        AND ($6::text[] IS NULL OR r.codccu = ANY($6::text[]))
      GROUP BY r.codccu, EXTRACT(YEAR FROM r.datlct), EXTRACT(MONTH FROM r.datlct)
      `,
      SITRAT_CONTABILIZADO,
      periodo.inicio,
      periodo.fim,
      periodo.anos,
      periodo.meses,
      centrosCusto
    );

    const valoresPorCodccu = new Map<string, number[]>();
    for (const linha of valoresLeaf) {
      empilharValor(
        valoresPorCodccu,
        linha.codccu,
        periodo.colunaPorChave.get(`${linha.ano}-${String(linha.mes).padStart(2, "0")}`),
        linha.valor,
        periodo.numColunas
      );
    }

    const { linhas, totalGeral } = montarMatrizCentroCusto(centros, valoresPorCodccu, periodo.numColunas);

    res.json({
      meses: periodo.colunas,
      linhas,
      totalGeral: { valores: totalGeral, total: totalGeral.reduce((a, b) => a + b, 0) },
    });
  } catch (error) {
    handleError(res, error, "centros-custo");
  }
});

// ---------- Dash: evolução multi-ano (YoY + acumulado por grupo) ----------
contabilRouter.get("/evolucao", async (req, res) => {
  try {
    const anoAtual = parseIntListParam(req.query.anos)?.[0] ?? new Date().getFullYear();
    const anoAnterior = anoAtual - 1;
    const grupos = parseStringListParam(req.query.grupo);

    const linhas = await prisma.$queryRawUnsafe<{ despar: string; ano: number; mes: number; valor: number }[]>(
      `
      SELECT btrim(pc.despar) AS despar,
             EXTRACT(YEAR FROM r.datlct)::int AS ano,
             EXTRACT(MONTH FROM r.datlct)::int AS mes,
             SUM(CASE WHEN r.debcre = 'C' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS valor
      FROM rateios_lancamento r
      JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
      WHERE r.sitrat = $1
        AND btrim(pc.despar) <> ''
        AND EXTRACT(YEAR FROM r.datlct) IN ($2, $3)
        AND ($4::text[] IS NULL OR btrim(pc.despar) = ANY($4::text[]))
      GROUP BY btrim(pc.despar), EXTRACT(YEAR FROM r.datlct), EXTRACT(MONTH FROM r.datlct)
      `,
      SITRAT_CONTABILIZADO,
      anoAtual,
      anoAnterior,
      grupos
    );

    const mensalAtual = new Array<number>(12).fill(0);
    const mensalAnterior = new Array<number>(12).fill(0);
    const acumuladoPorGrupo = new Map<string, number[]>();
    for (const linha of linhas) {
      if (linha.ano === anoAtual) mensalAtual[linha.mes - 1] += linha.valor;
      else mensalAnterior[linha.mes - 1] += linha.valor;

      if (linha.ano === anoAtual) {
        const vetor = acumuladoPorGrupo.get(linha.despar) ?? new Array(12).fill(0);
        vetor[linha.mes - 1] += linha.valor;
        acumuladoPorGrupo.set(linha.despar, vetor);
      }
    }
    // Acumulado corrente (jan->dez), calculado depois de somar todos os meses de cada grupo.
    for (const vetor of acumuladoPorGrupo.values()) {
      for (let i = 1; i < 12; i++) vetor[i] += vetor[i - 1];
    }

    const totalAtual = mensalAtual.reduce((a, b) => a + b, 0);
    const totalAnterior = mensalAnterior.reduce((a, b) => a + b, 0);
    const variacaoPct = totalAnterior !== 0 ? ((totalAtual - totalAnterior) / Math.abs(totalAnterior)) * 100 : null;

    const totaisPorGrupo = [...acumuladoPorGrupo.entries()].map(([grupo, valores]) => ({
      grupo,
      total: valores[valores.length - 1],
    }));
    const melhorGrupo = totaisPorGrupo.length > 0 ? totaisPorGrupo.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    const piorGrupo = totaisPorGrupo.length > 0 ? totaisPorGrupo.reduce((a, b) => (b.total < a.total ? b : a)) : null;

    res.json({
      anoAtual,
      anoAnterior,
      kpis: {
        totalAtual,
        totalAnterior,
        variacaoPct,
        melhorGrupo: melhorGrupo?.grupo ?? null,
        piorGrupo: piorGrupo?.grupo ?? null,
      },
      mensalYoY: mensalAtual.map((valor, i) => ({ mes: i + 1, atual: valor, anterior: mensalAnterior[i] })),
      acumuladoPorGrupo: [...acumuladoPorGrupo.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
        .map(([grupo, valores]) => ({ grupo, valores })),
    });
  } catch (error) {
    handleError(res, error, "evolucao");
  }
});
