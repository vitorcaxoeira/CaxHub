// Custo-hora real do consultor (bloco C da Rentabilidade, 18-19/11/2026) — a parte PURA: validação da configuração, conta do CLT e qual fonte de custo vale
// em cada mês. Nenhuma conta, percentual ou horas da escala mora aqui: tudo vem das tabelas custo_* (preenchidas por tela ou "Importar JSON"). O banco e o job
// estão em domain/custoHoraJob.ts.
//
// Regra de decisão do Vitor:
//   CLT = custo CONTABILIZADO pela folha (R048CTB) nas contas escolhidas por tela ÷ horas da escala (19/11/2026; antes era a classificação dos eventos da
//   folha + encargos em %) · PJ = valor bruto do contrato (retenções só informativas) · quem não é CLT nem tem contrato = valor-hora manual com vigência.

export const ORIGENS_CUSTO = {
  clt_folha: "CLT — contabilização da folha ÷ horas da escala",
  pj_contrato: "PJ — valor-hora do contrato",
  manual: "Valor-hora manual",
} as const;
export type OrigemCusto = keyof typeof ORIGENS_CUSTO;

export const PARAMETROS_CUSTO = {
  horas_mes: "Horas da escala por mês (divisor do custo mensal do CLT)",
} as const;
export type ChaveParametro = keyof typeof PARAMETROS_CUSTO;
export const ehChaveParametro = (v: unknown): v is ChaveParametro => typeof v === "string" && v in PARAMETROS_CUSTO;

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Valida e normaliza o valor de um parâmetro (sempre devolve o texto que fica gravado). */
export function validarParametro(chave: ChaveParametro, bruto: unknown): Validacao<string> {
  const texto = typeof bruto === "number" ? String(bruto) : typeof bruto === "string" ? bruto.trim() : "";
  if (chave === "horas_mes") {
    const n = Number(texto.replace(",", "."));
    if (!texto || !Number.isFinite(n) || n <= 0 || n > 744) return { ok: false, erro: "Horas da escala deve ser um número maior que 0 e até 744 (horas de um mês de 31 dias)" };
    return { ok: true, valor: String(n) };
  }
  return { ok: false, erro: "Parâmetro desconhecido" };
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
function dataIsoValida(texto: string): boolean {
  if (!DATA_ISO.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}
export { dataIsoValida };

const centavos = (v: number) => Math.round(v * 100) / 100;
const quatroCasas = (v: number) => Math.round(v * 10000) / 10000;

/** Um lançamento da contabilização da folha, já somado por conta/opção no mês. Só entra o que foi contabilizado a DÉBITO: o crédito não compõe o custo. */
export interface LancamentoFolha {
  /** `codemp:ctared` da conta do plano (ver `chaveConta`). */
  conta: string;
  /** Opção da contabilização na R048CTB: 1 = folha (cálculo), 3 = provisões. */
  opcctb: number | null;
  /** Valor a débito. */
  valor: number;
}

export const chaveConta = (codemp: number, ctared: number): string => `${codemp}:${ctared}`;

export interface EntradaClt {
  lancamentos: LancamentoFolha[];
  /** Contas escolhidas por tela para compor o custo (chaves `codemp:ctared`, só analíticas — ver rentabilidade/indicadores.contasSelecionadas). */
  contas: Set<string>;
  horasMes: number;
}

export interface DetalheClt {
  /** Custo do mês nas contas escolhidas (só débito). */
  custoMensal: number;
  /** Parte que vem da folha propriamente dita (opção 1) e das provisões de 13º/férias (opção 3). */
  folha: number;
  provisoes: number;
  horasMes: number;
  /** As contas que compuseram o custo, com o valor de cada uma (maiores primeiro). */
  porConta: { conta: string; valor: number }[];
}

/**
 * CLT: (Σ do que foi contabilizado a DÉBITO nas contas escolhidas, na folha do mês) ÷ horas da escala. `null` se não há o que dividir (sem horas, sem
 * lançamento nas contas escolhidas ou total zero).
 */
export function calcularCustoClt(e: EntradaClt): { custoHora: number; detalhe: DetalheClt } | null {
  if (!(e.horasMes > 0)) return null;
  const porConta = new Map<string, number>();
  let folha = 0;
  let provisoes = 0;
  for (const l of e.lancamentos) {
    if (!e.contas.has(l.conta)) continue;
    porConta.set(l.conta, (porConta.get(l.conta) ?? 0) + l.valor);
    if (l.opcctb === 3) provisoes += l.valor;
    else folha += l.valor;
  }
  const custoMensal = centavos(folha + provisoes);
  if (custoMensal <= 0) return null;
  return {
    custoHora: quatroCasas(custoMensal / e.horasMes),
    detalhe: {
      custoMensal,
      folha: centavos(folha),
      provisoes: centavos(provisoes),
      horasMes: e.horasMes,
      porConta: [...porConta.entries()].map(([conta, valor]) => ({ conta, valor: centavos(valor) })).sort((a, b) => b.valor - a.valor),
    },
  };
}

/** Uma regra de conta da tela (incluir/excluir), como a dos indicadores de rentabilidade. */
export interface RegraContaFolha {
  codemp: number;
  ctared: number;
  acao: "incluir" | "excluir";
}

/** Valida a lista de regras do corpo do PUT: inteiros, ação válida, sem conta repetida. */
export function validarRegrasContasFolha(bruto: unknown): Validacao<RegraContaFolha[]> {
  if (!Array.isArray(bruto)) return { ok: false, erro: "regras deve ser uma lista" };
  const vistas = new Set<string>();
  const saida: RegraContaFolha[] = [];
  for (const r of bruto as Record<string, unknown>[]) {
    const codemp = Number(r?.codemp);
    const ctared = Number(r?.ctared);
    if (!Number.isInteger(codemp) || !Number.isInteger(ctared) || ctared <= 0 || codemp <= 0) return { ok: false, erro: "Regra inválida: informe codemp e ctared" };
    if (r.acao !== "incluir" && r.acao !== "excluir") return { ok: false, erro: `Regra da conta ${ctared}: ação deve ser "incluir" ou "excluir"` };
    const k = chaveConta(codemp, ctared);
    if (vistas.has(k)) return { ok: false, erro: `A conta ${ctared} aparece duas vezes` };
    vistas.add(k);
    saida.push({ codemp, ctared, acao: r.acao });
  }
  return { ok: true, valor: saida };
}

export interface FontesDeCusto {
  clt: number | null;
  pj: number | null;
  manual: number | null;
}

/**
 * Qual fonte vale no mês: a folha (CLT) quando há folha calculada; senão o contrato (PJ); senão o valor manual. Quem foi CLT e virou PJ tem as duas
 * fontes em meses diferentes — cada mês usa a que existe nele. `null` = sem custo definido naquele mês.
 */
export function escolherCusto(f: FontesDeCusto): { origem: OrigemCusto; custoHora: number } | null {
  if (f.clt != null && f.clt > 0) return { origem: "clt_folha", custoHora: f.clt };
  if (f.pj != null && f.pj > 0) return { origem: "pj_contrato", custoHora: f.pj };
  if (f.manual != null && f.manual > 0) return { origem: "manual", custoHora: f.manual };
  return null;
}

export interface PeriodoMensal {
  mensal: boolean;
  /** Dia 1 (AAAA-MM-DD) a partir do qual o preço é mensal; nulo = desde sempre. */
  desde: string | null;
  /** Dia 1 (AAAA-MM-DD) do último mês com preço mensal; nulo = até hoje. */
  ate: string | null;
}

/** O preço do contrato, NESTA competência, é um valor mensal? (marcado como mensal e dentro do período, quando há limite). */
export function precoEhMensal(p: PeriodoMensal, competencia: string): boolean {
  return p.mensal && (!p.desde || competencia >= p.desde) && (!p.ate || competencia <= p.ate);
}

/** Corpo do PUT: `mensal` e, opcionalmente, o período em AAAA-MM (ou nulo). */
export function validarPeriodoMensal(corpo: unknown): Validacao<PeriodoMensal> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (typeof c.mensal !== "boolean") return { ok: false, erro: "mensal (verdadeiro ou falso) é obrigatório" };
  const lerMes = (v: unknown): string | null | undefined => {
    if (v === undefined || v === null || v === "") return null;
    return typeof v === "string" ? (competenciaDia1(v) ?? undefined) : undefined;
  };
  const desde = lerMes(c.desde);
  const ate = lerMes(c.ate);
  if (desde === undefined || ate === undefined) return { ok: false, erro: "Período inválido (use AAAA-MM)" };
  if (desde && ate && desde > ate) return { ok: false, erro: "O mês inicial não pode ser depois do final" };
  return { ok: true, valor: { mensal: c.mensal, desde: c.mensal ? desde : null, ate: c.mensal ? ate : null } };
}

export interface ValorManual {
  /** AAAA-MM-DD */
  vigenciaInicio: string;
  valor: number;
}

/** A vigência do valor-hora manual que vale na competência: a de maior início que não passa dela. */
export function vigenciaManualEm<T extends ValorManual>(valores: T[], competencia: string): T | null {
  let achado: T | null = null;
  for (const v of valores) if (v.vigenciaInicio <= competencia && (!achado || v.vigenciaInicio > achado.vigenciaInicio)) achado = v;
  return achado;
}

/** Valor-hora manual vigente na competência: o da última vigência que começou até ela. */
export function valorManualEm(valores: ValorManual[], competencia: string): number | null {
  return vigenciaManualEm(valores, competencia)?.valor ?? null;
}

export function validarValorManual(corpo: unknown): Validacao<{ vigenciaInicio: string; valor: number; observacao: string | null }> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const vigenciaInicio = typeof c.vigenciaInicio === "string" ? c.vigenciaInicio.slice(0, 10) : "";
  if (!dataIsoValida(vigenciaInicio)) return { ok: false, erro: "Vigência inválida (use AAAA-MM-DD)" };
  const valor = typeof c.valor === "number" ? c.valor : Number(String(c.valor ?? "").replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0 || valor > 100000) return { ok: false, erro: "Valor-hora deve ser maior que 0" };
  const obs = typeof c.observacao === "string" ? c.observacao.trim() : "";
  if (obs.length > 500) return { ok: false, erro: "Observação longa demais (máximo de 500 caracteres)" };
  return { ok: true, valor: { vigenciaInicio, valor: Math.round(valor * 10000) / 10000, observacao: obs || null } };
}

/** "2026-03" → "2026-03-01"; já com dia → normaliza para o dia 1. `null` se não for uma competência. */
export function competenciaDia1(texto: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(texto.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Todas as competências (dia 1) de `de` a `ate`, inclusive. Máximo de 60 para um pedido não virar varredura do banco inteiro. */
export function competenciasDoPeriodo(de: string, ate: string, maximo = 60): string[] | null {
  const ini = competenciaDia1(de);
  const fim = competenciaDia1(ate);
  if (!ini || !fim || ini > fim) return null;
  const saida: string[] = [];
  let [ano, mes] = ini.split("-").map(Number);
  while (true) {
    const atual = `${ano}-${String(mes).padStart(2, "0")}-01`;
    if (atual > fim) break;
    saida.push(atual);
    if (saida.length > maximo) return null;
    mes++;
    if (mes > 12) {
      mes = 1;
      ano++;
    }
  }
  return saida;
}

/** Primeiro dia do mês seguinte (AAAA-MM-DD) — limite superior (exclusivo) das consultas do mês. */
export function mesSeguinte(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}
