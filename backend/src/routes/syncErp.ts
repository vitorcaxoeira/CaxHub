import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { SYNC_JOBS } from "../sync/registry";
import type { SyncJobDescriptor } from "../sync/registry";
import { proximaExecucao } from "../sync/cronUtils";
import { camposEspelhados, camposErp } from "../sync/catalogoCampos";
import { resolverPredicados, carregarFiltrosAtivos, substituirPredicadoDoCampo, removerPredicadoDoCampo } from "../sync/filtrosAtivos";
import { PredicadoFiltro, OperadorFiltro, VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO, substituirVariavelUltimaSincronizacao } from "../sync/filtroSenior";
import { montarQuerySenior } from "../sync/consultaSenior";
import { AuthenticatedRequest } from "../auth/middleware";
import { DIMENSOES, dimensaoPorChave, jobsComDimensao, jobsSemDimensao } from "../sync/dimensoesFiltro";
import { diagnosticarRecorte, marcarOrfaosDoRecorte } from "../sync/recorteRetroativo";

// Painel de administração dos jobs de sincronização Senior -> CaxHub: quando cada
// tabela sincronizou pela última vez, quando roda de novo automaticamente, e uma ação
// manual (Todos ou só Alterados, quando o job suporta) — mesmo padrão de disparo
// "fire and forget" já usado em financeiro.ts (contas a receber).
export const syncErpRouter = Router();
syncErpRouter.use(requireAuth, requireRole("admin"));

