// Gestão de Descontos (05/11/2026): regras PURAS (sem banco) dos descontos abatidos da nota dos consultores. Tudo em centavos inteiros por
// dentro (nunca somar reais com ponto flutuante) e datas como meia-noite UTC (formato de @db.Date).
//
// Vocabulário: PROCESSO = um desconto lançado (DESC-AAAA-000001); PARCELA = uma prestação dele, contabilizada na competência (mês) do
// vencimento; FECHAMENTO = a repartição da nota de um mês entre as parcelas daquela competência.

export type ModoDesconto = "total_parcelado" | "mensal_fixo";
export const MODOS_DESCONTO: readonly ModoDesconto[] = ["total_parcelado", "mensal_fixo"];

export type SituacaoParcela = "pendente" | "descontada" | "parcial" | "cancelada" | "estornada" | "quitada_antecipadamente";
export type StatusProcesso = "ativo" | "quitado" | "cancelado" | "parcialmente_cancelado" | "vigencia_encerrada";

export const SITUACAO_PARCELA_ROTULO: Record<SituacaoParcela, string> = {
  pendente: "Pendente",
  descontada: "Descontada",
  parcial: "Parcial",
  cancelada: "Cancelada",
  estornada: "Estornada",
  quitada_antecipadamente: "Quitada antecipadamente",
};

export const STATUS_PROCESSO_ROTULO: Record<StatusProcesso, string> = {
  ativo: "Ativo",
  quitado: "Quitado",
  cancelado: "Cancelado",
  parcialmente_cancelado: "Parcialmente cancelado",
  vigencia_encerrada: "Vigência encerrada",
};

export const MODO_ROTULO: Record<ModoDesconto, string> = {
  total_parcelado: "Valor total parcelado",
  mensal_fixo: "Valor mensal fixo",
};

/** Teto de parcelas de um processo (guarda contra digitação errada: 12x de plano de saúde, 36x de qualquer coisa já é muito). */
export const MAX_PARCELAS_PROCESSO = 120;

export const emCentavos = (reais: number): number => Math.round(reais * 100);
export const emReais = (centavos: number): number => centavos / 100;

/** "DESC-2026-000001". */
export function numeroDoProcesso(ano: number, sequencia: number): string {
  return `DESC-${ano}-${String(sequencia).padStart(6, "0")}`;
}

const diaUtc = (ano: number, mesZeroBase: number, dia: number) => new Date(Date.UTC(ano, mesZeroBase, dia));
const ultimoDiaDoMes = (ano: number, mesZeroBase: number) => new Date(Date.UTC(ano, mesZeroBase + 1, 0)).getUTCDate();
const indiceDoMes = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth();

