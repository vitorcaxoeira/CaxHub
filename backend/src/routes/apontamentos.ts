import { Router } from "express";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, podeExecutarAcao, consultoresDosDepartamentos } from "../domain/contextoProjeto";
import { formatarMinutos, saldoDaAtividade } from "../domain/tetoAtividade";
import { paraHoraBrasil } from "../domain/fusoBrasil";
import { enfileirar, processarFilaSincronizacao } from "../sync/outboxSenior";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";

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
// Exportada porque a aprovação de ajuste de horário (routes/solicitacoesAjuste.ts) reescreve
// datati/horini/horfim do RatItem e precisa da MESMA conversão — duas cópias divergiriam, e
// já custou caro uma vez (ver o comentário de fuso acima).
export function diaBrasilComoData(data: Date): Date {
  const { ano, mes, dia } = paraHoraBrasil(data);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function nomeConsultor(c: { codfor: number | null; nomcom: string | null; nomfor: string | null }): string {
  return c.nomcom ?? c.nomfor ?? `Fornecedor ${c.codfor}`;
}

// "07/08 09:00–10:30 (1:30)" — hora de parede brasileira, nunca o relógio do servidor.
// Usado nas frases de histórico e notificação de exclusão e de ajuste.
export function descreverIntervaloSessao(inicio: Date, fim: Date | null): string {
  const hhmm = (d: Date) => {
    const h = paraHoraBrasil(d);
    return `${String(Math.trunc(h.minutosDoDia / 60)).padStart(2, "0")}:${String(h.minutosDoDia % 60).padStart(2, "0")}`;
  };
  const i = paraHoraBrasil(inicio);
  const dia = `${String(i.dia).padStart(2, "0")}/${String(i.mes).padStart(2, "0")}`;
  if (!fim) return `${dia} ${hhmm(inicio)} (em aberto)`;
  const duracao = Math.round((fim.getTime() - inicio.getTime()) / 60000);
  return `${dia} ${hhmm(inicio)}–${hhmm(fim)} (${formatarMinutos(duracao)})`;
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

// Teto de apontamento = alocado + excedentes autorizados. Vale pro gestor também: pra
// lançar acima do teto ele aumenta o campo de excedentes antes, e aí fica registrado quem
// autorizou e quanto — que é o ponto de ter o campo.
//
// `descontarMinutos` é a duração de uma sessão que JÁ está no realizado e vai ser
// substituída por este intervalo. Zero quando a sessão ainda nem existe.
async function recusarSeEstourarTeto(
  atividade: Parameters<typeof saldoDaAtividade>[0],
  inicio: Date,
  fim: Date,
  descontarMinutos = 0
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const duracao = Math.round((fim.getTime() - inicio.getTime()) / 60000);
  const { teto, realizado } = await saldoDaAtividade(atividade);
  const realizadoBase = realizado - descontarMinutos;
  if (teto <= 0 || realizadoBase + duracao <= teto) return null;

  const disponivel = teto - realizadoBase;
  return {
    status: 409,
    body: {
      error:
        disponivel > 0
          ? `Apontamento de ${formatarMinutos(duracao)} excede o teto da atividade. Saldo disponível: ${formatarMinutos(disponivel)} (alocado + excedentes: ${formatarMinutos(teto)}). Ajuste o horário ou peça ao gestor pra liberar horas excedentes.`
          : `A atividade já consumiu todo o teto de ${formatarMinutos(teto)} (alocado + excedentes). Peça ao gestor pra liberar horas excedentes antes de apontar.`,
      teto,
      realizado: realizadoBase,
      disponivel,
    },
  };
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
  if (sessao.excluidaEm != null) return { status: 400, body: { error: "Apontamento excluído" } };

  // Ajuste de horário aguardando o gestor barra a confirmação AQUI, e não na hora de
  // integrar: assim o apontamento nem chega a virar RatItem, nem entra na RAT com o
  // horário que está em discussão. Decidido o pedido, a confirmação segue normal.
  const ajustePendente = await prisma.solicitacaoAjusteApontamento.findFirst({
    where: { sessaoId, status: "pendente" },
    select: { id: true },
  });
  if (ajustePendente) {
    return {
      status: 409,
      body: {
        error: `Há um ajuste de horário aguardando o gestor (solicitação ${ajustePendente.id}) — confirme depois da decisão`,
      },
    };
  }

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

  // Sessão nascida de uma solicitação avulsa aprovada tem horário FECHADO. A tela de
  // confirmação permite ajustar início/fim — o que aqui deixaria o consultor confirmar
  // 09:00–18:00 sobre um intervalo que o gestor aprovou como 12:30–12:50, desfazendo a
  // decisão sem passar por ninguém. Mexer no horário exige um pedido novo.
  const daSolicitacao = await prisma.solicitacaoApontamento.findFirst({ where: { sessaoId } });
  if (
    daSolicitacao &&
    (inicio.getTime() !== sessao.inicio.getTime() || fim.getTime() !== sessao.fim.getTime())
  ) {
    return {
      status: 403,
      body: {
        error:
          "Este apontamento veio de uma solicitação aprovada pelo gestor — o horário não pode ser alterado aqui. Para outro horário, abra uma nova solicitação na atividade.",
      },
    };
  }

  // A sessão já existe e já entra em `realizado` como "não confirmada", então desconta a
  // duração atual dela — senão a mesma hora contaria duas vezes e o bloqueio dispararia
  // com metade do saldo consumido.
  const duracaoAtualDaSessao = Math.round((sessao.fim.getTime() - sessao.inicio.getTime()) / 60000);
  const recusa = await recusarSeEstourarTeto(atividade, inicio, fim, duracaoAtualDaSessao);
  if (recusa) return recusa;

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
      // Sem fallback AQUI porque a herança já aconteceu antes: desde 03/08/2026 toda
      // parada grava a descrição da atividade na sessão quando ninguém digita nada (ver
      // descricaoPadraoDaAtividade em domain/execucaoAtividade.ts), e é ela que chega neste
      // campo pela tela de confirmação.
      //
      // Consequência assumida: o gate de PATCH /rats/:id/aprovar, que exige observação em
      // todo item, na prática deixa de barrar — a observação quase nunca fica vazia. Foi
      // decisão do Vitor, pedindo que a descrição fosse herdada sempre.
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
      where: { fim: { not: null }, confirmada: false, excluidaEm: null, atividade: { codfor, sitreg: "A" } },
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

    // Pedido de ajuste de horário aguardando o gestor — a tela destaca a linha e abre o
    // formulário em leitura, em vez de deixar pedir de novo (o índice único parcial da
    // migration recusaria de qualquer forma).
    const ajustes = await prisma.solicitacaoAjusteApontamento.findMany({
      where: { status: "pendente", sessaoId: { in: sessoes.map((s) => s.id) } },
    });
    const ajustePorSessao = new Map(ajustes.map((a) => [a.sessaoId, a]));

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
          ajustePendente: (() => {
            const a = ajustePorSessao.get(s.id);
            return a
              ? { id: a.id, inicioSolicitado: a.inicioSolicitado, fimSolicitado: a.fimSolicitado, motivo: a.motivo, criadoEm: a.criadoEm }
              : null;
          })(),
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

// Resolve a coluna que a sessão vai carregar. Sessão manual não move o card — herda a
// coluna atual só porque o campo é obrigatório.
async function colunaDaAtividade(atividade: { colunaId: number | null }) {
  return atividade.colunaId
    ? prisma.quadroColuna.findUnique({ where: { id: atividade.colunaId } })
    : prisma.quadroColuna.findFirst({ orderBy: { ordem: "asc" } });
}

// Cria a sessão fechada e NÃO confirmada — ela cai na lista de "apontamentos a confirmar"
// do consultor (GET /sessoes-pendentes), que é quem fecha o apontamento e dispara o envio
// ao Senior.
//
// É o caminho da aprovação de uma solicitação avulsa: o gestor autoriza o tempo, o
// consultor confirma. Diferente de POST /manual, onde o próprio gestor lança e confirma no
// mesmo passo.
//
// O teto é conferido AQUI, e não só na confirmação: uma sessão não confirmada já entra em
// `realizado` (ver domain/tetoAtividade.ts), então aprovar já estoura o teto na prática.
export async function criarSessaoManualPendente(
  atividadeId: number,
  inicio: Date,
  fim: Date,
  observacao: string
): Promise<{ status: number; body: Record<string, unknown>; sessaoId?: number }> {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: atividadeId } });
  if (!atividade) return { status: 404, body: { error: "Atividade não encontrada" } };

  const coluna = await colunaDaAtividade(atividade);
  if (!coluna) return { status: 400, body: { error: "Quadro Kanban sem colunas configuradas" } };

  const recusa = await recusarSeEstourarTeto(atividade, inicio, fim);
  if (recusa) return recusa;

  const sessao = await prisma.atividadeSessaoExecucao.create({
    data: { atividadeId, colunaId: coluna.id, inicio, fim, origem: "manual", observacao },
  });
  return { status: 201, body: { sessaoId: sessao.id }, sessaoId: sessao.id };
}