const jobsEmAndamento = new Set<string>();
let sincronizandoTodos = false;

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sync-erp:${label}]`, message);
  res.status(500).json({ error: message });
}

// Data da última sincronização BEM-SUCEDIDA deste job (qualquer modo) — é o `desde` que
// `POST /:jobName/run` calcula pra rodar o modo Alterados de verdade, extraído aqui pra
// também resolver a variável "última sincronização" (filtroSenior.ts) em exibição
// (GET/preview), sem duplicar a mesma query 3 vezes. `null` = nunca sincronizado com sucesso.
async function ultimoSucessoEm(jobName: string): Promise<Date | null> {
  const ultimoSucesso = await prisma.syncLog.findFirst({
    where: { jobName, status: "success" },
    orderBy: { runAt: "desc" },
  });
  return ultimoSucesso?.runAt ?? null;
}

// Resolve a variável "última sincronização" (se presente) pra exibição — GET/preview nunca
// devolvem o token cru como se fosse SQL de verdade. Sem sincronização anterior, mantém o
// token (caso raro: tabela nova, ainda sem nenhum sync bem-sucedido).
async function comVariavelResolvidaParaExibicao(jobName: string, predicadosSql: string[]): Promise<string[]> {
  if (!predicadosSql.some((sql) => sql.includes(VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO))) return predicadosSql;
  const desde = await ultimoSucessoEm(jobName);
  return desde ? substituirVariavelUltimaSincronizacao(predicadosSql, desde) : predicadosSql;
}

// "Salvar filtro" sem nenhum predicado (a lista de rascunho ficou toda vazia) precisa ter o
// MESMO efeito que "apagar filtro" — bug real (21/08/2026): antes disso, um `upsert` com
// `predicados: []` deixava uma linha "vazia" na tabela, que fazia o indicador "●" acender à
// toa (GET / via `temFiltroTodos`/`temFiltroAlterados`, ver ali). Usado por PUT /:jobName/
// filtro/:modo e POST /:jobName/filtro/todos/propagar — os 2 lugares que gravam `predicados`
// vindo de fora (edição direta, ou cópia de "todos"). NÃO usado pela propagação por dimensão
// (POST /dimensoes/:d/aplicar): ela sempre insere um predicado a mais via
// `substituirPredicadoDoCampo`, nunca pode terminar com array vazio.
async function salvarOuLimparFiltro(
  jobName: string,
  modo: "todos" | "alterados",
  predicados: PredicadoFiltro[],
  atualizadoPor: number | null
): Promise<void> {
  if (predicados.length === 0) {
    await prisma.filtroSincronizacao.deleteMany({ where: { jobName, modo } });
    return;
  }
  await prisma.filtroSincronizacao.upsert({
    where: { jobName_modo: { jobName, modo } },
    update: { predicados: predicados as unknown as object, atualizadoPor },
    create: { jobName, modo, predicados: predicados as unknown as object, atualizadoPor },
  });
}

syncErpRouter.get("/", async (_req, res) => {
  try {
    const jobNames = SYNC_JOBS.map((j) => j.jobName);
    const logs = await prisma.syncLog.findMany({
      where: { jobName: { in: jobNames } },
      orderBy: { runAt: "desc" },
    });

    const ultimoPorJob = new Map<string, (typeof logs)[number]>();
    // Última execução que REALMENTE varreu, que não é necessariamente a última execução:
    // sync incremental ("Alterados") nunca varre, então uma tabela pode ter sincronizado
    // agora e não ser varrida há meses. Sem separar os dois, a tela some com a informação
    // da varredura assim que roda um incremental, e o buraco fica invisível.
    const ultimaVarreduraPorJob = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      if (!ultimoPorJob.has(log.jobName)) ultimoPorJob.set(log.jobName, log);
      if (log.varreduraModo != null && !ultimaVarreduraPorJob.has(log.jobName)) {
        ultimaVarreduraPorJob.set(log.jobName, log);
      }
    }

    const contagens = await Promise.all(SYNC_JOBS.map((job) => job.contarRegistros()));
    // Só os jobs com detecção de exclusão ligada contam removidos; os demais devolvem null
    // e a tela não mostra nada na coluna.
    const removidos = await Promise.all(SYNC_JOBS.map((job) => job.contarRemovidos?.() ?? Promise.resolve(null)));
    // Fase 3/4/6 do plano de filtros — só pra decidir os indicadores "●" na tela (um por
    // modo) sem precisar abrir a aba de cada tabela. O CONTEÚDO do filtro só é buscado
    // quando a aba Filtro(Todos)/Filtro(Alterados) é aberta de verdade (GET .../filtro/:modo)
    // — essa rota é chamada a cada 10s pelo polling, não vale a pena trazer o JSON inteiro de
    // todo filtro de toda tabela nela, só o suficiente pra saber se HÁ predicado de verdade.
    //
    // Bug real (21/08/2026, pego pelo Vitor num print): existir uma LINHA na tabela não é o
    // mesmo que ter filtro — salvar o painel sem nenhum campo selecionado manda `predicados:
    // []`, e isso acendia o "●" à toa. `PUT`/`propagar` agora apagam a linha nesse caso (não
    // deveria mais acontecer daqui pra frente), mas o `GET` confere o CONTEÚDO mesmo assim —
    // não confia só na linha existir, cobre também linha antiga que já ficou vazia.
    const filtrosSalvos = await prisma.filtroSincronizacao.findMany({ select: { jobName: true, modo: true, predicados: true } });
    const temPredicado = (f: (typeof filtrosSalvos)[number]) => Array.isArray(f.predicados) && f.predicados.length > 0;
    const jobsComFiltroTodos = new Set(filtrosSalvos.filter((f) => f.modo === "todos" && temPredicado(f)).map((f) => f.jobName));
    const jobsComFiltroAlterados = new Set(filtrosSalvos.filter((f) => f.modo === "alterados" && temPredicado(f)).map((f) => f.jobName));

    const agora = new Date();
    res.json({
      sincronizandoTodos,
      jobs: SYNC_JOBS.map((job, indice) => {
        const ultimo = ultimoPorJob.get(job.jobName);
        const varredura = ultimaVarreduraPorJob.get(job.jobName);
        return {
          jobName: job.jobName,
          displayName: job.displayName,
          // Ordem em que "Sincronizar Todas as Tabelas" executa esta tabela — mesma ordem
          // de SYNC_JOBS, que respeita as dependências de FK (ex.: FaseProposta antes de
          // AtividadeConsultor).
          ordemExecucao: indice + 1,
          totalRegistros: contagens[indice],
          suportaAlterados: job.suportaAlterados,
          // Campo de ORIGEM do corte incremental (ex.: "DatAtu") — pedido do Vitor 21/08/2026,
          // a tela usa isso pra oferecer a variável "última sincronização" só na linha certa
          // do editor de Filtro(Alterados).
          campoData: job.campoData,
          ultimaSincronizacao: ultimo?.runAt ?? null,
          ultimoStatus: ultimo?.status ?? null,
          // `message` do SyncLog agora também carrega o resumo da varredura em execução
          // BEM-SUCEDIDA (ex.: "varredura SIMULADA: 3 sumiram do Senior"), não só erro.
          // Por isso vira `ultimaMensagem` e quem decide a cor na tela é `ultimoStatus` —
          // mandar isso como `ultimoErro` pintaria resumo de sucesso de vermelho.
          ultimaMensagem: ultimo?.message ?? null,
          // Quanto a última execução (a mesma que ultimaSincronizacao/ultimaMensagem se
          // referem) levou, do início ao fim — inclusive quando terminou em erro. NULL:
          // log anterior a 20/08/2026, ou uma sync unitária que reaproveita este jobName
          // sem passar pelo carimbo (ver SyncLog.duracaoMs no schema).
          ultimaDuracaoMs: ultimo?.duracaoMs ?? null,
          totalRemovidos: removidos[indice],
          // Resultado da ÚLTIMA VARREDURA (não da última sincronização). `detectados`
          // conta o que ela achou, inclusive em modo "simular", quando nada foi gravado —
          // sem isso a tela mostraria zero durante toda a fase de observação, que é
          // justamente quando o número importa. `em` permite à tela avisar quando a
          // varredura está muito mais velha que a sincronização, sinal de tabela que só
          // vem rodando no modo "Alterados" e portanto nunca é varrida.
          ultimaVarredura:
            varredura?.varreduraModo != null
              ? {
                  modo: varredura.varreduraModo,
                  detectados: varredura.varreduraDetectados ?? 0,
                  em: varredura.runAt,
                }
              : null,
          // true = a tabela tem detecção configurada mas a última execução não varreu
          // (sync incremental). Vira alerta na tela quando persiste.
          temDeteccao: job.contarRemovidos != null,
          // Fase 3/4/6 do plano de filtros — true nos 35 jobs cujo `run()` já lê
          // `filtroDoJob()` (JOBS_COM_FILTRO em registry.ts). A tela usa isso pra mostrar as
          // abas Filtro(Todos)/Filtro(Alterados) só onde elas funcionam de verdade — a
          // segunda também exige `suportaAlterados` (não existe "alterados" sem CAMPO_DATA).
          suportaFiltro: job.suportaFiltro,
          temFiltroTodos: jobsComFiltroTodos.has(job.jobName),
          temFiltroAlterados: jobsComFiltroAlterados.has(job.jobName),
          proximaExecucao: proximaExecucao(job.cronExpr, agora),
          emAndamento: jobsEmAndamento.has(job.jobName),
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// GET /:jobName/removidos — amostra dos registros que a varredura marcou como excluídos
// no Senior, pra conferência manual lá no ERP. É o que permite validar a detecção antes
// de qualquer coisa começar a sumir das telas de negócio.
syncErpRouter.get("/:jobName/removidos", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (!job.listarRemovidos) {
      res.status(400).json({ error: "Esta tabela ainda não tem detecção de exclusão no Senior" });
      return;
    }
    const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));
    // Instante da última varredura deste job, pra listagem conseguir incluir os candidatos
    // que ainda não foram marcados (caso da simulação).
    const ultimaVarredura = await prisma.syncLog.findFirst({
      where: { jobName: job.jobName, varreduraInicio: { not: null } },
      orderBy: { runAt: "desc" },
      select: { varreduraInicio: true },
    });
    res.json({ itens: await job.listarRemovidos(limite, ultimaVarredura?.varreduraInicio ?? null) });
  } catch (error) {
    handleError(res, error, "removidos");
  }
});

// GET /:jobName/campos — catálogo de campos filtráveis (Fase 2 do plano de filtros na
// importação, só leitura — nada aqui aplica filtro, só descreve o que existe). Por padrão
// devolve os campos já espelhados localmente, sem round-trip SOAP (instantâneo, é o que a
// tela mostra ao expandir uma linha); `?fonte=erp` busca o dicionário completo do Senior
// (cacheado 12h, ver soap/metadataCache.ts) — mostra também campo NÃO espelhado, sob demanda
// ("ver todos os campos do ERP", decisão do Vitor de 21/08/2026).
syncErpRouter.get("/:jobName/campos", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }

    if (req.query.fonte === "erp") {
      const resultado = await camposErp(job);
      if (!resultado.temDicionario) {
        res.status(400).json({
          error: `"${job.displayName}" tem origem numa view do Senior (${job.tabelaSenior}) sem registro no dicionário de dados — só é possível ver os campos já espelhados.`,
        });
        return;
      }
      res.json({ fonte: "erp", campos: resultado.campos });
      return;
    }

    res.json({ fonte: "espelhado", campos: camposEspelhados(job) });
  } catch (error) {
    handleError(res, error, "campos");
  }
});

