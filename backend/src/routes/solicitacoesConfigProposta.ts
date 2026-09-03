import { Router } from "express";
import { Prisma } from "@prisma/client";
import { requireAuth, AuthenticatedRequest } from "../auth/middleware";
import { prisma } from "../db/prisma";
import { resolverContextoConsultor, podeAprovarConfiguracaoProposta } from "../domain/contextoProjeto";
import { notificarAprovadoresConfiguracaoProposta, criarNotificacao } from "../domain/notificacoes";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdProposta } from "../audit/identidadeEntidade";
import { modproLabel } from "../domain/propostasDominio";
import { podeGerenciarProposta } from "./alocacao";

// Pedido de mudança em 2 das 3 flags de configuração da proposta (PropostaModoAlocacao) e a
// decisão de quem tem alçada.
//
// Por que existe: mudar bloqueiaExcedenteEstrutura (trava a duração planejada da EAP acima do
// saldo) ou bloqueiaExcedente (autorizar/solicitar horas já trabalhadas acima do previsto) é
// decisão de nível de proposta com peso de orçamento, mas quem podia mexer era qualquer gestor
// com UM item nela (podeGerenciarProposta) — largo demais. Agora esse conjunto PEDE, e só
// admin / gestor do Comercial / gestor da Diretoria decide (podeAprovarConfiguracaoProposta).
//
// bloqueiaApontamento FICOU DE FORA desta regra (03/09/2026, a pedido do Vitor): não impacta
// orçamento, e é decisão do próprio gestor da área — continua mudando direto pelo PATCH
// /alocacao/propostas/:codemp/:codpro/configuracao-alocacao (podeGerenciarProposta), sem
// passar por aqui. Ver CAMPOS_SOLICITAVEIS abaixo.
//
// Quem já tem alçada pras outras duas também muda direto pelo mesmo PATCH, sem passar por
// aqui.
export const solicitacoesConfigPropostaRouter = Router();
solicitacoesConfigPropostaRouter.use(requireAuth);

const STATUS_PENDENTE = "pendente";
const STATUS_APROVADA = "aprovada";
const STATUS_REPROVADA = "reprovada";

// As 3 flags, com o rótulo em português usado na frase do histórico/auditoria/notificação e o
// evento de auditoria de MUDANÇA DA FLAG que já existia antes desta feature — ao aprovar, ele
// é gravado junto com o evento da decisão, pra a linha do tempo da flag continuar idêntica à
// de quem muda direto (mesmo tone/ícone de cadeado em auditoriaVisual.tsx).
const CAMPOS = {
  bloqueiaExcedenteEstrutura: {
    rotulo: "Travar horas acima do saldo do item na estrutura",
    evento: EVENTOS_AUDITORIA.PROPOSTA_BLOQUEIO_EXCEDENTE_ALTERADO,
    // Ausência de linha em PropostaModoAlocacao equivale a este valor — mesma resolução de
    // propostaBloqueiaExcedenteEstrutura/configBloqueioProposta.
    padrao: true,
  },
  bloqueiaApontamento: {
    rotulo: "Bloquear apontamentos",
    evento: EVENTOS_AUDITORIA.PROPOSTA_BLOQUEIO_APONTAMENTO_ALTERADO,
    padrao: false,
  },
  bloqueiaExcedente: {
    rotulo: "Bloquear horas excedentes",
    evento: EVENTOS_AUDITORIA.PROPOSTA_BLOQUEIO_HORAS_EXCEDENTES_ALTERADO,
    padrao: true,
  },
} as const;

type CampoConfig = keyof typeof CAMPOS;

function ehCampoValido(valor: unknown): valor is CampoConfig {
  return typeof valor === "string" && valor in CAMPOS;
}

// bloqueiaApontamento saiu do fluxo de aprovação (03/09/2026, a pedido do Vitor): não impacta
// orçamento, e quem já gerencia a proposta liga/desliga direto pelo PATCH
// /alocacao/propostas/:codemp/:codpro/configuracao-alocacao, sem passar por aqui. Continua
// dentro de CAMPOS (rótulo/evento) só pra decidirUma continuar servindo alguma solicitação
// antiga desse campo que ainda esteja pendente — POST / não deixa criar uma nova.
const CAMPOS_SOLICITAVEIS: readonly CampoConfig[] = ["bloqueiaExcedenteEstrutura", "bloqueiaExcedente"];

