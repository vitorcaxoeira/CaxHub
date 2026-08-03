import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, podeExecutarAcao, consultoresDosDepartamentos } from "../domain/contextoProjeto";
import { formatarMinutos, saldoDaAtividade } from "../domain/tetoAtividade";
import { paraHoraBrasil } from "../domain/fusoBrasil";
import { enfileirar, processarFilaSincronizacao } from "../sync/outboxSenior";

// Tela "Meus Apontamentos": o consultor revisa as sessões de execução que o sistema já
// rastreou (ver AtividadeSessaoExecucao / PATCH /atividades/:id/mover) e confirma —
// nesse momento vira um RatItem de verdade e entra na fila pro Senior. Sessão é a fonte
// da verdade do tempo trabalhado; RAT/IAT é só o formato de exportação.
export const apontamentosRouter = Router();
apontamentosRouter.use(requireAuth);

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[apontamentos:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

// RatItem.horini/horfim são minutos desde a meia-noite em hora de PAREDE brasileira, e
// datati é o dia dessa mesma parede — os dois viajam pro Senior.
//
// Usava getHours()/toDateString(), que leem o relógio do servidor: correto em
// desenvolvimento (UTC-3) e errado por 3 horas em produção (container em UTC-0), onde uma
// execução das 09:00 às 11:00 seria gravada como 12:00–14:00, e uma das 21:00 cairia no
// dia seguinte. Ver domain/fusoBrasil.ts.
function minutosDesdeMeiaNoite(data: Date): number {
  return paraHoraBrasil(data).minutosDoDia;
}

// Dia brasileiro do instante, como meia-noite UTC — o formato que @db.Date espera.
function diaBrasilComoData(data: Date): Date {
  const { ano, mes, dia } = paraHoraBrasil(data);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function nomeConsultor(c: { codfor: number | null; nomcom: string | null; nomfor: string | null }): string {
  return c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`;
}

// Quem pode lançar apontamento MANUAL: só admin e Líder Técnico (quem gerencia algum
// departamento). Decisão de produto de 30/07/2026 — lançar tempo "na mão" virou ferramenta
// de gestão; o consultor comum aponta pelo Kanban (mover o card, ou Iniciar/Parar), que é
// o caminho que gera sessão de execução rastreada.
//
// Vale pro POST /manual e pra decidir se a tela mostra o botão. Confirmar sessão já
// rastreada (POST /confirmar) NÃO passa por aqui — isso todo consultor continua fazendo.
function podeLancarManual(role: string, contexto: { departamentosGerenciados: number[] }): boolean {
  return role === "admin" || contexto.departamentosGerenciados.length > 0;
}

// Uma RAT Digitada por consultor+proposta — reaproveita se já existir uma (do CaxHub OU
// já confirmada no Senior, tanto faz) pra não gerar um documento por apontamento. Fica
// recebendo apontamentos de qualquer dia enquanto Digitada; depois de aprovada (PATCH
// /rats/:id/aprovar) ou aprovada direto no Senior (sync noturno atualiza sitrat aqui), o
// próximo apontamento pra essa mesma dupla consultor+proposta não encontra mais essa
// linha (sitrat != 9) e abre uma RAT nova — não há corte por dia. Importante: NÃO
// filtra por `origemCaxHub`/`numrat` — uma RAT real (já com número do Senior) que ainda
// esteja "Digitada" lá (documento existe, ainda não impresso/aprovado no ERP) é tão
// válida pra receber itens quanto uma criada pelo próprio CaxHub; filtrar só por
// origemCaxHub fazia todo apontamento novo criar uma RAT CaxHub paralela mesmo já
// existindo uma real digitada pra aquele consultor+proposta. `codfpj` é copiado da
// própria Proposta (mesmo valor que ela já guarda) — é o dado mais confiável disponível
// hoje pra esse campo, só usado quando é preciso CRIAR uma RAT nova. `depexe` vem do
// item que originou este apontamento — usado pra resolver "quem gerencia essa RAT"
// (mesma regra de podeExecutarAcao); se um consultor apontar em itens de departamentos
// diferentes na mesma proposta (raro), a RAT fica com o depexe do primeiro item, não
// resolvemos RAT multi-departamento nesta fase.
async function buscarOuCriarRatRascunho(
  atividade: { codemp: number; codpro: number },
  codfor: number,
  depexe: number,
  dataSessao: Date
) {
  const existente = await prisma.rat.findFirst({
    where: { sitrat: 9, codemp: atividade.codemp, codfor, codpro: atividade.codpro },
    orderBy: { id: "desc" },
  });
  if (existente) return existente;

  const proposta = await prisma.proposta.findUnique({
    where: { codemp_codpro: { codemp: atividade.codemp, codpro: atividade.codpro } },
  });

  return prisma.rat.create({
    data: {
      codemp: atividade.codemp,
      codfor,
      numprj: proposta?.numprj ?? null,
      codfpj: proposta?.codfpj ?? null,
      codpro: atividade.codpro,
      codcli: proposta?.codcli ?? null,
      datemi: diaBrasilComoData(dataSessao),
      sitrat: 9, // Digitado — rascunho local, ainda não confirmado no Senior
      depexe,
      origemCaxHub: true,
    },
  });
}

interface AjustesConfirmacao {
  ajusteInicio?: string;
  ajusteFim?: string;
  descricao?: string;
}

// Núcleo compartilhado por POST /confirmar (sessão já existe, veio de movimentação de
// coluna) e POST /manual (sessão criada na hora) — confirmar é sempre: validar RBAC,
// resolver/criar o Rat do dia, criar o RatItem, marcar a sessão e enfileirar pro Senior.
async function confirmarSessao(
  sessaoId: number,
  ajustes: AjustesConfirmacao,
  ctx: NonNullable<Awaited<ReturnType<typeof contextoDoUsuario>>>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { contexto, role } = ctx;

  const sessao = await prisma.atividadeSessaoExecucao.findUnique({
    where: { id: sessaoId },
    include: { atividade: true },
  });
  if (!sessao) return { status: 404, body: { error: "Sessão não encontrada" } };
  if (sessao.confirmada) return { status: 400, body: { error: "Sessão já confirmada" } };
  if (sessao.fim == null) return { status: 400, body: { error: "Sessão ainda em andamento" } };

  const atividade = sessao.atividade;
  const item = await prisma.propostaItem.findUnique({
    where: { codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite } },
  });
  if (!item || item.depexe == null) {
    return { status: 400, body: { error: "Item de proposta correspondente não encontrado" } };
  }
  if (!podeExecutarAcao(role, contexto, "lancarApontamento", { depexe: item.depexe, codfor: atividade.codfor })) {
    return { status: 403, body: { error: "Sem permissão para lançar apontamento nesta atividade" } };
  }
  // Sem seqati (atividade ainda não confirmada pelo Senior) também pode virar
  // apontamento — RatItem.seqati fica null nesse caso, sem bloquear o fluxo.

  const inicio = ajustes.ajusteInicio ? new Date(ajustes.ajusteInicio) : sessao.inicio;
  const fim = ajustes.ajusteFim ? new Date(ajustes.ajusteFim) : sessao.fim;
  if (!(fim.getTime() > inicio.getTime())) {
    return { status: 400, body: { error: "O fim precisa ser depois do início" } };
  }

  // Teto de apontamento = alocado + excedentes autorizados. Vale pro gestor também: pra
  // lançar acima do teto ele aumenta o campo de excedentes antes, e aí fica registrado
  // quem autorizou e quanto — que é o ponto de ter o campo.
  //
  // O `realizado` desconta esta sessão porque ela ainda não está confirmada e, portanto,
  // já entra na conta como "sessão não confirmada". Sem isso a duração seria contada duas
  // vezes e o bloqueio dispararia com metade do saldo consumido.
  const duracao = Math.round((fim.getTime() - inicio.getTime()) / 60000);
  const { teto, realizado } = await saldoDaAtividade(atividade);
  const duracaoAtualDaSessao = Math.round((sessao.fim.getTime() - sessao.inicio.getTime()) / 60000);
  const realizadoSemEsta = realizado - duracaoAtualDaSessao;
  if (teto > 0 && realizadoSemEsta + duracao > teto) {
    const disponivel = teto - realizadoSemEsta;
    return {
      status: 409,
      body: {
        error:
          disponivel > 0
            ? `Apontamento de ${formatarMinutos(duracao)} excede o teto da atividade. Saldo disponível: ${formatarMinutos(disponivel)} (alocado + excedentes: ${formatarMinutos(teto)}). Ajuste o horário ou peça ao gestor pra liberar horas excedentes.`
            : `A atividade já consumiu todo o teto de ${formatarMinutos(teto)} (alocado + excedentes). Peça ao gestor pra liberar horas excedentes antes de apontar.`,
        teto,
        realizado: realizadoSemEsta,
        disponivel,
      },
    };
  }

  const rat = await buscarOuCriarRatRascunho(atividade, atividade.codfor, item.depexe, inicio);
  const ratNovo = rat.origemCaxHub && rat.numrat == null;

  const ratItem = await prisma.ratItem.create({
    data: {
      ratId: rat.id,
      codemp: atividade.codemp,
      numprj: rat.numprj,
      codpro: atividade.codpro,
      seqite: atividade.seqite,
      codfas: atividade.fasid,
      seqati: atividade.seqati,
      datati: diaBrasilComoData(inicio),
      horini: minutosDesdeMeiaNoite(inicio),
      horfim: minutosDesdeMeiaNoite(fim),
      // Sem fallback pro despro do item de propósito: a RAT só pode ser aprovada quando
      // TODO item tiver observação preenchida (ver PATCH /rats/:id/aprovar) — se
      // caísse pro despro genérico automaticamente, esse gate nunca bloquearia nada de
      // verdade. A descrição do item continua visível na tela como contexto à parte.
      desati: ajustes.descricao?.trim() || null,
      origemCaxHub: true,
    },
  });

  await prisma.atividadeSessaoExecucao.update({
    where: { id: sessaoId },
    data: { confirmada: true, ratItemId: ratItem.id },
  });

  const pendenciaId = await enfileirar(atividade.id, "criar_apontamento", {
    ratItemId: ratItem.id,
    ratId: rat.id,
    seqati: atividade.seqati?.toString() ?? null,
    codemp: atividade.codemp,
    codpro: atividade.codpro,
    seqite: atividade.seqite,
    codfas: atividade.fasid,
    datati: ratItem.datati,
    horini: ratItem.horini,
    horfim: ratItem.horfim,
    desati: ratItem.desati,
    ratNovo,
    codfor: rat.codfor,
    codcli: rat.codcli,
    depexe: item.depexe,
  });

  // Envia pro Senior em segundo plano, sem segurar a resposta: o consultor não deveria
  // esperar o ERP pra ver o apontamento confirmado na tela, e o estado do envio aparece
  // no próximo carregamento. O cron de 15 min continua como rede de segurança pro que
  // falhar aqui — mesmo padrão "fire and forget" de syncErp.ts e POST /pedidos/sincronizar.
  processarFilaSincronizacao({ apenasId: pendenciaId }).catch((erro) => {
    console.error("[apontamentos] envio imediato ao Senior falhou:", erro instanceof Error ? erro.message : erro);
  });

  return { status: 201, body: { ratItemId: ratItem.id, ratId: rat.id } };
}

// GET /consultores — por quem o usuário pode lançar apontamento manual: ele mesmo e, se
// for Líder Técnico, os consultores dos departamentos que gerencia.
//
// Não reaproveita GET /rats/opcoes-filtro de propósito: aquela lista é derivada das RATs
// visíveis, então um consultor que ainda não tem RAT nenhuma não apareceria — justamente
// o caso em que o gestor precisa lançar o primeiro apontamento dele.
apontamentosRouter.get("/consultores", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { contexto, role } = ctx;

    // Admin não tem departamento gerenciado por definição, mas pode lançar por qualquer um
    // (podeExecutarAcao devolve true pra ele) — então recebe a lista inteira de consultores.
    const doTime =
      role === "admin"
        ? await prisma.consultor.findMany({ where: { codfor: { not: null } } })
        : await consultoresDosDepartamentos(contexto.departamentosGerenciados);

    const porCodfor = new Map<number, string>();
    // O próprio usuário entra sempre: gestor também aponta o tempo dele.
    if (contexto.consultor?.codfor != null) {
      porCodfor.set(contexto.consultor.codfor, nomeConsultor(contexto.consultor));
    }
    for (const c of doTime) {
      // codfor nulo não tem como se ligar a atividade nenhuma — deixar na lista faria o
      // gestor escolher um nome que nunca listaria atividades.
      if (c.codfor != null) porCodfor.set(c.codfor, nomeConsultor(c));
    }

    res.json({
      // A tela usa isso pra decidir se mostra o botão "+ Apontamento manual" — quem decide
      // é o servidor, que é quem também recusa o POST.
      podeLancarManual: podeLancarManual(role, contexto),
      consultores: [...porCodfor.entries()]
        .map(([codfor, nome]) => ({ codfor, nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome)),
    });
  } catch (error) {
    handleError(res, error, "consultores");
  }
});

// Atividades já confirmadas pelo Senior (seqati != null, exigido por confirmarSessao) —
// alimenta o select do apontamento manual.
//
// Sem `codfor`, são as do próprio usuário (comportamento de sempre). Com `codfor`, as
// daquele consultor — filtradas pelo MESMO predicado que o POST /manual vai aplicar, pra
// que a lista nunca ofereça uma atividade que o lançamento recusaria.
apontamentosRouter.get("/minhas-atividades", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.json({ atividades: [] });
      return;
    }
    const { contexto, role } = ctx;

    const codforPedido = Number(req.query.codfor);
    const codfor = Number.isFinite(codforPedido) ? codforPedido : contexto.consultor?.codfor;
    if (codfor == null) {
      res.json({ atividades: [] });
      return;
    }

    const atividades = await prisma.atividadeConsultor.findMany({
      where: { codfor, sitreg: "A", seqati: { not: null } },
      orderBy: { id: "desc" },
    });
    const chavesItem = atividades.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite }));
    const chavesProposta = [...new Set(atividades.map((a) => `${a.codemp}-${a.codpro}`))].map((chave) => {
      const [codemp, codpro] = chave.split("-").map(Number);
      return { codemp, codpro };
    });

    const [itens, propostas] = await Promise.all([
      chavesItem.length > 0 ? prisma.propostaItem.findMany({ where: { OR: chavesItem } }) : Promise.resolve([]),
      // Cliente é o que dá sentido ao agrupamento por proposta no seletor da tela —
      // número de proposta sozinho não identifica o projeto pra quem lança pelo time.
      chavesProposta.length > 0
        ? prisma.proposta.findMany({ where: { OR: chavesProposta }, include: { cliente: true } })
        : Promise.resolve([]),
    ]);
    const itemPorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i]));
    const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    res.json({
      atividades: atividades
        .map((a) => {
          const item = itemPorChave.get(`${a.codemp}-${a.codpro}-${a.seqite}`);
          // `depexe` do item é o que governa a permissão (não o departamento do consultor)
          // — mesma origem usada por confirmarSessao.
          if (item?.depexe == null) return null;
          if (!podeExecutarAcao(role, contexto, "lancarApontamento", { depexe: item.depexe, codfor })) return null;
          const proposta = propostaPorChave.get(`${a.codemp}-${a.codpro}`);
          return {
            id: a.id,
            codpro: a.codpro,
            seqite: a.seqite,
            itemDescricao: item.despro ?? null,
            cliente: proposta ? `${proposta.cliente.codcli} - ${proposta.cliente.nomcli}` : null,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null),
    });
  } catch (error) {
    handleError(res, error, "minhas-atividades");
  }
});

// Sessões fechadas (fim != null) e ainda não confirmadas das atividades do consultor
// logado — o que aparece na tela pra revisão.
apontamentosRouter.get("/sessoes-pendentes", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.json({ sessoes: [] });
      return;
    }

    const sessoes = await prisma.atividadeSessaoExecucao.findMany({
      where: { fim: { not: null }, confirmada: false, atividade: { codfor, sitreg: "A" } },
      include: { atividade: true, coluna: true },
      orderBy: { id: "desc" },
    });

    const chavesProposta = [...new Set(sessoes.map((s) => `${s.atividade.codemp}-${s.atividade.codpro}`))];
    const propostas =
      chavesProposta.length > 0
        ? await prisma.proposta.findMany({
            where: { OR: chavesProposta.map((c) => ({ codemp: Number(c.split("-")[0]), codpro: Number(c.split("-")[1]) })) },
            include: { cliente: true },
          })
        : [];
    const propostaPorChave = new Map(propostas.map((p) => [`${p.codemp}-${p.codpro}`, p]));

    const chavesItem = sessoes.map((s) => ({ codemp: s.atividade.codemp, codpro: s.atividade.codpro, seqite: s.atividade.seqite }));
    const itens = chavesItem.length > 0 ? await prisma.propostaItem.findMany({ where: { OR: chavesItem } }) : [];
    const itemPorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i]));

    res.json({
      sessoes: sessoes.map((s) => {
        const proposta = propostaPorChave.get(`${s.atividade.codemp}-${s.atividade.codpro}`);
        const item = itemPorChave.get(`${s.atividade.codemp}-${s.atividade.codpro}-${s.atividade.seqite}`);
        return {
          id: s.id,
          atividadeId: s.atividadeId,
          codpro: s.atividade.codpro,
          numprj: proposta?.numprj ?? null,
          cliente: proposta?.cliente.nomcli ?? null,
          codcli: proposta?.codcli ?? null,
          itemDescricao: item?.despro ?? null,
          seqite: s.atividade.seqite,
          colunaNome: s.coluna.nome,
          inicio: s.inicio,
          fim: s.fim,
          duracaoMinutos: s.fim ? Math.round((s.fim.getTime() - s.inicio.getTime()) / 60000) : 0,
          origem: s.origem,
          observacao: s.observacao,
        };
      }),
    });
  } catch (error) {
    handleError(res, error, "sessoes-pendentes");
  }
});

apontamentosRouter.post("/confirmar", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.body?.sessaoId);
    if (!Number.isFinite(sessaoId)) {
      res.status(400).json({ error: "sessaoId é obrigatório" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { status, body } = await confirmarSessao(sessaoId, {
      ajusteInicio: req.body?.ajusteInicio,
      ajusteFim: req.body?.ajusteFim,
      descricao: req.body?.descricao,
    }, ctx);
    res.status(status).json(body);
  } catch (error) {
    handleError(res, error, "confirmar");
  }
});

// Lança tempo sem uma sessão automática correspondente: cria a sessão já fechada e confirma
// no mesmo passo, o que gera o RatItem e enfileira o envio ao Senior.
//
// Exportada porque a aprovação de uma solicitação avulsa do consultor precisa exatamente
// disto (ver routes/solicitacoesApontamento.ts) — duplicar a sequência criaria dois
// caminhos de gravação de apontamento pra manter em sincronia.
//
// A sessão só nasce aqui: enquanto a solicitação está pendente não existe sessão nenhuma, e
// é isso que faz "só conta como apontamento depois de aprovado" valer no dado.
export async function registrarApontamentoAvulso(
  atividadeId: number,
  inicio: Date,
  fim: Date,
  descricao: string | undefined,
  ctx: NonNullable<Awaited<ReturnType<typeof contextoDoUsuario>>>
): Promise<{ status: number; body: Record<string, unknown>; sessaoId?: number }> {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: atividadeId } });
  if (!atividade) return { status: 404, body: { error: "Atividade não encontrada" } };

  const colunaAtual = atividade.colunaId
    ? await prisma.quadroColuna.findUnique({ where: { id: atividade.colunaId } })
    : await prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
  if (!colunaAtual) return { status: 400, body: { error: "Quadro Kanban sem colunas configuradas" } };

  const sessao = await prisma.atividadeSessaoExecucao.create({
    data: { atividadeId, colunaId: colunaAtual.id, inicio, fim, origem: "manual" },
  });

  const resultado = await confirmarSessao(sessao.id, { descricao }, ctx);
  // confirmarSessao recusa por teto, permissão ou item inexistente DEPOIS da sessão criada.
  // Deixá-la aí somaria ao realizado da atividade um apontamento que não foi aceito.
  if (resultado.status >= 400) {
    await prisma.atividadeSessaoExecucao.delete({ where: { id: sessao.id } });
    return resultado;
  }
  return { ...resultado, sessaoId: sessao.id };
}

apontamentosRouter.post("/manual", async (req: AuthenticatedRequest, res) => {
  try {
    const atividadeId = Number(req.body?.atividadeId);
    const inicio = req.body?.inicio ? new Date(req.body.inicio) : null;
    const fim = req.body?.fim ? new Date(req.body.fim) : null;
    if (!Number.isFinite(atividadeId) || !inicio || !fim) {
      res.status(400).json({ error: "atividadeId, inicio e fim são obrigatórios" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!podeLancarManual(ctx.role, ctx.contexto)) {
      res.status(403).json({
        error: "Apontamento manual é restrito a gestor de departamento — registre o tempo movendo o card no quadro",
      });
      return;
    }

    const { status, body } = await registrarApontamentoAvulso(atividadeId, inicio, fim, req.body?.descricao, ctx);
    res.status(status).json(body);
  } catch (error) {
    handleError(res, error, "manual");
  }
});

// Localiza o apontamento e a pendência de envio dele, garantindo que pertence ao
// consultor logado. Compartilhado pelas duas rotas de envio abaixo.
//
// O casamento pendência -> apontamento é o mesmo de GET /rats/:id/itens: a fila é
// indexada por atividade e o `ratItemId` vive dentro do payload.
async function carregarEnvioDoApontamento(ratItemId: number, codfor: number) {
  const ratItem = await prisma.ratItem.findUnique({ where: { id: ratItemId }, include: { rat: true, sessoes: true } });
  if (!ratItem || ratItem.rat.codfor !== codfor) return null;

  const atividadeId = ratItem.sessoes[0]?.atividadeId;
  const pendencia =
    atividadeId != null
      ? (
          await prisma.sincronizacaoPendente.findMany({
            where: { tipo: "criar_apontamento", atividadeId },
            orderBy: { id: "desc" },
          })
        ).find((p) => Number((p.payload as { ratItemId?: number })?.ratItemId) === ratItemId)
      : undefined;

  return { ratItem, pendencia };
}

// GET /envio/:ratItemId — estado do envio de UM apontamento ao Senior.
//
// Existe pra tela conseguir acompanhar o que acontece depois de confirmar: o envio roda
// em segundo plano e leva alguns segundos, então a releitura que o front faz na hora da
// confirmação sempre pega o item ainda na fila. Sem isso, o consultor confirma e nunca
// fica sabendo se chegou ao ERP.
apontamentosRouter.get("/envio/:ratItemId", async (req: AuthenticatedRequest, res) => {
  try {
    const ratItemId = Number(req.params.ratItemId);
    if (!Number.isFinite(ratItemId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const envio = await carregarEnvioDoApontamento(ratItemId, codfor);
    if (!envio) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    const { ratItem, pendencia } = envio;

    // `numrat` preenchido é a fonte da verdade do registro, não o status da fila: é ele
    // que trava edição e exclusão, e ele pode ter sido preenchido por outro caminho
    // (reconciliação com o ERP, ou o ratSync trazendo a RAT de volta).
    if (ratItem.numrat != null) {
      res.json({ status: "registrado", numrat: ratItem.numrat, seqrat: ratItem.seqrat, erro: null });
      return;
    }

    res.json({
      status: pendencia?.status ?? "desconhecido",
      numrat: null,
      seqrat: null,
      erro: pendencia?.ultimoErro ?? null,
    });
  } catch (error) {
    handleError(res, error, "envio-status");
  }
});

// POST /envio/:ratItemId/reenviar — nova tentativa de registrar o apontamento no Senior,
// disparada pelo próprio consultor quando o envio falhou.
//
// Seguro contra duplicata: `enviarApontamento` consulta o ERP antes de todo envio, então
// se o registro já existir de uma tentativa cuja resposta se perdeu, ele apenas reconcilia
// e grava numrat/seqrat em vez de gravar de novo.
apontamentosRouter.post("/envio/:ratItemId/reenviar", async (req: AuthenticatedRequest, res) => {
  try {
    const ratItemId = Number(req.params.ratItemId);
    if (!Number.isFinite(ratItemId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const envio = await carregarEnvioDoApontamento(ratItemId, codfor);
    if (!envio) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    const { ratItem, pendencia } = envio;

    if (ratItem.numrat != null) {
      res.status(400).json({ error: "Apontamento já registrado no Senior — nada a reenviar" });
      return;
    }
    if (pendencia?.status === "enviando") {
      res.status(409).json({ error: "Envio já em andamento" });
      return;
    }

    const atividadeId = ratItem.sessoes[0]?.atividadeId;
    if (atividadeId == null) {
      res.status(400).json({ error: "Apontamento sem sessão de execução vinculada — não dá pra enviar" });
      return;
    }

    let pendenciaId: number;
    if (pendencia) {
      // Volta a zero: sem isso um item já "bloqueado" (tentativas esgotadas) continuaria
      // de fora da varredura da fila.
      await prisma.sincronizacaoPendente.update({
        where: { id: pendencia.id },
        data: { status: "pendente", tentativas: 0, ultimoErro: null },
      });
      pendenciaId = pendencia.id;
    } else {
      // Sem pendência = apontamento desvinculado porque foi apagado no Senior (ver
      // desvincularItensAusentesNoSenior em routes/rats.ts, que remove a pendência
      // obsoleta). Enfileira de novo pra reintegrar.
      pendenciaId = await enfileirar(atividadeId, "criar_apontamento", {
        ratItemId: ratItem.id,
        ratId: ratItem.ratId,
        seqati: ratItem.seqati?.toString() ?? null,
        codemp: ratItem.codemp,
        codpro: ratItem.codpro,
        seqite: ratItem.seqite,
        codfas: ratItem.codfas,
        datati: ratItem.datati,
        horini: ratItem.horini,
        horfim: ratItem.horfim,
        desati: ratItem.desati,
        ratNovo: ratItem.rat.numrat == null,
        codfor: ratItem.rat.codfor,
        codcli: ratItem.rat.codcli,
        depexe: ratItem.rat.depexe,
      });
    }

    processarFilaSincronizacao({ apenasId: pendenciaId }).catch((erro) => {
      console.error("[apontamentos] reenvio ao Senior falhou:", erro instanceof Error ? erro.message : erro);
    });

    res.status(202).json({ status: "reenviando" });
  } catch (error) {
    handleError(res, error, "reenviar-envio");
  }
});

// Edita a observação (RatItem.desati) de um apontamento já confirmado — é como o
// consultor preenche o que faltou pra RAT poder ser aprovada (ver PATCH
// /rats/:id/aprovar, que exige observação em todo item). Só o dono, só enquanto a RAT
// pai ainda está Digitada e o item ainda não foi confirmado no Senior — mesmos guards
// de DELETE /:id logo abaixo.
apontamentosRouter.patch("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.params.id);
    const desati = typeof req.body?.desati === "string" ? req.body.desati.trim() : "";
    if (!Number.isFinite(sessaoId) || !desati) {
      res.status(400).json({ error: "desati é obrigatório" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.findUnique({
      where: { id: sessaoId },
      include: { atividade: true, ratItem: { include: { rat: true } } },
    });
    if (!sessao || sessao.atividade.codfor !== codfor) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    if (!sessao.ratItem) {
      res.status(400).json({ error: "Sessão ainda não confirmada — nada a editar" });
      return;
    }
    if (sessao.ratItem.numrat != null) {
      res.status(400).json({ error: "Já confirmado no Senior — não é possível editar" });
      return;
    }
    if (sessao.ratItem.rat.sitrat !== 9) {
      res.status(400).json({ error: "A RAT deste apontamento não está mais Digitada — não é possível editar" });
      return;
    }
    // Envio em voo: o job já leu o RatItem pra montar o payload, então uma edição agora
    // não chegaria ao Senior — a observação local ficaria diferente da registrada lá.
    // Mesmo espírito da guarda do DELETE logo abaixo.
    const envioEmVoo = await prisma.sincronizacaoPendente.findFirst({
      where: { tipo: "criar_apontamento", atividadeId: sessao.atividadeId, status: "enviando" },
    });
    if (envioEmVoo) {
      res.status(409).json({ error: "Envio ao Senior em andamento — aguarde para editar" });
      return;
    }

    await prisma.ratItem.update({ where: { id: sessao.ratItem.id }, data: { desati } });
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "editar-observacao");
  }
});

// Só desfaz enquanto o envio ainda está pendente — nunca depois de já ter ido/travado
// no Senior, pra não apagar algo que já pode existir do outro lado.
apontamentosRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const sessaoId = Number(req.params.id);
    if (!Number.isFinite(sessaoId)) {
      res.status(400).json({ error: "Id inválido" });
      return;
    }
    const ctx = await contextoDoUsuario(req);
    const codfor = ctx?.contexto.consultor?.codfor;
    if (!codfor) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }

    const sessao = await prisma.atividadeSessaoExecucao.findUnique({
      where: { id: sessaoId },
      include: { atividade: true, ratItem: true },
    });
    if (!sessao || sessao.atividade.codfor !== codfor) {
      res.status(404).json({ error: "Apontamento não encontrado" });
      return;
    }
    if (!sessao.confirmada || !sessao.ratItem) {
      res.status(400).json({ error: "Sessão ainda não confirmada — nada a desfazer" });
      return;
    }
    if (sessao.ratItem.numrat != null) {
      res.status(400).json({ error: "Já confirmado no Senior — não é possível excluir" });
      return;
    }
    const pendencia = await prisma.sincronizacaoPendente.findFirst({
      where: { tipo: "criar_apontamento", atividadeId: sessao.atividadeId },
      orderBy: { id: "desc" },
    });
    if (pendencia && pendencia.status !== "pendente") {
      res.status(400).json({ error: "Envio já em andamento ou bloqueado — não é possível excluir" });
      return;
    }

    const ratItemId = sessao.ratItem.id;
    await prisma.atividadeSessaoExecucao.update({ where: { id: sessaoId }, data: { confirmada: false, ratItemId: null } });
    if (pendencia) await prisma.sincronizacaoPendente.delete({ where: { id: pendencia.id } });
    await prisma.ratItem.delete({ where: { id: ratItemId } });

    res.status(204).send();
  } catch (error) {
    handleError(res, error, "excluir");
  }
});
