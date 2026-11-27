import { somarReais } from "./descontos";
import { descontosPorCompetencia } from "./descontosDados";
import { feriasPagasNasCompetencias } from "./feriasNota";
import { bonificacoesNasCompetencias } from "./bonificacaoNota";
import { totalDoContratoFixo, type ContratoFixo } from "./contratoFixo";
import { diasUteisLiquidos } from "./calendarioTrabalho";
import { diaBrasilComoData } from "./fusoBrasil";
import { FATOR_HORA_DESLOCAMENTO, carregarAbonos, deslocamentoNoPeriodo, diasInteirosAbonados, horasRealizadasNoPeriodo, type ValorHoraConsultor } from "./resumoConsultor";

// Financeiro de um consultor num mês: a "nota do mês" que a Home mostra no card de valor (um consultor por vez) e que a aba Provisionamento lista
// para todos. A conta de ganho e projeção (`ganhoDoMes`) e a do líquido (`liquidoDaNota`) moram aqui e são usadas pelos dois, para não divergirem.

const centavos = (v: number) => Math.round(v * 100) / 100;

export interface EntradaGanho {
  vlrhor: number;
  /** Minutos realizados do início do mês até hoje. */
  minutosAteHoje: number;
  /** Dias úteis (sem férias e folgas de dia inteiro) até hoje e no mês inteiro. */
  diasUteisPassados: number;
  diasUteisTotais: number;
  deslocamentoAteHojeMinutos: number;
  deslocamentoMinutos: number;
}

/**
 * Ganho até agora e projeção de UM mês (contrato por hora). A projeção extrapola a média de minutos por dia útil já passado para os dias úteis do
 * mês inteiro. Hora de deslocamento vale metade e NÃO é extrapolada: no ganho entra o lançado até hoje; na projeção, o lançado no mês inteiro.
 */
export function ganhoDoMes(e: EntradaGanho): { ganho: number; projecao: number; projecaoMinutos: number } {
  const media = e.diasUteisPassados > 0 ? e.minutosAteHoje / e.diasUteisPassados : 0;
  const projecaoMinutos = media * e.diasUteisTotais;
  const vlrDeslocamento = e.vlrhor * FATOR_HORA_DESLOCAMENTO;
  return {
    ganho: (e.vlrhor * e.minutosAteHoje) / 60 + (vlrDeslocamento * e.deslocamentoAteHojeMinutos) / 60,
    projecao: (e.vlrhor * projecaoMinutos) / 60 + (vlrDeslocamento * e.deslocamentoMinutos) / 60,
    projecaoMinutos,
  };
}

/** O mês anterior ao pedido (janeiro volta para dezembro do ano anterior). */
export const mesAnteriorDe = (ano: number, mes: number) => (mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 });

/** Líquido da nota: bruto + o que soma (férias, bonificação) − descontos, sem passar de zero (a mesma regra do card da Home). */
export const liquidoDaNota = (bruto: number, soma: number, descontos: number) => Math.max(0, centavos(bruto + soma - descontos));

export interface ValoresDoMes {
  minutosAteHoje: number;
  deslocamentoMinutos: number;
  deslocamentoValor: number;
  realizado: number;
  projecao: number;
  ferias: number;
  /** Férias que entram no líquido até agora: só quando o mês já começou. */
  feriasAteAgora: number;
  bonificacao: number;
  descontos: number;
  liquidoAteAgora: number;
  liquidoProjetado: number;
}

export interface EntradaValoresDoMes extends EntradaGanho {
  /** Contrato de valor fixo, quando é o caso: o realizado e a projeção passam a ser o fixo do mês + deslocamento (o card "Valor fixo" da Home). */
  fixo: ContratoFixo | null;
  ferias: number;
  mesIniciado: boolean;
  bonificacao: number;
  descontos: number;
}

/** Monta a linha financeira do mês a partir dos números já lidos (pura, testável). */
export function valoresDoMes(e: EntradaValoresDoMes): ValoresDoMes {
  const deslocamentoValor = (e.vlrhor * FATOR_HORA_DESLOCAMENTO * e.deslocamentoMinutos) / 60;
  const porHora = ganhoDoMes(e);
  const totalFixo = e.fixo ? totalDoContratoFixo(e.fixo, 1, deslocamentoValor).total : null;
  const realizado = centavos(totalFixo ?? porHora.ganho);
  const projecao = centavos(totalFixo ?? porHora.projecao);
  const feriasAteAgora = e.mesIniciado ? e.ferias : 0;
  return {
    minutosAteHoje: e.minutosAteHoje,
    deslocamentoMinutos: e.deslocamentoMinutos,
    deslocamentoValor: centavos(deslocamentoValor),
    realizado,
    projecao,
    ferias: e.ferias,
    feriasAteAgora,
    bonificacao: e.bonificacao,
    descontos: e.descontos,
    liquidoAteAgora: liquidoDaNota(realizado, feriasAteAgora + e.bonificacao, e.descontos),
    liquidoProjetado: liquidoDaNota(projecao, e.ferias + e.bonificacao, e.descontos),
  };
}

/** Lê do banco tudo o que forma a nota do mês de um consultor COM contrato (as mesmas fontes do GET /dashboard/meu-resumo). */
export async function financeiroDoMes(
  codemp: number,
  codfor: number,
  ano: number,
  mes: number,
  contrato: ValorHoraConsultor,
  agora: Date = new Date()
): Promise<ValoresDoMes & { descontosPrevistos: boolean }> {
  const de = new Date(Date.UTC(ano, mes - 1, 1));
  const ate = new Date(Date.UTC(ano, mes, 0));
  // O "hoje" é o dia de Brasília; o realizado só olha até hoje.
  const hoje = diaBrasilComoData(agora);
  const ateHoje = hoje.getTime() < ate.getTime() ? hoje : ate;

  const abonos = await carregarAbonos(codemp, codfor, de, ate);
  const diasAbonados = diasInteirosAbonados(abonos);
  const [horas, deslocamento, ferias, bonificacao, descontos] = await Promise.all([
    horasRealizadasNoPeriodo(codemp, codfor, de, ateHoje),
    deslocamentoNoPeriodo(codemp, codfor, de, ate),
    feriasPagasNasCompetencias(codemp, codfor, [de]),
    bonificacoesNasCompetencias(codemp, codfor, [de]),
    descontosPorCompetencia(codemp, codfor, [de]),
  ]);
  const somaMinutos = (lista: { minutos: number }[]) => lista.reduce((s, d) => s + d.minutos, 0);

  return {
    ...valoresDoMes({
      vlrhor: contrato.vlrhor,
      fixo: contrato.fixo,
      minutosAteHoje: horas.totalMinutos,
      diasUteisPassados: diasUteisLiquidos(de, ateHoje, diasAbonados),
      diasUteisTotais: diasUteisLiquidos(de, ate, diasAbonados),
      deslocamentoAteHojeMinutos: somaMinutos(deslocamento.filter((d) => d.data.getTime() <= ateHoje.getTime())),
      deslocamentoMinutos: somaMinutos(deslocamento),
      ferias: ferias.total,
      mesIniciado: de.getTime() <= hoje.getTime(),
      bonificacao: bonificacao.total,
      descontos: somarReais(descontos.map((c) => c.total)),
    }),
    // Competência ainda não fechada: o desconto é a previsão das parcelas pendentes.
    descontosPrevistos: descontos.some((c) => !c.fechada && c.itens.length > 0),
  };
}
