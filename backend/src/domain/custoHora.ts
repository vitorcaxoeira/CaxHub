// Custo-hora real do consultor (bloco C da Rentabilidade, 18/11/2026) — a parte PURA: validação da configuração, escolha do encargo vigente, conta do
// CLT e qual fonte de custo vale em cada mês. Nenhum percentual, evento, código de cálculo ou horas da escala mora aqui: tudo vem das tabelas custo_*
// (preenchidas por tela ou "Importar JSON"). O banco e o job estão em services/custoHoraJob.ts.
//
// Regra de decisão do Vitor (17/11/2026):
//   CLT = (folha + benefícios + encargos da folha + Σ% × base) ÷ horas da escala · PJ = valor bruto do contrato (retenções só informativas) ·
//   quem não é CLT nem tem contrato = valor-hora manual com vigência.

export const CLASSES_EVENTO = {
  remuneracao: "Remuneração — entra no custo e na base dos encargos percentuais",
  beneficio: "Benefício — entra no custo, fora da base dos encargos",
  encargo_folha: "Encargo já calculado pela folha — entra no custo, fora da base",
} as const;
export type ClasseEvento = keyof typeof CLASSES_EVENTO;

export const CLASSES_VALIDAS = Object.keys(CLASSES_EVENTO) as ClasseEvento[];
export const ehClasseEvento = (v: unknown): v is ClasseEvento => typeof v === "string" && (CLASSES_VALIDAS as string[]).includes(v);

export const ORIGENS_CUSTO = {
  clt_folha: "CLT — folha + encargos ÷ horas da escala",
  pj_contrato: "PJ — valor-hora do contrato",
  manual: "Valor-hora manual",
} as const;
export type OrigemCusto = keyof typeof ORIGENS_CUSTO;

export const PARAMETROS_CUSTO = {
  horas_mes: "Horas da escala por mês (divisor do custo mensal do CLT)",
  tipos_calculo: "Tipos de cálculo da folha que entram no custo do mês (R044CAL.TipCal, separados por vírgula)",
} as const;
export type ChaveParametro = keyof typeof PARAMETROS_CUSTO;
export const ehChaveParametro = (v: unknown): v is ChaveParametro => typeof v === "string" && v in PARAMETROS_CUSTO;

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Lista de tipos de cálculo "11,12, 13" → [11, 12, 13] (sem repetir, ordenada). `null` se o texto não for uma lista de inteiros positivos. */
export function lerTiposCalculo(texto: string): number[] | null {
  const partes = texto.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (partes.length === 0 || partes.some((p) => !/^\d{1,4}$/.test(p) || Number(p) <= 0)) return null;
  return [...new Set(partes.map(Number))].sort((a, b) => a - b);
}

/** Valida e normaliza o valor de um parâmetro (sempre devolve o texto que fica gravado). */
export function validarParametro(chave: ChaveParametro, bruto: unknown): Validacao<string> {
  const texto = typeof bruto === "number" ? String(bruto) : typeof bruto === "string" ? bruto.trim() : "";
  if (chave === "horas_mes") {
    const n = Number(texto.replace(",", "."));
    if (!texto || !Number.isFinite(n) || n <= 0 || n > 744) return { ok: false, erro: "Horas da escala deve ser um número maior que 0 e até 744 (horas de um mês de 31 dias)" };
    return { ok: true, valor: String(n) };
  }
  const tipos = lerTiposCalculo(texto);
  if (!tipos) return { ok: false, erro: "Informe os tipos de cálculo como números separados por vírgula (ex.: os que a folha mensal usa)" };
  return { ok: true, valor: tipos.join(",") };
}

export interface EncargoLinha {
  codigo: string;
  rotulo: string;
  percentual: number;
  /** AAAA-MM-DD (dia em que o percentual passa a valer). */
  vigenciaInicio: string;
}

