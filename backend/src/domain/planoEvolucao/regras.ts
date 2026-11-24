// Plano de Evolução Profissional e Eficiência (consultores PJ) — regras do regulamento v3.1, itens 4 a 10.
// Funções PURAS, sem banco. Tudo em PONTOS-BASE (1 p.p. = 100 bp) e CENTAVOS inteiros: nada de ponto flutuante na conta do valor hora,
// porque 105,5% de R$ 109,50 tem que dar exatamente R$ 115,52 (e 114,975 arredonda para 114,98, o que Number não garante).

import { CICLOS_PARA_EFETIVAR } from "./calendario";

export const PONTUACAO_INDIVIDUAL_BP = 400; // 4 requisitos individuais × 1%
export const PONTUACAO_GLOBAL_BP = 100; // requisito global, opcional
export const REFORCADOR_BP_POR_CICLO = 50; // +0,5 p.p. por ciclo consecutivo já cumprido
export const NOTA_MINIMA_COMPETENCIAS = 80; // portão do item 4
export const MEDIA_MINIMA_CLIENTES = 8; // item 6.2.2
export const AMOSTRA_MINIMA_CLIENTES = 3;

/** Os 4 requisitos individuais, indivisíveis (item 5). A ordem é a do regulamento. */
export const REQUISITOS_INDIVIDUAIS = [
  { chave: "certificacoes", rotulo: "Certificações Técnicas", item: "6.1" },
  { chave: "avaliacaoClientes", rotulo: "Avaliação de Clientes", item: "6.2" },
  { chave: "caseTecnico", rotulo: "Case Técnico", item: "6.3" },
  { chave: "eficienciaIndividual", rotulo: "Eficiência Individual", item: "6.4" },
] as const;
export type ChaveRequisito = (typeof REQUISITOS_INDIVIDUAIS)[number]["chave"];

/** Verdadeiro, falso, ou null = ainda não apurado/lançado. */
export type Tri = boolean | null;

export interface EstadoParticipante {
  /** Valor Hora Base vigente em centavos: o contratado, ou o da última Efetivação. */
  baseCentavos: number;
  /** Ciclos consecutivos cumpridos desde o último reinício ou efetivação (0 a 9). */
  consecutivos: number;
}

export interface EntradaApuracao {
  /** Portão 1 (item 4): contrato ativo durante todo o ciclo. */
  contratoAtivoNoCiclo: boolean;
  /** Portão 2 (item 4): os 6 meses integrais do ciclo (com prorrogação por interrupção formal contando normalmente). */
  cicloCompleto: boolean;
  /** Portão 3 (item 4): Avaliação de Competências, 0 a 100. null = ainda não lançada. */
  competenciasPct: number | null;
  certificacoes: Tri;
  avaliacaoClientes: Tri;
  caseTecnico: Tri;
  eficienciaIndividual: Tri;
  /** Requisito global (coletivo, opcional). null = ainda não apurado. */
  global: Tri;
}

export type StatusCiclo = "cumprido" | "descumprido" | "nao_apurado";

export interface ResultadoCiclo {
  status: StatusCiclo;
  /** Por que descumpriu ou não foi apurado (chaves de REQUISITOS_INDIVIDUAIS, "competencias", "contrato" ou "ciclo_incompleto"). */
  motivos: string[];
  /** Requisitos ainda sem resultado: o ciclo é uma PROJEÇÃO enquanto houver algum. */
  pendentes: string[];
  projetado: boolean;
  pontuacaoBp: number;
  reforcadorBp: number;
  percentualBp: number;
  valorHoraCentavos: number;
  /** Posição do ciclo na sequência (1 a 10) quando cumprido. */
  cicloNaSequencia: number | null;
  efetivou: boolean;
}

export interface SaidaApuracao {
  resultado: ResultadoCiclo;
  proximo: EstadoParticipante;
}

/** base × (1 + bp/10000), em centavos, arredondando meio para cima. Aritmética inteira. */
export function aplicarPercentual(baseCentavos: number, percentualBp: number): number {
  return Math.floor((baseCentavos * (10_000 + percentualBp) + 5_000) / 10_000);
}

export const reforcadorBp = (consecutivos: number) => REFORCADOR_BP_POR_CICLO * consecutivos;

/** Avaliação de Clientes (item 6.2.2): menos de 3 respostas = cumprido (a ausência de resposta não é do consultor); senão, média >= 8,0. */
export function avaliacaoClientesCumprida(media: number | null, respostas: number): boolean {
  if (respostas < AMOSTRA_MINIMA_CLIENTES) return true;
  return media != null && media >= MEDIA_MINIMA_CLIENTES;
}

/**
 * Apura (ou projeta) UM ciclo. Com requisitos em null o resultado é uma projeção que assume os pendentes como cumpridos
 * (`projetado: true`, `pendentes` lista quais); falhar qualquer requisito já conhecido descumpre o ciclo na hora.
 *
 * Regras (itens 4, 5, 7, 9 e 10):
 *  - contrato inativo ou ciclo incompleto: "não apurado". Não vale percentual e, por padrão, não quebra a sequência
 *    (`naoApuradoQuebraSequencia` muda isso: o texto do regulamento só diz que "não conta").
 *  - competências < 80% ou qualquer requisito individual falho: descumprido. Pontuação e reforçador zeram, volta à base vigente e a sequência recomeça.
 *  - senão: pontuação 4% (+1% se o global foi atingido) + reforçador (+0,5 p.p. por ciclo consecutivo cumprido antes), SEMPRE sobre a base, nunca sobre o ciclo anterior.
 *  - 10º ciclo consecutivo cumprido: o valor do ciclo vira a nova base e a sequência recomeça (Efetivação).
 */
