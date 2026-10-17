// Gestão de Metas do Comercial (menu Comercial › Gestão de Metas): tipos da API /api/metas-comercial, formatação e os assistentes de
// preenchimento mensal (espelho de backend/src/domain/metasComercial/calculo.ts — a regra de verdade é a do servidor; aqui só
// pré-preenche os campos que a gestora ainda pode editar).

export type Unidade = "BRL" | "HORAS" | "QTD";
export type Acumulacao = "SOMA" | "SALDO";

export interface Indicador {
  id: number;
  codigo: string;
  nome: string;
  unidade: Unidade;
  acumulacao: Acumulacao;
  origem: "MANUAL" | "FATURAMENTO_SENIOR";
  ordem: number;
  ativo: boolean;
  emUso: boolean;
}

export interface IndicadorDaPessoa {
  indicadorId: number;
  rotulo: string | null;
  ordem?: number;
}

export interface Participante {
  id: number;
  codfor: number | null;
  nome: string;
  funcao: string | null;
  naoAtribuido: boolean;
  ordem: number;
  ativo: boolean;
  indicadores: IndicadorDaPessoa[];
}

export interface ConfigAno {
  ano: number;
  pesosMensais: number[];
  observacao: string | null;
  empresa: Array<{ indicadorId: number; metaAnual: number }>;
  participantes: Participante[];
  referenciaSenior: { metaAnualFaturamento: number; crescimentoEsperado: number } | null;
}

export interface Lancamento {
  participanteId: number;
  indicadorId: number;
  mes: number;
  meta: number | null;
  realizado: number | null;
  observacao: string | null;
}

export interface LancamentosResposta {
  lancamentos: Lancamento[];
  /** Faturamento das NFs fechadas, mês a mês (12 posições). */
  faturamentoSenior: number[];
}

export interface Consolidado {
  meta: number;
  realizado: number;
  atingimento: number | null;
  saldo: number;
}

export interface CelulaMes {
  mes: number;
  meta: number | null;
  realizado: number | null;
  atingimento: number | null;
}

export interface IndicadorEmpresa {
  indicadorId: number;
  codigo: string;
  nome: string;
  unidade: Unidade;
  acumulacao: Acumulacao;
  origem: string;
  metaAnual: number | null;
  consolidado: Consolidado;
  metaDasPessoas: number | null;
  mensal: CelulaMes[];
  serie: Array<{ mes: number; meta: number; realizado: number | null }>;
}

export interface IndicadorPessoa {
  indicadorId: number;
  nome: string;
  rotulo: string;
  unidade: Unidade;
  acumulacao: Acumulacao;
  consolidado: Consolidado;
  mensal: CelulaMes[];
}

export interface PessoaPainel {
  participanteId: number;
  nome: string;
  funcao: string | null;
  naoAtribuido: boolean;
  atingimentoGeral: number | null;
  indicadores: IndicadorPessoa[];
}

export interface Painel {
  ano: number;
  periodo: string;
  meses: number[];
  atingimentoGeral: number | null;
  indicadores: IndicadorEmpresa[];
  pessoas: PessoaPainel[];
}

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Pesos padrão da planilha (Jan–Mar 6,667%, Abr–Set 10%, Out–Dez 6,667%). */
export const PESOS_PADRAO = [6.666667, 6.666667, 6.666667, 10, 10, 10, 10, 10, 10, 6.666667, 6.666667, 6.666667];

export const PERIODOS_FIXOS = [
  { valor: "ano", rotulo: "Ano inteiro" },
  { valor: "s1", rotulo: "1º semestre" },
  { valor: "s2", rotulo: "2º semestre" },
  { valor: "t1", rotulo: "1º trimestre" },
  { valor: "t2", rotulo: "2º trimestre" },
  { valor: "t3", rotulo: "3º trimestre" },
  { valor: "t4", rotulo: "4º trimestre" },
];

// ---------------------------------------------------------------- formatação

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfLivre = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** Valor na unidade do indicador: R$ com centavos, horas com até 2 casas, quantidade inteira. */
export function fmtValor(unidade: Unidade, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unidade === "BRL") return `R$ ${nf2.format(v)}`;
  if (unidade === "HORAS") return `${nfLivre.format(v)} h`;
  return nf0.format(v);
}

/** Igual a fmtValor, mas R$ sem centavos (cartões do painel). */
export function fmtResumo(unidade: Unidade, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unidade === "BRL") return `R$ ${nf0.format(v)}`;
  return fmtValor(unidade, v);
}

export const fmtPct = (x: number | null | undefined, casas = 1): string =>
  x == null || !Number.isFinite(x) ? "—" : `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(x * 100)}%`;

/** Texto de um número para campo de edição (vírgula decimal, sem R$). Vazio para nulo. */
export function numParaCampo(v: number | null | undefined): string {
  return v == null ? "" : nfLivre.format(v);
}

/** Peso mensal para campo de edição: até 6 casas (6,666667), para a soma continuar fechando 100% depois de editar. */
export function pesoParaCampo(v: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 }).format(v);
}

/**
 * Lê o que a pessoa digitou. "1.234,56" e "1234,56" e "1234.56" valem 1234,56; "1.500" vale 1500 (ponto de milhar); vazio = null;
 * ilegível = NaN. Negativo não é aceito (o servidor também recusa).
 */
export function lerNumero(texto: string): number | null {
  const t = texto.replace(/\s|R\$/g, "");
  if (t === "") return null;
  let normal: string;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  else normal = t;
  if (!/^\d+(\.\d+)?$/.test(normal)) return NaN;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

// ---------------------------------------------------------------- assistentes

export const arredonda2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Reparte `valor` entre os meses escolhidos na proporção dos pesos; a diferença de centavos vai para o último mês. 12 posições. */
export function distribuirPorPesos(valor: number, pesos: number[], meses: number[]): number[] {
  const escolhidos = [...new Set(meses)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  const saida = new Array<number>(12).fill(0);
  if (escolhidos.length === 0) return saida;
  const soma = escolhidos.reduce((a, m) => a + (pesos[m - 1] ?? 0), 0);
  const fracao = (m: number) => (soma > 0 ? (pesos[m - 1] ?? 0) / soma : 1 / escolhidos.length);
  let acumulado = 0;
  escolhidos.forEach((m, i) => {
    const v = i === escolhidos.length - 1 ? arredonda2(valor - acumulado) : arredonda2(valor * fracao(m));
    saida[m - 1] = v;
    acumulado = arredonda2(acumulado + v);
  });
  return saida;
}

export const somaPesos = (pesos: number[]) => pesos.reduce((a, b) => a + b, 0);

export const rotuloPeriodo = (periodo: string): string => {
  const fixo = PERIODOS_FIXOS.find((p) => p.valor === periodo);
  if (fixo) return fixo.rotulo;
  const m = /^(mes|ate)-(\d{1,2})$/.exec(periodo);
  if (m) return m[1] === "mes" ? MESES_LONGOS[Number(m[2]) - 1] : `Acumulado até ${MESES_LONGOS[Number(m[2]) - 1].toLowerCase()}`;
  return periodo;
};
