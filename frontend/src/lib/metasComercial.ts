// Gestão de Metas do Comercial (menu Comercial › Gestão de Metas): tipos da API /api/metas-comercial, formatação e os assistentes de
// preenchimento mensal (espelho de backend/src/domain/metasComercial/calculo.ts — a regra de verdade é a do servidor; aqui só
// pré-preenche os campos que a gestora ainda pode editar).

export type Unidade = "BRL" | "HORAS" | "QTD";
export type Acumulacao = "SOMA" | "SALDO";
/** MANUAL = digitado em Lançamentos; as outras vêm do Senior e são somente leitura. */
export type Origem = "MANUAL" | "FATURAMENTO_SENIOR" | "CARTEIRA_SENIOR" | "PROPOSTAS_SENIOR" | "PEDIDOS_SENIOR";

export const ehDoSenior = (origem: string) => origem !== "MANUAL";

export const ROTULO_ORIGEM: Record<Origem, string> = {
  MANUAL: "Digitado em Lançamentos",
  FATURAMENTO_SENIOR: "Notas fiscais do Senior",
  CARTEIRA_SENIOR: "Carteira de contratos do Senior (RVTR101, motivo 500)",
  PROPOSTAS_SENIOR: "Horas das propostas aprovadas (Senior)",
  PEDIDOS_SENIOR: "Pedidos com rateio na conta 177 (Senior)",
};
export const rotuloOrigem = (origem: string) => ROTULO_ORIGEM[origem as Origem] ?? origem;

export interface Indicador {
  id: number;
  codigo: string;
  nome: string;
  unidade: Unidade;
  acumulacao: Acumulacao;
  origem: Origem;
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
  /** Representante do Senior: as horas das propostas dele são o realizado de Horas de Serviços da pessoa. */
  codrep: number | null;
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
  /** Realizado do Senior por origem (FATURAMENTO_SENIOR, CARTEIRA_SENIOR), 12 posições; null = mês sem valor. */
  realizadoSenior: Record<string, Array<number | null>>;
  /** Realizado do Senior por pessoa (origem -> participanteId -> 12 meses), ex.: horas das propostas pelo representante. */
  realizadoSeniorPessoa?: Record<string, Record<string, Array<number | null>>>;
  /** Quando a carteira de contratos foi fotografada pela última vez (ISO), ou null. */
  ultimaFotoCarteira: string | null;
  /** Fonte de cada mês da carteira: FOTO (lida no mês) ou RECONSTRUIDA (mês anterior à primeira foto, recalculado). */
  fontesCarteira: Array<"FOTO" | "RECONSTRUIDA" | null>;
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
  ultimaFotoCarteira: string | null;
  fontesCarteira: Array<"FOTO" | "RECONSTRUIDA" | null>;
}

/** "19/10 às 11:22" (data e hora locais da foto da carteira). */
export function quandoFoto(iso: string | null | undefined): string {
  if (!iso) return "sem foto ainda";
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
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

/** Para textos curtos (linha de apoio dos cartões): reais a partir de 1 milhão viram "R$ 13,8 mi"; o resto como fmtResumo. */
export function fmtCurto(unidade: Unidade, v: number | null | undefined): string {
  if (v != null && Number.isFinite(v) && unidade === "BRL" && Math.abs(v) >= 1e6) {
    return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v / 1e6)} mi`;
  }
  return fmtResumo(unidade, v);
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

export interface Representante {
  codrep: number;
  nome: string;
  ativo: boolean;
}

export interface NotaFaturada {
  codemp: number;
  codfil: number;
  serie: string;
  numero: number;
  emissao: string;
  codcli: number;
  cliente: string | null;
  codrep: number;
  representante: string | null;
  itens: number;
  valor: number;
}

export interface NotasFaturadasResposta {
  ano: number;
  mes: number;
  quantidade: number;
  total: number;
  notas: NotaFaturada[];
}

export interface PedidoLicenca {
  codemp: number;
  codfil: number;
  numped: number;
  emissao: string;
  sitped: number;
  codcli: number;
  cliente: string | null;
  codrep: number | null;
  representante: string | null;
  servicos: string;
  valor: number;
}

export interface PedidosLicencasResposta {
  ano: number;
  mes: number;
  quantidade: number;
  total: number;
  pedidos: PedidoLicenca[];
}

/** Situação do pedido (domínio LSitPed do Senior). */
export const SITUACAO_PEDIDO: Record<number, string> = {
  1: "Aberto total",
  2: "Aberto parcial",
  3: "Suspenso",
  4: "Liquidado",
  5: "Cancelado",
  6: "Aguardando WMS",
  7: "Em transmissão",
  8: "Preparação análise/NF",
  9: "Não fechado",
};

// ---------------------------------------------------------------- quadro (estilo da planilha)

export interface ColunasQuadro {
  /** Quanto falta para a meta (coluna DESAFIO da planilha). Nulo sem meta ou quando superou. */
  falta: number | null;
  /** Quanto passou da meta. Nulo quando não superou. */
  superou: number | null;
  /** % que falta (100% − %), nunca negativo. Nulo sem meta. */
  pctFalta: number | null;
}

/** Colunas de desafio de uma linha do quadro: as contas J e K da planilha, com "superou" no lugar de número negativo. */
export function colunasQuadro(c: { meta: number; realizado: number; atingimento: number | null }): ColunasQuadro {
  if (!(c.meta > 0) || c.atingimento == null) return { falta: null, superou: null, pctFalta: null };
  const saldo = arredonda2(c.meta - c.realizado);
  if (saldo < 0) return { falta: null, superou: -saldo, pctFalta: 0 };
  return { falta: saldo, superou: null, pctFalta: Math.max(0, 1 - c.atingimento) };
}

/** DESAFIO GERAL da planilha: média de (100% − %) = 100% − realizado geral. Acima de 100% não há o que faltar: fica 0% (a planilha
 * mostraria negativo), como o "% que falta" de cada linha que superou a meta. */
export const desafioGeral = (geral: number | null): number | null => (geral == null ? null : Math.max(0, 1 - geral));

/** Série do gráfico do mês a mês a partir das células mensais (acumulada em SOMA; posição de cada mês em SALDO). */
export function serieDe(mensal: CelulaMes[], acumulacao: Acumulacao): Array<{ mes: number; meta: number; realizado: number | null }> {
  const ultimo = Math.max(0, ...mensal.filter((m) => m.realizado != null).map((m) => m.mes));
  let meta = 0;
  let real = 0;
  return mensal.map((m) => {
    if (acumulacao === "SALDO") return { mes: m.mes, meta: m.meta ?? 0, realizado: m.realizado };
    meta += m.meta ?? 0;
    real += m.realizado ?? 0;
    return { mes: m.mes, meta: arredonda2(meta), realizado: m.mes <= ultimo ? arredonda2(real) : null };
  });
}
