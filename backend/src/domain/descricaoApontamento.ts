import { prisma } from "../db/prisma";
import { ContextoConsultor, podeExecutarAcao } from "./contextoProjeto";

// Descrição de apontamento (27/11/2026, pedido do gestor Alessandro trazido pelo Vitor): todo apontamento tem uma descrição escrita pelo PRÓPRIO
// consultor, com contexto. Regra (decisão do Vitor): pelo menos 30 caracteres e DIFERENTE da descrição da atividade, que passa a ser mostrada
// só como informação (nunca mais é copiada para o apontamento). A regra é uma só para todos os caminhos; o frontend tem o espelho dela
// (lib/descricaoApontamento.ts) para avisar antes de enviar, mas quem garante é o servidor.

// Quem escreve (mesma data, pedido do Vitor): o consultor e, em Meus Apontamentos, também o gestor e o admin, com a mesma regra de texto. Quando
// não é o próprio consultor, fica registrado no histórico da atividade e na auditoria quem escreveu e o texto anterior.

export const MIN_DESCRICAO = 30;
/** Tamanho de AtividadeSessaoExecucao.observacao e de RatItem.desati. */
export const MAX_DESCRICAO = 1000;

/** Texto como ele é contado: sem pontas e com espaços repetidos valendo um (30 espaços não são contexto). */
export const textoDaDescricao = (texto: string | null | undefined) => (texto ?? "").trim().replace(/\s+/g, " ");

