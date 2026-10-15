import type { PropostaCalculada } from "./eficienciaPropostas";

// Eficiência financeira do Painel de Eficiência. Funções PURAS sobre as propostas já calculadas (mesmos recortes, ignorados e modo de
// estouro do resto da tela; nada de consulta nova).
//
// BASE: valor-hora de VENDA do item (propostas_itens.valhor), em R$. NÃO é faturamento (a NF só se liga ao projeto, não à proposta)
// nem custo (só 30% dos consultores têm valor-hora cadastrado). Item sem valor-hora fica com valor zero.
//
//   valorVendido   = horas vendidas   × valor-hora
//   valorExecutado = horas executadas × valor-hora
//   valorAcima     = o estouro em R$ (o `impacto` da proposta: por item, ou pela proposta no valor-hora médio, conforme o modo)
//   valorDentro    = valorExecutado − valorAcima   (o que as horas executadas "renderam" dentro do vendido)
//   eficiência financeira = valorDentro ÷ valorExecutado   (difere da de horas: estourar um item caro pesa mais que um barato)

export interface LinhaFinanceira {
  valorVendido: number;
  valorExecutado: number;
  valorDentro: number;
  valorAcima: number;
  valorSaldo: number;
  /** Parte do valor vendido em itens sem faturamento direto (N, C, H, I). */
  valorSemFaturamento: number;
  /** valorExecutado ÷ valorVendido (null = executou sem ter vendido). */
  consumo: number | null;
  /** valorDentro ÷ valorExecutado (null = nada executado). */
  eficiencia: number | null;
  /** R$ por hora EXECUTADA que ficou dentro do vendido (valorDentro ÷ horas executadas). */
  receitaPorHora: number | null;
  /** R$ por hora VENDIDA em média (valorVendido ÷ horas vendidas): a régua pra comparar com a receita por hora executada. */
  valorHoraVendido: number | null;
}

interface Acumulado {
  valorVendido: number;
  valorExecutado: number;
  valorAcima: number;
  valorSaldo: number;
  valorSemFaturamento: number;
  minutosVendidos: number;
  minutosExecutados: number;
}

const vazio = (): Acumulado => ({ valorVendido: 0, valorExecutado: 0, valorAcima: 0, valorSaldo: 0, valorSemFaturamento: 0, minutosVendidos: 0, minutosExecutados: 0 });

function somar(a: Acumulado, p: PropostaCalculada): Acumulado {
  a.valorVendido += p.valorVendido;
  a.valorExecutado += p.valorExecutado;
  a.valorAcima += p.impacto;
  a.valorSaldo += p.valorSaldo;
  a.valorSemFaturamento += p.valorSemFaturamento;
  a.minutosVendidos += p.vendido;
  a.minutosExecutados += p.executado;
  return a;
}

function fechar(a: Acumulado): LinhaFinanceira {
  // O estouro nunca passa do que foi executado (no modo "pela proposta" o valor-hora médio pode, em itens muito diferentes, exceder).
  const valorAcima = Math.min(a.valorAcima, a.valorExecutado);
  const valorDentro = Math.max(0, a.valorExecutado - valorAcima);
  return {
    valorVendido: a.valorVendido,
    valorExecutado: a.valorExecutado,
    valorDentro,
    valorAcima,
    valorSaldo: a.valorSaldo,
    valorSemFaturamento: a.valorSemFaturamento,
    consumo: a.valorVendido > 0 ? a.valorExecutado / a.valorVendido : a.valorExecutado > 0 ? null : 0,
    eficiencia: a.valorExecutado > 0 ? valorDentro / a.valorExecutado : null,
    receitaPorHora: a.minutosExecutados > 0 ? valorDentro / (a.minutosExecutados / 60) : null,
    valorHoraVendido: a.minutosVendidos > 0 ? a.valorVendido / (a.minutosVendidos / 60) : null,
  };
}

export const financeiroDaProposta = (p: PropostaCalculada): LinhaFinanceira => fechar(somar(vazio(), p));

export const resumirFinanceiro = (propostas: PropostaCalculada[]): LinhaFinanceira => fechar(propostas.reduce(somar, vazio()));

export interface ClienteFinanceiro extends LinhaFinanceira {
  codcli: number;
  cliente: string;
  interna: boolean;
  propostas: number;
}

export function financeiroPorCliente(propostas: PropostaCalculada[]): ClienteFinanceiro[] {
  const mapa = new Map<number, { codcli: number; cliente: string; interna: boolean; propostas: number; acc: Acumulado }>();
  for (const p of propostas) {
    const c = mapa.get(p.codcli) ?? { codcli: p.codcli, cliente: p.cliente, interna: p.interna, propostas: 0, acc: vazio() };
    c.propostas++;
    somar(c.acc, p);
    mapa.set(p.codcli, c);
  }
  return [...mapa.values()].map(({ acc, ...c }) => ({ ...c, ...fechar(acc) }));
}
