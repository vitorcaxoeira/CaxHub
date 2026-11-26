// Contas do controle de férias dos consultores PJ (13/11/2026), reproduzindo a planilha "Simulação Férias PJs". Funções puras (sem banco), com teste.
//
//   saldo do período aquisitivo = dias de direito (corridos) - dias corridos dos gozos não cancelados - folgas de dia inteiro marcadas para descontar
//   valor das férias            = dias úteis do gozo x horas/dia x média do % trabalhado x valor-hora   (pago na nota do mês)
//   média do % trabalhado       = média simples do % dos 12 meses FECHADOS antes do mês de início das férias (sempre 12)
//   % de um mês                 = horas executadas / (dias úteis disponíveis do mês x horas/dia)
//   dias úteis disponíveis      = seg–sex menos feriados nacionais por padrão; o gestor ajusta cada mês. Mês com 0 dias fica fora da média.
//                                 Por padrão, meses antes do primeiro mês com horas valem 0 (o consultor ainda não trabalhava).
//
// Feriados nacionais (conferido contra a planilha: 11/2025 = 19, 12/2025 = 22, 04/2023 = 18; Carnaval e Corpus Christi não são descontados).

import { chaveDia, diasDoPeriodo } from "./calendarioTrabalho";

/** Horas por dia útil que a planilha considera (8h30). Padrão quando a jornada do consultor não diz outra coisa. */
export const HORAS_DIA_PADRAO = 8.5;
/** Quantos meses fechados antes do mês do gozo entram na média do % trabalhado. */
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

/** Feriados nacionais do ano (YYYY-MM-DD -> nome): os fixos mais a Sexta-feira Santa. O Dia da Consciência Negra (20/11) é nacional desde 2024. */
export function feriadosNacionaisNomeados(ano: number): Map<string, string> {
  const fixos: [string, string][] = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["12-25", "Natal"],
  ];
  if (ano >= 2024) fixos.push(["11-20", "Dia da Consciência Negra"]);
  const mapa = new Map(fixos.map(([md, nome]) => [`${ano}-${md}`, nome]));
  const sextaSanta = pascoa(ano);
  sextaSanta.setUTCDate(sextaSanta.getUTCDate() - 2);
  mapa.set(chaveDia(sextaSanta), "Sexta-feira Santa");
  return mapa;
}

