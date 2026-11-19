import { Router, Response } from "express";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  competenciaDia1,
  competenciasDoPeriodo,
  ehChaveParametro,
  mesSeguinte,
  ORIGENS_CUSTO,
  PARAMETROS_CUSTO,
  validarParametro,
  validarRegrasContasFolha,
  validarValorManual,
  type ChaveParametro,
  type RegraContaFolha,
} from "../domain/custoHora";
import { executarJobCustoHora, JOB_NAME as JOB_CUSTO_HORA } from "../domain/custoHoraJob";
import { carregarPlano } from "../domain/rentabilidade/calculo";
import { contasSelecionadas } from "../domain/rentabilidade/indicadores";

// Administração > Custo-hora real (18-19/11/2026): a configuração do cálculo (horas da escala e as CONTAS do plano que compõem o custo do CLT na
// contabilização da folha, R048CTB), o valor-hora manual por consultor e o resultado mensal do job. Só administrador: o resultado do CLT deriva da folha
// (remuneração individual). Montado em server.ts como "/custo-hora". A conta em si é de domain/custoHora.ts; o job, de domain/custoHoraJob.ts.
export const custoHoraRouter = Router();
custoHoraRouter.use(requireAuth, requireRole("admin"));

function handleError(res: Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[custo-hora:${label}]`, message);
  res.status(500).json({ error: message });
}

const usuarioDe = (req: unknown): number | null => (req as AuthenticatedRequest).user?.userId ?? null;
const ISO = (d: Date) => d.toISOString().slice(0, 10);
const dataUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const numero = (v: unknown): number | null => (v == null ? null : Number(v));

// ---------- configuração ----------

async function lerConfig() {
  const [parametros, contas, folhaImportada, ultimaExecucao] = await Promise.all([
    prisma.custoParametro.findMany(),
    prisma.custoContaFolha.findMany({ orderBy: [{ codemp: "asc" }, { ctared: "asc" }] }),
    prisma.$queryRaw<{ linhas: number; ate: Date | null }[]>`SELECT count(*)::int AS linhas, max(datlan) AS ate FROM hcm_contabilizacao_folha`,
    prisma.syncLog.findFirst({ where: { jobName: JOB_CUSTO_HORA }, orderBy: { id: "desc" }, select: { status: true, message: true, runAt: true } }),
  ]);
  return {
    parametros: Object.fromEntries(parametros.map((p) => [p.chave, p.valor])),
    definicoesParametros: PARAMETROS_CUSTO,
    origens: ORIGENS_CUSTO,
    contasFolha: contas.map((c) => ({ codemp: c.codemp, ctared: c.ctared, acao: c.acao })),
    contabilizacaoFolha: { linhas: folhaImportada[0]?.linhas ?? 0, ate: folhaImportada[0]?.ate ? ISO(folhaImportada[0].ate) : null },
    ultimaExecucao,
  };
}

custoHoraRouter.get("/config", async (_req, res) => {
  try {
    res.json(await lerConfig());
  } catch (error) {
    handleError(res, error, "config");
  }
});

custoHoraRouter.put("/parametros/:chave", async (req, res) => {
  try {
    const chave = req.params.chave;
    if (!ehChaveParametro(chave)) {
      res.status(404).json({ error: "Parâmetro desconhecido" });
      return;
    }
    if (req.body?.valor === null) {
      await prisma.custoParametro.deleteMany({ where: { chave } });
      res.json({ ok: true });
      return;
    }
    const v = validarParametro(chave as ChaveParametro, req.body?.valor);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    await prisma.custoParametro.upsert({ where: { chave }, create: { chave, valor: v.valor }, update: { valor: v.valor } });
    res.json({ ok: true, valor: v.valor });
  } catch (error) {
    handleError(res, error, "put-parametro");
  }
});

// ---------- contas da folha (R048CTB) ----------

/** Confere que cada conta das regras existe no plano do ERP; devolve as que não existem. */
async function contasForaDoPlano(regras: RegraContaFolha[]): Promise<number[]> {
  if (regras.length === 0) return [];
  const plano = await carregarPlano();
  const existentes = new Set(plano.map((c) => `${c.codemp}:${c.ctared}`));
  return regras.filter((r) => !existentes.has(`${r.codemp}:${r.ctared}`)).map((r) => r.ctared);
}

// Grava (substitui) as regras de quais contas compõem o custo do CLT. O seletor de contas da tela é o mesmo dos indicadores de rentabilidade.
custoHoraRouter.put("/contas-folha", async (req, res) => {
  try {
    const v = validarRegrasContasFolha(req.body?.regras);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const fora = await contasForaDoPlano(v.valor);
    if (fora.length > 0) {
      res.status(400).json({ error: `Conta(s) fora do plano contábil: ${fora.slice(0, 10).join(", ")}` });
      return;
    }
    await prisma.$transaction([prisma.custoContaFolha.deleteMany({}), prisma.custoContaFolha.createMany({ data: v.valor })]);
    res.json({ ok: true, regras: v.valor.length });
  } catch (error) {
    handleError(res, error, "put-contas-folha");
  }
});

interface MovimentoConta {
  numemp: number;
  ctared: number;
  clacta: string | null;
  descta: string | null;
  anasin: string | null;
  debito: number;
  credito: number;
  colaboradores: number;
}

// O que a folha contabilizou no mês, por conta do plano (débito, crédito e quantos colaboradores): é o que a pessoa olha para decidir quais contas entram
// no custo — e vê, na hora, o efeito das regras já gravadas (`selecionada`).
custoHoraRouter.get("/contas-folha/movimento", async (req, res) => {
  try {
    let competencia = competenciaDia1(String(req.query.competencia ?? ""));
    if (!competencia) {
      const ultimo = await prisma.$queryRaw<{ m: Date | null }[]>`SELECT date_trunc('month', max(datlan))::date AS m FROM hcm_contabilizacao_folha`;
      competencia = ultimo[0]?.m ? ISO(ultimo[0].m) : null;
    }
    if (!competencia) {
      res.json({ competencia: null, contas: [], totais: { debito: 0, credito: 0, liquido: 0, liquidoSelecionado: 0 } });
      return;
    }
    const [linhas, regras, plano] = await Promise.all([
      prisma.$queryRaw<MovimentoConta[]>`
        SELECT c.numemp, c.ctared, btrim(pc.clacta) AS clacta, btrim(pc.descta) AS descta, pc.anasin,
               SUM(CASE WHEN c.debcre = 'D' THEN c.vallan ELSE 0 END)::float8 AS debito,
               SUM(CASE WHEN c.debcre = 'C' THEN c.vallan ELSE 0 END)::float8 AS credito,
               count(DISTINCT (c.tipcol, c.numcad))::int AS colaboradores
        FROM hcm_contabilizacao_folha c
        LEFT JOIN plano_contabil pc ON pc.codemp = c.numemp AND pc.ctared = c.ctared
        WHERE c.ctared IS NOT NULL AND c.datlan >= ${competencia}::date AND c.datlan < ${mesSeguinte(competencia)}::date
        GROUP BY c.numemp, c.ctared, pc.clacta, pc.descta, pc.anasin
        ORDER BY pc.clacta NULLS LAST, c.ctared`,
      prisma.custoContaFolha.findMany(),
      carregarPlano(),
    ]);
    const selecionadas = contasSelecionadas(regras.map((r) => ({ codemp: r.codemp, ctared: r.ctared, acao: r.acao as "incluir" | "excluir" })), plano);
    const contas = linhas.map((l) => ({
      codemp: l.numemp,
      ctared: l.ctared,
      clacta: l.clacta,
      descta: l.descta,
      debito: l.debito,
      credito: l.credito,
      liquido: Math.round((l.debito - l.credito) * 100) / 100,
      colaboradores: l.colaboradores,
      selecionada: selecionadas.has(`${l.numemp}:${l.ctared}`),
    }));
    const soma = (f: (c: (typeof contas)[number]) => number) => Math.round(contas.reduce((s, c) => s + f(c), 0) * 100) / 100;
    res.json({
      competencia,
      contas,
      totais: { debito: soma((c) => c.debito), credito: soma((c) => c.credito), liquido: soma((c) => c.liquido), liquidoSelecionado: soma((c) => (c.selecionada ? c.liquido : 0)) },
    });
  } catch (error) {
    handleError(res, error, "contas-folha-movimento");
  }
});

// ---------- importar / exportar ----------

custoHoraRouter.get("/exportar", async (_req, res) => {
  try {
    const config = await lerConfig();
    res.json({ parametros: config.parametros, contasFolha: config.contasFolha });
  } catch (error) {
    handleError(res, error, "exportar");
  }
});

// Importa a configuração inteira (a mesma forma do /exportar). Valida TUDO antes de gravar; `substituir: true` apaga as regras de contas atuais antes
// (parâmetros presentes no arquivo sempre sobrescrevem). Sem `substituir`, mescla: o que o arquivo traz entra por cima do que já existe.
custoHoraRouter.post("/importar", async (req, res) => {
  try {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const erros: string[] = [];
    const parametros: [ChaveParametro, string][] = [];
    for (const [chave, valor] of Object.entries((corpo.parametros ?? {}) as Record<string, unknown>)) {
      if (!ehChaveParametro(chave)) {
        erros.push(`Parâmetro desconhecido: ${chave}`);
        continue;
      }
      const v = validarParametro(chave, valor);
      if (v.ok) parametros.push([chave, v.valor]);
      else erros.push(`${chave}: ${v.erro}`);
    }
    let regras: RegraContaFolha[] = [];
    if (corpo.contasFolha !== undefined) {
      const v = validarRegrasContasFolha(corpo.contasFolha);
      if (v.ok) {
        regras = v.valor;
        const fora = await contasForaDoPlano(regras);
        if (fora.length > 0) erros.push(`Conta(s) fora do plano contábil: ${fora.slice(0, 10).join(", ")}`);
      } else erros.push(v.erro);
    }
    if (erros.length > 0) {
      res.status(400).json({ error: erros.slice(0, 10).join(" · "), erros });
      return;
    }

    const substituir = corpo.substituir === true;
    await prisma.$transaction([
      ...(substituir ? [prisma.custoContaFolha.deleteMany({})] : []),
      ...parametros.map(([chave, valor]) => prisma.custoParametro.upsert({ where: { chave }, create: { chave, valor }, update: { valor } })),
      ...regras.map((r) => prisma.custoContaFolha.upsert({ where: { codemp_ctared: { codemp: r.codemp, ctared: r.ctared } }, create: r, update: { acao: r.acao } })),
    ]);
    res.json({ ok: true, parametros: parametros.length, contasFolha: regras.length });
  } catch (error) {
    handleError(res, error, "importar");
  }
});

// ---------- valor-hora manual ----------

custoHoraRouter.get("/valor-hora-manual/:codemp/:codusu", async (req, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codusu = Number(req.params.codusu);
    if (!Number.isInteger(codemp) || !Number.isInteger(codusu)) {
      res.status(400).json({ error: "codemp e codusu são obrigatórios" });
      return;
    }
    const valores = await prisma.consultorValorHoraManual.findMany({ where: { codemp, codusu }, orderBy: { vigenciaInicio: "desc" } });
    res.json({ valores: valores.map((v) => ({ id: v.id, vigenciaInicio: ISO(v.vigenciaInicio), valor: Number(v.valor), observacao: v.observacao })) });
  } catch (error) {
    handleError(res, error, "get-manual");
  }
});

// Grava (ou corrige) o valor-hora manual de uma vigência: mesma vigência = atualiza o valor.
custoHoraRouter.post("/valor-hora-manual/:codemp/:codusu", async (req, res) => {
  try {
    const codemp = Number(req.params.codemp);
    const codusu = Number(req.params.codusu);
    const v = validarValorManual(req.body);
    if (!Number.isInteger(codemp) || !Number.isInteger(codusu) || !v.ok) {
      res.status(400).json({ error: v.ok ? "codemp e codusu são obrigatórios" : v.erro });
      return;
    }
    const consultor = await prisma.consultor.findUnique({ where: { codemp_codusu: { codemp, codusu } }, select: { codusu: true } });
    if (!consultor) {
      res.status(404).json({ error: "Consultor não encontrado" });
      return;
    }
    const vigenciaInicio = dataUtc(v.valor.vigenciaInicio);
    await prisma.consultorValorHoraManual.upsert({
      where: { codemp_codusu_vigenciaInicio: { codemp, codusu, vigenciaInicio } },
      create: { codemp, codusu, vigenciaInicio, valor: v.valor.valor, observacao: v.valor.observacao, atualizadoPor: usuarioDe(req) },
      update: { valor: v.valor.valor, observacao: v.valor.observacao, atualizadoPor: usuarioDe(req) },
    });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "post-manual");
  }
});

custoHoraRouter.delete("/valor-hora-manual/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "id inválido" });
      return;
    }
    const r = await prisma.consultorValorHoraManual.deleteMany({ where: { id } });
    if (r.count === 0) {
      res.status(404).json({ error: "Valor não encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "delete-manual");
  }
});

// ---------- resultado do job ----------

custoHoraRouter.get("/resultado", async (req, res) => {
  try {
    const competencia = competenciaDia1(String(req.query.competencia ?? ""));
    if (!competencia) {
      res.status(400).json({ error: "competencia deve ser AAAA-MM" });
      return;
    }
    const [linhas, consultores, competencias] = await Promise.all([
      prisma.consultorCustoHora.findMany({ where: { competencia: dataUtc(competencia) } }),
      prisma.consultor.findMany({ where: { removidoEmSenior: null }, select: { codemp: true, codusu: true, nomcom: true, nomfor: true, sitfor: true, conhab: true } }),
      prisma.$queryRaw<{ competencia: Date }[]>`SELECT DISTINCT competencia FROM consultor_custo_hora ORDER BY competencia DESC LIMIT 36`,
    ]);
    const custoPor = new Map(linhas.map((l) => [`${l.codemp}-${l.codusu}`, l]));
    const nome = (c: { nomcom: string | null; nomfor: string | null; codusu: number }) => (c.nomcom ?? "").trim() || (c.nomfor ?? "").trim() || `Consultor ${c.codusu}`;
    res.json({
      competencia,
      competenciasComResultado: competencias.map((c) => ISO(c.competencia)),
      linhas: consultores
        .map((c) => {
          const l = custoPor.get(`${c.codemp}-${c.codusu}`);
          return { codemp: c.codemp, codusu: c.codusu, nome: nome(c), ativo: c.sitfor === "A", origem: l?.origem ?? null, custoHora: l ? numero(l.custoHora) : null, detalhe: l?.detalhe ?? null };
        })
        // Quem é inativo e não tem custo no mês não interessa; ativo sem custo é justamente o que precisa de atenção.
        .filter((l) => l.custoHora != null || l.ativo)
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    });
  } catch (error) {
    handleError(res, error, "resultado");
  }
});

custoHoraRouter.post("/recalcular", async (req, res) => {
  try {
    const competencias = competenciasDoPeriodo(String(req.body?.de ?? ""), String(req.body?.ate ?? req.body?.de ?? ""));
    if (!competencias) {
      res.status(400).json({ error: "Informe o período (de/ate em AAAA-MM, até 60 meses)" });
      return;
    }
    const r = await executarJobCustoHora(competencias);
    if (!r) {
      res.status(500).json({ error: "O cálculo falhou — veja o último registro em Sincronização (custo-hora-job)." });
      return;
    }
    res.json(r);
  } catch (error) {
    handleError(res, error, "recalcular");
  }
});