function handleError(res: import("express").Response, error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[solicitacoes-config-proposta:${label}]`, message);
  res.status(500).json({ error: message });
}

async function contextoDoUsuario(req: AuthenticatedRequest) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return null;
  const contexto = await resolverContextoConsultor(user.email);
  return { user, contexto, role: req.user!.role as string };
}

// Valor efetivo das 3 flags: linha ausente vale o `padrao` de cada uma (não `false`) — é o que
// as leituras espalhadas pelo backend já assumem.
async function configAtual(codemp: number, codpro: number): Promise<Record<CampoConfig, boolean>> {
  const linha = await prisma.propostaModoAlocacao.findUnique({ where: { codemp_codpro: { codemp, codpro } } });
  return {
    bloqueiaExcedenteEstrutura: linha?.bloqueiaExcedenteEstrutura ?? CAMPOS.bloqueiaExcedenteEstrutura.padrao,
    bloqueiaApontamento: linha?.bloqueiaApontamento ?? CAMPOS.bloqueiaApontamento.padrao,
    bloqueiaExcedente: linha?.bloqueiaExcedente ?? CAMPOS.bloqueiaExcedente.padrao,
  };
}

interface PropostaInfo {
  clienteNome: string | null;
  despro: string | null;
  numprj: number | null;
  modproLabel: string;
}

// Mesma ideia de propostaInfoPorAtividades nos outros 3 routers, chaveada direto por
// codemp-codpro (aqui a solicitação já é da proposta, não de uma atividade).
async function propostaInfoEmLote(pares: { codemp: number; codpro: number }[]): Promise<Map<string, PropostaInfo>> {
  const mapa = new Map<string, PropostaInfo>();
  if (pares.length === 0) return mapa;
  const unicos = [...new Map(pares.map((p) => [`${p.codemp}-${p.codpro}`, p])).values()];
  const propostas = await prisma.proposta.findMany({
    where: { OR: unicos.map((p) => ({ codemp: p.codemp, codpro: p.codpro })) },
    select: {
      codemp: true,
      codpro: true,
      numprj: true,
      despro: true,
      modpro: true,
      cliente: { select: { codcli: true, nomcli: true } },
    },
  });
  for (const p of propostas) {
    mapa.set(`${p.codemp}-${p.codpro}`, {
      clienteNome: p.cliente ? `${p.cliente.codcli} - ${p.cliente.nomcli}` : null,
      despro: p.despro ?? null,
      numprj: p.numprj ?? null,
      modproLabel: modproLabel(p.modpro),
    });
  }
  return mapa;
}

// "ligar"/"desligar" — a frase única que vai pra auditoria e pra notificação, no mesmo
// espírito do `fato` dos outros 3 fluxos (começa em minúscula porque emenda depois do nome).
function descreverMudanca(campo: CampoConfig, valorSolicitado: boolean): string {
  return `${valorSolicitado ? "ligar" : "desligar"} "${CAMPOS[campo].rotulo}"`;
}

const INCLUDE_LISTA = {
  solicitante: { select: { nome: true } },
  decididoPor: { select: { nome: true } },
} as const;

type SolicitacaoComRelacoes = Prisma.SolicitacaoConfiguracaoPropostaGetPayload<{ include: typeof INCLUDE_LISTA }>;

function serializar(s: SolicitacaoComRelacoes, podeDecidir: boolean, propostaInfo?: PropostaInfo) {
  return {
    id: s.id,
    codemp: s.codemp,
    codpro: s.codpro,
    numprj: propostaInfo?.numprj ?? null,
    campo: s.campo,
    campoLabel: ehCampoValido(s.campo) ? CAMPOS[s.campo].rotulo : s.campo,
    valorAtual: s.valorAtual,
    valorSolicitado: s.valorSolicitado,
    motivo: s.motivo,
    status: s.status,
    criadoEm: s.criadoEm,
    decididoEm: s.decididoEm,
    observacaoDecisao: s.observacaoDecisao,
    solicitanteNome: s.solicitante?.nome ?? "Usuário removido",
    decisorNome: s.decididoPor?.nome ?? null,
    clienteNome: propostaInfo?.clienteNome ?? null,
    despro: propostaInfo?.despro ?? null,
    modproLabel: propostaInfo?.modproLabel ?? "—",
    podeDecidir,
  };
}

// POST / — quem enxerga a proposta (mesma regra de podeGerenciarProposta, que é quem mexia
// nas flags antes) PEDE a mudança. Quem tem alçada não passa por aqui: muda direto no PATCH.
solicitacoesConfigPropostaRouter.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const codemp = Number(req.body?.codemp);
    const codpro = Number(req.body?.codpro);
    const campo = req.body?.campo;
    const valorSolicitado = req.body?.valorSolicitado;
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";

    if (!Number.isFinite(codemp) || !Number.isFinite(codpro)) {
      res.status(400).json({ error: "codemp e codpro são obrigatórios" });
      return;
    }
    if (!ehCampoValido(campo) || !CAMPOS_SOLICITAVEIS.includes(campo)) {
      res.status(400).json({
        error:
          campo === "bloqueiaApontamento"
            ? "Bloquear apontamentos não passa por aprovação — quem gerencia a proposta muda direto, sem solicitação."
            : "campo inválido",
      });
      return;
    }
    if (typeof valorSolicitado !== "boolean") {
      res.status(400).json({ error: "valorSolicitado deve ser true ou false" });
      return;
    }
    // Mesmo motivo dos outros 3 fluxos: sem ele o aprovador decide no escuro.
    if (motivo === "") {
      res.status(400).json({ error: "Informe o motivo da solicitação" });
      return;
    }

    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;
    if (!(await podeGerenciarProposta(role, contexto, codemp, codpro))) {
      res.status(403).json({ error: "Sem permissão para solicitar mudança nesta proposta" });
      return;
    }

    const atual = await configAtual(codemp, codpro);
    if (atual[campo] === valorSolicitado) {
      res.status(400).json({ error: "A configuração já está nesse valor — nada a mudar" });
      return;
    }

    const fato = `solicitou ${descreverMudanca(campo, valorSolicitado)} na proposta ${codemp}/${codpro}`;

    let criada;
    try {
      criada = await prisma.$transaction(async (tx) => {
        const nova = await tx.solicitacaoConfiguracaoProposta.create({
          data: { codemp, codpro, campo, valorAtual: atual[campo], valorSolicitado, motivo, solicitanteId: user.id },
        });
        await criarEventoAuditoria(
          {
            origem: "tela",
            usuarioId: user.id,
            codemp,
            codpro,
            entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
            entidadeId: entidadeIdProposta(codemp, codpro),
            entidadeRotulo: `Proposta ${codemp}/${codpro}`,
            eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_CONFIG_SOLICITADA,
            alteracoes: null,
            metadata: {
              campo,
              campoLabel: CAMPOS[campo].rotulo,
              de: atual[campo] ? "Ligado" : "Desligado",
              para: valorSolicitado ? "Ligado" : "Desligado",
              motivo,
            },
            correlationId: req.correlationId!,
          },
          tx
        );
        return nova;
      });
    } catch (erro) {
      // Índice único parcial (uma pendente por proposta+campo) — é o caminho do duplo clique,
      // então merece uma frase e não um 500.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        res.status(409).json({ error: "Já existe uma solicitação pendente para este campo nesta proposta" });
        return;
      }
      throw erro;
    }

    await notificarAprovadoresConfiguracaoProposta(codemp, `${user.nome} ${fato}`, user.id);

    res.status(201).json({ id: criada.id, status: criada.status });
  } catch (error) {
    handleError(res, error, "criar");
  }
});

// GET /?status=&codemp=&codpro= — quem tem alçada vê todas; qualquer um vê as próprias.
solicitacoesConfigPropostaRouter.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const ctx = await contextoDoUsuario(req);
    if (!ctx) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    const { user, contexto, role } = ctx;
    const status = typeof req.query.status === "string" && req.query.status !== "" ? req.query.status : null;
    const codemp = Number(req.query.codemp);
    const codpro = Number(req.query.codpro);

    const where: Prisma.SolicitacaoConfiguracaoPropostaWhereInput = {};
    if (status) where.status = status;
    if (Number.isFinite(codemp) && Number.isFinite(codpro)) {
      where.codemp = codemp;
      where.codpro = codpro;
    }

    const todas = await prisma.solicitacaoConfiguracaoProposta.findMany({
      where,
      include: INCLUDE_LISTA,
      orderBy: [{ status: "asc" }, { criadoEm: "desc" }],
    });

    const podeDecidir = podeAprovarConfiguracaoProposta(role, contexto);
    const mapaProposta = await propostaInfoEmLote(todas.map((s) => ({ codemp: s.codemp, codpro: s.codpro })));

    const visiveis = todas
      .filter((s) => podeDecidir || s.solicitanteId === user.id)
      .map((s) => serializar(s, podeDecidir, mapaProposta.get(`${s.codemp}-${s.codpro}`)));

    res.json({ solicitacoes: visiveis, podeDecidir });
  } catch (error) {
    handleError(res, error, "listar");
  }
});

// Miolo de "decidir uma solicitação" — a MESMA lógica de POST /:id/decidir e de
// POST /decidir-lote. Nunca toca em `res`: devolve { status, body } pro chamador responder
// (individual) ou acumular (lote).
async function decidirUma(
  id: number,
  opts: { aprovar: boolean; observacao?: unknown },
  req: AuthenticatedRequest
): Promise<{ status: number; body: unknown }> {
  if (!Number.isFinite(id)) return { status: 400, body: { error: "Id inválido" } };
  const { aprovar } = opts;
  const observacao = typeof opts.observacao === "string" ? opts.observacao.trim() : "";

  const solicitacao = await prisma.solicitacaoConfiguracaoProposta.findUnique({ where: { id } });
  if (!solicitacao) return { status: 404, body: { error: "Solicitação não encontrada" } };
  // Dois aprovadores com o painel aberto decidiriam o mesmo pedido e a flag seria aplicada
  // duas vezes (a segunda com o "de" já errado na auditoria).
  if (solicitacao.status !== STATUS_PENDENTE) {
    return { status: 409, body: { error: `Esta solicitação já foi ${solicitacao.status}` } };
  }
  if (!ehCampoValido(solicitacao.campo)) {
    return { status: 400, body: { error: `Campo desconhecido: ${solicitacao.campo}` } };
  }
  const campo = solicitacao.campo;

  const ctx = await contextoDoUsuario(req);
  if (!ctx) return { status: 404, body: { error: "Usuário não encontrado" } };
  const { user, contexto, role } = ctx;
  if (!podeAprovarConfiguracaoProposta(role, contexto)) {
    return { status: 403, body: { error: "Só admin, gestor do Comercial ou da Diretoria pode decidir esta solicitação" } };
  }

  const { codemp, codpro } = solicitacao;
  // O "de" da auditoria sai do valor LIDO AGORA, não do valorAtual congelado no pedido — o
  // congelado é papelada, e entre o pedido e a decisão o valor pode ter mudado por outro
  // caminho (aprovador mexendo direto pelo PATCH).
  const atual = await configAtual(codemp, codpro);
  const valorAntes = atual[campo];
  const fato = `${aprovar ? "aprovou" : "reprovou"} o pedido de ${descreverMudanca(campo, solicitacao.valorSolicitado)} na proposta ${codemp}/${codpro}`;

  const atualizada = await prisma.$transaction(async (tx) => {
    const s = await tx.solicitacaoConfiguracaoProposta.update({
      where: { id },
      data: {
        status: aprovar ? STATUS_APROVADA : STATUS_REPROVADA,
        decididoPorId: user.id,
        decididoEm: new Date(),
        observacaoDecisao: observacao === "" ? null : observacao,
      },
    });

    const entidadeComum = {
      origem: "tela" as const,
      usuarioId: user.id,
      codemp,
      codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.PROPOSTA,
      entidadeId: entidadeIdProposta(codemp, codpro),
      entidadeRotulo: `Proposta ${codemp}/${codpro}`,
      correlationId: req.correlationId!,
    };

    await criarEventoAuditoria(
      {
        ...entidadeComum,
        eventoTipo: aprovar ? EVENTOS_AUDITORIA.PROPOSTA_CONFIG_APROVADA : EVENTOS_AUDITORIA.PROPOSTA_CONFIG_REPROVADA,
        alteracoes: null,
        metadata: {
          campo,
          campoLabel: CAMPOS[campo].rotulo,
          de: valorAntes ? "Ligado" : "Desligado",
          para: solicitacao.valorSolicitado ? "Ligado" : "Desligado",
          motivo: solicitacao.motivo,
          observacaoDecisao: observacao === "" ? null : observacao,
        },
      },
      tx
    );

    if (aprovar) {
      // Mesmo upsert do PATCH direto. Linha ausente nasce em modo "estrutura" — é o que
      // resolverModoAlocacao devolve quando não há config (ver alocacao.ts).
      await tx.propostaModoAlocacao.upsert({
        where: { codemp_codpro: { codemp, codpro } },
        create: { codemp, codpro, modo: "estrutura", [campo]: solicitacao.valorSolicitado },
        update: { [campo]: solicitacao.valorSolicitado },
      });
      // O MESMO evento que o PATCH direto grava — a linha do tempo da flag fica idêntica,
      // tenha a mudança vindo por aprovação ou pela mão de quem já tem alçada.
      if (valorAntes !== solicitacao.valorSolicitado) {
        await criarEventoAuditoria(
          {
            ...entidadeComum,
            eventoTipo: CAMPOS[campo].evento,
            alteracoes: {
              [campo]: { de: valorAntes, para: solicitacao.valorSolicitado, rotulo: CAMPOS[campo].rotulo },
            },
            metadata: {
              bloqueio_de: valorAntes ? "Ligado" : "Desligado",
              bloqueio_para: solicitacao.valorSolicitado ? "Ligado" : "Desligado",
              origem_solicitacao: solicitacao.id,
            },
          },
          tx
        );
      }
    }

    return s;
  });

  // Fora da transação: falha de notificação não desfaz a decisão.
  if (solicitacao.solicitanteId != null && solicitacao.solicitanteId !== user.id) {
    await criarNotificacao(solicitacao.solicitanteId, "config_proposta_decidida", `${user.nome} ${fato}`);
  }

  return {
    status: 200,
    body: {
      id: atualizada.id,
      status: atualizada.status,
      campo,
      valorAplicado: aprovar ? solicitacao.valorSolicitado : valorAntes,
    },
  };
}

solicitacoesConfigPropostaRouter.post("/:id/decidir", async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const aprovar = req.body?.aprovar;
    if (typeof aprovar !== "boolean") {
      res.status(400).json({ error: "aprovar (true/false) é obrigatório" });
      return;
    }
    const resultado = await decidirUma(id, { aprovar, observacao: req.body?.observacao }, req);
    res.status(resultado.status).json(resultado.body);
  } catch (error) {
    handleError(res, error, "decidir");
  }
});

// Decide várias de uma vez — serial (não Promise.all), como os outros 3: cada uma abre a
// própria transação, e o lote sempre responde 200 com o que passou e o que falhou.
solicitacoesConfigPropostaRouter.post("/decidir-lote", async (req: AuthenticatedRequest, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((v: unknown) => Number(v)) : null;
    const aprovar = req.body?.aprovar;
    if (!ids || ids.length === 0 || typeof aprovar !== "boolean") {
      res.status(400).json({ error: "ids (array não vazio) e aprovar (true/false) são obrigatórios" });
      return;
    }

    const sucesso: number[] = [];
    const falhas: { id: number; erro: string }[] = [];
    for (const id of ids) {
      const resultado = await decidirUma(id, { aprovar, observacao: req.body?.observacao }, req);
      if (resultado.status >= 400) {
        const corpo = resultado.body as { error?: string };
        falhas.push({ id, erro: corpo.error ?? "Falha ao decidir" });
      } else {
        sucesso.push(id);
      }
    }

    res.json({ sucesso, falhas });
  } catch (error) {
    handleError(res, error, "decidir-lote");
  }
});
