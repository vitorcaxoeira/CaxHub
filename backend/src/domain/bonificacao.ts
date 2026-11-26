// Gestão de Bonificação (25/11/2026): regras PURAS (sem banco) da bonificação dos consultores. Cada INDICADOR tem versões de REGRA com vigência;
// a regra traz o valor base (R$) e as FAIXAS que transformam o valor apurado em PONTOS (0 a 1, em geral). Valor = pontos x valor base.
// Dinheiro em centavos inteiros por dentro (nunca somar reais com ponto flutuante); datas como meia-noite UTC (formato de @db.Date).
import { competenciaDe, emCentavos, emReais, somarMeses } from "./descontos";

export { competenciaDe, emCentavos, emReais, somarMeses };

export type FonteIndicador = "manual" | "kyria_capacidade" | "kyria_eficiencia" | "kyria_pct_ponto" | "kyria_chamados_antigos";
export const FONTES_INDICADOR: readonly FonteIndicador[] = ["manual", "kyria_capacidade", "kyria_eficiencia", "kyria_pct_ponto", "kyria_chamados_antigos"];
export const FONTE_ROTULO: Record<FonteIndicador, string> = {
  manual: "Lançamento manual",
  kyria_capacidade: "Kyria · fila das sextas",
  kyria_eficiencia: "Kyria · abertos x fechados",
  kyria_pct_ponto: "Kyria + ponto HCM · % apontado",
  kyria_chamados_antigos: "Kyria · chamados antigos",
};

export type UnidadeIndicador = "quantidade" | "percentual" | "horas";
export const UNIDADES_INDICADOR: readonly UnidadeIndicador[] = ["quantidade", "percentual", "horas"];
export const UNIDADE_ROTULO: Record<UnidadeIndicador, string> = { quantidade: "Quantidade", percentual: "Percentual (%)", horas: "Horas" };

/** menor_melhor: limites crescentes, vale a 1ª faixa com valor <= limite. maior_melhor: limites decrescentes, vale a 1ª com valor >= limite. */
export type SentidoIndicador = "menor_melhor" | "maior_melhor";
export const SENTIDOS_INDICADOR: readonly SentidoIndicador[] = ["menor_melhor", "maior_melhor"];
export const SENTIDO_ROTULO: Record<SentidoIndicador, string> = { menor_melhor: "Quanto menor, melhor (até X)", maior_melhor: "Quanto maior, melhor (a partir de X)" };

export type SituacaoFechamento = "aberto" | "fechado";
export const SITUACAO_FECHAMENTO_ROTULO: Record<SituacaoFechamento, string> = { aberto: "Aberto", fechado: "Fechado" };

export const eFonteIndicador = (v: unknown): v is FonteIndicador => typeof v === "string" && (FONTES_INDICADOR as readonly string[]).includes(v);
export const eUnidadeIndicador = (v: unknown): v is UnidadeIndicador => typeof v === "string" && (UNIDADES_INDICADOR as readonly string[]).includes(v);
export const eSentidoIndicador = (v: unknown): v is SentidoIndicador => typeof v === "string" && (SENTIDOS_INDICADOR as readonly string[]).includes(v);

// ------------------------------------------------------------------------------------------------------------------------------ faixas
export interface FaixaRegra {
  /** Nulo = "demais casos" (só a última faixa). */
  limite: number | null;
  pontos: number;
}

export const MAX_FAIXAS = 20;
export const MAX_PONTOS_POR_FAIXA = 10;

/** Confere a tabela de faixas de uma regra; devolve a mensagem do 1º problema ou null se está certa. */
export function validarFaixas(faixas: FaixaRegra[], sentido: SentidoIndicador): string | null {
  if (faixas.length === 0) return "Informe ao menos uma faixa";
  if (faixas.length > MAX_FAIXAS) return `No máximo ${MAX_FAIXAS} faixas por regra`;
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i];
    const ultima = i === faixas.length - 1;
    if (!Number.isFinite(f.pontos) || f.pontos < 0 || f.pontos > MAX_PONTOS_POR_FAIXA) return `Os pontos da faixa ${i + 1} devem ficar entre 0 e ${MAX_PONTOS_POR_FAIXA}`;
    if (ultima) {
      if (f.limite != null) return 'A última faixa deve ser "demais casos" (sem limite)';
    } else {
      if (f.limite == null || !Number.isFinite(f.limite)) return `A faixa ${i + 1} precisa de um limite (só a última fica sem)`;
      const anterior = i > 0 ? faixas[i - 1].limite : null;
      if (anterior != null && (sentido === "menor_melhor" ? f.limite <= anterior : f.limite >= anterior)) {
        return sentido === "menor_melhor" ? `Os limites devem ser crescentes (faixa ${i + 1})` : `Os limites devem ser decrescentes (faixa ${i + 1})`;
      }
    }
  }
  return null;
}

/** Pontos do valor apurado: a primeira faixa (na ordem) em que ele se enquadra; sem nenhuma, 0. */
export function pontosDaFaixa(valor: number, faixas: FaixaRegra[], sentido: SentidoIndicador): number {
  for (const f of faixas) {
    if (f.limite == null) return f.pontos;
    if (sentido === "menor_melhor" ? valor <= f.limite : valor >= f.limite) return f.pontos;
  }
  return 0;
}

export interface RegraCalculo {
  valorBase: number;
  faixas: FaixaRegra[];
}

/** Pontos e valor (centavos) de um indicador a partir do valor efetivo (informado ou apurado). */
export function calcularIndicador(valor: number, regra: RegraCalculo, sentido: SentidoIndicador): { pontos: number; centavos: number } {
  const pontos = pontosDaFaixa(valor, regra.faixas, sentido);
  return { pontos, centavos: Math.round(pontos * emCentavos(regra.valorBase)) };
}

