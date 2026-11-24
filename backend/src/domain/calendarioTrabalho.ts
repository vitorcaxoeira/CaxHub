// Calendário de trabalho do consultor (13/11/2026): a meta de um dia a partir da jornada cadastrada (JornadaConsultor) e do que abona o dia — FÉRIAS (gozos
// lançados pelo gestor) e AUSÊNCIAS lançadas pelo consultor (dia inteiro ou parte do dia). Dia abonado não conta na meta do "Progresso da meta".
// Funções puras (sem banco), com teste. Minutos desde a meia-noite, hora de parede de São Paulo (mesma convenção de JornadaConsultor).

export interface JornadaDia {
  manhaInicio: number | null;
  manhaFim: number | null;
  tardeInicio: number | null;
  tardeFim: number | null;
}

export interface AusenciaDia {
  diaInteiro: boolean;
  inicioMin: number | null;
  fimMin: number | null;
}

export interface ContextoDia {
  /** O dia está dentro de um gozo de férias (não cancelado). */
  ferias: boolean;
  ausencias: AusenciaDia[];
}

export const chaveDia = (d: Date): string => d.toISOString().slice(0, 10);

/** Enumera as datas (YYYY-MM-DD) de `de` a `ate`, inclusive nos dois extremos. */
export function diasDoPeriodo(de: Date, ate: Date): string[] {
  const dias: string[] = [];
  const atual = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), de.getUTCDate()));
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), ate.getUTCDate()));
  while (atual.getTime() <= fim.getTime()) {
    dias.push(chaveDia(atual));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}

type Intervalo = [number, number];

/** Os períodos de trabalho do dia (manhã e tarde), só os que têm início E fim preenchidos e fim depois do início. */
function periodosDaJornada(j: JornadaDia | undefined): Intervalo[] {
  if (!j) return [];
  const periodos: Intervalo[] = [];
  if (j.manhaInicio != null && j.manhaFim != null && j.manhaFim > j.manhaInicio) periodos.push([j.manhaInicio, j.manhaFim]);
  if (j.tardeInicio != null && j.tardeFim != null && j.tardeFim > j.tardeInicio) periodos.push([j.tardeInicio, j.tardeFim]);
  return periodos;
}

/** Meta de minutos do dia pela jornada cadastrada, sem nenhum abono. Dia sem jornada devolve 0. */
export function metaBaseDoDia(j: JornadaDia | undefined): number {
  return periodosDaJornada(j).reduce((soma, [ini, fim]) => soma + (fim - ini), 0);
}

/** Minutos de `periodo` cobertos por algum dos intervalos (a união: intervalos sobrepostos não contam duas vezes). */
function minutosCobertos(periodo: Intervalo, intervalos: Intervalo[]): number {
  const recortados = intervalos
    .map(([ini, fim]): Intervalo => [Math.max(ini, periodo[0]), Math.min(fim, periodo[1])])
    .filter(([ini, fim]) => fim > ini)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let fimAtual = -Infinity;
  for (const [ini, fim] of recortados) {
    const de = Math.max(ini, fimAtual);
    if (fim > de) total += fim - de;
    fimAtual = Math.max(fimAtual, fim);
  }
  return total;
}

export interface MetaDoDia {
  /** Meta pela jornada, sem abono. */
  baseMinutos: number;
  /** Meta que vale: base menos o abonado. */
  metaMinutos: number;
  abonadoFeriasMinutos: number;
  abonadoFolgaMinutos: number;
  /** O dia inteiro está abonado (férias ou folga de dia inteiro): não conta como dia útil de trabalho. */
  diaInteiroAbonado: boolean;
}

/**
 * Meta do dia: férias e folga de dia inteiro zeram a meta; folga parcial tira só o trecho que cai DENTRO da jornada (folga fora do horário de trabalho não
 * muda nada). Férias valem mais que folga: o minuto abonado conta uma vez só, como férias.
 */
