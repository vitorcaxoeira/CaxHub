// Lógica pura dos grupos expansíveis do MultiSelectDropdown (18/11/2026): como as opções se agrupam, quando um grupo aparece aberto e quantas opções
// marcadas ele tem. Fica fora do componente para ter teste.

export interface OpcaoAgrupavel {
  value: string | number;
  label: string;
  grupo?: string;
}

export const GRUPO_PADRAO = "Sem grupo";

/** Grupos na ordem em que aparecem nas opções, cada um com as suas (opção sem grupo cai em "Sem grupo"). */
export function agruparOpcoes<T extends OpcaoAgrupavel>(opcoes: T[]): [string, T[]][] {
  const mapa = new Map<string, T[]>();
  for (const o of opcoes) {
    const g = o.grupo ?? GRUPO_PADRAO;
    const atual = mapa.get(g);
    if (atual) atual.push(o);
    else mapa.set(g, [o]);
  }
  return [...mapa.entries()];
}

/**
 * Grupo aparece aberto quando a pessoa o expandiu, ou quando há busca digitada: só sobram na lista os grupos com resultado, e deixá-los contraídos
 * esconderia o que a busca achou. A cada abertura da lista `abertos` volta a vazio, então tudo começa contraído.
 */
export function grupoEstaAberto(buscaAtiva: boolean, abertos: ReadonlySet<string>, grupo: string): boolean {
  return buscaAtiva || abertos.has(grupo);
}

/** Quantas opções marcadas o grupo tem, contando TODAS as opções dele (não só as que passam na busca). */
export function marcadasDoGrupo<T extends OpcaoAgrupavel>(todas: T[], grupo: string, selecionados: readonly (string | number)[]): number {
  return todas.filter((o) => (o.grupo ?? GRUPO_PADRAO) === grupo && selecionados.includes(o.value)).length;
}

/** Texto da opção no gatilho: "Grupo · Etiqueta" quando agrupado (etiquetas de grupos diferentes podem ter o mesmo nome). */
export function rotuloComGrupo(o: OpcaoAgrupavel | undefined, agrupar: boolean): string | undefined {
  if (!o) return undefined;
  return agrupar && o.grupo ? `${o.grupo} · ${o.label}` : o.label;
}
