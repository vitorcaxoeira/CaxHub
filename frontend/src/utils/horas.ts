const horasInteirasFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

// USU_QtdHor (Senior) vem em minutos. Exibimos como "horas:minutos" com separador
// de milhar na parte de horas (ex.: "21.165:00 h") — nunca hh:mm tradicional, que
// assume no máximo 24h; aqui as horas podem passar de 1.000.
export function formatHoras(horasDecimais: number): string {
  const totalMinutos = Math.round(horasDecimais * 60);
  const horas = Math.trunc(totalMinutos / 60);
  const minutos = Math.abs(totalMinutos % 60);
  return `${horasInteirasFormatter.format(horas)}:${String(minutos).padStart(2, "0")} h`;
}

// Aceita "H:MM" (H sem limite de dígitos, já que passa de 1.000h com facilidade), nunca
// decimal — mesmo formato de entrada usado nos formulários de alocação.
export function horasParaMinutos(horas: string): number | null {
  const match = horas.trim().match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total > 0 ? total : null;
}

export function minutosParaInputHoras(minutos: number | null): string {
  if (minutos == null) return "";
  const totalMinutos = Math.round(minutos);
  const horasParte = Math.trunc(totalMinutos / 60);
  const minutosParte = Math.abs(totalMinutos % 60);
  return `${horasParte}:${String(minutosParte).padStart(2, "0")}`;
}
