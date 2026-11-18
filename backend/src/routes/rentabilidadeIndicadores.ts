import { Prisma } from "@prisma/client";
import { Router } from "express";
import type { Response } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { calcularRentabilidade, carregarIndicadores, diagnosticarContas, type Recorte } from "../domain/rentabilidade/calculo";
import { ErroFormula } from "../formulas/formula";
import { FONTES_SISTEMA, ordemDeCalculo, quemUsa, validarIndicador, type IndicadorEntrada } from "../domain/rentabilidade/indicadores";

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
