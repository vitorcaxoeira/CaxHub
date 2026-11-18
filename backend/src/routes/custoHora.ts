import { Router, Response } from "express";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import {
  CLASSES_EVENTO,
  competenciaDia1,
  competenciasDoPeriodo,
  ehChaveParametro,
  ehClasseEvento,
  ORIGENS_CUSTO,
  PARAMETROS_CUSTO,
  validarEncargo,
  validarParametro,
  validarValorManual,
  type ChaveParametro,
} from "../domain/custoHora";
import { executarJobCustoHora, JOB_NAME as JOB_CUSTO_HORA } from "../domain/custoHoraJob";

// Administração > Custo-hora real (18/11/2026): a configuração do cálculo (parâmetros, encargos percentuais com vigência, classificação dos eventos
// da folha), o valor-hora manual por consultor e o resultado mensal do job. Só administrador: o resultado do CLT deriva da folha (remuneração
// individual). Montado em server.ts como "/custo-hora". A conta em si é de domain/custoHora.ts; o job, de domain/custoHoraJob.ts.
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
  const [parametros, encargos, classes, ultimaExecucao] = await Promise.all([
    prisma.custoParametro.findMany(),
    prisma.custoEncargo.findMany({ orderBy: [{ codigo: "asc" }, { vigenciaInicio: "asc" }] }),
    prisma.custoEventoClasse.count(),
    prisma.syncLog.findFirst({ where: { jobName: JOB_CUSTO_HORA }, orderBy: { id: "desc" }, select: { status: true, message: true, runAt: true } }),
  ]);
  return {
    parametros: Object.fromEntries(parametros.map((p) => [p.chave, p.valor])),
    definicoesParametros: PARAMETROS_CUSTO,
    classesEvento: CLASSES_EVENTO,
    origens: ORIGENS_CUSTO,
    encargos: encargos.map((e) => ({ id: e.id, codigo: e.codigo, rotulo: e.rotulo, percentual: Number(e.percentual), vigenciaInicio: ISO(e.vigenciaInicio) })),
    eventosClassificados: classes,
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

// ---------- encargos ----------

custoHoraRouter.post("/encargos", async (req, res) => {
  try {
    const v = validarEncargo(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.erro });
      return;
    }
    const igual = await prisma.custoEncargo.findUnique({ where: { codigo_vigenciaInicio: { codigo: v.valor.codigo, vigenciaInicio: dataUtc(v.valor.vigenciaInicio) } } });
    if (igual) {
      res.status(409).json({ error: `Já existe o encargo "${v.valor.codigo}" com vigência em ${v.valor.vigenciaInicio}. Edite o existente.` });
      return;
    }
    const criado = await prisma.custoEncargo.create({ data: { ...v.valor, vigenciaInicio: dataUtc(v.valor.vigenciaInicio) } });
    res.status(201).json({ id: criado.id });
  } catch (error) {
    handleError(res, error, "post-encargo");
  }
});

custoHoraRouter.put("/encargos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const v = validarEncargo(req.body);
    if (!Number.isInteger(id) || !v.ok) {
      res.status(400).json({ error: v.ok ? "id inválido" : v.erro });
      return;
    }
    const outro = await prisma.custoEncargo.findFirst({ where: { codigo: v.valor.codigo, vigenciaInicio: dataUtc(v.valor.vigenciaInicio), NOT: { id } } });
    if (outro) {
      res.status(409).json({ error: `Já existe o encargo "${v.valor.codigo}" com vigência em ${v.valor.vigenciaInicio}.` });
      return;
    }
    const r = await prisma.custoEncargo.updateMany({ where: { id }, data: { ...v.valor, vigenciaInicio: dataUtc(v.valor.vigenciaInicio) } });
    if (r.count === 0) {
      res.status(404).json({ error: "Encargo não encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-encargo");
  }
});