/** Feriados nacionais do ano (YYYY-MM-DD). */
export function feriadosNacionais(ano: number): Set<string> {
  return new Set(feriadosNacionaisNomeados(ano).keys());
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

/** Feriados nacionais do mês que caem de seg a sex (são os que tiram dia útil), em ordem. */
export function feriadosUteisDoMes(ano: number, mes: number): { data: string; nome: string }[] {
  const prefixo = `${ano}-${String(mes).padStart(2, "0")}-`;
  return [...feriadosNacionaisNomeados(ano).entries()]
    .filter(([data]) => data.startsWith(prefixo))
    .filter(([data]) => {
      const dow = new Date(`${data}T00:00:00Z`).getUTCDay();
      return dow >= 1 && dow <= 5;
    })
    .map(([data, nome]) => ({ data, nome }))
    .sort((x, y) => x.data.localeCompare(y.data));
}

/** Dias úteis PADRÃO de um mês da média: os dias úteis do mês, mas 0 antes do primeiro mês com horas (o consultor ainda não trabalhava). */
export function diasUteisPadraoDoMes(ano: number, mes: number, primeiroMesComHoras: { ano: number; mes: number } | null): number {
  if (!primeiroMesComHoras) return 0;
  const indice = (a: number, m: number) => a * 12 + (m - 1);
  return indice(ano, mes) < indice(primeiroMesComHoras.ano, primeiroMesComHoras.mes) ? 0 : diasUteisDoMes(ano, mes);
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

/** Os 12 meses FECHADOS antes do mês de início do gozo, em ordem cronológica (sempre 12, mesmo para consultor recém-admitido). */
export function mesesDaMedia(inicioGozo: Date): { ano: number; mes: number }[] {
  const indice = (ano: number, mes: number) => ano * 12 + (mes - 1);
  const fim = indice(inicioGozo.getUTCFullYear(), inicioGozo.getUTCMonth() + 1) - 1; // o mês anterior ao do gozo
  const meses: { ano: number; mes: number }[] = [];
  for (let i = fim - MESES_DA_MEDIA + 1; i <= fim; i++) meses.push({ ano: Math.floor(i / 12), mes: (i % 12) + 1 });
  return meses;
}

export interface MesParaMedia {
  minutos: number;
  /** Dias úteis disponíveis do mês (padrão ou ajustado pelo gestor). 0 = o mês fica fora da média. */
  diasUteis: number;
}

/**
 * Média simples do % trabalhado: de cada mês com dias disponíveis, horas / (dias úteis x horas/dia). Meses com 0 dias saem da conta. Sem nenhum mês válido, 1
 * (100%): não há histórico para reduzir nem aumentar.
 */
export function mediaPctTrabalhado(meses: MesParaMedia[], horasDia = HORAS_DIA_PADRAO): number {
  const validos = meses.filter((m) => m.diasUteis > 0);
  if (validos.length === 0) return 1;
  const pcts = validos.map((m) => m.minutos / 60 / (m.diasUteis * horasDia));
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

export interface PeriodoParaSaldo {
  /** YYYY-MM-DD */
  inicio: string;
  fim: string;
  diasDireito: number;
  diasGozados: number;
  diasFolgaDescontada: number;
  /** Saldo do período como a tela de férias já calcula (direito - gozados - folgas). */
  saldo: number;
}

export interface FracaoEmFormacao {
  inicio: string;
  fim: string;
  /** Dias do período aquisitivo já decorridos até hoje, e a duração total dele. */
  diasDecorridos: number;
  diasDoPeriodo: number;
  diasDireito: number;
  /** diasDireito x decorridos / duração: os dias de férias já "ganhos" até hoje (decimal). */
  acumulado: number;
  /** O que sobra do acumulado depois das férias e folgas já lançadas no período (nunca negativo). */
  saldo: number;
}

export interface SaldoPorVencimento {
  /** Períodos aquisitivos JÁ COMPLETOS (fim até hoje): o direito inteiro está adquirido. Soma dos saldos (nunca negativos). */
  vencido: number;
  /** Fração dos períodos ainda em curso (início até hoje, fim depois de hoje): dias ganhos até hoje, proporcionais ao tempo decorrido. */
  emFormacao: number;
  /** Soma dos saldos de todos os períodos, inclusive os que ainda não começaram. */
  total: number;
  periodosEmFormacao: FracaoEmFormacao[];
}

const diaUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const diasEntre = (de: string, ate: string) => Math.round((diaUtc(ate) - diaUtc(de)) / 86_400_000);

/**
 * Separa o saldo de férias de um consultor em "vencido" (período aquisitivo completo), "em formação" (fração proporcional ao tempo decorrido dos períodos em curso)
 * e "total" (todos os períodos, inclusive os futuros). Ex.: períodos 01/08/2025–01/08/2026 (20 d) e 01/08/2026–01/08/2027 (20 d), hoje 25/11/2026 -> vencido 20,
 * em formação 20 x 116/365 = 6,4, total 40.
 */
export function saldoPorVencimento(periodos: PeriodoParaSaldo[], hoje: string): SaldoPorVencimento {
  const positivo = (n: number) => Math.max(0, n);
  let vencido = 0;
  let total = 0;
  const periodosEmFormacao: FracaoEmFormacao[] = [];
  for (const p of periodos) {
    total += positivo(p.saldo);
    if (p.fim <= hoje) {
      vencido += positivo(p.saldo);
    } else if (p.inicio <= hoje) {
      const diasDoPeriodo = diasEntre(p.inicio, p.fim);
      const diasDecorridos = diasEntre(p.inicio, hoje);
      const acumulado = diasDoPeriodo > 0 ? (p.diasDireito * diasDecorridos) / diasDoPeriodo : 0;
      periodosEmFormacao.push({
        inicio: p.inicio,
        fim: p.fim,
        diasDecorridos,
        diasDoPeriodo,
        diasDireito: p.diasDireito,
        acumulado,
        saldo: positivo(acumulado - p.diasGozados - p.diasFolgaDescontada),
      });
    }
  }
  return { vencido, emFormacao: periodosEmFormacao.reduce((s, f) => s + f.saldo, 0), total, periodosEmFormacao };
}

/** Primeiro dia útil (seg–sex, fora feriado nacional) DEPOIS de `fim`: o retorno ao trabalho que o aviso de férias informa. */
export function proximoDiaUtil(fim: Date): Date {
  const d = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate() + 1));
  while (diasUteisDoPeriodo(d, d) === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
