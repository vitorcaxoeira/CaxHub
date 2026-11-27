// Horas Kyria x Trabalhadas: quebra das horas de cada atendente por time do chamado e, dentro do time, por área do chamado.

export interface LinhaTimeArea {
  codusu: number;
  time: string;
  area: string;
  minutos: number;
}

export interface TimeComAreas {
  time: string;
  minutos: number;
  porArea: { area: string; minutos: number }[];
}

const centesimos = (n: number) => Math.round(n * 100) / 100;

/** Agrupa as linhas (usuário, time, área) em usuário → times → áreas; times e áreas do maior para o menor (empate: ordem alfabética). */
export function agruparTimesEAreas(linhas: LinhaTimeArea[]): Map<number, TimeComAreas[]> {
  const porUsuario = new Map<number, Map<string, TimeComAreas>>();
  for (const l of linhas) {
    const times = porUsuario.get(l.codusu) ?? new Map<string, TimeComAreas>();
    const time = times.get(l.time) ?? { time: l.time, minutos: 0, porArea: [] };
    time.minutos = centesimos(time.minutos + l.minutos);
    time.porArea.push({ area: l.area, minutos: centesimos(l.minutos) });
    times.set(l.time, time);
    porUsuario.set(l.codusu, times);
  }
  const maiorPrimeiro = <T extends { minutos: number }>(nome: (x: T) => string) => (a: T, b: T) => b.minutos - a.minutos || nome(a).localeCompare(nome(b), "pt-BR");
  return new Map(
    [...porUsuario].map(([codusu, times]) => [
      codusu,
      [...times.values()].map((t) => ({ ...t, porArea: t.porArea.sort(maiorPrimeiro((a) => a.area)) })).sort(maiorPrimeiro((t) => t.time)),
    ])
  );
}