custoHoraRouter.delete("/encargos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "id inválido" });
      return;
    }
    const r = await prisma.custoEncargo.deleteMany({ where: { id } });
    if (r.count === 0) {
      res.status(404).json({ error: "Encargo não encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "delete-encargo");
  }
});

// ---------- eventos da folha ----------

interface EventoLinha {
  tabeve: number;
  codeve: number;
  descricao: string | null;
  tipeve: number | null;
  classe: string | null;
  linhas: number;
  colaboradores: number;
  valor: number;
}

/** Os eventos que aparecem na folha importada (R046VER), com o tipo do Senior, a classe escolhida e o quanto pesam — o que a pessoa precisa para decidir. */
function eventosDaFolha(): Promise<EventoLinha[]> {
  return prisma.$queryRaw<EventoLinha[]>`
    SELECT v.tabeve, v.codeve, btrim(e.deseve) AS descricao, e.tipeve, k.classe,
           count(*)::int AS linhas, count(DISTINCT (v.numemp, v.tipcol, v.numcad))::int AS colaboradores, COALESCE(SUM(v.valeve), 0)::float8 AS valor
    FROM hcm_verbas_folha v
    LEFT JOIN hcm_eventos e ON e.codtab = v.tabeve AND e.codeve = v.codeve
    LEFT JOIN custo_evento_classes k ON k.tabeve = v.tabeve AND k.codeve = v.codeve
    WHERE v.removido_em_senior IS NULL
    GROUP BY v.tabeve, v.codeve, e.deseve, e.tipeve, k.classe
    ORDER BY e.tipeve NULLS LAST, v.tabeve, v.codeve`;
}

custoHoraRouter.get("/eventos", async (_req, res) => {
  try {
    res.json({ eventos: await eventosDaFolha() });
  } catch (error) {
    handleError(res, error, "eventos");
  }
});