export function apurarCiclo(
  estado: EstadoParticipante,
  entrada: EntradaApuracao,
  opcoes: { naoApuradoQuebraSequencia?: boolean } = {}
): SaidaApuracao {
  const base = estado.baseCentavos;

  const motivosPortao: string[] = [];
  if (!entrada.contratoAtivoNoCiclo) motivosPortao.push("contrato");
  if (!entrada.cicloCompleto) motivosPortao.push("ciclo_incompleto");
  if (motivosPortao.length > 0) {
    return {
      resultado: {
        status: "nao_apurado",
        motivos: motivosPortao,
        pendentes: [],
        projetado: false,
        pontuacaoBp: 0,
        reforcadorBp: 0,
        percentualBp: 0,
        valorHoraCentavos: base,
        cicloNaSequencia: null,
        efetivou: false,
      },
      proximo: { baseCentavos: base, consecutivos: opcoes.naoApuradoQuebraSequencia ? 0 : estado.consecutivos },
    };
  }

  const falhas: string[] = [];
  const pendentes: string[] = [];
  if (entrada.competenciasPct == null) pendentes.push("competencias");
  else if (entrada.competenciasPct < NOTA_MINIMA_COMPETENCIAS) falhas.push("competencias");
  for (const r of REQUISITOS_INDIVIDUAIS) {
    const v = entrada[r.chave];
    if (v == null) pendentes.push(r.chave);
    else if (!v) falhas.push(r.chave);
  }
  if (entrada.global == null) pendentes.push("global");

  if (falhas.length > 0) {
    return {
      resultado: {
        status: "descumprido",
        motivos: falhas,
        pendentes,
        projetado: false,
        pontuacaoBp: 0,
        reforcadorBp: 0,
        percentualBp: 0,
        valorHoraCentavos: base,
        cicloNaSequencia: null,
        efetivou: false,
      },
      proximo: { baseCentavos: base, consecutivos: 0 },
    };
  }

  const pontuacaoBp = PONTUACAO_INDIVIDUAL_BP + (entrada.global === true ? PONTUACAO_GLOBAL_BP : 0);
  const reforco = reforcadorBp(estado.consecutivos);
  const percentualBp = pontuacaoBp + reforco;
  const valorHoraCentavos = aplicarPercentual(base, percentualBp);
  const cicloNaSequencia = estado.consecutivos + 1;
  const efetivou = cicloNaSequencia >= CICLOS_PARA_EFETIVAR;

  return {
    resultado: {
      status: "cumprido",
      motivos: [],
      pendentes,
      projetado: pendentes.length > 0,
      pontuacaoBp,
      reforcadorBp: reforco,
      percentualBp,
      valorHoraCentavos,
      cicloNaSequencia,
      efetivou,
    },
    // Efetivação: o valor do 10º ciclo é incorporado em definitivo e o plano recomeça sobre a nova base, com reforçador zerado.
    proximo: efetivou ? { baseCentavos: valorHoraCentavos, consecutivos: 0 } : { baseCentavos: base, consecutivos: cicloNaSequencia },
  };
}

/** Roda uma sequência de ciclos (cada um com a sua entrada) a partir de um estado, devolvendo todos os resultados. */
export function apurarSequencia(
  estadoInicial: EstadoParticipante,
  entradas: EntradaApuracao[],
  opcoes: { naoApuradoQuebraSequencia?: boolean } = {}
): { resultados: ResultadoCiclo[]; estadoFinal: EstadoParticipante } {
  let estado = estadoInicial;
  const resultados: ResultadoCiclo[] = [];
  for (const e of entradas) {
    const s = apurarCiclo(estado, e, opcoes);
    resultados.push(s.resultado);
    estado = s.proximo;
  }
  return { resultados, estadoFinal: estado };
}

export interface ProjecaoDoCiclo {
  /** Se o global for atingido nesta rodada. */
  comGlobal: ResultadoCiclo;
  /** Se o global NÃO for atingido. */
  semGlobal: ResultadoCiclo;
}

/** Os dois desfechos possíveis do ciclo: o requisito global é coletivo e fora do controle do consultor (item 7.3). */
export function projetarCiclo(estado: EstadoParticipante, entrada: EntradaApuracao, opcoes: { naoApuradoQuebraSequencia?: boolean } = {}): ProjecaoDoCiclo {
  return {
    comGlobal: apurarCiclo(estado, { ...entrada, global: true }, opcoes).resultado,
    semGlobal: apurarCiclo(estado, { ...entrada, global: false }, opcoes).resultado,
  };
}

/** "5,5%" a partir de pontos-base. */
export const formatarPercentual = (bp: number) => `${(bp / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

export const centavos = (reais: number) => Math.round(reais * 100);
export const reais = (c: number) => c / 100;
