import type { Tone } from "../components/ui/badges";

export type Senso = "seiri" | "seiton" | "seiso" | "seiketsu" | "shitsuke";

export const SENSOS: { chave: Senso; nome: string; rotulo: string; curto: string }[] = [
  { chave: "seiri", nome: "Seiri", rotulo: "Seiri – Utilização", curto: "Utilização" },
  { chave: "seiton", nome: "Seiton", rotulo: "Seiton – Organização", curto: "Organização" },
  { chave: "seiso", nome: "Seiso", rotulo: "Seiso – Limpeza", curto: "Limpeza" },
  { chave: "seiketsu", nome: "Seiketsu", rotulo: "Seiketsu – Padronização", curto: "Padronização" },
  { chave: "shitsuke", nome: "Shitsuke", rotulo: "Shitsuke – Disciplina", curto: "Disciplina" },
];

export type TipoArea = "setor" | "comum";
export type Papel5S = "coordenador" | "avaliador" | "lider";
export type Tendencia = "melhora" | "queda" | "estavel" | null;

export const PAPEL_ROTULO: Record<Papel5S, string> = { coordenador: "Coordenador", avaliador: "Avaliador", lider: "Líder" };
export const TIPO_AREA_ROTULO: Record<TipoArea, string> = { setor: "Setor", comum: "Ambiente comum" };

export interface Acesso5S {
  papel: Papel5S | null;
  areasLider: number[];
  pode: { gerenciarCadastros: boolean; avaliar: boolean; observar: boolean };
}

export type PorSenso = Record<Senso, number | null>;
export interface Percentuais {
  geral: number | null;
  porSenso: PorSenso;
}

export interface ImagemRef {
  id: number;
  nomeArquivo: string;
}

export function formatarPerc(v: number | null | undefined, casas = 0): string {
  if (v == null) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

// Faixas de leitura do resultado: ≥85 bom, 70–85 atenção, <70 crítico.
export function tomDaNota(v: number | null | undefined): Tone {
  if (v == null) return "neutral";
  if (v >= 85) return "success";
  if (v >= 70) return "warning";
  return "destructive";
}

export const CELULA_TOM: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  neutral: "text-muted",
};

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// "2026-09" → "Set/2026"
export function rotuloMes(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MESES[mes - 1]}/${ano}`;
}

export function rotuloMesLongo(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  return `${MESES_LONGOS[mes - 1]} ${ano}`;
}

export function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function somarMeses(chave: string, delta: number): string {
  const [ano, mes] = chave.split("-").map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-09-18" → "18/09/2026"
export function formatarDiaIso(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Tendência entre os dois últimos valores com dado da série (mesma faixa de ±1 p.p. do backend).
export function tendenciaEntre(serie: Array<number | null>): Tendencia {
  const v = serie.filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const diff = v[v.length - 1] - v[v.length - 2];
  if (diff > 1) return "melhora";
  if (diff < -1) return "queda";
  return "estavel";
}

export function mensagemDeErro(err: unknown, padrao: string): string {
  const e = err as { response?: { data?: { error?: string } } };
  return e?.response?.data?.error ?? padrao;
}