// Lê e valida minimamente o formato bruto de `req.body.predicados` — a validação de VERDADE
// (campo existe, tipo bate, valor é válido) acontece em resolverPredicados/validarEMontarPredicado,
// isso aqui só garante que o formato chega no shape esperado antes de gastar round-trip SOAP.
function lerPredicadosDoBody(body: unknown): PredicadoFiltro[] {
  const bruto = (body as { predicados?: unknown } | undefined)?.predicados;
  if (!Array.isArray(bruto)) throw new Error('Corpo precisa ter "predicados": array.');
  return bruto.map((p, indice) => {
    if (typeof p !== "object" || p === null) throw new Error(`predicados[${indice}] precisa ser um objeto.`);
    const { campo, operador, valores } = p as Record<string, unknown>;
    if (typeof campo !== "string" || !campo) throw new Error(`predicados[${indice}].campo precisa ser texto não vazio.`);
    if (typeof operador !== "string" || !operador) throw new Error(`predicados[${indice}].operador precisa ser texto não vazio.`);
    if (!Array.isArray(valores) || !valores.every((v) => typeof v === "string")) {
      throw new Error(`predicados[${indice}].valores precisa ser um array de texto.`);
    }
    return { campo, operador, valores } as PredicadoFiltro;
  });
}

// Confere `:modo` na URL ("todos"/"alterados") e se o job aceita filtro nesse modo —
// "alterados" só existe pra job com CAMPO_DATA (Fase 6). Devolve o erro já formatado, ou
// `null` quando pode seguir.
function erroDeModoInvalido(job: SyncJobDescriptor, modo: string): string | null {
  if (modo !== "todos" && modo !== "alterados") return `Modo "${modo}" inválido — use "todos" ou "alterados".`;
  if (!job.suportaFiltro) return `"${job.displayName}" ainda não aceita filtro (o job não está em JOBS_COM_FILTRO, registry.ts).`;
  if (modo === "alterados" && !job.suportaAlterados) {
    return `"${job.displayName}" não tem campo de data de geração/alteração — não existe modo "Alterados" pra filtrar.`;
  }
  return null;
}