/** Chave de comparação: sem maiúsculas, acentos, espaços e pontuação. */
export const chaveDeComparacao = (texto: string | null | undefined) =>
  (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Repete a descrição da atividade? Compara também com o corte de 1000 caracteres, que era como o preenchimento automático gravava. */
export function repeteDescricaoDaAtividade(texto: string, referencias: (string | null | undefined)[]): boolean {
  const chave = chaveDeComparacao(texto);
  if (!chave) return false;
  return referencias.some((r) => !!r && (chave === chaveDeComparacao(r) || chave === chaveDeComparacao(r.trim().slice(0, MAX_DESCRICAO))));
}

/**
 * Quem pode incluir ou alterar a descrição de um apontamento em Meus Apontamentos: quem já pode CONFIRMÁ-LO (o dono, o admin, o gestor do
 * departamento do item ou o gestor do time do consultor) e, na RAT, o gestor do departamento dela (quem aprova). Colega de time não.
 * `codforsDoTime` é o retorno de domain/contextoProjeto.codforsDoTime (`null` = admin).
 */
export function podeDescreverApontamento(
  role: string,
  contexto: ContextoConsultor,
  alvo: { codfor: number; depexes: (number | null | undefined)[] },
  codforsDoTime: Set<number> | null
): boolean {
  if (codforsDoTime?.has(alvo.codfor)) return true;
  const depexes = alvo.depexes.filter((d): d is number => d != null);
  // Sem departamento conhecido, -1 não casa com nenhum: sobram o dono e o admin.
  return (depexes.length > 0 ? depexes : [-1]).some((depexe) =>
    podeExecutarAcao(role, contexto, "lancarApontamento", { depexe, codfor: alvo.codfor })
  );
}

/** Por que a descrição não serve; `null` quando serve. `referencias` = nome do nó do cronograma e descrição do item da proposta. */
export function erroDeDescricao(texto: string | null | undefined, referencias: (string | null | undefined)[] = []): string | null {
  const contado = textoDaDescricao(texto);
  if (!contado) return "Descreva o que foi realizado: a descrição é obrigatória.";
  if (repeteDescricaoDaAtividade(contado, referencias)) return "A descrição não pode repetir a descrição da atividade: conte o que você fez.";
  if (contado.length < MIN_DESCRICAO) return `A descrição precisa ter pelo menos ${MIN_DESCRICAO} caracteres (faltam ${MIN_DESCRICAO - contado.length}).`;
  if ((texto ?? "").trim().length > MAX_DESCRICAO) return `A descrição pode ter no máximo ${MAX_DESCRICAO} caracteres.`;
  return null;
}

export interface AtividadeComDescricao {
  codemp: number;
  codpro: number;
  seqite: number;
  estruturaAtividadeId: number | null;
}

export interface ReferenciasDaAtividade {
  /** A que a tela mostra no bloco "Atividade": o nome do nó do cronograma ou, sem ele, a descrição do item da proposta. */
  descricaoAtividade: string | null;
  itemDescricao: string | null;
  /** As duas, para a comparação: a descrição do apontamento não pode repetir nenhuma. */
  todas: string[];
}

const chaveItem = (a: { codemp: number; codpro: number; seqite: number }) => `${a.codemp}-${a.codpro}-${a.seqite}`;

function montarReferencias(nomeDoNo: string | null | undefined, despro: string | null | undefined): ReferenciasDaAtividade {
  const no = nomeDoNo?.trim() || null;
  const item = despro?.trim() || null;
  return { descricaoAtividade: no ?? item, itemDescricao: item, todas: [no, item].filter((x): x is string => !!x) };
}

/** Referências de várias atividades de uma vez (uma consulta por tabela). Devolve uma função de busca por atividade. */
export async function carregarReferencias(atividades: AtividadeComDescricao[]): Promise<(a: AtividadeComDescricao) => ReferenciasDaAtividade> {
  const nos = [...new Set(atividades.map((a) => a.estruturaAtividadeId).filter((x): x is number => x != null))];
  const [estruturas, itens] = await Promise.all([
    nos.length ? prisma.estruturaAtividade.findMany({ where: { id: { in: nos } }, select: { id: true, nome: true } }) : [],
    atividades.length
      ? prisma.propostaItem.findMany({
          where: { codemp: { in: [...new Set(atividades.map((a) => a.codemp))] }, codpro: { in: [...new Set(atividades.map((a) => a.codpro))] } },
          select: { codemp: true, codpro: true, seqite: true, despro: true },
        })
      : [],
  ]);
  const nomePorNo = new Map(estruturas.map((e) => [e.id, e.nome]));
  const desproPorItem = new Map(itens.map((i) => [chaveItem(i), i.despro]));
  return (a) => montarReferencias(a.estruturaAtividadeId != null ? nomePorNo.get(a.estruturaAtividadeId) : null, desproPorItem.get(chaveItem(a)));
}

export async function referenciasDaAtividade(atividade: AtividadeComDescricao): Promise<ReferenciasDaAtividade> {
  return (await carregarReferencias([atividade]))(atividade);
}

/**
 * Apontamentos do consultor que ainda precisam de descrição: sessões PENDENTES (encerradas, não excluídas, ainda não confirmadas em RAT) de
 * atividades ATIVAS dele, com a descrição vazia, curta ou igual à da atividade. As antigas preenchidas automaticamente contam. Enquanto houver
 * alguma, ele não inicia outra atividade.
 */
export async function sessoesSemDescricao(codfor: number): Promise<{ id: number; atividadeId: number; codpro: number }[]> {
  const sessoes = await prisma.atividadeSessaoExecucao.findMany({
    where: { fim: { not: null }, confirmada: false, excluidaEm: null, ratItemId: null, atividade: { codfor, sitreg: "A" } },
    select: { id: true, atividadeId: true, observacao: true, atividade: { select: { codemp: true, codpro: true, seqite: true, estruturaAtividadeId: true } } },
    orderBy: { inicio: "desc" },
  });
  if (sessoes.length === 0) return [];
  const referencias = await carregarReferencias(sessoes.map((s) => s.atividade));
  return sessoes
    .filter((s) => erroDeDescricao(s.observacao, referencias(s.atividade).todas) != null)
    .map((s) => ({ id: s.id, atividadeId: s.atividadeId, codpro: s.atividade.codpro }));
}

export interface PedidoDeMovimentacao {
  atividade: AtividadeComDescricao & { id: number; codfor: number };
  /** Só o próprio consultor é obrigado (e autorizado) a descrever o que fez. */
  souDono: boolean;
  /** A movimentação entra numa raia que conta como execução. */
  abreSessao: boolean;
  /** Descrição digitada para a sessão desta atividade que a movimentação fecha (corpo da requisição). */
  observacao?: unknown;
  /** Descrição da OUTRA atividade em andamento, que este início pausa, e a sessão a que ela pertence. */
  observacaoEmAndamento?: unknown;
  sessaoEmAndamentoId?: unknown;
}

export type DecisaoDeMovimentacao =
  | { recusa: { status: number; corpo: Record<string, unknown> } }
  | { recusa: null; observacaoFechamento: string | null; observacaoDaPausada: { sessaoId: number; texto: string } | null };

const textoDigitado = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");

const recusarDescricao = (erro: string) => ({ recusa: { status: 400, corpo: { codigo: "descricao_invalida", error: erro } } });

/**
 * O que Iniciar, Parar e arrastar o card exigem de descrição antes de acontecer. Quem NÃO é o dono (gestor, admin) movimenta sem
 * descrever nada e o texto que mandar é ignorado: a sessão fica com a nota que o consultor já tinha salvo, ou vazia, e é ele quem descreve
 * (decisão do Vitor, 27/11/2026). O bloqueio por apontamento pendente vale para o consultor da atividade, seja quem for que inicie.
 */
export async function avaliarDescricaoDaMovimentacao(pedido: PedidoDeMovimentacao): Promise<DecisaoDeMovimentacao> {
  const { atividade, souDono, abreSessao } = pedido;
  let observacaoFechamento: string | null = null;
  let observacaoDaPausada: { sessaoId: number; texto: string } | null = null;

  // 1) A movimentação fecha uma sessão desta atividade: o dono precisa descrevê-la (o digitado ou a nota que ele já salvou).
  const sessaoAberta = await prisma.atividadeSessaoExecucao.findFirst({ where: { atividadeId: atividade.id, fim: null } });
  if (sessaoAberta && souDono) {
    const digitado = textoDigitado(pedido.observacao);
    const erro = erroDeDescricao(digitado || sessaoAberta.observacao, (await referenciasDaAtividade(atividade)).todas);
    if (erro) return recusarDescricao(erro);
    observacaoFechamento = digitado || null;
  }

  if (!abreSessao) return { recusa: null, observacaoFechamento, observacaoDaPausada };

  // 2) Vai abrir sessão: o consultor não pode ter apontamento pendente sem descrição.
  const pendentes = await sessoesSemDescricao(atividade.codfor);
  if (pendentes.length > 0) return { recusa: { status: 409, corpo: respostaDescricaoPendente(pendentes.length, souDono) } };

  // 3) Há outra atividade dele em andamento, que vai ser pausada: ele conta o que fez nela ANTES de iniciar a nova.
  if (souDono) {
    const outra = await prisma.atividadeSessaoExecucao.findFirst({
      where: { fim: null, atividadeId: { not: atividade.id }, atividade: { codfor: atividade.codfor } },
      include: { atividade: true },
      orderBy: { inicio: "desc" },
    });
    if (outra) {
      const referencias = await referenciasDaAtividade(outra.atividade);
      const digitado = textoDigitado(pedido.observacaoEmAndamento);
      // O texto só vale para a sessão que o consultor viu: se a que está em andamento mudou, pergunta de novo.
      if (!digitado || Number(pedido.sessaoEmAndamentoId) !== outra.id) {
        return {
          recusa: {
            status: 409,
            corpo: {
              codigo: "descrever_em_andamento",
              error: `Conte o que foi feito na atividade em andamento (proposta ${outra.atividade.codpro}) antes de iniciar outra.`,
              emAndamento: {
                sessaoId: outra.id,
                atividadeId: outra.atividadeId,
                titulo: `Proposta ${outra.atividade.codpro}`,
                descricaoAtividade: referencias.descricaoAtividade,
                itemDescricao: referencias.itemDescricao,
                nota: outra.observacao,
              },
            },
          },
        };
      }
      const erro = erroDeDescricao(digitado, referencias.todas);
      if (erro) return recusarDescricao(erro);
      observacaoDaPausada = { sessaoId: outra.id, texto: digitado };
    }
  }

  return { recusa: null, observacaoFechamento, observacaoDaPausada };
}

/** Corpo do 409 de início bloqueado, para a tela mostrar a mensagem e o botão que leva a Meus Apontamentos. */
export function respostaDescricaoPendente(quantidade: number, souOConsultor: boolean) {
  const quem = souOConsultor ? "Você tem" : "O consultor desta atividade tem";
  const plural = quantidade === 1 ? "apontamento sem descrição" : "apontamentos sem descrição";
  return {
    codigo: "descricao_pendente",
    quantidade,
    souOConsultor,
    error: `${quem} ${quantidade} ${plural}. Descreva o que foi feito em Meus Apontamentos antes de iniciar outra atividade.`,
  };
}
