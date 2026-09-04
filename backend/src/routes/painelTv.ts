import { Router } from "express";
import { requireAuth, requireRole, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { catalogoPublico, painelPorId, validarFiltros } from "../domain/painelCatalogo";
import { DEPEXE_LABELS } from "../domain/propostasDominio";
import { consultoresDosDepartamentos, departamentosComTime, nomeConsultor } from "../domain/contextoProjeto";
import { runSincronizacaoProjetos, sincronizacaoProjetosEmAndamento, JOBS_PROJETOS } from "../sync/projetosSyncOrchestrator";

interface OrquestradorSyncPainel {
  // Nomes em SyncLog.jobName dos jobs deste domínio — pra calcular "última atualização"
  // (a tabela mais defasada manda, mesma lógica MIN(MAX(runAt)) de contabil.ts/financeiro.ts).
  jobs: string[];
  emAndamento(): boolean;
  run(): Promise<void>;
}

// Mapa dominioSync (ver domain/painelCatalogo.ts) -> orquestrador. Só "projetos" na v1;
// um painel financeiro/contábil futuro soma uma entrada aqui apontando pro orquestrador
// que JÁ EXISTE (contasReceberSyncOrchestrator.ts / contabilSyncOrchestrator.ts) — nada
// mais neste arquivo muda.
const ORQUESTRADORES: Record<string, OrquestradorSyncPainel> = {
  projetos: { jobs: JOBS_PROJETOS, emAndamento: sincronizacaoProjetosEmAndamento, run: runSincronizacaoProjetos },
};

// Cooldown por domínio — deliberadamente maior que o ciclo de rotação mais longo
// plausível. Sem isto, cada TV giraria e re-disparia sync a cada volta: N telas martelando
// o Senior o dia inteiro, brigando com a janela do cron noturno (server.ts:162-219).
const COOLDOWN_MS = 10 * 60 * 1000;
const ultimaConclusaoPorDominio = new Map<string, number>();

// Só marca o fim do cooldown quando o sync de fato TERMINAR (sucesso ou erro) — nunca no
// disparo, senão um sync que demora minutos liberaria o próximo antes de ter terminado.
async function executarComCooldown(dominio: string, orquestrador: OrquestradorSyncPainel): Promise<void> {
  try {
    await orquestrador.run();
  } finally {
    ultimaConclusaoPorDominio.set(dominio, Date.now());
  }
}

// Modo Painel/TV — configuração (admin) e consumo (conta de TV) da rotação de painéis.
// Router com DOIS públicos no mesmo arquivo: /catalogo e /config* são admin-only (quem
// decide o que roda em cada TV); /rotacao e /dados* são abertos também ao papel "painel",
// sempre restritos à PRÓPRIA config — nunca à de outra TV. Mesmo padrão de dois blocos já
// usado em contabil.ts (router aberto + requireRole por rota, não por `router.use`).
export const painelTvRouter = Router();
painelTvRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[painel-tv:${label}]`, message);
  res.status(500).json({ error: message });
}

// Conta de TV cuja rotação/dados esta requisição vai ler. Papel "painel" SEMPRE lê a
// própria — qualquer `?userId=` que ele mande é ignorado, de propósito: é isso que
// garante que uma senha de TV vazada só enxerga o que o admin configurou pra ela. Só
// admin pode pedir outra conta (`?userId=`), pra pré-visualizar a TV de alguém.
function usuarioAlvo(req: AuthenticatedRequest): number {
  if (req.user!.role === "painel") return req.user!.userId;
  const userIdQuery = typeof req.query.userId === "string" ? Number(req.query.userId) : NaN;
  return Number.isFinite(userIdQuery) ? userIdQuery : req.user!.userId;
}

// "Última atualização" de um domínio de sync — a tabela mais DEFASADA entre os jobs
// dele manda, não a mais recente (mesma lógica de contabil.ts/financeiro.ts). Reaproveitada
// tanto por GET /sync/:dominio (status pra tela de admin/depuração) quanto pelo carimbo
// "dados de HH:mm" embutido na resposta de GET /dados/:painelId — mesma conta, sempre.
async function ultimaAtualizacaoDoDominio(dominio: string | null): Promise<string | null> {
  if (dominio == null) return null;
  const orquestrador = ORQUESTRADORES[dominio];
  if (!orquestrador) return null;
  const logs = await Promise.all(
    orquestrador.jobs.map((jobName) => prisma.syncLog.findFirst({ where: { jobName, status: "success" }, orderBy: { runAt: "desc" } }))
  );
  const validos = logs.filter((l): l is NonNullable<typeof l> => l != null);
  if (validos.length === 0) return null;
  return new Date(Math.min(...validos.map((l) => l.runAt.getTime()))).toISOString();
}

// GET /painel-tv/catalogo — os painéis disponíveis (metadados + filtros que cada um
// declara) e as opções pra preencher esses filtros na tela de administração. Molde de
// DepartamentoGrupoContabil: um GET só, linhas (aqui, o catálogo) e opções juntas.
painelTvRouter.get("/catalogo", requireRole("admin"), async (_req, res) => {
  try {
    const consultores = await consultoresDosDepartamentos(await departamentosComTime());
    res.json({
      paineis: catalogoPublico(),
      opcoes: {
        departamentos: Object.entries(DEPEXE_LABELS).map(([value, label]) => ({ value: Number(value), label })),
        consultores: consultores
          .filter((c) => c.codfor != null)
          .map((c) => ({ value: c.codfor as number, label: nomeConsultor(c) }))
          .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      },
    });
  } catch (error) {
    handleError(res, error, "catalogo");
  }
});

// GET /painel-tv/config — todas as contas de TV já configuradas (com a rotação completa)
// e as contas com papel "painel" que ainda não têm config nenhuma (pra o admin escolher
// "montar esta TV").
painelTvRouter.get("/config", requireRole("admin"), async (_req, res) => {
  try {
    const usuariosPainel = await prisma.user.findMany({
      where: { role: { name: "painel" } },
      include: { painelTv: { include: { itens: { orderBy: { ordem: "asc" } } } } },
      orderBy: { nome: "asc" },
    });

    res.json({
      tvs: usuariosPainel
        .filter((u) => u.painelTv != null)
        .map((u) => ({
          userId: u.id,
          email: u.email,
          nome: u.painelTv!.nome,
          depexe: u.painelTv!.depexe,
          codemp: u.painelTv!.codemp,
          zoom: u.painelTv!.zoom.toNumber(),
          tema: u.painelTv!.tema,
          ativo: u.painelTv!.ativo,
          itens: u.painelTv!.itens.map((i) => ({
            id: i.id,
            painelId: i.painelId,
            ordem: i.ordem,
            duracaoSegundos: i.duracaoSegundos,
            modoAtualizacao: i.modoAtualizacao,
            filtros: i.filtros,
            ativo: i.ativo,
          })),
        })),
      // Conta com o papel certo mas sem PainelTv ainda — aparece na tela como "criar
      // configuração pra esta TV".
      usuariosPainel: usuariosPainel
        .filter((u) => u.painelTv == null)
        .map((u) => ({ userId: u.id, email: u.email, nome: u.nome })),
    });
  } catch (error) {
    handleError(res, error, "config");
  }
});

// PUT /painel-tv/config/:userId — grava o cabeçalho da TV e substitui a rotação inteira
// (replace-all, mesmo padrão de PUT /contabil/departamentos-grupos/:codemp/:depexe): a
// tela edita a lista toda, e assim não sobra item órfão de uma edição anterior.
painelTvRouter.put("/config/:userId", requireRole("admin"), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: "userId inválido" });
      return;
    }

    const usuario = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (!usuario) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (usuario.role.name !== "painel") {
      res.status(400).json({ error: "Só é possível configurar um usuário com o papel painel" });
      return;
    }

    const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
    if (nome === "") {
      res.status(400).json({ error: "nome é obrigatório" });
      return;
    }
    const depexe = req.body?.depexe != null ? Number(req.body.depexe) : null;
    const codemp = req.body?.codemp != null ? Number(req.body.codemp) : null;
    const zoom = req.body?.zoom != null ? Number(req.body.zoom) : 1.6;
    const tema = typeof req.body?.tema === "string" ? req.body.tema : "dark";
    const ativo = req.body?.ativo !== false;
    if (depexe != null && !Number.isFinite(depexe)) {
      res.status(400).json({ error: "depexe inválido" });
      return;
    }
    if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 5) {
      res.status(400).json({ error: "zoom deve estar entre 0.5 e 5" });
      return;
    }

    const itensBody = Array.isArray(req.body?.itens) ? req.body.itens : null;
    if (!itensBody) {
      res.status(400).json({ error: "itens é obrigatório" });
      return;
    }
    const itens: {
      painelId: string;
      duracaoSegundos: number;
      modoAtualizacao: string;
      filtros: unknown;
      ativo: boolean;
    }[] = [];
    for (const bruto of itensBody) {
      const painelId = String(bruto?.painelId ?? "");
      const def = painelPorId(painelId);
      if (!def) {
        res.status(400).json({ error: `Painel desconhecido: ${painelId}` });
        return;
      }
      const modoAtualizacao = typeof bruto?.modoAtualizacao === "string" ? bruto.modoAtualizacao : "local";
      if (!["nenhum", "local", "erp"].includes(modoAtualizacao)) {
        res.status(400).json({ error: `modoAtualizacao inválido no painel ${painelId}` });
        return;
      }
      if (modoAtualizacao === "erp" && def.dominioSync == null) {
        res.status(400).json({ error: `O painel "${def.nome}" não tem origem externa — não aceita modo "erp"` });
        return;
      }
      const erroFiltros = validarFiltros(painelId, bruto?.filtros ?? null);
      if (erroFiltros) {
        res.status(400).json({ error: erroFiltros });
        return;
      }
      const duracaoSegundos = Number(bruto?.duracaoSegundos ?? def.duracaoPadraoSegundos);
      if (!Number.isFinite(duracaoSegundos) || duracaoSegundos < 5 || duracaoSegundos > 600) {
        res.status(400).json({ error: `duracaoSegundos deve estar entre 5 e 600 no painel ${painelId}` });
        return;
      }
      itens.push({
        painelId,
        duracaoSegundos,
        modoAtualizacao,
        filtros: bruto?.filtros ?? undefined,
        ativo: bruto?.ativo !== false,
      });
    }

    await prisma.$transaction([
      prisma.painelTv.upsert({
        where: { userId },
        update: { nome, depexe, codemp, zoom, tema, ativo },
        create: { userId, nome, depexe, codemp, zoom, tema, ativo },
      }),
      prisma.painelTvItem.deleteMany({ where: { painelTvUserId: userId } }),
      prisma.painelTvItem.createMany({
        data: itens.map((item, i) => ({
          painelTvUserId: userId,
          ordem: i,
          ...item,
          filtros: item.filtros as unknown as object,
        })),
      }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "config:put");
  }
});

// GET /painel-tv/rotacao — a lista ordenada de painéis que a rotação atual vai exibir,
// com o `dominioSync` de cada um já resolvido do catálogo (o motor de rotação do
// frontend usa isso pra saber se dispara pré-busca de sync ou não, sem precisar
// conhecer o catálogo). Nunca devolve `filtros` — o frontend não precisa deles, quem
// aplica é o backend em GET /dados/:painelId.
painelTvRouter.get("/rotacao", requireRole("painel", "admin"), async (req, res) => {
  try {
    const userId = usuarioAlvo(req);
    const tv = await prisma.painelTv.findUnique({
      where: { userId },
      include: { itens: { where: { ativo: true }, orderBy: { ordem: "asc" } } },
    });
    if (!tv || !tv.ativo) {
      res.status(404).json({ error: "Esta conta de TV ainda não tem uma rotação configurada." });
      return;
    }
    res.json({
      tv: { nome: tv.nome, zoom: tv.zoom.toNumber(), tema: tv.tema },
      itens: tv.itens.map((i) => ({
        id: i.id,
        painelId: i.painelId,
        duracaoSegundos: i.duracaoSegundos,
        modoAtualizacao: i.modoAtualizacao,
        dominioSync: painelPorId(i.painelId)?.dominioSync ?? null,
      })),
    });
  } catch (error) {
    handleError(res, error, "rotacao");
  }
});

// GET /painel-tv/dados/:painelId?item=<id do PainelTvItem> — os dados de UMA exibição.
// Os filtros vêm SEMPRE da config salva (PainelTvItem.filtros, com PainelTv.depexe/
// codemp como base) — nunca de query string arbitrária, nem pro papel "painel" nem pro
// admin em pré-visualização, então não existe caminho pra pedir dado de fora do que foi
// configurado pra aquela TV.
painelTvRouter.get("/dados/:painelId", requireRole("painel", "admin"), async (req, res) => {
  try {
    const { painelId } = req.params;
    const def = painelPorId(painelId);
    if (!def || !def.carregar) {
      res.status(404).json({ error: "Este painel ainda não tem dados disponíveis." });
      return;
    }

    const userId = usuarioAlvo(req);
    const tv = await prisma.painelTv.findUnique({ where: { userId } });
    if (!tv) {
      res.status(404).json({ error: "Conta de TV sem configuração." });
      return;
    }

    const itemIdQuery = typeof req.query.item === "string" ? Number(req.query.item) : NaN;
    let filtros: Record<string, unknown> | null = null;
    if (Number.isFinite(itemIdQuery)) {
      const item = await prisma.painelTvItem.findFirst({ where: { id: itemIdQuery, painelTvUserId: userId } });
      if (!item || item.painelId !== painelId) {
        res.status(400).json({ error: "Este item de rotação não pertence a esta conta de TV ou não é deste painel." });
        return;
      }
      filtros = (item.filtros as Record<string, unknown> | null) ?? null;
    }

    const depexe = typeof filtros?.depexe === "number" ? filtros.depexe : tv.depexe;
    const codemp = typeof filtros?.codemp === "number" ? filtros.codemp : tv.codemp ?? 1;
    const codforsBruto = filtros?.codfor;
    const codfors = Array.isArray(codforsBruto) && codforsBruto.length > 0 ? codforsBruto.map(Number) : null;
    const periodoBruto = filtros?.periodo as { ano?: unknown; mes?: unknown } | undefined;
    const periodo =
      periodoBruto && typeof periodoBruto.ano === "number" && typeof periodoBruto.mes === "number"
        ? { ano: periodoBruto.ano, mes: periodoBruto.mes }
        : null;

    const dados = await def.carregar({ codemp, depexe, codfors, periodo });
    // Carimbo de frescor — só quando o painel TEM uma origem que pode ficar defasada.
    // Um painel 100% local (dominioSync: null, ex.: "Em execução agora") nunca carrega
    // isto, e o frontend simplesmente não mostra o rodapé.
    const _syncAtualizadoEm = await ultimaAtualizacaoDoDominio(def.dominioSync);
    res.json(typeof dados === "object" && dados != null ? { ...dados, _syncAtualizadoEm } : dados);
  } catch (error) {
    handleError(res, error, "dados");
  }
});

// GET /painel-tv/sync/:dominio — status da sincronização deste domínio (usado pela tela
// de administração/depuração; o motor de rotação da TV não chama isto, só o carimbo
// embutido em GET /dados acima).
painelTvRouter.get("/sync/:dominio", requireRole("painel", "admin"), async (req, res) => {
  try {
    const orquestrador = ORQUESTRADORES[req.params.dominio];
    if (!orquestrador) {
      res.status(404).json({ error: `Domínio de sincronização desconhecido: ${req.params.dominio}` });
      return;
    }
    res.json({
      emAndamento: orquestrador.emAndamento(),
      ultimaAtualizacao: await ultimaAtualizacaoDoDominio(req.params.dominio),
    });
  } catch (error) {
    handleError(res, error, "sync:get");
  }
});

// POST /painel-tv/sync/:dominio — dispara a sincronização deste domínio. Contrato com o
// motor de rotação (useRotacaoPainel.ts): 202 (iniciou), 409 (já rodando) e 200 "recente"
// (dentro do cooldown) são todos "siga em frente e mostre o painel" — a TV nunca fica
// numa tela de espera, o sync é sempre oportunista (pré-busca), nunca bloqueante.
painelTvRouter.post("/sync/:dominio", requireRole("painel", "admin"), async (req, res) => {
  try {
    const dominio = req.params.dominio;
    const orquestrador = ORQUESTRADORES[dominio];
    if (!orquestrador) {
      res.status(404).json({ error: `Domínio de sincronização desconhecido: ${dominio}` });
      return;
    }
    if (orquestrador.emAndamento()) {
      res.status(409).json({ error: "Sincronização já em andamento" });
      return;
    }
    const ultimaConclusao = ultimaConclusaoPorDominio.get(dominio);
    if (ultimaConclusao != null && Date.now() - ultimaConclusao < COOLDOWN_MS) {
      res.status(200).json({ status: "recente", proximaLiberacaoEm: new Date(ultimaConclusao + COOLDOWN_MS).toISOString() });
      return;
    }
    executarComCooldown(dominio, orquestrador).catch((error) => {
      console.error(`[painel-tv:sync:${dominio}]`, error instanceof Error ? error.message : error);
    });
    res.status(202).json({ status: "iniciado" });
  } catch (error) {
    handleError(res, error, "sync:post");
  }
});
