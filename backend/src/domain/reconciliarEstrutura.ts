import { prisma } from "../db/prisma";
import { truncarNomeEstrutura } from "./estruturaAtividadeDominio";
import { SITPRO_ALOCAVEL } from "./propostasDominio";

// O cronograma mostra alocação agrupada por nó da EAP — a consulta é
// `where: { estruturaAtividadeId: { in: nosIds } }` (ver routes/alocacao.ts). Alocação sem
// nó não tem onde aparecer, mesmo contando normalmente no saldo da lista de propostas, que
// agrega por item.
//
// E o Senior não tem como preencher esse campo: `estruturaAtividadeId` é conceito 100%
// CaxHub. Toda alocação que chega pelo `atividadeConsultorSync` nasce órfã. Medido em
// 04/08/2026: 54 órfãs somando 1.810h em 29 propostas alocáveis, uma delas criada no
// mesmo dia — torneira aberta, não dívida histórica.
//
// Esta função é a reconciliação: dá um nó a cada órfã. Roda no fim do sync de atividades
// (onde a órfã nasce, sem janela entre importar e reconciliar) e também pelo script
// prisma/migrarLegadoParaEstrutura.ts, que delega pra cá em vez de manter uma cópia.

export interface OrfaPendente {
  id: number;
  codemp: number;
  codpro: number;
  seqite: number;
  motivo: string;
}

export interface ResultadoReconciliacao {
  /** Órfãs que viraram nó nesta passagem. */
  nosCriados: number;
  /** Propostas tocadas. */
  propostasTocadas: number;
  /** Órfãs elegíveis que não puderam ser reconciliadas agora — ver `motivo`. */
  pendentes: OrfaPendente[];
}

export function resumirReconciliacao(r: ResultadoReconciliacao): string {
  const base = `${r.nosCriados} nó(s) de estrutura criado(s) em ${r.propostasTocadas} proposta(s)`;
  return r.pendentes.length > 0 ? `${base}; ${r.pendentes.length} alocação(ões) aguardando o item chegar` : base;
}

/**
 * Cria um nó `tipo: "atividade"` para cada AtividadeConsultor ativa sem
 * `estruturaAtividadeId`, e amarra o vínculo de volta.
 *
 * Idempotente: só olha órfãs, então rodar de novo não duplica nada.
 */