export function metaDoDia(jornada: JornadaDia | undefined, ctx: ContextoDia): MetaDoDia {
  const baseMinutos = metaBaseDoDia(jornada);
  if (ctx.ferias) {
    return { baseMinutos, metaMinutos: 0, abonadoFeriasMinutos: baseMinutos, abonadoFolgaMinutos: 0, diaInteiroAbonado: true };
  }
  if (ctx.ausencias.some((a) => a.diaInteiro)) {
    return { baseMinutos, metaMinutos: 0, abonadoFeriasMinutos: 0, abonadoFolgaMinutos: baseMinutos, diaInteiroAbonado: true };
  }
  const parciais: Intervalo[] = ctx.ausencias
    .filter((a) => a.inicioMin != null && a.fimMin != null && a.fimMin > a.inicioMin)
    .map((a): Intervalo => [a.inicioMin as number, a.fimMin as number]);
  const abonado = periodosDaJornada(jornada).reduce((soma, periodo) => soma + minutosCobertos(periodo, parciais), 0);
  return { baseMinutos, metaMinutos: baseMinutos - abonado, abonadoFeriasMinutos: 0, abonadoFolgaMinutos: abonado, diaInteiroAbonado: false };
}

/** Dias úteis (seg–sex) de `de` a `ate`, sem os dias inteiros abonados (férias ou folga de dia inteiro). Usada na projeção de ganho. */
export function diasUteisLiquidos(de: Date, ate: Date, diasAbonados: ReadonlySet<string> = new Set()): number {
  return diasDoPeriodo(de, ate).filter((d) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return dow !== 0 && dow !== 6 && !diasAbonados.has(d);
  }).length;
}

// ---------- Entrada de uma folga (POST/PUT /calendario/ausencias) ----------

const MINUTOS_NO_DIA = 24 * 60;

/** "YYYY-MM-DD" válido (data real) -> Date em UTC meia-noite; senão null. */
export function lerDia(texto: unknown): Date | null {
  if (typeof texto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const d = new Date(`${texto}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || chaveDia(d) !== texto ? null : d;
}

export interface AusenciaLida {
  data: Date;
  diaInteiro: boolean;
  inicioMin: number | null;
  fimMin: number | null;
  motivo: string | null;
  descontaFerias: boolean;
}

/**
 * Confere o corpo de uma folga: dia válido; dia inteiro (sem horário) ou parcial (início < fim, em minutos, dentro do dia); motivo até 200 caracteres;
 * "descontar do saldo de férias" só vale para dia INTEIRO (folga parcial nunca desconta). Devolve o erro em português.
 */
export function lerAusencia(corpo: unknown): { ok: true; valor: AusenciaLida } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== "object") return { ok: false, erro: "Informe os dados da folga." };
  const b = corpo as Record<string, unknown>;
  const data = lerDia(b.data);
  if (!data) return { ok: false, erro: "Informe uma data válida." };
  const diaInteiro = b.diaInteiro !== false;
  let inicioMin: number | null = null;
  let fimMin: number | null = null;
  if (!diaInteiro) {
    const ini = Number(b.inicioMin);
    const fim = Number(b.fimMin);
    if (b.inicioMin == null || b.fimMin == null || !Number.isInteger(ini) || !Number.isInteger(fim) || ini < 0 || fim > MINUTOS_NO_DIA || fim <= ini) {
      return { ok: false, erro: "Informe o horário da folga: o início precisa ser antes do fim." };
    }
    inicioMin = ini;
    fimMin = fim;
  }
  const motivo = typeof b.motivo === "string" && b.motivo.trim() ? b.motivo.trim() : null;
  if (motivo && motivo.length > 200) return { ok: false, erro: "O motivo pode ter até 200 caracteres." };
  const descontaFerias = b.descontaFerias === true;
  if (descontaFerias && !diaInteiro) return { ok: false, erro: "Só a folga de dia inteiro pode descontar do saldo de férias." };
  return { ok: true, valor: { data, diaInteiro, inicioMin, fimMin, motivo, descontaFerias } };
}