export interface EncargoEntrada {
  codigo: string;
  rotulo: string;
  percentual: number;
  vigenciaInicio: string;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
function dataIsoValida(texto: string): boolean {
  if (!DATA_ISO.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}
export { dataIsoValida };

export function validarEncargo(corpo: unknown): Validacao<EncargoEntrada> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const codigo = typeof c.codigo === "string" ? c.codigo.trim() : "";
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(codigo)) return { ok: false, erro: "Código inválido: use letras minúsculas, números e _, começando por letra (2 a 40 caracteres)" };
  const rotulo = typeof c.rotulo === "string" ? c.rotulo.trim() : "";
  if (!rotulo || rotulo.length > 120) return { ok: false, erro: "Informe o nome do encargo (até 120 caracteres)" };
  const percentual = typeof c.percentual === "number" ? c.percentual : Number(String(c.percentual ?? "").replace(",", "."));
  if (!Number.isFinite(percentual) || percentual < 0 || percentual > 1000) return { ok: false, erro: "Percentual deve estar entre 0 e 1000" };
  const vigenciaInicio = typeof c.vigenciaInicio === "string" ? c.vigenciaInicio.slice(0, 10) : "";
  if (!dataIsoValida(vigenciaInicio)) return { ok: false, erro: "Vigência inválida (use AAAA-MM-DD)" };
  return { ok: true, valor: { codigo, rotulo, percentual: Math.round(percentual * 10000) / 10000, vigenciaInicio } };
}

/**
 * O percentual de cada encargo que vale na competência (dia 1 do mês): para cada `codigo`, a linha de maior vigência que não passa do mês.
 * Encargo que só começa depois da competência não entra (ainda não existia). Ordem estável por código.
 */
export function encargosVigentes(linhas: EncargoLinha[], competencia: string): { codigo: string; rotulo: string; percentual: number }[] {
  const escolhida = new Map<string, EncargoLinha>();
  for (const l of linhas) {
    if (l.vigenciaInicio > competencia) continue;
    const atual = escolhida.get(l.codigo);
    if (!atual || l.vigenciaInicio > atual.vigenciaInicio) escolhida.set(l.codigo, l);
  }
  return [...escolhida.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)).map((l) => ({ codigo: l.codigo, rotulo: l.rotulo, percentual: l.percentual }));
}

export interface EntradaClt {
  /** Soma dos eventos classificados como remuneração. */
  remuneracao: number;
  beneficios: number;
  encargosFolha: number;
  encargos: { codigo: string; rotulo: string; percentual: number }[];
  horasMes: number;
}

export interface DetalheClt {
  remuneracao: number;
  beneficios: number;
  encargosFolha: number;
  encargos: { codigo: string; rotulo: string; percentual: number; valor: number }[];
  custoMensal: number;
  horasMes: number;
}

const centavos = (v: number) => Math.round(v * 100) / 100;
const quatroCasas = (v: number) => Math.round(v * 10000) / 10000;

/** CLT: (remuneração + benefícios + encargos da folha + Σ percentual × remuneração) ÷ horas da escala. `null` se não há o que dividir. */
export function calcularCustoClt(e: EntradaClt): { custoHora: number; detalhe: DetalheClt } | null {
  if (!(e.horasMes > 0)) return null;
  const encargos = e.encargos.map((x) => ({ ...x, valor: centavos((e.remuneracao * x.percentual) / 100) }));
  const custoMensal = centavos(e.remuneracao + e.beneficios + e.encargosFolha + encargos.reduce((s, x) => s + x.valor, 0));
  if (custoMensal <= 0) return null;
  return {
    custoHora: quatroCasas(custoMensal / e.horasMes),
    detalhe: { remuneracao: centavos(e.remuneracao), beneficios: centavos(e.beneficios), encargosFolha: centavos(e.encargosFolha), encargos, custoMensal, horasMes: e.horasMes },
  };
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

/** Valor-hora manual vigente na competência: o da última vigência que começou até ela. */
export function valorManualEm(valores: ValorManual[], competencia: string): number | null {
  let achado: ValorManual | null = null;
  for (const v of valores) if (v.vigenciaInicio <= competencia && (!achado || v.vigenciaInicio > achado.vigenciaInicio)) achado = v;
  return achado ? achado.valor : null;
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
