import { AtividadeConsultor, Prisma, QuadroColuna } from "@prisma/client";
import { prisma } from "../db/prisma";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdAtividade } from "../audit/identidadeEntidade";

// Nomes reais das raias do quadro (ver backend/prisma/seed.ts) — mesma regra de negócio
// espelhada em frontend/src/lib/atividade-acoes.ts. Duas runtimes diferentes (sem pacote
// compartilhado neste monorepo), mas é UMA regra só: mudar aqui exige mudar lá também.
export const RAIA_A_FAZER = "A Fazer";
export const RAIA_EM_ANDAMENTO = "Em Andamento";

// Coluna efetiva de um card. `AtividadeConsultor.colunaId` nulo significa "nunca foi
// movida", e vale como a primeira raia do quadro — hoje 99% das atividades estão assim
// (2.206 de 2.227 na base local), porque só quem foi arrastado ganhou coluna gravada.
//
// Função pura, e uma só, de propósito: a listagem já aplicava esse fallback pra renderizar
// o card em "A Fazer", mas a validação de Iniciar/Parar lia o `colunaId` cru. O resultado
// era o card aparecer em "A Fazer" e o start recusar dizendo que ele não estava lá. Quem
// mostra e quem valida têm que enxergar a MESMA coluna.
export function colunaEfetiva(colunaDaAtividade: QuadroColuna | null, primeiraColuna: QuadroColuna | null): QuadroColuna | null {
  return colunaDaAtividade ?? primeiraColuna;
}

export function podeIniciar(nomeColunaAtual: string | null | undefined): boolean {
  return nomeColunaAtual === RAIA_A_FAZER;
}

export function podeParar(nomeColunaAtual: string | null | undefined): boolean {
  return nomeColunaAtual === RAIA_EM_ANDAMENTO;
}

// Tamanho de AtividadeSessaoExecucao.observacao e de RatItem.desati — o texto passa pelos
// dois. `despro` chega a 1.833 caracteres na base (19 itens passam de 1.000), então sem o
// corte o insert quebraria justamente nos maiores.
const LIMITE_OBSERVACAO = 1000;

// Descrição que a atividade "empresta" pra observação de uma parada: a mais específica que
// existir. O nome do nó no cronograma descreve a atividade em si; o `despro` descreve o
// item da proposta inteiro, e é o que sobra quando a proposta não usa estrutura — medido em
// 03/08/2026, só 771 das 2.259 atividades ativas têm nó, então o segundo caminho é o comum.
//
// Uma função só porque três lugares dependem da MESMA resposta: o modal que abre
// pré-preenchido, o vigia de fim de jornada e a herança da parada automática. Se cada um
// derivasse por conta própria, a tela ofereceria um texto e o servidor gravaria outro.
export async function descricaoPadraoDaAtividade(
  atividade: Pick<AtividadeConsultor, "codemp" | "codpro" | "seqite" | "estruturaAtividadeId">
): Promise<string | null> {
  if (atividade.estruturaAtividadeId != null) {
    const no = await prisma.estruturaAtividade.findUnique({
      where: { id: atividade.estruturaAtividadeId },
      select: { nome: true },
    });
    if (no?.nome?.trim()) return no.nome.trim().slice(0, LIMITE_OBSERVACAO);
  }
  const item = await prisma.propostaItem.findUnique({
    where: {
      codemp_codpro_seqite: { codemp: atividade.codemp, codpro: atividade.codpro, seqite: atividade.seqite },
    },
    select: { despro: true },
  });
  const despro = item?.despro?.trim();
  return despro ? despro.slice(0, LIMITE_OBSERVACAO) : null;
}

// Mesma escolha, sem ir ao banco — pra quem já tem os dois valores em mãos (a listagem de
// atividades monta os dois no mesmo `map`).
export function escolherDescricaoPadrao(estruturaNome: string | null, itemDescricao: string | null): string | null {
  const nome = estruturaNome?.trim();
  if (nome) return nome.slice(0, LIMITE_OBSERVACAO);
  const descricao = itemDescricao?.trim();
  return descricao ? descricao.slice(0, LIMITE_OBSERVACAO) : null;
}

export interface ContextoMovimentacao {
  atividade: AtividadeConsultor;
  colunaAnterior: QuadroColuna | null;
  colunaNova: QuadroColuna;
  // Nulo só na parada automática, que não nasce de uma ação de ninguém. Tanto o histórico
  // de movimentação quanto o evento de auditoria já aceitam usuário nulo.
  usuarioId: number | null;
  // Fonte da sessão de execução aberta/fechada (AtividadeSessaoExecucao.origem) — não
  // confundir com o `origem` do evento de auditoria (sempre "tela" aqui: as duas fontes
  // nascem de uma ação do usuário numa tela, seja arrastar o card ou clicar Iniciar/Parar).
  origemSessao: "movimentacao_kanban" | "manual";
  correlationId: string;
  // Instante do fechamento da sessão aberta (e da abertura da nova, quando a coluna conta
  // como execução). É `Date` e não "agora implícito" justamente porque a parada
  // automática precisa fechar num instante do PASSADO — o limite de teto ou o fim do
  // expediente — e não na hora em que a varredura percebeu.
  agora: Date;
  // Origem do evento de auditoria. Só a parada automática usa "job"; toda ação nascida de
  // uma tela deixa o padrão.
  origemEvento?: "tela" | "job";
  // Texto livre gravado no metadata do evento de parada — usado pela varredura pra
  // registrar POR QUE parou (teto ou expediente).
  motivoParada?: string;
  // Texto capturado na hora de fechar a sessão (modal "O que foi feito?" ao mover o
  // card pra fora de "Em Andamento" ou clicar Parar) — pré-preenche a Descrição em
  // Meus Apontamentos.
  //
  // Vazio ou ausente NÃO deixa a sessão em branco: cai na descrição da atividade (ver
  // descricaoPadraoDaAtividade). É o que cobre a auto-pausa de POST /:id/start e todas as
  // paradas automáticas, onde não há ninguém pra digitar.
  observacaoFechamento?: string | null;
}

