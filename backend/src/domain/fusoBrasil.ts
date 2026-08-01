// Conversão entre instante (Date, sempre UTC por dentro) e hora de parede brasileira.
//
// POR QUE ISTO EXISTE, e por que nada aqui usa getHours()/getDay():
//
//   ambiente          TZ          offset   new Date() no MESMO instante
//   ----------------  ----------  -------  ----------------------------
//   dev (Windows)     não definida  -3     Fri Jul 31 2026 23:00
//   produção (docker) não definida   0     2026-08-01T02:00Z
//
// Medido em 31/07/2026. Uma jornada que termina "18:00" é hora de parede de São Paulo;
// escrever a comparação com o relógio do servidor funcionaria em desenvolvimento e
// erraria por 3 horas em produção — e na virada do dia erraria o dia da semana junto,
// justamente o caso do card esquecido na sexta à noite.
//
// Também não vale setar TZ no container: o projeto tem uma convenção inteira de datas em
// UTC (`@db.Date`, formatadores com timeZone "UTC") que mudaria de comportamento junto.
// A conversão fica isolada aqui.

export const FUSO_BRASIL = "America/Sao_Paulo";

const formatador = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_BRASIL,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

interface HoraParede {
  ano: number;
  mes: number; // 1-12
  dia: number;
  minutosDoDia: number; // desde a meia-noite local
  diaSemana: number; // 0=domingo .. 6=sábado
}

// Instante -> hora de parede em São Paulo.
export function paraHoraBrasil(instante: Date): HoraParede {
  const partes = Object.fromEntries(formatador.formatToParts(instante).map((p) => [p.type, p.value]));
  const ano = Number(partes.year);
  const mes = Number(partes.month);
  const dia = Number(partes.day);
  const hora = Number(partes.hour === "24" ? "0" : partes.hour);
  const minuto = Number(partes.minute);

  // Dia da semana calculado sobre a data LOCAL montada em UTC — usar getUTCDay direto no
  // instante daria o dia errado sempre que a hora local e a UTC caíssem em dias
  // diferentes, que é exatamente o cenário noturno que a jornada precisa tratar.
  const diaSemana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();

  return { ano, mes, dia, minutosDoDia: hora * 60 + minuto, diaSemana };
}

// Offset do fuso, em minutos, NAQUELE instante — calculado, e não constante, porque o
// horário de verão brasileiro pode voltar e mudaria o valor conforme a data.
function offsetMinutos(instante: Date): number {
  const { ano, mes, dia, minutosDoDia } = paraHoraBrasil(instante);
  const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia) + minutosDoDia * 60_000;
  // Segundos zerados dos dois lados pra o arredondamento não introduzir 1 minuto de erro.
  const instanteSemSegundos = Math.floor(instante.getTime() / 60_000) * 60_000;
  return Math.round((comoSeFosseUtc - instanteSemSegundos) / 60_000);
}

// Hora de parede brasileira -> instante. `minutosDoDia` pode passar de 1440 (ex.: fim de
// expediente às 24:00), e a data avança sozinha.
//
// O offset é medido no próprio dia informado, então uma virada de horário de verão no
// meio do caminho não desloca o resultado.
export function doDiaBrasil(referencia: Date, minutosDoDia: number): Date {
  const { ano, mes, dia } = paraHoraBrasil(referencia);
  const offset = offsetMinutos(referencia);
  return new Date(Date.UTC(ano, mes - 1, dia) + (minutosDoDia - offset) * 60_000);
}
