import { AtividadeConsultor } from "@prisma/client";
import { prisma } from "../db/prisma";
import { SITRAT_CANCELADO } from "./ratDominio";

// Teto de apontamento de uma atividade e quanto dele já foi consumido.
//
// Mora aqui, e não na rota, porque três lugares dependem da MESMA conta: o card do quadro
// (que mostra "realizado / teto"), a validação que barra a confirmação acima do teto, e a
// varredura que para a execução ao encostar nele. Se a conta divergir, o consultor vê
// "18:00 de 20:00" na tela e leva um bloqueio dizendo que já passou.

// Minutos. `qtdhor` é o planejado (nunca alterado) e `horasExcedentes` é a folga que o
// gestor autorizou por cima dele.
export function tetoDaAtividade(atividade: Pick<AtividadeConsultor, "qtdhor" | "horasExcedentes">): number {
  return (atividade.qtdhor ?? 0) + atividade.horasExcedentes;
}

// "Realizado" = sessões de execução fechadas mas ainda NÃO confirmadas + duração dos
// RatItem já confirmados/sincronizados, EXCETO o de uma RAT cancelada (sitrat=5) — RAT
// cancelada não é trabalho realizado, mesmo com horini/horfim preenchidos. Uma sessão
// confirmada tem `ratItemId` preenchido, então sai da conta de sessões e passa a contar
// via RatItem — nunca as duas ao mesmo tempo, senão a mesma hora entraria duas vezes.
//
// Mesma definição de horasRealizadasDaAtividade em routes/atividades.ts, que calcula em
// lote pra árvore inteira; esta versão é pontual, pra uma atividade só.
//
// Sessão ABERTA (fim: null) fica de fora de propósito: o tempo dela ainda está correndo e
// não é realizado, é o que a varredura de parada automática projeta em cima deste número.
export async function realizadoDaAtividade(atividade: Pick<AtividadeConsultor, "id" | "seqati">): Promise<number> {
  const porId = await realizadoDasAtividades([atividade]);
  return porId.get(atividade.id) ?? 0;
}

// Versão em lote de realizadoDaAtividade — a MESMA conta, em 2 queries pro conjunto inteiro
// (nunca 1 por atividade). É a única implementação: a pontual acima só chama esta com um
// item, pra a regra não ter cópia que possa divergir.
export async function realizadoDasAtividades(
  atividades: Pick<AtividadeConsultor, "id" | "seqati">[]
): Promise<Map<number, number>> {
  const resultado = new Map<number, number>();
  if (atividades.length === 0) return resultado;

  const ids = atividades.map((a) => a.id);
  // `> 0n`, não só `!= null`: seqati=0 não é um seqAti real — ver mesmo comentário em
  // routes/alocacao.ts e routes/atividades.ts. Uma atividade com seqati=0 buscaria aqui
  // TODO RatItem de seqati=0 do banco inteiro, não só os dela.
  const seqatis = atividades.filter((a) => a.seqati != null && a.seqati > 0n).map((a) => a.seqati as bigint);

  const [sessoes, ratItens] = await Promise.all([
    prisma.atividadeSessaoExecucao.findMany({
      where: { atividadeId: { in: ids }, confirmada: false, fim: { not: null }, excluidaEm: null },
      select: { atividadeId: true, inicio: true, fim: true },
    }),
    seqatis.length > 0
      ? prisma.ratItem.findMany({
          where: {
            seqati: { in: seqatis },
            horini: { not: null },
            horfim: { not: null },
            rat: { sitrat: { not: SITRAT_CANCELADO } },
          },
          select: { seqati: true, horini: true, horfim: true },
        })
      : Promise.resolve([]),
  ]);

  // Acumula em MILISSEGUNDOS e arredonda UMA vez, no total. Arredondar sessão a sessão
  // descartava até 30s de cada uma, e zerava por completo as de menos de 30s: três starts
  // curtos somavam 0 minuto. Agora três sessões de 25s somam 1 minuto, como deve ser.
  const msPorAtividade = new Map<number, number>();
  for (const s of sessoes) {
    if (s.fim == null) continue;
    msPorAtividade.set(s.atividadeId, (msPorAtividade.get(s.atividadeId) ?? 0) + (s.fim.getTime() - s.inicio.getTime()));
  }
  // RatItem já vem em minutos inteiros (horini/horfim são a granularidade do Senior), então
  // entra como está — não há segundo a preservar aqui.
  const minutosRatPorSeqati = new Map<bigint, number>();
  for (const r of ratItens) {
    if (r.seqati == null || r.horini == null || r.horfim == null) continue;
    minutosRatPorSeqati.set(r.seqati, (minutosRatPorSeqati.get(r.seqati) ?? 0) + (r.horfim - r.horini));
  }

  for (const a of atividades) {
    const minutosSessoes = Math.round((msPorAtividade.get(a.id) ?? 0) / 60000);
    const minutosRat = a.seqati != null && a.seqati > 0n ? minutosRatPorSeqati.get(a.seqati) ?? 0 : 0;
    resultado.set(a.id, minutosSessoes + minutosRat);
  }
  return resultado;
}

