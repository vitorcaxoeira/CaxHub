// Plano de Evolução Profissional e Eficiência — eficiência apurada pelo ITEM DA PROPOSTA (decisão do Vitor, 15/10/2026).
// Funções PURAS, sem banco. Horas em MINUTOS, como no resto do Painel de Eficiência.
//
// A unidade é o item (orçado = horas vendidas do item, executado = tudo apontado no item), nunca a atividade atribuída ao consultor.
// O item do Senior não tem data de encerramento, então a eficiência do ciclo não usa "tarefa encerrada": cada hora apontada NO CICLO,
// em ordem cronológica, é classificada como DENTRO ou ACIMA do orçado do item, pelo acumulado do item até aquela hora (somando o que
// já tinha sido executado antes do ciclo). O estouro cai em quem apontou depois de o item passar do vendido. É a mesma contabilidade da
// tendência do painel (carregarTendencia em eficienciaDados.ts).
//
//   eficiência = horas dentro ÷ horas executadas      (individual: só as horas do consultor; global: todas as horas da área)
//
// Diferença consciente do texto do regulamento (Σ orçado ÷ Σ executado das tarefas encerradas): esta versão tem teto de 100%.

export interface HoraApontada {
  id: number;
  /** null = apontamento sem consultor: conta no global, não em nenhum individual. */
  codfor: number | null;
  minutos: number;
}

export interface ItemNoCiclo {
  codemp: number;
  codpro: number;
  seqite: number;
  /** Horas vendidas do item, em minutos. */
  vendido: number;
  /** O que o item já tinha executado ANTES do início do ciclo, em minutos. */
  executadoAntes: number;
  /** Apontamentos DENTRO do ciclo, já em ordem cronológica (data, hora inicial, id). */
  horas: HoraApontada[];
}

export interface Acumulado {
  executado: number;
  dentro: number;
  acima: number;
  /** Quantos itens distintos entraram na conta. */
  itens: number;
}

export const acumuladoVazio = (): Acumulado => ({ executado: 0, dentro: 0, acima: 0, itens: 0 });

export interface IndicesDoCiclo {
  global: Acumulado;
  porConsultor: Map<number, Acumulado>;
}

/** Classifica as horas do ciclo de UM item e soma no acumulado global e no de cada consultor. */
export function classificarItem(item: ItemNoCiclo, saida: IndicesDoCiclo): void {
  const vendido = Math.max(0, item.vendido);
  let acumulado = Math.max(0, item.executadoAntes);
  const consultoresDoItem = new Set<number>();
  let teveHora = false;
  for (const h of item.horas) {
    const minutos = Math.max(0, h.minutos);
    if (minutos === 0) continue;
    teveHora = true;
    const dentro = Math.max(0, Math.min(minutos, vendido - acumulado));
    const acima = minutos - dentro;
    acumulado += minutos;

    saida.global.executado += minutos;
    saida.global.dentro += dentro;
    saida.global.acima += acima;
    if (h.codfor != null) {
      const c = saida.porConsultor.get(h.codfor) ?? acumuladoVazio();
      c.executado += minutos;
      c.dentro += dentro;
      c.acima += acima;
      saida.porConsultor.set(h.codfor, c);
      consultoresDoItem.add(h.codfor);
    }
  }
  if (!teveHora) return;
  saida.global.itens++;
  for (const codfor of consultoresDoItem) saida.porConsultor.get(codfor)!.itens++;
}

/** Eficiência global e individual de um conjunto de itens no ciclo. */
export function indicesDoCiclo(itens: ItemNoCiclo[]): IndicesDoCiclo {
  const saida: IndicesDoCiclo = { global: acumuladoVazio(), porConsultor: new Map() };
  for (const item of itens) classificarItem(item, saida);
  return saida;
}

/** dentro ÷ executado, em %, ou null sem horas. */
export const indiceDe = (a: Acumulado): number | null => (a.executado > 0 ? (a.dentro / a.executado) * 100 : null);

export interface VereditoMeta {
  /** Índice em % (null = sem horas). */
  indice: number | null;
  /** true/false se a meta foi atingida; null quando não dá para dizer (sem base ou sem meta). */
  atingiu: boolean | null;
  /** Poucas horas para concluir: devolve "sem base", nunca um 0% falso. */
  semBase: boolean;
}

/**
 * Compara com a meta do ciclo. `amostraMinimaMin`: abaixo disso de horas executadas o resultado é "sem base" (KPI honesto: sem amostra
 * não se reprova nem se aprova ninguém). Meta nula (ciclo ainda sem meta publicada) devolve atingiu=null.
 */
export function avaliarMeta(a: Acumulado, meta: number | null, amostraMinimaMin: number): VereditoMeta {
  const indice = indiceDe(a);
  if (a.executado < amostraMinimaMin || indice == null) return { indice, atingiu: null, semBase: true };
  if (meta == null) return { indice, atingiu: null, semBase: false };
  // Tolerância de 1e-9 só pra não reprovar por ruído de ponto flutuante em 90% exatos.
  return { indice, atingiu: indice + 1e-9 >= meta, semBase: false };
}