custoHoraRouter.put("/eventos/:tabeve/:codeve", async (req, res) => {
  try {
    const tabeve = Number(req.params.tabeve);
    const codeve = Number(req.params.codeve);
    const classe: unknown = req.body?.classe;
    if (!Number.isInteger(tabeve) || !Number.isInteger(codeve) || (classe !== null && !ehClasseEvento(classe))) {
      res.status(400).json({ error: "tabeve, codeve e classe (remuneracao, beneficio, encargo_folha ou null para ignorar) são obrigatórios" });
      return;
    }
    if (classe === null) await prisma.custoEventoClasse.deleteMany({ where: { tabeve, codeve } });
    else await prisma.custoEventoClasse.upsert({ where: { tabeve_codeve: { tabeve, codeve } }, create: { tabeve, codeve, classe, atualizadoPor: usuarioDe(req) }, update: { classe, atualizadoPor: usuarioDe(req) } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "put-evento");
  }
});

// Classifica de uma vez os eventos de um tipo do Senior (Provento, Vantagem, Desconto...) — a pessoa decide a classe; o código não presume nenhuma.
custoHoraRouter.post("/eventos/lote", async (req, res) => {
  try {
    const tipeve = Number(req.body?.tipeve);
    const classe: unknown = req.body?.classe;
    const somenteSemClasse = req.body?.somenteSemClasse !== false;
    if (!Number.isInteger(tipeve) || (classe !== null && !ehClasseEvento(classe))) {
      res.status(400).json({ error: "tipeve e classe (ou null para ignorar) são obrigatórios" });
      return;
    }
    const alvo = (await eventosDaFolha()).filter((e) => e.tipeve === tipeve && (!somenteSemClasse || e.classe == null));
    await prisma.$transaction(
      alvo.map((e) =>
        classe === null
          ? prisma.custoEventoClasse.deleteMany({ where: { tabeve: e.tabeve, codeve: e.codeve } })
          : prisma.custoEventoClasse.upsert({ where: { tabeve_codeve: { tabeve: e.tabeve, codeve: e.codeve } }, create: { tabeve: e.tabeve, codeve: e.codeve, classe, atualizadoPor: usuarioDe(req) }, update: { classe, atualizadoPor: usuarioDe(req) } })
      )
    );
    res.json({ ok: true, alterados: alvo.length });
  } catch (error) {
    handleError(res, error, "eventos-lote");
  }
});

// ---------- importar / exportar ----------

custoHoraRouter.get("/exportar", async (_req, res) => {
  try {
    const [config, eventos] = await Promise.all([lerConfig(), prisma.custoEventoClasse.findMany({ orderBy: [{ tabeve: "asc" }, { codeve: "asc" }] })]);
    res.json({
      parametros: config.parametros,
      encargos: config.encargos.map(({ codigo, rotulo, percentual, vigenciaInicio }) => ({ codigo, rotulo, percentual, vigenciaInicio })),
      eventos: eventos.map((e) => ({ tabeve: e.tabeve, codeve: e.codeve, classe: e.classe })),
    });
  } catch (error) {
    handleError(res, error, "exportar");
  }
});

// Importa a configuração inteira (a mesma forma do /exportar). Valida TUDO antes de gravar; `substituir: true` apaga encargos e classificações atuais
// antes (parâmetros presentes no arquivo sempre sobrescrevem). Sem `substituir`, mescla: o que o arquivo traz entra por cima do que já existe.
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
    const encargos: ReturnType<typeof validarEncargo>[] = Array.isArray(corpo.encargos) ? corpo.encargos.map((e) => validarEncargo(e)) : [];
    encargos.forEach((e, i) => !e.ok && erros.push(`Encargo ${i + 1}: ${e.erro}`));
    const vistos = new Set<string>();
    for (const e of encargos) {
      if (!e.ok) continue;
      const k = `${e.valor.codigo}|${e.valor.vigenciaInicio}`;
      if (vistos.has(k)) erros.push(`Encargo repetido: ${e.valor.codigo} com vigência ${e.valor.vigenciaInicio}`);
      vistos.add(k);
    }
    const eventos: { tabeve: number; codeve: number; classe: string }[] = [];
    if (Array.isArray(corpo.eventos)) {
      corpo.eventos.forEach((e: any, i: number) => {
        if (Number.isInteger(e?.tabeve) && Number.isInteger(e?.codeve) && ehClasseEvento(e?.classe)) eventos.push({ tabeve: e.tabeve, codeve: e.codeve, classe: e.classe });
        else erros.push(`Evento ${i + 1}: informe tabeve, codeve e classe válida`);
      });
    }
    if (erros.length > 0) {
      res.status(400).json({ error: erros.slice(0, 10).join(" · "), erros });
      return;
    }

    const substituir = corpo.substituir === true;
    const quem = usuarioDe(req);
    await prisma.$transaction([
      ...(substituir ? [prisma.custoEncargo.deleteMany({}), prisma.custoEventoClasse.deleteMany({})] : []),
      ...parametros.map(([chave, valor]) => prisma.custoParametro.upsert({ where: { chave }, create: { chave, valor }, update: { valor } })),
      ...encargos.flatMap((e) =>
        e.ok
          ? [
              prisma.custoEncargo.upsert({
                where: { codigo_vigenciaInicio: { codigo: e.valor.codigo, vigenciaInicio: dataUtc(e.valor.vigenciaInicio) } },
                create: { ...e.valor, vigenciaInicio: dataUtc(e.valor.vigenciaInicio) },
                update: { rotulo: e.valor.rotulo, percentual: e.valor.percentual },
              }),
            ]
          : []
      ),
      ...eventos.map((e) => prisma.custoEventoClasse.upsert({ where: { tabeve_codeve: { tabeve: e.tabeve, codeve: e.codeve } }, create: { ...e, atualizadoPor: quem }, update: { classe: e.classe, atualizadoPor: quem } })),
    ]);
    res.json({ ok: true, parametros: parametros.length, encargos: encargos.length, eventos: eventos.length });
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