// Lança tempo sem uma sessão automática correspondente: cria a sessão já fechada e confirma
// no mesmo passo, o que gera o RatItem e enfileira o envio ao Senior. É o atalho do gestor
// (POST /manual) — a aprovação de solicitação usa criarSessaoManualPendente acima.
export async function registrarApontamentoAvulso(
  atividadeId: number,
  inicio: Date,
  fim: Date,
  descricao: string | undefined,
  ctx: NonNullable<Awaited<ReturnType<typeof contextoDoUsuario>>>
): Promise<{ status: number; body: Record<string, unknown>; sessaoId?: number }> {
  const atividade = await prisma.atividadeConsultor.findUnique({ where: { id: atividadeId } });
  if (!atividade) return { status: 404, body: { error: "Atividade não encontrada" } };

  const colunaAtual = await colunaDaAtividade(atividade);
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
    if (sessao.excluidaEm != null) {
      res.status(400).json({ error: "Apontamento já excluído" });
      return;
    }
    if (sessao.ratItem?.numrat != null) {
      res.status(400).json({ error: "Já confirmado no Senior — não é possível excluir" });
      return;
    }
    const pendencia = await prisma.sincronizacaoPendente.findFirst({
      where: { tipo: "criar_apontamento", atividadeId: sessao.atividadeId },
      orderBy: { id: "desc" },
    });
    if (sessao.ratItem && pendencia && pendencia.status !== "pendente") {
      res.status(400).json({ error: "Envio já em andamento ou bloqueado — não é possível excluir" });
      return;
    }

    // Exclusão LÓGICA da sessão: antes isto desfazia a confirmação, e o apontamento voltava
    // pra fila de "a confirmar" — quem queria apagar via o item reaparecer. Agora a sessão
    // é marcada e sai de vista, do realizado e da fila de confirmação.
    //
    // O RatItem, ao contrário, é apagado de verdade: ele é espelho de um documento do ERP,
    // e guardar um "excluído" que nunca chegou lá não descreve nada. Só existe quando a
    // sessão já tinha sido confirmada — a exclusão vale também pra sessão que nunca foi.
    const ratItemId = sessao.ratItem?.id ?? null;
    const fato = `excluiu o apontamento de ${descreverIntervaloSessao(sessao.inicio, sessao.fim)}`;

    await prisma.$transaction(async (tx) => {
      await tx.atividadeSessaoExecucao.update({
        where: { id: sessaoId },
        data: { excluidaEm: new Date(), excluidaPorId: ctx!.user.id, confirmada: false, ratItemId: null },
      });
      if (pendencia) await tx.sincronizacaoPendente.delete({ where: { id: pendencia.id } });
      if (ratItemId) await tx.ratItem.delete({ where: { id: ratItemId } });
      await tx.atividadeHistoricoMovimentacao.create({
        data: { atividadeId: sessao.atividadeId, tipo: "apontamento_excluido", descricao: fato, userId: ctx!.user.id },
      });
      await criarEventoAuditoria(
        {
          origem: "tela",
          usuarioId: ctx!.user.id,
          codemp: sessao.atividade.codemp,
          codpro: sessao.atividade.codpro,
          entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
          entidadeId: entidadeIdAtividade(sessao.atividadeId),
          entidadeRotulo: `Atividade — Proposta ${sessao.atividade.codpro}`,
          eventoTipo: EVENTOS_AUDITORIA.APONTAMENTO_EXCLUIDO,
          alteracoes: null,
          metadata: {
            inicio: sessao.inicio.toISOString(),
            fim: sessao.fim?.toISOString() ?? null,
            estavaConfirmada: sessao.confirmada,
            ratItemRemovido: ratItemId,
          },
          correlationId: req.correlationId!,
        },
        tx
      );
    });

    res.status(204).send();
  } catch (error) {
    handleError(res, error, "excluir");
  }
});
