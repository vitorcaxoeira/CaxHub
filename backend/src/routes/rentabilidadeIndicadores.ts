import { Prisma } from "@prisma/client";
import { Router } from "express";
import type { Response } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { calcularRentabilidade, calcularRentabilidadePorGrupo, carregarIndicadores, carregarPlano, diagnosticarContas, filtrosComuns, type Recorte } from "../domain/rentabilidade/calculo";
import { colunasDaFormula, ErroFormula } from "../formulas/formula";
import { classificarOrigem, contasSelecionadas, FONTES_SISTEMA, ordemDeCalculo, quemUsa, validarIndicador, type IndicadorEntrada } from "../domain/rentabilidade/indicadores";
import { col, registrarListaConsultavel } from "./listaConsultavel";
import { ErroEntradaConsulta } from "../consultas/consultaColunas";
import { extrasDaConsulta } from "../consultas/camposRelacionados";
import { FONTES_LANCAMENTOS_RESULTADO } from "../domain/fontesDeCampos";
import { FORMULA_VALOR_REALIZADO, SITRAT_CONTABILIZADO } from "../domain/contabilDominio";
import { comHistoricoPadrao } from "./contabil";

// Administração > Contábil > Indicadores de Rentabilidade e a tela de resultado por centro de custo (17/11/2026). Substituem as listas FIXAS de
// contas do BI de Rentabilidade (regra do Vitor: nenhuma conta no código). Só admin, nas duas pontas. Montado em server.ts em "/rentabilidade".
export const rentabilidadeIndicadoresRouter = Router();
rentabilidadeIndicadoresRouter.use(requireAuth, requireRole("admin"));

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[rentabilidade:${label}]`, message);
  res.status(500).json({ error: message });
}

const dadosDe = (v: IndicadorEntrada) => ({
  codigo: v.codigo,
  rotulo: v.rotulo,
  tipo: v.tipo,
  base: v.base,
  natureza: v.natureza,
  formato: v.formato,
  formulaTexto: v.formulaTexto,
  formulaArvore: v.formulaArvore ? (v.formulaArvore as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  fonte: v.fonte,
  ordem: v.ordem,
  visivel: v.visivel,
});

/** Confere que o conjunto inteiro de indicadores continua calculável (sem fórmula em círculo). */
function conferirConjunto(indicadores: { codigo: string; tipo: IndicadorEntrada["tipo"]; formulaArvore: IndicadorEntrada["formulaArvore"] }[]): string | null {
  try {
    ordemDeCalculo(indicadores);
    return null;
  } catch (e) {
    return e instanceof ErroFormula ? e.message : "Fórmulas inválidas";
  }
}

// ---------- configuração ----------

rentabilidadeIndicadoresRouter.get("/indicadores", async (_req, res) => {
  try {
    res.json({ indicadores: await carregarIndicadores(), fontes: FONTES_SISTEMA });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

rentabilidadeIndicadoresRouter.post("/indicadores", async (req, res) => {
  try {
    const existentes = await carregarIndicadores();
    const v = validarIndicador(req.body, new Set(existentes.map((i) => i.codigo)));
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const ciclo = conferirConjunto([...existentes, v.valor]);
    if (ciclo) {
      res.status(400).json({ error: ciclo });
      return;
    }
    const criado = await prisma.rentabilidadeIndicador.create({ data: { ...dadosDe(v.valor), contas: { create: v.valor.contas } }, select: { id: true } });
    res.status(201).json({ id: criado.id });
  } catch (error) {
    handleError(res, error, "criar");
  }
});

rentabilidadeIndicadoresRouter.put("/indicadores/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Indicador inválido" });
      return;
    }
    const existentes = await carregarIndicadores();
    const atual = existentes.find((i) => i.id === id);
    if (!atual) {
      res.status(404).json({ error: "Indicador não encontrado" });
      return;
    }
    const outros = existentes.filter((i) => i.id !== id);
    const v = validarIndicador(req.body, new Set(outros.map((i) => i.codigo)));
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    if (v.valor.codigo !== atual.codigo) {
      const usam = quemUsa(atual.codigo, existentes);
      if (usam.length) {
        res.status(409).json({ error: `O código ${atual.codigo} é citado em fórmula de: ${usam.join(", ")}. Ajuste essas fórmulas antes de mudar o código.` });
        return;
      }
    }
    const ciclo = conferirConjunto([...outros, v.valor]);
    if (ciclo) {
      res.status(400).json({ error: ciclo });
      return;
    }
    // O que outras fórmulas já citam tem que continuar existindo e dando número depois da troca de tipo.
    await prisma.$transaction([
      prisma.rentabilidadeIndicadorConta.deleteMany({ where: { indicadorId: id } }),
      prisma.rentabilidadeIndicador.update({ where: { id }, data: { ...dadosDe(v.valor), contas: { create: v.valor.contas } } }),
    ]);
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "atualizar");
  }
});

rentabilidadeIndicadoresRouter.delete("/indicadores/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existentes = await carregarIndicadores();
    const atual = existentes.find((i) => i.id === id);
    if (!atual) {
      res.status(404).json({ error: "Indicador não encontrado" });
      return;
    }
    const usam = quemUsa(atual.codigo, existentes);
    if (usam.length) {
      res.status(409).json({ error: `${atual.codigo} é citado em fórmula de: ${usam.join(", ")}. Tire a citação antes de excluir.` });
      return;
    }
    await prisma.rentabilidadeIndicador.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "excluir");
  }
});

// ---------- importar e exportar (JSON) ----------

rentabilidadeIndicadoresRouter.get("/exportar", async (_req, res) => {
  try {
    const indicadores = await carregarIndicadores();
    res.json({
      versao: 1,
      indicadores: indicadores.map((i) => ({
        codigo: i.codigo,
        rotulo: i.rotulo,
        tipo: i.tipo,
        base: i.base,
        natureza: i.natureza,
        formato: i.formato,
        formula: i.formulaTexto,
        fonte: i.fonte,
        ordem: i.ordem,
        visivel: i.visivel,
        contas: i.contas,
      })),
    });
  } catch (error) {
    handleError(res, error, "exportar");
  }
});

/**
 * Importa a configuração. A TELA já leu o texto de cada fórmula e manda `formulaTexto` + `formulaArvore` (o leitor de texto é só dela).
 * `modo`: "substituir" apaga tudo e grava o arquivo; "mesclar" grava por código (o que está no arquivo troca, o resto fica).
 */
rentabilidadeIndicadoresRouter.post("/importar", async (req, res) => {
  try {
    const { modo, indicadores } = (req.body ?? {}) as { modo?: unknown; indicadores?: unknown };
    if ((modo !== "substituir" && modo !== "mesclar") || !Array.isArray(indicadores) || indicadores.length === 0 || indicadores.length > 200) {
      res.status(400).json({ error: "Informe o modo (substituir ou mesclar) e de 1 a 200 indicadores" });
      return;
    }
    const brutos = indicadores as Record<string, unknown>[];
    const codigosDoArquivo = brutos.map((b) => (typeof b?.codigo === "string" ? b.codigo : ""));
    const repetido = codigosDoArquivo.find((c, i) => c && codigosDoArquivo.indexOf(c) !== i);
    if (repetido) {
      res.status(400).json({ error: `O código ${repetido} aparece duas vezes no arquivo` });
      return;
    }
    const existentes = await carregarIndicadores();
    const manter = modo === "mesclar" ? existentes.filter((e) => !codigosDoArquivo.includes(e.codigo)) : [];

    const validados: IndicadorEntrada[] = [];
    for (const b of brutos) {
      const outros = new Set([...codigosDoArquivo.filter((c) => c !== b.codigo), ...manter.map((m) => m.codigo)]);
      const v = validarIndicador(b, outros);
      if (!v.ok) {
        res.status(400).json({ error: `Indicador ${typeof b?.codigo === "string" ? b.codigo : "?"}: ${v.erro}` });
        return;
      }
      validados.push(v.valor);
    }
    const ciclo = conferirConjunto([...manter, ...validados]);
    if (ciclo) {
      res.status(400).json({ error: ciclo });
      return;
    }

    // Conta citada que não existe no plano: não bloqueia (o plano pode mudar), mas é avisada.
    const citadas = [...new Set(validados.flatMap((v) => v.contas.map((c) => `${c.codemp}:${c.ctared}`)))];
    const noPlano = citadas.length
      ? await prisma.planoContabil.findMany({ where: { OR: citadas.map((k) => ({ codemp: Number(k.split(":")[0]), ctared: Number(k.split(":")[1]) })) }, select: { codemp: true, ctared: true } })
      : [];
    const achadas = new Set(noPlano.map((c) => `${c.codemp}:${c.ctared}`));
    const inexistentes = citadas.filter((k) => !achadas.has(k)).map((k) => Number(k.split(":")[1]));

    await prisma.$transaction(async (tx) => {
      if (modo === "substituir") await tx.rentabilidadeIndicador.deleteMany({});
      else await tx.rentabilidadeIndicador.deleteMany({ where: { codigo: { in: codigosDoArquivo } } });
      for (const v of validados) await tx.rentabilidadeIndicador.create({ data: { ...dadosDe(v), contas: { create: v.contas } } });
    });
    res.json({ ok: true, importados: validados.length, mantidos: manter.length, contasForaDoPlano: inexistentes });
  } catch (error) {
    handleError(res, error, "importar");
  }
});

// ---------- apoio da tela ----------

rentabilidadeIndicadoresRouter.get("/plano", async (_req, res) => {
  try {
    const contas = await prisma.planoContabil.findMany({
      select: { codemp: true, ctared: true, clacta: true, descta: true, anasin: true, nivcta: true, paiCtared: true, despar: true },
      orderBy: [{ codemp: "asc" }, { clacta: "asc" }],
    });
    res.json({ contas: contas.map((c) => ({ ...c, despar: c.despar?.trim() || null })) });
  } catch (error) {
    handleError(res, error, "plano");
  }
});

rentabilidadeIndicadoresRouter.get("/opcoes", async (_req, res) => {
  try {
    const [setores, centros] = await Promise.all([
      prisma.$queryRaw<{ despar: string }[]>`SELECT DISTINCT btrim(despar) AS despar FROM plano_contabil WHERE btrim(COALESCE(despar, '')) <> '' ORDER BY 1`,
      prisma.centroCusto.findMany({ where: { anasin: "A" }, select: { codccu: true, desccu: true }, orderBy: { codccu: "asc" } }),
    ]);
    res.json({ setores: setores.map((s) => s.despar), centros });
  } catch (error) {
    handleError(res, error, "opcoes");
  }
});

// ---------- resultado ----------

const MES = /^(\d{4})-(\d{2})$/;

/** `inicio` e `fim` em YYYY-MM (o mês `fim` entra inteiro). Devolve o recorte, ou a mensagem do que está errado. */
function lerRecorte(query: Record<string, unknown>): { ok: true; recorte: Recorte } | { ok: false; erro: string } {
  const ini = MES.exec(String(query.inicio ?? ""));
  const fim = MES.exec(String(query.fim ?? query.inicio ?? ""));
  if (!ini || !fim) return { ok: false, erro: "Informe inicio e fim no formato AAAA-MM" };
  const [ai, mi, af, mf] = [Number(ini[1]), Number(ini[2]), Number(fim[1]), Number(fim[2])];
  if (mi < 1 || mi > 12 || mf < 1 || mf > 12) return { ok: false, erro: "Mês inválido" };
  const meses = (af - ai) * 12 + (mf - mi) + 1;
  if (meses < 1 || meses > 36) return { ok: false, erro: "O período vai de 1 a 36 meses" };
  const proximo = mf === 12 ? `${af + 1}-01-01` : `${af}-${String(mf + 1).padStart(2, "0")}-01`;
  const ccs = typeof query.cc === "string" && query.cc ? query.cc.split(",").filter(Boolean).slice(0, 500) : null;
  return {
    ok: true,
    recorte: {
      inicio: `${ai}-${String(mi).padStart(2, "0")}-01`,
      fim: proximo,
      setor: typeof query.setor === "string" && query.setor.trim() ? query.setor.trim() : null,
      ccs,
      restringirModelo: query.restringirModelo !== "0" && query.restringirModelo !== "false",
      grupo: typeof query.grupo === "string" ? query.grupo : undefined,
    },
  };
}

rentabilidadeIndicadoresRouter.get("/calcular", async (req, res) => {
  try {
    const r = lerRecorte(req.query);
    if (!r.ok) {
      res.status(400).json({ error: r.erro });
      return;
    }
    res.json(await calcularRentabilidade(r.recorte));
  } catch (error) {
    handleError(res, error, "calcular");
  }
});

// ---------- origem do valor (24/11/2026) ----------
// De onde vem o valor de uma célula (ou do total, ou de uma linha de grupo): `classificarOrigem` diz o que o modal mostra — lançamentos (soma de contas), apontamentos
// (horas e custo do sistema) ou a composição de uma fórmula (cada coluna citada). Mesmos parâmetros de /calcular (recorte) + `indicador` (código) e, para uma linha,
// `codccu`; sem `codccu` vale o recorte inteiro (a linha de total ou, com `grupo`, a linha do grupo).

/** O recorte do cálculo, com o CC clicado no lugar do filtro de CCs da tela (`recorteTela` é o da tela, sem essa troca). */
function recorteDaOrigem(query: Record<string, unknown>) {
  const r = lerRecorte(query);
  if (!r.ok) return r;
  const codccu = typeof query.codccu === "string" && query.codccu.trim() ? query.codccu.trim() : null;
  return { ok: true as const, recorte: codccu ? { ...r.recorte, ccs: [codccu] } : r.recorte, recorteTela: r.recorte, codccu };
}

/** A fórmula, ou alguma coluna de que ela depende (mesmo indiretamente), usa TOTAL(): o valor de uma linha depende de TODOS os CCs do recorte. */
function dependeDeTotal(codigo: string, config: Awaited<ReturnType<typeof carregarIndicadores>>, vistos = new Set<string>()): boolean {
  if (vistos.has(codigo)) return false;
  vistos.add(codigo);
  const i = config.find((x) => x.codigo === codigo);
  if (!i || i.tipo !== "formula" || !i.formulaArvore) return false;
  return colunasDaFormula(i.formulaArvore, true).length > 0 || colunasDaFormula(i.formulaArvore).some((c) => dependeDeTotal(c, config, vistos));
}

/** A coluna (visível ou não: uma fórmula pode citar indicador oculto) e como se chega ao valor dela; `null` quando não há o que mostrar. */
async function origemDaColuna(codigo: string) {
  const config = await carregarIndicadores();
  const indicador = config.find((i) => i.codigo === codigo);
  const origem = indicador ? classificarOrigem(codigo, config) : null;
  if (!indicador || !origem) return null;
  return { config, indicador, origem, porCodigo: new Map(config.map((i) => [i.codigo, i])) };
}

rentabilidadeIndicadoresRouter.get("/origem", async (req, res) => {
  try {
    const r = recorteDaOrigem(req.query);
    if (!r.ok) {
      res.status(400).json({ error: r.erro });
      return;
    }
    const codigo = typeof req.query.indicador === "string" ? req.query.indicador : "";
    const o = await origemDaColuna(codigo);
    if (!o) {
      res.status(404).json({ error: "Esta coluna não tem origem para mostrar." });
      return;
    }
    // TOTAL() depende de todos os CCs do recorte: com ele, calcula o recorte da tela inteiro e pega a linha do CC. Sem ele, limita ao CC clicado (mais barato).
    const usaTotal = dependeDeTotal(codigo, o.config);
    const calculado = await calcularRentabilidade(usaTotal ? r.recorteTela : r.recorte, o.config);
    const valores = r.codccu ? (calculado.linhas.find((l) => l.codccu === r.codccu)?.valores ?? {}) : calculado.total;
    const desc = r.codccu ? ((await prisma.centroCusto.findFirst({ where: { codccu: r.codccu }, select: { desccu: true } }))?.desccu ?? "") : null;
    const base = {
      tipo: o.origem.tipo,
      indicador: { codigo: o.indicador.codigo, rotulo: o.indicador.rotulo, formato: o.indicador.formato, formula: o.indicador.tipo === "formula" ? o.indicador.formulaTexto : null },
      centroCusto: r.codccu ? { codccu: r.codccu, desccu: desc } : null,
      valor: valores[codigo] ?? 0,
    };
    if (o.origem.tipo === "formula") {
      res.json({
        ...base,
        referencias: o.origem.referencias.map((x) => {
          const ind = o.porCodigo.get(x.codigo);
          return {
            codigo: x.codigo,
            rotulo: ind?.rotulo ?? x.codigo,
            formato: ind?.formato ?? "numero",
            valor: valores[x.codigo] ?? 0,
            // O total do recorte só vem para as que a fórmula usa dentro de TOTAL().
            total: x.emTotal ? (calculado.total[x.codigo] ?? 0) : null,
            origem: classificarOrigem(x.codigo, o.config) !== null,
          };
        }),
      });
      return;
    }
    res.json({
      ...base,
      componentes: o.origem.componentes.map((c) => ({ codigo: c.codigo, rotulo: o.porCodigo.get(c.codigo)?.rotulo ?? c.codigo, sinal: c.sinal, valor: valores[c.codigo] ?? 0 })),
    });
  } catch (error) {
    handleError(res, error, "origem");
  }
});

// Os lançamentos que formam o valor: a MESMA regra de `movimentoRealizado` (rateio e lançamento contabilizados, não removidos, conta e CC analíticos, período, setor e modelo do
// Senior, FORMULA_VALOR_REALIZADO), só que linha a linha, com as contas e a natureza (débito/crédito) de cada indicador que compõe a coluna e o sinal da fórmula.
// Lista consultável como a dos lançamentos do Resultado Analítico (filtro e ordem por coluna, Σ, CSV, "Mais campos").
registrarListaConsultavel(
  rentabilidadeIndicadoresRouter,
  "/origem/lancamentos",
  async (req) => {
    const r = recorteDaOrigem(req.query as Record<string, unknown>);
    if (!r.ok) throw new ErroEntradaConsulta(r.erro);
    const codigo = typeof req.query.indicador === "string" ? req.query.indicador : "";
    const o = await origemDaColuna(codigo);
    if (!o || o.origem.tipo !== "lancamentos") throw new ErroEntradaConsulta("Esta coluna não tem origem em lançamentos.", 404);
    const plano = await carregarPlano();
    // (empresa, conta) -> o indicador que a seleciona, com sinal e natureza. Sem nenhuma conta, uma linha que não casa com nada (VALUES não pode ser vazio).
    const mapa: Prisma.Sql[] = [];
    for (const c of o.origem.componentes) {
      const ind = o.porCodigo.get(c.codigo)!;
      for (const chave of contasSelecionadas(ind.contas, plano)) {
        const [codemp, ctared] = chave.split(":").map(Number);
        mapa.push(Prisma.sql`(${codemp}::int, ${ctared}::int, ${ind.rotulo}::text, ${c.sinal}::int, ${ind.natureza}::text)`);
      }
    }
    if (mapa.length === 0) mapa.push(Prisma.sql`(0::int, 0::int, ''::text, 1::int, 'ambos'::text)`);
    const extras = extrasDaConsulta(FONTES_LANCAMENTOS_RESULTADO, req.query as Record<string, unknown>);
    return {
      fontes: FONTES_LANCAMENTOS_RESULTADO,
      totais: ["valor"],
      interna: Prisma.sql`
        SELECT m.indicador AS indicador, r.numlct::text AS numlct, r.ctared AS ctared, (r.ctared || ' - ' || pc.descta) AS conta, r.datlct AS datlct,
               (CASE WHEN cc.desccu IS NOT NULL THEN r.codccu || ' - ' || cc.desccu ELSE r.codccu END) AS centro_custo,
               r.debcre AS debcre, (m.sinal * (${Prisma.raw(FORMULA_VALOR_REALIZADO)}))::float8 AS valor,
               l.cpllct AS cpllct, l.codhpd AS codhpd${extras.selecao}
        FROM (VALUES ${Prisma.join(mapa)}) AS m(codemp, ctared, indicador, sinal, natureza)
        JOIN rateios_lancamento r ON r.codemp = m.codemp AND r.ctared = m.ctared
        JOIN lancamentos_contabeis l ON l.codemp = r.codemp AND l.numlct = r.numlct
        JOIN plano_contabil pc ON pc.codemp = r.codemp AND pc.ctared = r.ctared
        JOIN centros_custo cc ON cc.codemp = r.codemp AND cc.codccu = r.codccu
        WHERE r.sitrat = ${SITRAT_CONTABILIZADO} AND l.sitlct = ${SITRAT_CONTABILIZADO}
          AND r.removido_em_senior IS NULL AND l.removido_em_senior IS NULL
          AND pc.anasin = 'A' AND cc.anasin = 'A'
          AND r.datlct >= ${r.recorte.inicio}::date AND r.datlct < ${r.recorte.fim}::date
          AND (m.natureza = 'ambos' OR (m.natureza = 'debito' AND r.debcre = 'D') OR (m.natureza = 'credito' AND r.debcre = 'C'))
          ${filtrosComuns("r", r.recorte)}`,
      colunas: [
        col.texto("indicador", { obrigatoria: true }),
        col.data("datlct", { obrigatoria: true }),
        col.texto("numlct", { obrigatoria: true }),
        col.texto("conta", { obrigatoria: true }),
        col.texto("centro_custo"),
        col.texto("cpllct"),
        col.texto("debcre"),
        col.decimal("valor", { obrigatoria: true }),
        ...extras.colunas,
      ],
      ordemPadrao: Prisma.sql`x."datlct" ASC, x."numlct" ASC`,
      decorar: (linhas) => comHistoricoPadrao(linhas),
    };
  },
  "rentabilidade-origem",
);

/** O que cada indicador do sistema soma: de onde vêm os apontamentos (Kyria, RAT) e se o valor é a hora ou o custo dela (hora × custo-hora do consultor no mês). */
const PERNAS_DO_SISTEMA: Record<string, { origem: "kyria" | "rat"; medida: "horas" | "custo" }[]> = {
  HorasKyria: [{ origem: "kyria", medida: "horas" }],
  HorasRat: [{ origem: "rat", medida: "horas" }],
  CustoKyria: [{ origem: "kyria", medida: "custo" }],
  CustoRat: [{ origem: "rat", medida: "custo" }],
  CustoReal: [
    { origem: "kyria", medida: "custo" },
    { origem: "rat", medida: "custo" },
  ],
};

// Os apontamentos que formam um valor de horas ou de custo das horas: a MESMA regra de `horasKyriaPorCc`/`horasRatPorCc`/`custoKyriaPorCc`/`custoRatPorCc` (calculo.ts), linha a
// linha — Kyria (ticket → cliente → CC do cliente) e RAT (item → projeto → CC do projeto), período, RAT não cancelada, item não removido, custo-hora do consultor no mês. O
// valor de cada linha é a hora ou o custo, com o sinal da fórmula. Os CCs da lista são os do cálculo: o clicado, os do recorte, ou (linha de grupo) os que têm movimento no grupo.
registrarListaConsultavel(
  rentabilidadeIndicadoresRouter,
  "/origem/horas",
  async (req) => {
    const r = recorteDaOrigem(req.query as Record<string, unknown>);
    if (!r.ok) throw new ErroEntradaConsulta(r.erro);
    const codigo = typeof req.query.indicador === "string" ? req.query.indicador : "";
    const o = await origemDaColuna(codigo);
    if (!o || o.origem.tipo !== "horas") throw new ErroEntradaConsulta("Esta coluna não tem origem em horas.", 404);
    let ccs: string[] | null = r.recorte.ccs;
    if (!r.codccu && r.recorte.grupo != null) ccs = (await calcularRentabilidade(r.recorte, o.config)).linhas.map((l) => l.codccu);

    const pernas: Prisma.Sql[] = [];
    for (const c of o.origem.componentes) {
      const ind = o.porCodigo.get(c.codigo)!;
      for (const p of PERNAS_DO_SISTEMA[ind.fonte ?? ""] ?? []) {
        if (p.origem === "kyria") {
          const valor = p.medida === "horas" ? Prisma.sql`(e.minutes / 60.0)` : Prisma.sql`COALESCE((e.minutes / 60.0) * cch.custo_hora, 0)`;
          pernas.push(Prisma.sql`
            SELECT 'Kyria'::text AS origem, ${ind.rotulo}::text AS indicador, (e.started_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia, t.code::text AS documento,
                   m.name::text AS pessoa, t.title::text AS descricao, cl.codccu::text AS codccu, (e.minutes / 60.0)::float8 AS horas, cch.custo_hora::float8 AS custo_hora,
                   (${c.sinal}::int * ${valor})::float8 AS valor
            FROM kyria_time_entries e
            JOIN kyria_tickets t ON t.id = e.ticket_id
            JOIN kyria_customers kc ON kc.id = t.customer_id
            JOIN clientes cl ON cl.codcli = kc.codcli
            LEFT JOIN kyria_members m ON m.id = e.user_id
            LEFT JOIN consultor_custo_hora cch ON cch.codusu = m.codusu AND cch.competencia = date_trunc('month', e.started_at AT TIME ZONE 'America/Sao_Paulo')::date
            WHERE e.started_at >= ${r.recorte.inicio}::date AND e.started_at < ${r.recorte.fim}::date AND cl.codccu IS NOT NULL
              AND (${ccs}::text[] IS NULL OR cl.codccu = ANY(${ccs}::text[]))`);
        } else {
          const valor = p.medida === "horas" ? Prisma.sql`((i.horfim - i.horini) / 60.0)` : Prisma.sql`COALESCE(((i.horfim - i.horini) / 60.0) * cc.custo_hora, 0)`;
          pernas.push(Prisma.sql`
            SELECT 'RAT'::text AS origem, ${ind.rotulo}::text AS indicador, i.datati::date AS dia, ('RAT ' || r.numrat::text)::text AS documento,
                   (SELECT COALESCE(NULLIF(btrim(co.nomcom), ''), btrim(co.nomfor)) FROM consultores co WHERE co.codemp = r.codemp AND co.codfor = r.codfor ORDER BY co.codusu LIMIT 1)::text AS pessoa,
                   i.desati::text AS descricao, p.codccu::text AS codccu, ((i.horfim - i.horini) / 60.0)::float8 AS horas, cc.custo_hora::float8 AS custo_hora,
                   (${c.sinal}::int * ${valor})::float8 AS valor
            FROM rat_itens i
            JOIN rats r ON r.id = i."ratId" AND r.sitrat IS DISTINCT FROM 5
            JOIN projetos p ON p.codemp = r.codemp AND p.numprj = r.numprj
            LEFT JOIN LATERAL (
              SELECT cch.custo_hora FROM consultores co
              JOIN consultor_custo_hora cch ON cch.codemp = co.codemp AND cch.codusu = co.codusu AND cch.competencia = date_trunc('month', i.datati)::date
              WHERE co.codemp = r.codemp AND co.codfor = r.codfor ORDER BY co.codusu LIMIT 1
            ) cc ON true
            WHERE i.datati >= ${r.recorte.inicio}::date AND i.datati < ${r.recorte.fim}::date AND i.horfim > i.horini
              AND i.removido_em_senior IS NULL AND p.codccu IS NOT NULL
              AND (${ccs}::text[] IS NULL OR p.codccu = ANY(${ccs}::text[]))`);
        }
      }
    }
    if (pernas.length === 0) throw new ErroEntradaConsulta("Esta coluna não tem origem em horas.", 404);
    return {
      totais: ["valor"],
      interna: Prisma.sql`SELECT * FROM (${Prisma.join(pernas, " UNION ALL ")}) u`,
      colunas: [
        col.texto("origem", { obrigatoria: true }),
        col.texto("indicador", { obrigatoria: true }),
        col.data("dia", { obrigatoria: true }),
        col.texto("documento"),
        col.texto("pessoa"),
        col.texto("descricao"),
        col.texto("codccu"),
        col.decimal("horas"),
        col.decimal("custo_hora"),
        col.decimal("valor", { obrigatoria: true }),
      ],
      ordemPadrao: Prisma.sql`x."dia" ASC, x."documento" ASC`,
    };
  },
  "rentabilidade-origem-horas",
);

// Aba Por Grupo (24/11/2026): mesmos parâmetros de /calcular, um bloco por grupo (Conta Paralela) com as linhas dos CCs que têm movimento nele.
rentabilidadeIndicadoresRouter.get("/calcular-por-grupo", async (req, res) => {
  try {
    const r = lerRecorte(req.query);
    if (!r.ok) {
      res.status(400).json({ error: r.erro });
      return;
    }
    res.json(await calcularRentabilidadePorGrupo(r.recorte));
  } catch (error) {
    handleError(res, error, "calcular-por-grupo");
  }
});

rentabilidadeIndicadoresRouter.get("/diagnostico", async (req, res) => {
  try {
    const r = lerRecorte(req.query);
    if (!r.ok) {
      res.status(400).json({ error: r.erro });
      return;
    }
    res.json(await diagnosticarContas(r.recorte));
  } catch (error) {
    handleError(res, error, "diagnostico");
  }
});
