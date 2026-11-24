// Contas do controle de férias dos consultores PJ (13/11/2026), reproduzindo a planilha "Simulação Férias PJs". Funções puras (sem banco), com teste.
//
//   saldo do período aquisitivo = dias de direito (corridos) - dias corridos dos gozos não cancelados - folgas de dia inteiro marcadas para descontar
//   valor das férias            = dias úteis do gozo x horas/dia x média do % trabalhado x valor-hora   (pago na nota do mês)
//   média do % trabalhado       = média simples do % de cada mês = horas trabalhadas / (dias úteis do mês x horas/dia), até 12 meses antes do gozo,
//                                 a partir do primeiro mês com horas (a planilha começa no mês da admissão)
//
// Dias úteis = segunda a sexta menos os feriados NACIONAIS (conferido contra a planilha: 11/2025 = 19, 12/2025 = 22, 04/2023 = 18; Carnaval e Corpus Christi
// não são descontados).

import { chaveDia, diasDoPeriodo } from "./calendarioTrabalho";

/** Horas por dia útil que a planilha considera (8h30). Padrão quando a jornada do consultor não diz outra coisa. */
export const HORAS_DIA_PADRAO = 8.5;
/** Quantos meses antes do gozo entram na média do % trabalhado. */
export const MESES_DA_MEDIA = 12;

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher), em UTC. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Feriados nacionais do ano (YYYY-MM-DD): os fixos mais a Sexta-feira Santa. O Dia da Consciência Negra (20/11) é nacional desde 2024. */
export function feriadosNacionais(ano: number): Set<string> {
  const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];
  if (ano >= 2024) fixos.push("11-20");
  const lista = fixos.map((md) => `${ano}-${md}`);
  const sextaSanta = pascoa(ano);
  sextaSanta.setUTCDate(sextaSanta.getUTCDate() - 2);
  lista.push(chaveDia(sextaSanta));
  return new Set(lista);
}

/** Dias úteis (seg–sex, fora feriado nacional) de `de` a `ate`, inclusive. */
export function diasUteisDoPeriodo(de: Date, ate: Date): number {
  const feriados = new Map<number, Set<string>>();
  return diasDoPeriodo(de, ate).filter((dia) => {
    const dow = new Date(`${dia}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const ano = Number(dia.slice(0, 4));
    if (!feriados.has(ano)) feriados.set(ano, feriadosNacionais(ano));
    return !feriados.get(ano)!.has(dia);
  }).length;
}

/** Dias úteis do mês (mes 1–12). */
export function diasUteisDoMes(ano: number, mes: number): number {
  return diasUteisDoPeriodo(new Date(Date.UTC(ano, mes - 1, 1)), new Date(Date.UTC(ano, mes, 0)));
}

/** Dias corridos de `inicio` a `fim`, inclusive nos dois extremos. */
export function diasCorridosEntre(inicio: Date, fim: Date): number {
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((dia(fim) - dia(inicio)) / 86_400_000) + 1;
}

export interface SaldoDoAquisitivo {
  diasDireito: number;
  /** Dias corridos dos gozos não cancelados. */
  diasGozados: number;
  /** Folgas de dia inteiro que o consultor marcou para descontar (1 dia cada). */
  diasFolgaDescontada: number;
  saldo: number;
}

export function saldoDoAquisitivo(
  diasDireito: number,
  gozos: { diasCorridos: number; situacao: string }[],
  folgasDescontadas: number,
): SaldoDoAquisitivo {
  const diasGozados = gozos.filter((g) => g.situacao !== "cancelada").reduce((soma, g) => soma + g.diasCorridos, 0);
  return { diasDireito, diasGozados, diasFolgaDescontada: folgasDescontadas, saldo: diasDireito - diasGozados - folgasDescontadas };
}

/**
 * Os meses que entram na média do % trabalhado de um gozo que começa em `inicioGozo`: até MESES_DA_MEDIA meses completos ANTES do mês do gozo, e nunca antes
 * do primeiro mês com horas (`primeiroMesComHoras`). Em ordem cronológica. Sem horas anteriores, lista vazia.
 */
export function mesesDaMedia(inicioGozo: Date, primeiroMesComHoras: { ano: number; mes: number } | null): { ano: number; mes: number }[] {
  if (!primeiroMesComHoras) return [];
  const indice = (ano: number, mes: number) => ano * 12 + (mes - 1);
  const fim = indice(inicioGozo.getUTCFullYear(), inicioGozo.getUTCMonth() + 1) - 1; // o mês anterior ao do gozo
  const inicio = Math.max(fim - MESES_DA_MEDIA + 1, indice(primeiroMesComHoras.ano, primeiroMesComHoras.mes));
  const meses: { ano: number; mes: number }[] = [];
  for (let i = inicio; i <= fim; i++) meses.push({ ano: Math.floor(i / 12), mes: (i % 12) + 1 });
  return meses;
}

/** Média simples do % trabalhado: horas do mês / (dias úteis do mês x horas/dia), de cada mês. Sem meses, 1 (100%): não há histórico para reduzir nem aumentar. */
export function mediaPctTrabalhado(meses: { ano: number; mes: number; minutos: number }[], horasDia = HORAS_DIA_PADRAO): number {
  if (meses.length === 0) return 1;
  const pcts = meses.map((m) => {
    const base = diasUteisDoMes(m.ano, m.mes) * horasDia;
    return base > 0 ? m.minutos / 60 / base : 0;
  });
  return pcts.reduce((soma, p) => soma + p, 0) / pcts.length;
}

export interface ValorDasFerias {
  /** diasUteis x horasDia x mediaPct, em horas (2 casas). */
  horasFerias: number;
  /** horasFerias (sem arredondar) x valorHora, em reais (centavos). */
  valorFerias: number;
}

export function valorDasFerias(params: { diasUteis: number; horasDia: number; mediaPct: number; valorHora: number }): ValorDasFerias {
  const horas = params.diasUteis * params.horasDia * params.mediaPct;
  return { horasFerias: centavos(horas), valorFerias: centavos(horas * params.valorHora) };
}

/** Primeiro dia útil (seg–sex, fora feriado nacional) DEPOIS de `fim`: o retorno ao trabalho que o aviso de férias informa. */
export function proximoDiaUtil(fim: Date): Date {
  const d = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate() + 1));
  while (diasUteisDoPeriodo(d, d) === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
