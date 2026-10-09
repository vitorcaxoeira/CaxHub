// Formatadores das telas de RH. Regras que valem para todas:
//   moeda      sempre com "R$"; compacta (mil, mi) só em eixo de gráfico e cartão apertado
//   horas      decimais com "h" (1.234,5 h), nunca "2649:16:12"
//   percentual valor já em % (12,3) -> "12,3%"; null vira "—"
//   null       "—": nunca zero no lugar de "sem dado"

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const decimal2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const reaisCentavos = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VAZIO = "—";

export const fmtInt = (v: number | null | undefined) => (v == null ? VAZIO : inteiro.format(v));
export const fmtDec = (v: number | null | undefined, casas = 1) => (v == null ? VAZIO : (casas === 2 ? decimal2 : decimal1).format(v));
export const fmtMoeda = (v: number | null | undefined) => (v == null ? VAZIO : reais.format(v));
export const fmtMoedaCentavos = (v: number | null | undefined) => (v == null ? VAZIO : reaisCentavos.format(v));
export const fmtPct = (v: number | null | undefined, casas = 1) => (v == null ? VAZIO : `${(casas === 2 ? decimal2 : decimal1).format(v)}%`);
export const fmtHoras = (v: number | null | undefined) => (v == null ? VAZIO : `${decimal1.format(v)} h`);

/** 1.234.567 -> "1,2 mi"; 45.300 -> "45 mil". Para rótulo de eixo e valor sobre barra. */
export function fmtCompacto(v: number | null | undefined, prefixo = ""): string {
  if (v == null) return VAZIO;
  const abs = Math.abs(v);
  const sinal = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sinal}${prefixo}${decimal1.format(abs / 1_000_000)} mi`;
  if (abs >= 10_000) return `${sinal}${prefixo}${inteiro.format(abs / 1000)} mil`;
  if (abs >= 1000) return `${sinal}${prefixo}${decimal1.format(abs / 1000)} mil`;
  return `${sinal}${prefixo}${inteiro.format(abs)}`;
}

export const fmtMoedaCompacta = (v: number | null | undefined) => fmtCompacto(v, "R$ ");

/** "2026-04-13T00:00:00.000Z" -> "13/04/2026" (sem fuso: a data do Senior é só data). */
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return VAZIO;
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return VAZIO;
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function fmtMesAno(iso: string | null | undefined): string {
  if (!iso) return VAZIO;
  const [a, m] = iso.slice(0, 7).split("-");
  return `${m}/${a}`;
}

/** Variação percentual já calculada (12,3 -> "+12,3%"). */
export function fmtVariacao(v: number | null | undefined): string {
  if (v == null) return VAZIO;
  return `${v > 0 ? "+" : ""}${decimal1.format(v)}%`;
}

/** "1 pessoa", "5 pessoas". */
export const fmtPessoas = (n: number | null | undefined) => (n == null ? "—" : `${inteiro.format(n)} pessoa${n === 1 ? "" : "s"}`);
