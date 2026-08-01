import { AtividadeConsultor } from "@prisma/client";
import { prisma } from "../db/prisma";

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
// RatItem já confirmados/sincronizados. Uma sessão confirmada tem `ratItemId` preenchido,
// então sai da conta de sessões e passa a contar via RatItem — nunca as duas ao mesmo
// tempo, senão a mesma hora entraria duas vezes.
//
// Mesma definição de horasRealizadasDaAtividade em routes/atividades.ts, que calcula em
// lote pra árvore inteira; esta versão é pontual, pra uma atividade só.
//
// Sessão ABERTA (fim: null) fica de fora de propósito: o tempo dela ainda está correndo e
// não é realizado, é o que a varredura de parada automática projeta em cima deste número.
export async function realizadoDaAtividade(atividade: Pick<AtividadeConsultor, "id" | "seqati">): Promise<number> {
  const [sessoes, ratItens] = await Promise.all([
    prisma.atividadeSessaoExecucao.findMany({
      where: { atividadeId: atividade.id, confirmada: false, fim: { not: null } },
      select: { inicio: true, fim: true },
    }),
    atividade.seqati != null
      ? prisma.ratItem.findMany({
          where: { seqati: atividade.seqati, horini: { not: null }, horfim: { not: null } },
          select: { horini: true, horfim: true },
        })
      : Promise.resolve([]),
  ]);

  let minutos = 0;
  for (const s of sessoes) {
    if (s.fim == null) continue;
    minutos += Math.round((s.fim.getTime() - s.inicio.getTime()) / 60000);
  }
  for (const r of ratItens) {
    if (r.horini == null || r.horfim == null) continue;
    minutos += r.horfim - r.horini;
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

// "20:30" a partir de minutos — usado nas mensagens de bloqueio, que precisam dizer o
// número exato pra pessoa conseguir ajustar o horário e caber no saldo.
export function formatarMinutos(minutos: number): string {
  const sinal = minutos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutos));
  return `${sinal}${Math.trunc(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
