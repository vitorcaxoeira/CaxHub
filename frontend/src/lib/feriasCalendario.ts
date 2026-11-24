// Tipos e formatadores do calendário de trabalho e do controle de férias do consultor (13/11/2026). Espelham as respostas de GET /calendario e GET /ferias/*
// (backend/src/routes/calendario.ts e ferias.ts). Horários em MINUTOS desde a meia-noite, como a jornada.

export interface Ausencia {
  id: number;
  diaInteiro: boolean;
  inicioMin: number | null;
  fimMin: number | null;
  motivo: string | null;
  descontaFerias: boolean;
}

export interface DiaCalendario {
  /** YYYY-MM-DD */
  data: string;
  /** 0=domingo ... 6=sábado */
  diaSemana: number;
  /** Meta pela jornada, sem abono. */
  baseMinutos: number;
  /** Meta que vale (já sem férias e folgas). */
  metaMinutos: number;
  apontadoMinutos: number;
  ferias: boolean;
  gozoId: number | null;
  ausencias: Ausencia[];
}

export interface Gozo {
  id: number;
  inicio: string;
  fim: string;
  diasCorridos: number;
  situacao: "programada" | "cancelada" | string;
  observacao: string | null;
  competenciaPagamento: string | null;
  diasUteis: number | null;
  horasDia: number | null;
  mediaPct: number | null;
  valorHora: number | null;
  horasFerias: number | null;
  valorFerias: number | null;
}

export interface Aquisitivo {
  id: number;
  codemp: number;
  codfor: number;
  inicio: string;
  fim: string;
  observacao: string | null;
  diasDireito: number;
  /** Férias remuneradas (o gozo calcula o valor) ou só marcam os dias no calendário (sem valor). */
  remunerado: boolean;
  diasGozados: number;
  diasFolgaDescontada: number;
  saldo: number;
  gozos: Gozo[];
}

export interface RespostaCalendario {
  semConsultor?: boolean;
  consultor: { codemp: number; codfor: number; nome: string; depexe: number | null };
  ano: number;
  mes: number;
  dias: DiaCalendario[];
  totais: { metaMinutos: number; abonadoFeriasMinutos: number; abonadoFolgaMinutos: number; apontadoMinutos: number };
  saldos: Aquisitivo[];
  permissoes: { editarFolgas: boolean; lancarFerias: boolean; proprio: boolean };
}

export interface Simulacao {
  inicio: string;
  fim: string;
  diasCorridos: number;
  diasUteis: number;
  horasDia: number;
  mediaPct: number;
  meses: { ano: number; mes: number; minutos: number; pct: number }[];
  valorHora: number | null;
  horasFerias: number;
  valorFerias: number | null;
}

/** "2026-11-20" -> "20/11/2026" (sem passar por Date: não desloca o dia pelo fuso). */
export function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Minutos -> "HH:MM". */
export function hhmm(minutos: number): string {
  return `${String(Math.trunc(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

/** "14:30" (valor do <input type="time">) -> minutos; vazio ou inválido -> null. */
export function horaParaMinutos(valor: string): number | null {
  if (!valor) return null;
  const [h, m] = valor.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

export const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const DIAS_SEMANA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Mensagem de erro da API (ou o padrão). */
export function mensagemDeErro(err: unknown, padrao: string): string {
  const resposta = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return typeof resposta === "string" && resposta ? resposta : padrao;
}
