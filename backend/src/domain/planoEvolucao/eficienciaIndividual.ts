// Plano de Evolução Profissional e Eficiência — requisito 6.4 (Eficiência Individual) e indicador de apontamento online.
// Funções PURAS, sem banco.

/**
 * Indicadores da eficiência operacional (item 6.4). Os automáticos o CaxHub calcula; os manuais o gestor lança na apuração (Fase 2).
 * `cronograma` existe no regulamento mas está DESATIVADO: a data prevista de fim está preenchida em 0,2% das atividades (Fase 0).
 */
export const INDICADORES = [
  { chave: "produtividade", rotulo: "Produtividade", tipo: "automatico", descricao: "Horas do consultor dentro do orçado do item ÷ horas executadas, nos itens da área, no ciclo." },
  { chave: "apontamento_online", rotulo: "Apontamento online", tipo: "automatico", descricao: "Parte das horas do ciclo apontadas ao vivo, pelo Start/Stop, e não depois do fato." },
  { chave: "cronograma", rotulo: "Cumprimento de cronogramas", tipo: "manual", descricao: "Entregas no prazo acordado com o cliente. Sem base automática: a data prevista de fim quase não é preenchida." },
  { chave: "retrabalho", rotulo: "Retrabalho", tipo: "manual", descricao: "Horas gastas em correção de entrega própria já dada como concluída." },
  { chave: "qualidade_tecnica", rotulo: "Qualidade técnica", tipo: "manual", descricao: "Aderência às boas práticas do produto e ausência de incidentes atribuíveis à execução." },
  { chave: "aderencia_processos", rotulo: "Aderência aos processos internos", tipo: "manual", descricao: "Uso correto de proposta de serviço, ata de levantamento, registro de pendências e follow-up." },
] as const;
export type ChaveIndicador = (typeof INDICADORES)[number]["chave"];
export const CHAVES_INDICADORES: string[] = INDICADORES.map((i) => i.chave);

export interface ResultadoIndicador {
  chave: string;
  peso: number;
  /** true/false = atingiu a meta; null = sem base (automático sem amostra) ou manual ainda não lançado. */
  atingiu: boolean | null;
}

export interface VereditoEficienciaIndividual {
  /** true/false quando dá para concluir; null quando nenhum indicador tem base. */
  cumpriu: boolean | null;
  /** Peso dos indicadores atingidos, e peso dos que têm base (denominador). */
  pontos: number;
  base: number;
  /** Nota em % (pontos ÷ base), ou null sem base. */
  nota: number | null;
  /** Indicadores que ficaram de fora da conta por não terem base ainda. */
  semBase: string[];
}

/**
 * Requisito 6.4: cada indicador que atinge a meta soma o seu peso; o requisito é cumprido se a soma dos pesos atingidos ÷ soma dos pesos
 * COM BASE for >= `notaMinimaPct` (padrão 100: todos os indicadores com base atingidos). Indicador sem base não entra nem no numerador nem
 * no denominador (KPI honesto: falta de dado não reprova ninguém). Na apuração final (Fase 2) o gestor completa os manuais antes de fechar.
 */
export function cumpreEficienciaIndividual(indicadores: ResultadoIndicador[], notaMinimaPct = 100): VereditoEficienciaIndividual {
  const comBase = indicadores.filter((i) => i.atingiu != null && i.peso > 0);
  const semBase = indicadores.filter((i) => i.atingiu == null && i.peso > 0).map((i) => i.chave);
  const base = comBase.reduce((t, i) => t + i.peso, 0);
  if (base === 0) return { cumpriu: null, pontos: 0, base: 0, nota: null, semBase };
  const pontos = comBase.filter((i) => i.atingiu).reduce((t, i) => t + i.peso, 0);
  const nota = (pontos / base) * 100;
  return { cumpriu: nota + 1e-9 >= notaMinimaPct, pontos, base, nota, semBase };
}

// ---------------------------------------------------------------- apontamento online

/** De onde veio a hora apontada (medido na Fase 0). */
export type OrigemDaHora =
  /** Sessão Start/Stop criada até 5 min depois de começar. */
  | "ao_vivo"
  /** Sessão nascida de solicitação de apontamento aprovada: retroativo explícito. */
  | "solicitacao"
  /** Sessão criada mais de 5 min depois de começar, sem solicitação: retroativo provável. */
  | "sessao_tardia"
  /** Lançado direto no Senior, sem sessão do CaxHub. Sem carimbo de criação: só dá para olhar o atraso entre `datati` e `datreg`. */
  | "senior";

export interface HoraComOrigem {
  minutos: number;
  origem: OrigemDaHora;
  /** Dias entre a data trabalhada e a de registro (só para origem "senior"). null = sem data de registro. */
  atrasoDias: number | null;
}

/**
 * Definição A: só o Start/Stop ao vivo conta como online (é o que o regulamento diz: "online, via StartStop, no momento da execução").
 * Definição B: A, mais o lançamento no Senior registrado no MESMO dia do trabalho. A escolha é política (parâmetro do ciclo).
 */
export type DefinicaoOnline = "A" | "B";

export function ehOnline(h: HoraComOrigem, definicao: DefinicaoOnline): boolean {
  if (h.origem === "ao_vivo") return true;
  return definicao === "B" && h.origem === "senior" && h.atrasoDias != null && h.atrasoDias <= 0;
}

export interface ApontamentoOnline {
  totalMin: number;
  onlineMin: number;
  /** % das horas online, ou null sem horas. */
  pct: number | null;
}

export function apontamentoOnline(horas: HoraComOrigem[], definicao: DefinicaoOnline): ApontamentoOnline {
  let total = 0;
  let online = 0;
  for (const h of horas) {
    if (h.minutos <= 0) continue;
    total += h.minutos;
    if (ehOnline(h, definicao)) online += h.minutos;
  }
  return { totalMin: total, onlineMin: online, pct: total > 0 ? (online / total) * 100 : null };
}

/** Comparação com a meta, com a mesma regra de amostra mínima da eficiência. */
export function avaliarOnline(a: ApontamentoOnline, meta: number | null, amostraMinimaMin: number): { pct: number | null; atingiu: boolean | null; semBase: boolean } {
  if (a.totalMin < amostraMinimaMin || a.pct == null) return { pct: a.pct, atingiu: null, semBase: true };
  if (meta == null) return { pct: a.pct, atingiu: null, semBase: false };
  return { pct: a.pct, atingiu: a.pct + 1e-9 >= meta, semBase: false };
}