/** Primeiro dia do mês da data (a competência é sempre o dia 1). */
export function competenciaDe(d: Date): Date {
  return diaUtc(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function somarMeses(competencia: Date, meses: number): Date {
  return diaUtc(competencia.getUTCFullYear(), competencia.getUTCMonth() + meses, 1);
}

/** Vencimento no mês da competência; dia 31 em mês curto cai no último dia (fevereiro: 28/29). */
export function vencimentoDa(competencia: Date, diaVencimento: number): Date {
  const ano = competencia.getUTCFullYear();
  const mes = competencia.getUTCMonth();
  return diaUtc(ano, mes, Math.min(diaVencimento, ultimoDiaDoMes(ano, mes)));
}

export interface ParcelaGerada {
  numero: number;
  competencia: Date;
  vencimento: Date;
  valor: number; // reais
}

export interface EntradaGeracao {
  modo: ModoDesconto;
  valorTotal?: number | null;
  valorParcela?: number | null;
  qtdParcelas: number;
  competenciaInicial: Date;
  diaVencimento: number;
}

export interface ParcelamentoGerado {
  valorTotal: number;
  valorParcela: number; // a parcela regular (no modo total, a última pode diferir pelos centavos)
  parcelas: ParcelaGerada[];
}

/**
 * Modo "total_parcelado": divide o total e a ÚLTIMA parcela absorve os centavos que sobraram (500,00 em 3x: 166,66 + 166,66 + 166,68).
 * Modo "mensal_fixo": todas as parcelas iguais ao valor informado, inclusive a última, e o total é valor × quantidade (29,99 × 3 = 89,97).
 */
export function gerarParcelas(e: EntradaGeracao): ParcelamentoGerado {
  const qtd = e.qtdParcelas;
  let valoresC: number[];
  if (e.modo === "mensal_fixo") {
    const parcelaC = emCentavos(e.valorParcela ?? 0);
    valoresC = Array.from({ length: qtd }, () => parcelaC);
  } else {
    const totalC = emCentavos(e.valorTotal ?? 0);
    const baseC = Math.floor(totalC / qtd);
    valoresC = Array.from({ length: qtd }, (_, i) => (i === qtd - 1 ? totalC - baseC * (qtd - 1) : baseC));
  }
  const competenciaInicial = competenciaDe(e.competenciaInicial);
  const parcelas = valoresC.map((c, i) => {
    const competencia = somarMeses(competenciaInicial, i);
    return { numero: i + 1, competencia, vencimento: vencimentoDa(competencia, e.diaVencimento), valor: emReais(c) };
  });
  return {
    valorTotal: emReais(valoresC.reduce((s, c) => s + c, 0)),
    valorParcela: emReais(valoresC[0] ?? 0),
    parcelas,
  };
}

export interface TipoParaValidar {
  ativo: boolean;
  permiteParcelamento: boolean;
  maxParcelas: number | null;
  valorMinimo: number | null;
  valorMaximo: number | null;
  exigeObservacao: boolean;
}

export interface DadosDoProcesso extends EntradaGeracao {
  vigenciaInicio: Date;
  vigenciaFim: Date;
  observacao?: string | null;
}

export type ResultadoValidacao = { ok: true; parcelamento: ParcelamentoGerado } | { ok: false; erro: string };

const valorValido = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) && emCentavos(v) > 0;

/** Valida o lançamento e, se estiver certo, já devolve o parcelamento calculado (a mesma conta usada para gravar). */
export function validarProcesso(d: DadosDoProcesso, tipo: TipoParaValidar): ResultadoValidacao {
  if (!MODOS_DESCONTO.includes(d.modo)) return { ok: false, erro: "Modo de lançamento inválido" };
  if (!tipo.ativo) return { ok: false, erro: "Este tipo de desconto está inativo" };
  if (!Number.isInteger(d.qtdParcelas) || d.qtdParcelas <= 0) return { ok: false, erro: "A quantidade de parcelas deve ser maior que zero" };
  if (d.qtdParcelas > MAX_PARCELAS_PROCESSO) return { ok: false, erro: `No máximo ${MAX_PARCELAS_PROCESSO} parcelas por processo` };
  if (d.modo === "total_parcelado" && !valorValido(d.valorTotal)) return { ok: false, erro: "Informe o valor total do desconto (maior que zero)" };
  if (d.modo === "mensal_fixo" && !valorValido(d.valorParcela)) return { ok: false, erro: "Informe o valor mensal da parcela (maior que zero)" };
  if (!Number.isInteger(d.diaVencimento) || d.diaVencimento < 1 || d.diaVencimento > 31) return { ok: false, erro: "O dia de vencimento deve estar entre 1 e 31" };
  if (d.vigenciaFim.getTime() < d.vigenciaInicio.getTime()) return { ok: false, erro: "A data final da vigência deve ser igual ou posterior à inicial" };

  const competencia = competenciaDe(d.competenciaInicial);
  if (indiceDoMes(competencia) < indiceDoMes(d.vigenciaInicio) || indiceDoMes(competencia) > indiceDoMes(d.vigenciaFim)) {
    return { ok: false, erro: "A competência inicial deve estar dentro do período de vigência" };
  }

  const parcelamento = gerarParcelas({ ...d, competenciaInicial: competencia });
  const ultima = parcelamento.parcelas[parcelamento.parcelas.length - 1];
  if (d.vigenciaFim.getTime() < ultima.vencimento.getTime()) {
    return { ok: false, erro: "A data final da vigência deve cobrir todas as parcelas (a última vence em " + isoData(ultima.vencimento) + ")" };
  }

  if (!tipo.permiteParcelamento && d.qtdParcelas > 1) return { ok: false, erro: "Este tipo de desconto não permite parcelamento" };
  if (tipo.maxParcelas != null && d.qtdParcelas > tipo.maxParcelas) return { ok: false, erro: `Este tipo permite no máximo ${tipo.maxParcelas} parcela(s)` };
  if (tipo.valorMinimo != null && emCentavos(parcelamento.valorTotal) < emCentavos(tipo.valorMinimo)) {
    return { ok: false, erro: `O valor do processo é menor que o mínimo do tipo (${tipo.valorMinimo.toFixed(2)})` };
  }
  if (tipo.valorMaximo != null && emCentavos(parcelamento.valorTotal) > emCentavos(tipo.valorMaximo)) {
    return { ok: false, erro: `O valor do processo é maior que o máximo do tipo (${tipo.valorMaximo.toFixed(2)})` };
  }
  if (tipo.exigeObservacao && !(d.observacao ?? "").trim()) return { ok: false, erro: "Este tipo de desconto exige observação" };

  return { ok: true, parcelamento };
}

const isoData = (d: Date) => d.toISOString().slice(0, 10);

const FECHADAS: readonly SituacaoParcela[] = ["cancelada", "estornada"];

/**
 * Status do processo, derivado das parcelas. A parcela "parcial" já foi resolvida (o restante dela vive numa parcela pendente nova na
 * competência seguinte), então só a "pendente" mantém o processo em aberto.
 */
export function statusDoProcesso(parcelas: { situacao: SituacaoParcela }[], vigenciaFim: Date, hoje: Date): StatusProcesso {
  if (parcelas.length === 0) return "ativo";
  if (parcelas.every((p) => FECHADAS.includes(p.situacao))) return "cancelado";
  const temPendente = parcelas.some((p) => p.situacao === "pendente");
  const temFechada = parcelas.some((p) => FECHADAS.includes(p.situacao));
  // Sem pendência: quitado, a menos que alguma parcela tenha sido cancelada/estornada (aí o processo terminou ANTES da quitação total).
  if (!temPendente) return temFechada ? "cancelado" : "quitado";
  if (temFechada) return "parcialmente_cancelado";
  if (vigenciaFim.getTime() < hoje.getTime()) return "vigencia_encerrada";
  return "ativo";
}

export interface ParcelaParaAlocar {
  id: number;
  processoId: number;
  numero: number;
  vencimento: Date;
  valor: number; // reais
}

export interface ResultadoAlocacao {
  id: number;
  /** "descontada": coube inteira. "parcial": coube uma parte (o resto vira parcela nova no mês seguinte). "transportada": nada coube (a parcela inteira segue para o mês seguinte). */
  acao: "descontada" | "parcial" | "transportada";
  valorDescontado: number; // reais
  restante: number; // reais
}

/**
 * Reparte a nota do mês entre as parcelas da competência: abate em ordem de vencimento (desempate: processo, número) até acabar o
 * dinheiro. O que não cabe NÃO se perde nem cancela a parcela: o restante segue para a competência seguinte.
 */
export function alocarNaCompetencia(valorNota: number, parcelas: ParcelaParaAlocar[]): ResultadoAlocacao[] {
  let disponivelC = Math.max(0, emCentavos(valorNota));
  const ordenadas = [...parcelas].sort(
    (a, b) => a.vencimento.getTime() - b.vencimento.getTime() || a.processoId - b.processoId || a.numero - b.numero,
  );
  return ordenadas.map((p) => {
    const valorC = emCentavos(p.valor);
    const descontadoC = Math.min(valorC, disponivelC);
    disponivelC -= descontadoC;
    const acao: ResultadoAlocacao["acao"] = descontadoC === valorC ? "descontada" : descontadoC > 0 ? "parcial" : "transportada";
    return { id: p.id, acao, valorDescontado: emReais(descontadoC), restante: emReais(valorC - descontadoC) };
  });
}

/** Soma em centavos (sem erro de ponto flutuante) de valores em reais. */
export function somarReais(valores: number[]): number {
  return emReais(valores.reduce((s, v) => s + emCentavos(v), 0));
}

/** Saldo devedor do processo: o que ainda vai ser descontado (só parcela pendente conta). */
export function saldoDevedor(parcelas: { situacao: SituacaoParcela; valor: number }[]): number {
  return somarReais(parcelas.filter((p) => p.situacao === "pendente").map((p) => p.valor));
}

/** Total já descontado de verdade (inclui o pedaço descontado das parcelas parciais). */
export function totalDescontado(parcelas: { valorDescontado: number }[]): number {
  return somarReais(parcelas.map((p) => p.valorDescontado));
}