export async function reconciliarAlocacoesOrfas(): Promise<ResultadoReconciliacao> {
  const orfas = await prisma.atividadeConsultor.findMany({
    where: { sitreg: "A", estruturaAtividadeId: null },
    orderBy: [{ codemp: "asc" }, { codpro: "asc" }, { id: "asc" }],
  });
  if (orfas.length === 0) return { nosCriados: 0, propostasTocadas: 0, pendentes: [] };

  const chaves = [...new Set(orfas.map((a) => `${a.codemp}-${a.codpro}`))];
  const paraChave = (c: string) => {
    const [codemp, codpro] = c.split("-").map(Number);
    return { codemp, codpro };
  };

  // Recorte 1: só proposta que as telas de alocação abrem. Das 1.495 órfãs da base, 1.441
  // estão em proposta fora de SITPRO_ALOCAVEL — criar nó pra elas seria lixo em tabela.
  //
  // Como esta função varre TODAS as órfãs a cada passagem do sync, a proposta que virar
  // alocável depois é reconciliada sozinha na passagem seguinte. É o que faz o recorte não
  // deixar buraco.
  const propostas = await prisma.proposta.findMany({
    where: { OR: chaves.map(paraChave) },
    select: { codemp: true, codpro: true, sitpro: true },
  });
  const alocaveis = new Set(
    propostas.filter((p) => p.sitpro != null && SITPRO_ALOCAVEL.includes(p.sitpro)).map((p) => `${p.codemp}-${p.codpro}`)
  );

  // Recorte 2: proposta marcada explicitamente como "por item" não vira EAP por conta
  // própria — seria desfazer uma escolha de quem configurou. Hoje são zero na base; a
  // guarda existe pro dia em que não forem.
  const modoItem = new Set(
    (await prisma.propostaModoAlocacao.findMany({ where: { modo: "item" }, select: { codemp: true, codpro: true } })).map(
      (m) => `${m.codemp}-${m.codpro}`
    )
  );

  const elegiveis = orfas.filter((a) => {
    const chave = `${a.codemp}-${a.codpro}`;
    return alocaveis.has(chave) && !modoItem.has(chave);
  });
  if (elegiveis.length === 0) return { nosCriados: 0, propostasTocadas: 0, pendentes: [] };

  // Nome e seqite do nó saem do item; sem ele não há nó a criar.
  const itens = await prisma.propostaItem.findMany({
    where: { OR: elegiveis.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite })) },
    select: { codemp: true, codpro: true, seqite: true, despro: true, codser: true },
  });
  const itemPorChave = new Map(itens.map((i) => [`${i.codemp}-${i.codpro}-${i.seqite}`, i]));

  // `ordem` continua de onde os nós existentes do item pararam, pra alocação nova não
  // nascer empilhada em cima das antigas.
  const ordemPorItem = new Map<string, number>();
  for (const n of await prisma.estruturaAtividade.findMany({
    where: { OR: elegiveis.map((a) => ({ codemp: a.codemp, codpro: a.codpro, seqite: a.seqite })) },
    select: { codemp: true, codpro: true, seqite: true, ordem: true },
  })) {
    const chave = `${n.codemp}-${n.codpro}-${n.seqite}`;
    ordemPorItem.set(chave, Math.max(ordemPorItem.get(chave) ?? -1, n.ordem));
  }

  const pendentes: OrfaPendente[] = [];
  const propostasTocadas = new Set<string>();
  let nosCriados = 0;

  for (const a of elegiveis) {
    const chaveItem = `${a.codemp}-${a.codpro}-${a.seqite}`;
    const item = itemPorChave.get(chaveItem);
    if (!item) {
      // O item ainda não chegou do Senior. O registry roda Itens de Proposta ANTES de
      // Atividades por Consultor, então isto é raro e se resolve na próxima passagem —
      // mas vai contado pro log, em vez de sumir num console.warn.
      pendentes.push({ id: a.id, codemp: a.codemp, codpro: a.codpro, seqite: a.seqite, motivo: "PropostaItem ainda não importado" });
      continue;
    }

    const proximaOrdem = (ordemPorItem.get(chaveItem) ?? -1) + 1;
    ordemPorItem.set(chaveItem, proximaOrdem);

    await prisma.$transaction(async (tx) => {
      const no = await tx.estruturaAtividade.create({
        data: {
          codemp: a.codemp,
          codpro: a.codpro,
          seqite: a.seqite,
          parentId: null,
          tipo: "atividade",
          nome: truncarNomeEstrutura(item.despro ?? item.codser ?? `Item ${a.seqite}`),
          ordem: proximaOrdem,
          // `qtdhor` inválido NÃO descarta a alocação, diferente do script antigo:
          // descartar aqui significa mantê-la invisível, que é o que esta função existe
          // pra impedir. O "Alocado" da tela sai do qtdhor da alocação, não daqui.
          duracaoHoras: a.qtdhor != null && a.qtdhor > 0 ? a.qtdhor : null,
          responsavelCodfor: a.codfor,
          dataPrevistaInicio: a.dataPrevistaInicio,
          dataPrevistaFim: a.dataPrevistaFim,
        },
      });
      // `estruturaAtividadeId: null` no where: se duas execuções se cruzarem, a segunda
      // não sobrescreve um vínculo recém-criado pela primeira.
      const { count } = await tx.atividadeConsultor.updateMany({
        where: { id: a.id, estruturaAtividadeId: null },
        data: { estruturaAtividadeId: no.id },
      });
      if (count === 0) {
        // Alguém amarrou entre a leitura e agora — desfaz o nó órfão que acabei de criar.
        await tx.estruturaAtividade.delete({ where: { id: no.id } });
        return;
      }
      nosCriados++;
      propostasTocadas.add(`${a.codemp}-${a.codpro}`);
    });
  }

  return { nosCriados, propostasTocadas: propostasTocadas.size, pendentes };
}
