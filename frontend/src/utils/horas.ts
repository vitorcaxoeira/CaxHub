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