// ------------------------------------------------------------------------------------------------------------------------------ vigências
export interface Vigencia {
  id?: number;
  inicio: Date;
  fim: Date | null;
}

const FIM_DO_MUNDO = Date.UTC(9999, 0, 1);

export function ultimoDiaDoMes(competencia: Date): Date {
  return new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth() + 1, 0));
}

/** A regra vigora na competência (dia 1) quando começou até ela e não terminou antes dela. */
export function vigenteEm(v: Vigencia, competencia: Date): boolean {
  return v.inicio.getTime() <= competencia.getTime() && (v.fim == null || v.fim.getTime() >= competencia.getTime());
}

/** A pessoa está enquadrada na competência se a vigência toca qualquer dia do mês. */
export function ativoNoMes(v: Vigencia, competencia: Date): boolean {
  return v.inicio.getTime() <= ultimoDiaDoMes(competencia).getTime() && (v.fim == null || v.fim.getTime() >= competencia.getTime());
}

export function regraVigente<T extends { vigenciaInicio: Date; vigenciaFim: Date | null }>(regras: T[], competencia: Date): T | null {
  const vigentes = regras.filter((r) => vigenteEm({ inicio: r.vigenciaInicio, fim: r.vigenciaFim }, competencia));
  if (vigentes.length === 0) return null;
  // Sem sobreposição não há dúvida; se houver (dado antigo), vale a que começou por último.
  return vigentes.sort((a, b) => b.vigenciaInicio.getTime() - a.vigenciaInicio.getTime())[0];
}

/** Datas da regra: começa no dia 1 e termina no último dia de um mês (a competência é mensal, não há meia-regra). */
export function validarVigenciaDeRegra(inicio: Date, fim: Date | null): string | null {
  if (inicio.getUTCDate() !== 1) return "A vigência da regra começa sempre no dia 1 de um mês";
  if (fim) {
    if (fim.getTime() !== ultimoDiaDoMes(fim).getTime()) return "A vigência da regra termina sempre no último dia de um mês";
    if (fim.getTime() < inicio.getTime()) return "O fim da vigência não pode ser anterior ao início";
  }
  return null;
}

export function validarPeriodo(inicio: Date, fim: Date | null): string | null {
  if (fim && fim.getTime() < inicio.getTime()) return "O fim da vigência não pode ser anterior ao início";
  return null;
}

/** Procura sobreposição entre as vigências (a do `id` informado é ignorada: é ela mesma sendo editada). */
export function vigenciaSobreposta(existentes: Vigencia[], nova: Vigencia): Vigencia | null {
  const ini = nova.inicio.getTime();
  const fim = nova.fim ? nova.fim.getTime() : FIM_DO_MUNDO;
  for (const e of existentes) {
    if (nova.id != null && e.id === nova.id) continue;
    const eIni = e.inicio.getTime();
    const eFim = e.fim ? e.fim.getTime() : FIM_DO_MUNDO;
    if (ini <= eFim && eIni <= fim) return e;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------------------------------ apuração
/** Sextas-feiras (UTC) do mês da competência. */
export function sextasDoMes(competencia: Date): Date[] {
  const ano = competencia.getUTCFullYear();
  const mes = competencia.getUTCMonth();
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const sextas: Date[] = [];
  for (let dia = 1; dia <= ultimo; dia++) {
    const d = new Date(Date.UTC(ano, mes, dia));
    if (d.getUTCDay() === 5) sextas.push(d);
  }
  return sextas;
}

export const arredondar = (n: number, casas = 4): number => {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
};

/** Média simples; sem valores, nulo (não existe média de nada). */
export function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return arredondar(valores.reduce((a, b) => a + b, 0) / valores.length);
}

/** Parte ÷ total em percentual (0 a 100, 4 casas); total zerado = sem resultado. */
export function percentualDe(parte: number, total: number): number | null {
  if (!(total > 0)) return null;
  return arredondar((parte * 100) / total);
}

export const minutosParaHoras = (minutos: number): number => arredondar(minutos / 60, 2);

/** 144.97 horas -> "144:58" (como o relatório Horas Disponíveis x Trabalhadas). */
export function formatarHorasMinutos(minutos: number): string {
  const total = Math.round(minutos);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ------------------------------------------------------------------------------------------------------------------------------ resultado
export interface ResultadoParaTotal {
  pontos: number | null;
  valor: number | null;
}

/** Total do consultor no fechamento (centavos). `pendentes` = indicadores ainda sem valor (falta lançar ou sem dado do Kyria). */
export function totalDoConsultor(resultados: ResultadoParaTotal[]): { pontos: number; centavos: number; pendentes: number } {
  let pontos = 0;
  let centavos = 0;
  let pendentes = 0;
  for (const r of resultados) {
    if (r.pontos == null || r.valor == null) {
      pendentes++;
      continue;
    }
    pontos += r.pontos;
    centavos += emCentavos(r.valor);
  }
  return { pontos: arredondar(pontos, 3), centavos, pendentes };
}

/** Valor efetivo do resultado: o que a pessoa informou vale no lugar do apurado. */
export function valorEfetivo(apurado: number | null, informado: number | null): number | null {
  return informado ?? apurado;
}

export const competenciaDoMes = (ano: number, mes: number): Date => competenciaDe(new Date(Date.UTC(ano, mes - 1, 1)));
export const mesAnterior = (competencia: Date): Date => somarMeses(competencia, -1);
export const mesSeguinte = (competencia: Date): Date => somarMeses(competencia, 1);
