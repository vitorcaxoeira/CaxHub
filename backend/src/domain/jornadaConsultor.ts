import { JornadaConsultor } from "@prisma/client";
import { doDiaBrasil, paraHoraBrasil } from "./fusoBrasil";

// Regras da jornada de trabalho — separadas da varredura pra poderem ser testadas sem
// banco e sem relógio.

export interface Periodo {
  inicio: number; // minutos desde a meia-noite, hora de São Paulo
  fim: number;
}

// Os períodos do dia, em ordem. Período pela metade (só início ou só fim) é descartado:
// não dá pra recortar uma sessão contra um limite que não existe.
export function periodosDoDia(jornada: JornadaConsultor): Periodo[] {
  const periodos: Periodo[] = [];
  if (jornada.manhaInicio != null && jornada.manhaFim != null && jornada.manhaFim > jornada.manhaInicio) {
    periodos.push({ inicio: jornada.manhaInicio, fim: jornada.manhaFim });
  }
  if (jornada.tardeInicio != null && jornada.tardeFim != null && jornada.tardeFim > jornada.tardeInicio) {
    periodos.push({ inicio: jornada.tardeInicio, fim: jornada.tardeFim });
  }
  return periodos.sort((a, b) => a.inicio - b.inicio);
}

// Até quando uma sessão iniciada em `inicioSessao` pode contar, segundo a jornada daquele
// dia. `null` = sem limite de expediente (consultor sem jornada cadastrada, ou dia sem
// período válido — ver o comentário de decisão abaixo).
//
// Três casos:
//   - início DENTRO de um período  -> limite é o fim daquele período
//   - início ANTES de um período   -> limite é o fim desse período (quem começou 07:00
//                                     com expediente 08:00-12:00 registra 07:00-12:00)
//   - início DEPOIS do último      -> limite é o próprio início: a sessão fecha com
//                                     duração zero e não vira apontamento
//
// Repare que isto só decide ONDE CORTAR: o início da sessão é o que o consultor marcou e
// não é mexido. Uma sessão que começa no intervalo de almoço vai contar o almoço junto,
// porque descontar o vão exigiria partir a sessão em duas — e a sessão vira pendência,
// onde o consultor ajusta o horário antes de confirmar. O objetivo aqui é impedir o card
// esquecido de contar a noite e o fim de semana, não auditar o intervalo.
export function limitePorExpediente(inicioSessao: Date, jornada: JornadaConsultor | null): Date | null {
  if (!jornada) return null;
  const periodos = periodosDoDia(jornada);
  // Dia sem período válido (folga) — a sessão não deveria nem ter começado, então o limite
  // é o próprio início e ela é descartada.
  if (periodos.length === 0) return inicioSessao;

  const { minutosDoDia } = paraHoraBrasil(inicioSessao);

  for (const periodo of periodos) {
    if (minutosDoDia < periodo.inicio) return doDiaBrasil(inicioSessao, periodo.fim);
    if (minutosDoDia < periodo.fim) return doDiaBrasil(inicioSessao, periodo.fim);
  }
  return inicioSessao;
}

// Dia da semana (0=dom..6=sáb) em que a sessão começou, em hora de São Paulo — é a chave
// pra buscar a jornada certa. Nunca derivar isso de getDay() do servidor.
export function diaSemanaDaSessao(inicioSessao: Date): number {
  return paraHoraBrasil(inicioSessao).diaSemana;
}
