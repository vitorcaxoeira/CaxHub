// Plano de Evolução Profissional e Eficiência (consultores PJ) — calendário dos ciclos.
// Funções PURAS, sem banco. Datas são texto "AAAA-MM-DD" (nunca Date): evita deslocar um dia por fuso, como no resto do Painel de Eficiência.
// Regulamento v3.1, itens 3.1 a 3.3.

const MS_DIA = 86_400_000;

const paraUtc = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
};
const deUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const dataIsoValida = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && deUtc(paraUtc(v)) === v;
export const somarDias = (iso: string, dias: number) => deUtc(paraUtc(iso) + dias * MS_DIA);
/** Dias de `a` até `b` (positivo quando `b` é depois de `a`). */
export const diasEntre = (a: string, b: string) => Math.round((paraUtc(b) - paraUtc(a)) / MS_DIA);

export type Semestre = 1 | 2;

export const VIGENCIA_INICIO = "2027-01-01";
export const CICLOS_PARA_EFETIVAR = 10;

export function periodoDoSemestre(ano: number, semestre: Semestre): { inicio: string; fim: string } {
  return semestre === 1 ? { inicio: `${ano}-01-01`, fim: `${ano}-06-30` } : { inicio: `${ano}-07-01`, fim: `${ano}-12-31` };
}

export function semestreDaData(iso: string): { ano: number; semestre: Semestre } {
  const ano = Number(iso.slice(0, 4));
  return { ano, semestre: Number(iso.slice(5, 7)) <= 6 ? 1 : 2 };
}

export function semestreSeguinte(ano: number, semestre: Semestre): { ano: number; semestre: Semestre } {
  return semestre === 1 ? { ano, semestre: 2 } : { ano: ano + 1, semestre: 1 };
}

/**
 * Início do 1º ciclo de quem assinou o Termo de Ciência em `adesaoIso` (item 3.1): quem adere até a abertura (01/01/2027) começa nela;
 * depois disso, o 1º ciclo começa no primeiro dia do semestre civil seguinte à assinatura. Assinar exatamente no 1º dia de um semestre
 * começa nesse mesmo dia.
 */
export function inicioDoPrimeiroCiclo(adesaoIso: string, vigenciaIso: string = VIGENCIA_INICIO): string {
  if (adesaoIso <= vigenciaIso) return vigenciaIso;
  const { ano, semestre } = semestreDaData(adesaoIso);
  const { inicio } = periodoDoSemestre(ano, semestre);
  if (adesaoIso === inicio) return inicio;
  const prox = semestreSeguinte(ano, semestre);
  return periodoDoSemestre(prox.ano, prox.semestre).inicio;
}

/** Os semestres civis dos `n` ciclos seguidos a partir de (ano, semestre). */
export function sequenciaDeSemestres(ano: number, semestre: Semestre, n: number): { ciclo: number; ano: number; semestre: Semestre; inicio: string; fim: string }[] {
  const saida: { ciclo: number; ano: number; semestre: Semestre; inicio: string; fim: string }[] = [];
  let atual = { ano, semestre };
  for (let i = 1; i <= n; i++) {
    saida.push({ ciclo: i, ...atual, ...periodoDoSemestre(atual.ano, atual.semestre) });
    atual = semestreSeguinte(atual.ano, atual.semestre);
  }
  return saida;
}

export interface CalendarioDoCiclo {
  abertura: string;
  corteEvidencias: string;
  apuracaoAte: string;
  devolutivaEm: string;
  contestacaoAte: string;
  encerramento: string;
}

/**
 * Datas padrão do calendário interno (item 3.2), contadas a partir do FIM do ciclo: corte de evidências 30 dias antes, apuração e devolutiva
 * 10 dias antes, contestação 5 dias antes (5 dias corridos após a devolutiva). No 1º ciclo de 2027 isso dá 31/05, 20/06, 20/06, 25/06 e 30/06,
 * as datas do regulamento. A gestão confirma as datas efetivas na abertura de cada ciclo (item 12), então tudo isto é só o padrão.
 */
export function calendarioDoCiclo(inicio: string, fim: string): CalendarioDoCiclo {
  return {
    abertura: inicio,
    corteEvidencias: somarDias(fim, -30),
    apuracaoAte: somarDias(fim, -10),
    devolutivaEm: somarDias(fim, -10),
    contestacaoAte: somarDias(fim, -5),
    encerramento: fim,
  };
}

/** Interrupção formal acima de 30 dias corridos prorroga o ciclo pelo mesmo número de dias (item 3.3). Até 30 dias, nada muda. */
export function fimProrrogado(fim: string, diasDeInterrupcao: number): string {
  return diasDeInterrupcao > 30 ? somarDias(fim, diasDeInterrupcao) : fim;
}

/** O ciclo está em andamento na data? (início e fim incluídos) */
export const cicloContem = (inicio: string, fim: string, iso: string) => iso >= inicio && iso <= fim;