// GET /:jobName/filtro/:modo — filtro salvo hoje pra esta tabela NESTE modo (Fase 3/6 do
// plano de filtros na importação — "todos" vale pro cron também, "alterados" só quando a
// sincronização incremental roda, os dois independentes desde a Fase 6). Predicados brutos
// (editáveis) + o resultado já resolvido (fragmentos SQL, se dá pra escopar a varredura) — a
// mesma resolução que `filtrosAtivos.ts` usa no snapshot, então o que a tela mostra aqui é
// exatamente o que o próximo `run()` nesse modo vai aplicar.
syncErpRouter.get("/:jobName/filtro/:modo", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const modo = req.params.modo as "todos" | "alterados";
    const erroModo = erroDeModoInvalido(job, modo);
    if (erroModo) {
      res.status(400).json({ error: erroModo });
      return;
    }
    const salvo = await prisma.filtroSincronizacao.findUnique({ where: { jobName_modo: { jobName: job.jobName, modo } } });
    const predicados = (salvo?.predicados as unknown as PredicadoFiltro[] | undefined) ?? [];
    const resolvido = await resolverPredicados(job, predicados);
    res.json({
      predicados,
      // Exibição: se algum predicado usa a variável "última sincronização", mostra a data
      // REAL de agora (não o token cru) — `predicados` (acima) continua com o token, é o que
      // o editor da tela usa pra saber que aquela linha está em modo "variável".
      predicadosSql: await comVariavelResolvidaParaExibicao(job.jobName, resolvido.predicadosSql),
      escopavel: resolvido.escopoLocal !== null,
      motivoNaoEscopavel: resolvido.motivoNaoEscopavel,
      atualizadoEm: salvo?.atualizadoEm ?? null,
    });
  } catch (error) {
    handleError(res, error, "filtro:get");
  }
});

// PUT /:jobName/filtro/:modo — salva um novo conjunto de predicados PRA ESSE MODO (substitui
// o anterior DESSE MODO por inteiro, não faz merge, e não toca no filtro do outro modo — Fase
// 6: Todos e Alterados são independentes, só se juntam se o admin pedir explicitamente via
// POST .../filtro/todos/propagar). Valida TUDO antes de gravar — um predicado inválido
// rejeita a lista inteira, nunca salva pela metade. Recarrega o snapshot em memória antes de
// responder, então a resposta 200 já garante que o próximo `run()` nesse modo usa o filtro novo.
//
// Fase 5 (recorte retroativo): se o filtro novo estreita o recorte a ponto de deixar linha
// local órfã (fora do escopo pra sempre — a varredura também fica escopada, ver Fase 3/F),
// NÃO salva de primeira. Devolve 409 com o diagnóstico (`precisaConfirmar`); o chamador decide
// e reenvia com `acaoRecorte: "deixar" | "marcar"` — "apagar" não é oferecido de propósito,
// contraria a regra do projeto de nunca apagar fisicamente registro espelhado (ver
// [[deteccao-exclusao-sem-apagar-sempre-simular]] no segundo cérebro).
syncErpRouter.put("/:jobName/filtro/:modo", async (req: AuthenticatedRequest, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const modo = req.params.modo as "todos" | "alterados";
    const erroModo = erroDeModoInvalido(job, modo);
    if (erroModo) {
      res.status(400).json({ error: erroModo });
      return;
    }

    let predicados: PredicadoFiltro[];
    try {
      predicados = lerPredicadosDoBody(req.body);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    // A variável "última sincronização" só faz sentido em Alterados — "todos" não tem um
    // `desde` pra resolver contra (pedido do Vitor 21/08/2026).
    if (modo !== "alterados" && predicados.some((p) => p.valores.includes(VALOR_VARIAVEL_ULTIMA_SINCRONIZACAO))) {
      res.status(400).json({ error: `A variável "última sincronização com sucesso" só pode ser usada no modo Alterados.` });
      return;
    }

    let resolvido;
    try {
      resolvido = await resolverPredicados(job, predicados);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const acaoRecorte = req.body?.acaoRecorte === "marcar" ? "marcar" : req.body?.acaoRecorte === "deixar" ? "deixar" : null;
    if (!acaoRecorte) {
      const diagnostico = await diagnosticarRecorte(job, resolvido.escopoLocal);
      if (diagnostico.linhasQueSaem !== null && diagnostico.linhasQueSaem > 0) {
        res.status(409).json({
          precisaConfirmar: true,
          linhasQueSaem: diagnostico.linhasQueSaem,
          suportaMarcar: diagnostico.suportaMarcar,
          mensagem: `${diagnostico.linhasQueSaem} linha(s) já espelhada(s) localmente ficariam fora deste recorte — reenvie com "acaoRecorte": "deixar" ou "marcar".`,
        });
        return;
      }
    }

    await salvarOuLimparFiltro(job.jobName, modo, predicados, req.user?.userId ?? null);

    let linhasMarcadas: number | null = null;
    if (acaoRecorte === "marcar" && resolvido.escopoLocal && Object.keys(resolvido.escopoLocal).length > 0) {
      linhasMarcadas = await marcarOrfaosDoRecorte(job, resolvido.escopoLocal);
    }

    await carregarFiltrosAtivos(SYNC_JOBS);

    // Modo "todos" salvo com sucesso numa tabela que também tem "Alterados" — a tela mostra
    // um aviso dispensável (não bloqueia nada, decisão do Vitor 21/08/2026) perguntando se
    // quer propagar. `alteradosDivergente` é só informativo: true quando ainda não existe
    // filtro em "alterados" nesta tabela, ou quando existe mas é DIFERENTE do que acabou de
    // ser salvo em "todos" — nos dois casos faz sentido perguntar.
    let alteradosDivergente = false;
    if (modo === "todos" && job.suportaAlterados) {
      const salvoAlterados = await prisma.filtroSincronizacao.findUnique({
        where: { jobName_modo: { jobName: job.jobName, modo: "alterados" } },
      });
      alteradosDivergente = JSON.stringify(salvoAlterados?.predicados ?? null) !== JSON.stringify(predicados);
    }

    res.json({
      predicados,
      predicadosSql: await comVariavelResolvidaParaExibicao(job.jobName, resolvido.predicadosSql),
      escopavel: resolvido.escopoLocal !== null,
      motivoNaoEscopavel: resolvido.motivoNaoEscopavel,
      linhasMarcadas,
      alteradosDivergente,
    });
  } catch (error) {
    handleError(res, error, "filtro:put");
  }
});

// DELETE /:jobName/filtro/:modo — remove o filtro DESSE MODO (o outro modo, se houver,
// continua intocado). Idempotente: apagar um filtro que já não existe não é erro.
syncErpRouter.delete("/:jobName/filtro/:modo", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    const modo = req.params.modo as "todos" | "alterados";
    await prisma.filtroSincronizacao.deleteMany({ where: { jobName: job.jobName, modo } });
    await carregarFiltrosAtivos(SYNC_JOBS);
    res.status(204).end();
  } catch (error) {
    handleError(res, error, "filtro:delete");
  }
});