export interface ResultadoMovimentacao {
  operacoes: Prisma.PrismaPromise<unknown>[];
  duracaoSessaoFechadaMin: number | null;
}

// Monta as operações Prisma de uma movimentação de card (atualizar coluna, log de
// histórico, fechar sessão aberta / abrir sessão nova conforme
// QuadroColuna.contaComoExecucao, eventos de auditoria) — usado tanto por
// PATCH /:id/mover (drag-and-drop, origemSessao "movimentacao_kanban") quanto por
// POST /:id/start e /:id/stop (origemSessao "manual"). Só monta as operações — quem
// chama decide quando/como executar (um array próprio, ou combinado com outra chamada
// desta mesma função, ex.: pausar uma atividade pra iniciar outra na mesma transação).
export async function montarOperacoesMovimentacao(ctx: ContextoMovimentacao): Promise<ResultadoMovimentacao> {
  const { atividade, colunaAnterior, colunaNova, usuarioId, origemSessao, correlationId, agora, observacaoFechamento, origemEvento, motivoParada } = ctx;

  const sessaoAbertaAntes = await prisma.atividadeSessaoExecucao.findFirst({
    where: { atividadeId: atividade.id, fim: null },
  });
  const duracaoSessaoFechadaMin = sessaoAbertaAntes
    ? Math.round((agora.getTime() - sessaoAbertaAntes.inicio.getTime()) / 60000)
    : null;

  // Observação vazia herda a descrição da atividade. Vale pra TODA parada — a automática
  // (fim de expediente, teto, varredura, auto-pausa ao iniciar outra) não tem ninguém pra
  // digitar, e era ali que a sessão fechava em branco. Consulta o banco só quando há
  // sessão aberta pra fechar e não veio texto.
  const observacaoDaSessao =
    observacaoFechamento?.trim() ||
    (sessaoAbertaAntes ? await descricaoPadraoDaAtividade(atividade) : null);

  const entidadeId = entidadeIdAtividade(atividade.id);
  const entidadeRotulo = `Atividade — Proposta ${atividade.codpro}`;
  const ctxEvento = {
    origem: origemEvento ?? ("tela" as const),
    usuarioId,
    codemp: atividade.codemp,
    codpro: atividade.codpro,
    entidadeId,
    correlationId,
  };

  const operacoes: Prisma.PrismaPromise<unknown>[] = [
    prisma.atividadeConsultor.update({ where: { id: atividade.id }, data: { colunaId: colunaNova.id } }),
    prisma.atividadeHistoricoMovimentacao.create({
      data: {
        atividadeId: atividade.id,
        colunaAnteriorId: atividade.colunaId,
        colunaNovaId: colunaNova.id,
        userId: usuarioId,
      },
    }),
    prisma.atividadeSessaoExecucao.updateMany({
      where: { atividadeId: atividade.id, fim: null },
      data: { fim: agora, ...(observacaoDaSessao ? { observacao: observacaoDaSessao } : {}) },
    }),
    ...(colunaNova.contaComoExecucao
      ? [
          prisma.atividadeSessaoExecucao.create({
            data: { atividadeId: atividade.id, colunaId: colunaNova.id, inicio: agora, origem: origemSessao },
          }),
        ]
      : []),
    criarEventoAuditoria({
      ...ctxEvento,
      entidadeTipo: ENTIDADES_AUDITORIA.KANBAN_CARD,
      entidadeRotulo,
      eventoTipo: EVENTOS_AUDITORIA.KANBAN_RAIA_ALTERADA,
      alteracoes: { colunaId: { de: atividade.colunaId, para: colunaNova.id, rotulo: "Coluna" } },
      metadata: { raia_de: colunaAnterior?.nome ?? null, raia_para: colunaNova.nome },
    }),
    ...(sessaoAbertaAntes
      ? [
          criarEventoAuditoria({
            ...ctxEvento,
            entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
            entidadeRotulo,
            eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_PARADA,
            alteracoes: null,
            metadata: {
              coluna: colunaAnterior?.nome ?? null,
              duracaoMinutos: duracaoSessaoFechadaMin,
              observacao: observacaoDaSessao,
              motivo: motivoParada ?? null,
            },
          }),
        ]
      : []),
    ...(colunaNova.contaComoExecucao
      ? [
          criarEventoAuditoria({
            ...ctxEvento,
            entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
            entidadeRotulo,
            eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_INICIADA,
            alteracoes: null,
            metadata: { coluna: colunaNova.nome },
          }),
        ]
      : []),
  ];

  return { operacoes, duracaoSessaoFechadaMin };
}