// Minutos que os pedidos PENDENTES da atividade ainda vão consumir se aprovados. Não entram
// em `realizado` (a sessão só nasce na aprovação), então sem isto vários pedidos que cabem
// um de cada vez passariam, juntos, do teto.
//
// Pedido de apontamento reserva a duração inteira. Pedido de ajuste reserva só o que passa
// da duração atual da sessão (um ajuste que ENCURTA não libera saldo antes de aprovado).
// `ignorarAjusteDaSessaoId` tira da soma o pedido de ajuste da própria sessão que está sendo
// (re)avaliada, pra não contar a mesma hora duas vezes.
export async function minutosReservadosPendentes(
  atividadeId: number,
  opcoes: { ignorarAjusteDaSessaoId?: number } = {}
): Promise<number> {
  const [apontamentos, ajustes] = await Promise.all([
    prisma.solicitacaoApontamento.findMany({
      where: { atividadeId, status: "pendente" },
      select: { inicioSolicitado: true, fimSolicitado: true },
    }),
    prisma.solicitacaoAjusteApontamento.findMany({
      where: {
        status: "pendente",
        sessao: { atividadeId },
        ...(opcoes.ignorarAjusteDaSessaoId != null ? { sessaoId: { not: opcoes.ignorarAjusteDaSessaoId } } : {}),
      },
      select: { inicioSolicitado: true, fimSolicitado: true, sessao: { select: { inicio: true, fim: true } } },
    }),
  ]);

  let minutos = 0;
  for (const p of apontamentos) {
    minutos += Math.round((p.fimSolicitado.getTime() - p.inicioSolicitado.getTime()) / 60000);
  }
  for (const a of ajustes) {
    const pedido = Math.round((a.fimSolicitado.getTime() - a.inicioSolicitado.getTime()) / 60000);
    const atual = a.sessao.fim ? Math.round((a.sessao.fim.getTime() - a.sessao.inicio.getTime()) / 60000) : 0;
    minutos += Math.max(0, pedido - atual);
  }
  return minutos;
}

export interface SaldoAtividade {
  teto: number;
  realizado: number;
  // Pode ser negativo: a base já tem apontamento anterior a esta regra, e o Senior também
  // sincroniza RatItem que nasceram fora do CaxHub.
  saldo: number;
}

export async function saldoDaAtividade(
  atividade: Pick<AtividadeConsultor, "id" | "seqati" | "qtdhor" | "horasExcedentes">
): Promise<SaldoAtividade> {
  const teto = tetoDaAtividade(atividade);
  const realizado = await realizadoDaAtividade(atividade);
  return { teto, realizado, saldo: teto - realizado };
}

// A partir de quanto do teto consumido a entrada em execução já vem com aviso. 80% é o
// mesmo limiar que colore a barra do card em âmbar (frontend/src/lib/consumoHoras.ts) —
// se divergissem, o card ficaria amarelo sem avisar nada, ou avisaria com a barra azul.
export const LIMIAR_AVISO_TETO = 0.8;

export interface EntradaEmExecucao {
  // false = o teto já foi consumido; a atividade não pode entrar em execução.
  permitida: boolean;
  // Presente quando há algo a dizer: o motivo do bloqueio, ou o aviso de que está perto.
  mensagem: string | null;
  saldo: number;
  teto: number;
}

// Decide se uma atividade pode ENTRAR em execução, e com que recado. Vale tanto pro botão
// Iniciar quanto pro arrasto do card pra uma raia que conta como execução — os dois abrem
// sessão, então os dois têm que responder igual.
//
// Atividade sem teto (nada alocado) passa sem aviso: barrar aqui impediria de trabalhar
// numa atividade ainda não dimensionada, que é justamente quando se descobre o tamanho.
export async function avaliarEntradaEmExecucao(
  atividade: Pick<AtividadeConsultor, "id" | "seqati" | "qtdhor" | "horasExcedentes">
): Promise<EntradaEmExecucao> {
  const { teto, realizado, saldo } = await saldoDaAtividade(atividade);
  if (teto <= 0) return { permitida: true, mensagem: null, saldo, teto };

  if (saldo <= 0) {
    return {
      permitida: false,
      mensagem: `Esta atividade já consumiu o teto de ${formatarMinutos(teto)} (alocado + excedentes) — ${formatarMinutos(realizado)} realizados. Peça ao gestor pra liberar horas excedentes antes de continuar.`,
      saldo,
      teto,
    };
  }

  if (realizado / teto >= LIMIAR_AVISO_TETO) {
    return {
      permitida: true,
      mensagem: `Restam ${formatarMinutos(saldo)} de ${formatarMinutos(teto)} nesta atividade. Se precisar de mais tempo, solicite horas excedentes ao gestor.`,
      saldo,
      teto,
    };
  }

  return { permitida: true, mensagem: null, saldo, teto };
}

// "20:30" a partir de minutos — usado nas mensagens de bloqueio, que precisam dizer o
// número exato pra pessoa conseguir ajustar o horário e caber no saldo.
export function formatarMinutos(minutos: number): string {
  const sinal = minutos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutos));
  return `${sinal}${Math.trunc(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