// POST /:jobName/filtro/todos/propagar — Fase 6: MESCLA os predicados salvos em "todos" pra
// dentro de "alterados", um campo de cada vez (`substituirPredicadoDoCampo`, mesma regra que a
// propagação por dimensão já usa: o predicado de "todos" substitui o predicado DO MESMO CAMPO
// em "alterados", se houver, mas preserva qualquer predicado que só exista em "alterados" —
// ex.: `DatEmi ≥ variável`, salvo só ali). Não é um vínculo permanente (decisão do Vitor,
// 21/08/2026) — depois de propagado, os dois evoluem independentes; propagar de novo mais
// tarde só atualiza os campos que vieram de "todos" outra vez.
//
// Bug real (21/08/2026, pego pelo Vitor): a versão original SUBSTITUÍA o array inteiro de
// "alterados" pelo de "todos" — perdia qualquer predicado exclusivo de "alterados" (o caso
// relatado: propagar um filtro novo de "todos" apagava o `DatEmi` que só existia em
// "alterados"). Corrigido pra mesclar por campo em vez de substituir tudo.
syncErpRouter.post("/:jobName/filtro/todos/propagar", async (req: AuthenticatedRequest, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (!job.suportaAlterados) {
      res.status(400).json({ error: `"${job.displayName}" não tem modo "Alterados" — não há pra onde propagar.` });
      return;
    }

    const salvoTodos = await prisma.filtroSincronizacao.findUnique({ where: { jobName_modo: { jobName: job.jobName, modo: "todos" } } });
    const predicadosTodos = (salvoTodos?.predicados as unknown as PredicadoFiltro[] | undefined) ?? [];

    const salvoAlterados = await prisma.filtroSincronizacao.findUnique({ where: { jobName_modo: { jobName: job.jobName, modo: "alterados" } } });
    const existentesAlterados = (salvoAlterados?.predicados as unknown as PredicadoFiltro[] | undefined) ?? [];

    let predicados = existentesAlterados;
    for (const p of predicadosTodos) {
      predicados = substituirPredicadoDoCampo(predicados, p);
    }

    let resolvido;
    try {
      resolvido = await resolverPredicados(job, predicados);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const acaoRecorte = req.body?.acaoRecorte === "marcar" ? "marcar" : req.body?.acaoRecorte === "deixar" ? "deixar" : null;
    if (!acaoRecorte) {
      const diagnostico = await diagnosticarRecorte(job, resolvido.escopoLocal);
      if (diagnostico.linhasQueSaem !== null && diagnostico.linhasQueSaem > 0) {
        res.status(409).json({
          precisaConfirmar: true,
          linhasQueSaem: diagnostico.linhasQueSaem,
          suportaMarcar: diagnostico.suportaMarcar,
          mensagem: `${diagnostico.linhasQueSaem} linha(s) já espelhada(s) localmente ficariam fora do recorte de Alterados — reenvie com "acaoRecorte": "deixar" ou "marcar".`,
        });
        return;
      }
    }

    await salvarOuLimparFiltro(job.jobName, "alterados", predicados, req.user?.userId ?? null);

    let linhasMarcadas: number | null = null;
    if (acaoRecorte === "marcar" && resolvido.escopoLocal && Object.keys(resolvido.escopoLocal).length > 0) {
      linhasMarcadas = await marcarOrfaosDoRecorte(job, resolvido.escopoLocal);
    }

    await carregarFiltrosAtivos(SYNC_JOBS);

    res.json({ predicados, predicadosSql: resolvido.predicadosSql, linhasMarcadas });
  } catch (error) {
    handleError(res, error, "filtro:propagar");
  }
});

// POST /:jobName/preview — monta a query final SEM EXECUTAR (nem contra o Senior, nem grava
// nada) a partir de um conjunto de predicados CANDIDATO, ainda por salvar — é o "ver query"
// obrigatório do plano antes de qualquer filtro entrar em produção. Mesma validação de
// PUT /filtro, então "preview passou" e "salvar vai funcionar" são a mesma pergunta.
syncErpRouter.post("/:jobName/preview", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (!job.suportaFiltro) {
      res.status(400).json({ error: `"${job.displayName}" ainda não aceita filtro (o job não está em JOBS_COM_FILTRO, registry.ts).` });
      return;
    }

    let predicados: PredicadoFiltro[];
    try {
      predicados = lerPredicadosDoBody(req.body);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const resolvido = await resolverPredicados(job, predicados);
    // "ver query" nunca mostra o token da variável cru como se fosse SQL de verdade — resolve
    // pra data real da última sincronização com sucesso, se houver alguma.
    const predicadosSqlExibicao = await comVariavelResolvidaParaExibicao(job.jobName, resolvido.predicadosSql);
    const query = montarQuerySenior(job.queryBase, predicadosSqlExibicao);
    res.json({
      query,
      escopavel: resolvido.escopoLocal !== null,
      motivoNaoEscopavel: resolvido.motivoNaoEscopavel,
    });
  } catch (error) {
    // Erro de validação (predicado inválido) é o caso comum aqui — 400, não 500, é o que a
    // tela espera pra mostrar a mensagem inline no formulário.
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// GET /dimensoes — Fase 4 do plano de filtros na importação (requisito 4: filtro numa tabela
// pai propaga pra quem referencia). Uma dimensão é um campo com o MESMO sentido em várias
// tabelas (hoje só "codemp"/Empresa, achado varrendo os 35 jobs de verdade — não mantido à
// mão, ver sync/dimensoesFiltro.ts). Lista os jobs alcançados (com a origem que cada um usa,
// já que 4 grafias diferentes convivem no sistema) e os que NÃO têm a dimensão — esses são
// cadastro compartilhado, precisam ficar completos por construção (filtrar quebraria o
// casamento por valor de quem depende deles).
syncErpRouter.get("/dimensoes", async (_req, res) => {
  try {
    res.json({
      dimensoes: DIMENSOES.map((dimensao) => ({
        chave: dimensao.chave,
        rotulo: dimensao.rotulo,
        alcancados: jobsComDimensao(SYNC_JOBS, dimensao).map(({ job, coluna, filtravel }) => ({
          jobName: job.jobName,
          displayName: job.displayName,
          origem: coluna.origem,
          filtravel,
        })),
        cadastroCompartilhado: jobsSemDimensao(SYNC_JOBS, dimensao).map((job) => ({
          jobName: job.jobName,
          displayName: job.displayName,
        })),
      })),
    });
  } catch (error) {
    handleError(res, error, "dimensoes:get");
  }
});

function lerOperadorEValoresDoBody(body: unknown): { operador: OperadorFiltro; valores: string[] } {
  const { operador, valores } = (body as Record<string, unknown>) ?? {};
  if (typeof operador !== "string" || !operador) throw new Error('Corpo precisa ter "operador": texto.');
  if (!Array.isArray(valores) || !valores.every((v) => typeof v === "string")) {
    throw new Error('Corpo precisa ter "valores": array de texto.');
  }
  return { operador: operador as OperadorFiltro, valores };
}

// Núcleo de /dimensoes/:dimensao/pre-visualizar e /aplicar — os dois fazem exatamente o mesmo
// cálculo (valida o predicado mesclado em CADA job alcançado pela dimensão, e diagnostica o
// recorte retroativo — Fase 5 — de cada um); só o que acontece com o resultado muda (um só
// mostra, o outro grava). Um job por vez, sem abortar os demais no primeiro erro — é assim
// que a "cascata" consegue reportar sucesso parcial em vez de tudo-ou-nada num filtro que
// toca 27 tabelas de uma vez. `job`/`escopoLocal` ficam no resultado INTERNO (pra
// `marcarOrfaosDoRecorte` no /aplicar); `paraResultadoPublico` tira isso antes de responder.
interface ResultadoPropagacaoInterno {
  job: SyncJobDescriptor;
  jobName: string;
  displayName: string;
  ok: boolean;
  erro?: string;
  predicados?: PredicadoFiltro[];
  escopoLocal?: Record<string, unknown> | null;
  query?: string;
  escopavel?: boolean;
  linhasQueSaem?: number | null;
  suportaMarcar?: boolean;
}

async function calcularPropagacao(
  dimensaoChave: string,
  operador: OperadorFiltro,
  valores: string[],
  jobsExcluidos: Set<string>
): Promise<ResultadoPropagacaoInterno[]> {
  const dimensao = dimensaoPorChave(dimensaoChave);
  if (!dimensao) throw new Error(`Dimensão "${dimensaoChave}" não existe.`);

  const alcancados = jobsComDimensao(SYNC_JOBS, dimensao).filter((x) => !jobsExcluidos.has(x.job.jobName));
  return Promise.all(
    alcancados.map(async ({ job, coluna, filtravel }): Promise<ResultadoPropagacaoInterno> => {
      const base = { job, jobName: job.jobName, displayName: job.displayName };
      if (!filtravel) {
        return { ...base, ok: false, erro: "Tabela sem dicionário de dados no Senior — não é possível filtrar aqui." };
      }
      try {
        // Fase 6: propagação por dimensão continua Todos-only de propósito — propagar pro
        // Alterados de 27 tabelas de uma vez ficou fora de escopo (ver plano); quem quiser
        // isso usa o "propagar pro Alterados" de cada tabela depois.
        const salvo = await prisma.filtroSincronizacao.findUnique({ where: { jobName_modo: { jobName: job.jobName, modo: "todos" } } });
        const existentes = (salvo?.predicados as unknown as PredicadoFiltro[] | undefined) ?? [];
        const predicados = substituirPredicadoDoCampo(existentes, { campo: coluna.origem, operador, valores });
        const resolvido = await resolverPredicados(job, predicados);
        const diagnostico = await diagnosticarRecorte(job, resolvido.escopoLocal);
        return {
          ...base,
          ok: true,
          predicados,
          escopoLocal: resolvido.escopoLocal,
          query: montarQuerySenior(job.queryBase, resolvido.predicadosSql),
          escopavel: resolvido.escopoLocal !== null,
          linhasQueSaem: diagnostico.linhasQueSaem,
          suportaMarcar: diagnostico.suportaMarcar,
        };
      } catch (error) {
        return { ...base, ok: false, erro: error instanceof Error ? error.message : String(error) };
      }
    })
  );
}

function paraResultadoPublico(r: ResultadoPropagacaoInterno) {
  const { job: _job, escopoLocal: _escopoLocal, ...publico } = r;
  return publico;
}

// POST /dimensoes/:dimensao/pre-visualizar — dry run: mostra a query final, o diagnóstico de
// recorte retroativo (Fase 5) e se cada tabela alcançada aceitaria o predicado, sem gravar
// nada. É a "cascata resultante antes de salvar" que o plano pede — o admin decide quais
// tabelas excluir (`jobsExcluidos`) olhando isto.
syncErpRouter.post("/dimensoes/:dimensao/pre-visualizar", async (req, res) => {
  try {
    const { operador, valores } = lerOperadorEValoresDoBody(req.body);
    const jobsExcluidos = new Set<string>(Array.isArray(req.body?.jobsExcluidos) ? req.body.jobsExcluidos : []);
    const resultados = await calcularPropagacao(req.params.dimensao, operador, valores, jobsExcluidos);
    res.json({ resultados: resultados.map(paraResultadoPublico) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// POST /dimensoes/:dimensao/aplicar — mesmo cálculo do preview, mas GRAVA cada job que passou
// na validação (ok:true) e pula os que falharam — sucesso parcial é reportado, não vira erro
// 500 pra cascata inteira. Recarrega o snapshot uma única vez no fim, não job a job.
//
// Fase 5 (recorte retroativo): se ALGUM job da cascata tem linha órfã e o corpo não trouxe
// `acaoRecorte`, nada é salvo — devolve 409 com o total agregado. Uma escolha só
// ("deixar"/"marcar") vale pra cascata inteira: pedir uma decisão por tabela numa ação que já
// é em lote por natureza seria mais atrito que ajuda (mesmo espírito de "Sincronizar Todas as
// Tabelas" ser uma ação só). "apagar" não é oferecido — mesma regra do PUT /:jobName/filtro.
syncErpRouter.post("/dimensoes/:dimensao/aplicar", async (req: AuthenticatedRequest, res) => {
  try {
    const { operador, valores } = lerOperadorEValoresDoBody(req.body);
    const jobsExcluidos = new Set<string>(Array.isArray(req.body?.jobsExcluidos) ? req.body.jobsExcluidos : []);
    const resultados = await calcularPropagacao(req.params.dimensao, operador, valores, jobsExcluidos);

    const acaoRecorte = req.body?.acaoRecorte === "marcar" ? "marcar" : req.body?.acaoRecorte === "deixar" ? "deixar" : null;
    const totalOrfaos = resultados.reduce((soma, r) => soma + (r.ok ? r.linhasQueSaem ?? 0 : 0), 0);
    if (!acaoRecorte && totalOrfaos > 0) {
      res.status(409).json({
        precisaConfirmar: true,
        linhasQueSaem: totalOrfaos,
        suportaMarcar: resultados.some((r) => r.ok && r.suportaMarcar),
        mensagem: `${totalOrfaos} linha(s) já espelhada(s) localmente, somadas entre as tabelas afetadas, ficariam fora deste recorte — reenvie com "acaoRecorte": "deixar" ou "marcar".`,
        resultados: resultados.map(paraResultadoPublico),
      });
      return;
    }

    for (const resultado of resultados) {
      if (!resultado.ok) continue;
      await prisma.filtroSincronizacao.upsert({
        where: { jobName_modo: { jobName: resultado.jobName, modo: "todos" } },
        update: { predicados: resultado.predicados as unknown as object, atualizadoPor: req.user?.userId ?? null },
        create: { jobName: resultado.jobName, modo: "todos", predicados: resultado.predicados as unknown as object, atualizadoPor: req.user?.userId ?? null },
      });
      if (acaoRecorte === "marcar" && resultado.escopoLocal && Object.keys(resultado.escopoLocal).length > 0) {
        await marcarOrfaosDoRecorte(resultado.job, resultado.escopoLocal);
      }
    }
    await carregarFiltrosAtivos(SYNC_JOBS);

    res.json({ resultados: resultados.map(paraResultadoPublico) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// DELETE /dimensoes/:dimensao — remove o predicado desta dimensão de TODO job que o tenha
// (não apaga o filtro inteiro de cada job, só o campo da dimensão — preserva qualquer
// predicado próprio que a tabela já tivesse em outro campo). Idempotente.
syncErpRouter.delete("/dimensoes/:dimensao", async (_req, res) => {
  try {
    const dimensao = dimensaoPorChave(_req.params.dimensao);
    if (!dimensao) {
      res.status(404).json({ error: `Dimensão "${_req.params.dimensao}" não existe.` });
      return;
    }
    const alcancados = jobsComDimensao(SYNC_JOBS, dimensao);
    for (const { job, coluna } of alcancados) {
      // Fase 6: dimensão só escreveu em "todos" (aplicar acima), então só precisa limpar
      // "todos" aqui também — "alterados" nunca recebeu nada desta rota.
      const salvo = await prisma.filtroSincronizacao.findUnique({ where: { jobName_modo: { jobName: job.jobName, modo: "todos" } } });
      if (!salvo) continue;
      const restantes = removerPredicadoDoCampo(salvo.predicados as unknown as PredicadoFiltro[], coluna.origem);
      if (restantes.length === 0) {
        await prisma.filtroSincronizacao.delete({ where: { jobName_modo: { jobName: job.jobName, modo: "todos" } } });
      } else {
        await prisma.filtroSincronizacao.update({ where: { jobName_modo: { jobName: job.jobName, modo: "todos" } }, data: { predicados: restantes as unknown as object } });
      }
    }
    await carregarFiltrosAtivos(SYNC_JOBS);
    res.status(204).end();
  } catch (error) {
    handleError(res, error, "dimensoes:delete");
  }
});

syncErpRouter.post("/:jobName/run", async (req, res) => {
  try {
    const job = SYNC_JOBS.find((j) => j.jobName === req.params.jobName);
    if (!job) {
      res.status(404).json({ error: "Job não encontrado" });
      return;
    }
    if (sincronizandoTodos || jobsEmAndamento.has(job.jobName)) {
      res.status(409).json({ error: "Sincronização já em andamento" });
      return;
    }

    const modo = req.body?.modo === "alterados" ? "alterados" : "todos";
    if (modo === "alterados" && !job.suportaAlterados) {
      res.status(400).json({ error: "Esta tabela não tem campo de data de geração/alteração — só aceita sincronizar Todos" });
      return;
    }

    let desde: Date | undefined;
    if (modo === "alterados") {
      const ultimoSucesso = await ultimoSucessoEm(job.jobName);
      if (!ultimoSucesso) {
        res.status(400).json({ error: "Nunca sincronizado com sucesso ainda — rode Todos primeiro" });
        return;
      }
      desde = ultimoSucesso;
    }

    jobsEmAndamento.add(job.jobName);
    job
      .run(desde)
      .catch((error) => {
        console.error(`[sync-erp:${job.jobName}] falhou:`, error instanceof Error ? error.message : error);
      })
      .finally(() => jobsEmAndamento.delete(job.jobName));

    res.status(202).json({ status: "iniciado", modo });
  } catch (error) {
    handleError(res, error, "run");
  }
});

syncErpRouter.post("/run-all", async (_req, res) => {
  try {
    if (sincronizandoTodos || jobsEmAndamento.size > 0) {
      res.status(409).json({ error: "Já existe uma sincronização em andamento" });
      return;
    }

    sincronizandoTodos = true;
    (async () => {
      // Sequencial e na ordem de SYNC_JOBS (respeita dependências de FK, ex.: FaseProposta
      // antes de AtividadeConsultor) — mesmo padrão do runSincronizacaoContasReceber.
      for (const job of SYNC_JOBS) {
        jobsEmAndamento.add(job.jobName);
        try {
          await job.run();
        } finally {
          jobsEmAndamento.delete(job.jobName);
        }
      }
    })()
      .catch((error) => {
        console.error("[sync-erp:run-all] falhou:", error instanceof Error ? error.message : error);
      })
      .finally(() => {
        sincronizandoTodos = false;
      });

    res.status(202).json({ status: "iniciado" });
  } catch (error) {
    handleError(res, error, "run-all");
  }
});
