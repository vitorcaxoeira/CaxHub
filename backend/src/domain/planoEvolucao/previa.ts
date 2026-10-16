// Plano de Evolução Profissional e Eficiência — prévia ao vivo do ciclo. Função PURA: recebe tudo já carregado (ver planoEvolucaoDados.ts).
//
// A prévia NÃO é a apuração. Mostra, em tempo real, os indicadores automáticos de cada participante, o índice global da área contra a meta
// e o valor hora PROJETADO. Os requisitos que dependem do gestor (certificações, avaliação de clientes, case, competências) ficam "pendentes"
// até a apuração (Fase 2), então a projeção assume que serão cumpridos e diz isso (`projetado`, `pendentes`).

import { ItemNoCiclo, VereditoMeta, Acumulado, avaliarMeta, indicesDoCiclo, acumuladoVazio } from "./eficienciaItens";
import {
  DefinicaoOnline,
  HoraComOrigem,
  ResultadoIndicador,
  VereditoEficienciaIndividual,
  apontamentoOnline,
  avaliarOnline,
  cumpreEficienciaIndividual,
} from "./eficienciaIndividual";
import { EntradaApuracao, EstadoParticipante, ProjecaoDoCiclo, projetarCiclo } from "./regras";

export interface IndicadorConfig {
  chave: string;
  tipo: "automatico" | "manual";
  peso: number;
  /** Meta em % (automáticos). */
  meta: number | null;
  ativo: boolean;
}

export interface ParametrosDaPrevia {
  metaEficienciaGlobal: number | null;
  amostraMinimaHoras: number;
  definicaoOnline: DefinicaoOnline;
  notaMinimaEficienciaIndividual: number;
  naoApuradoQuebraSequencia: boolean;
  indicadores: IndicadorConfig[];
}

export interface ParticipanteDaPrevia {
  id: number;
  codfor: number;
  nome: string;
  /** Valor Hora Base vigente no início do ciclo, em centavos. null = ainda sem base lançada. */
  baseCentavos: number | null;
  /** Ciclos consecutivos já cumpridos antes deste (histórico informado na adesão, até a Fase 2 gravar as apurações). */
  consecutivosAntes: number;
}

export interface PreviaIndicadorAutomatico {
  /** Horas executadas / online, em minutos, e o índice em %. */
  horasMin: number;
  indice: number | null;
  meta: number | null;
  atingiu: boolean | null;
  semBase: boolean;
}

export interface PreviaConsultor {
  id: number;
  codfor: number;
  nome: string;
  produtividade: PreviaIndicadorAutomatico & { dentroMin: number; acimaMin: number; itens: number };
  online: PreviaIndicadorAutomatico & { onlineMin: number };
  eficienciaIndividual: VereditoEficienciaIndividual;
  /** Requisitos que só o gestor lança (Fase 2): ficam null (pendentes) na prévia. */
  pendentes: string[];
  baseCentavos: number | null;
  /** null quando falta o Valor Hora Base. */
  projecao: ProjecaoDoCiclo | null;
}

export interface PreviaGlobal {
  executadoMin: number;
  dentroMin: number;
  acimaMin: number;
  itens: number;
  indice: number | null;
  meta: number | null;
  atingiu: boolean | null;
  semBase: boolean;
}

export interface PreviaDoCiclo {
  global: PreviaGlobal;
  consultores: PreviaConsultor[];
}

const configDe = (params: ParametrosDaPrevia, chave: string) => params.indicadores.find((i) => i.chave === chave && i.ativo);

function previaGlobal(a: Acumulado, v: VereditoMeta, meta: number | null): PreviaGlobal {
  return { executadoMin: a.executado, dentroMin: a.dentro, acimaMin: a.acima, itens: a.itens, indice: v.indice, meta, atingiu: v.atingiu, semBase: v.semBase };
}

export function montarPrevia(
  params: ParametrosDaPrevia,
  participantes: ParticipanteDaPrevia[],
  itens: ItemNoCiclo[],
  horasPorConsultor: Map<number, HoraComOrigem[]>
): PreviaDoCiclo {
  const amostraMin = params.amostraMinimaHoras * 60;
  const indices = indicesDoCiclo(itens);
  // O global é o da ÁREA inteira (todos os consultores apontando nos itens da área), não só dos participantes.
  const veredGlobal = avaliarMeta(indices.global, params.metaEficienciaGlobal, amostraMin);
  // Meta global não atingida não é descumprimento: só tira o 5º ponto (regulamento 6.5).
  const globalAtingido = veredGlobal.atingiu;

  const consultores: PreviaConsultor[] = participantes.map((p) => {
    const acum = indices.porConsultor.get(p.codfor) ?? acumuladoVazio();
    const cfgProd = configDe(params, "produtividade");
    const veredProd = avaliarMeta(acum, cfgProd?.meta ?? null, amostraMin);
    const on = apontamentoOnline(horasPorConsultor.get(p.codfor) ?? [], params.definicaoOnline);
    const cfgOn = configDe(params, "apontamento_online");
    const veredOn = avaliarOnline(on, cfgOn?.meta ?? null, amostraMin);

    // Resultado de cada indicador ATIVO para a nota do requisito 6.4. Automático sem meta publicada ou sem base = null (fora da conta).
    // Manual não lançado = null (a Fase 2 deixa o gestor completar antes de fechar).
    const resultados: ResultadoIndicador[] = params.indicadores
      .filter((i) => i.ativo)
      .map((i) => ({
        chave: i.chave,
        peso: i.peso,
        atingiu: i.chave === "produtividade" ? veredProd.atingiu : i.chave === "apontamento_online" ? veredOn.atingiu : null,
      }));
    const individual = cumpreEficienciaIndividual(resultados, params.notaMinimaEficienciaIndividual);

    const pendentes = ["competencias", "certificacoes", "avaliacaoClientes", "caseTecnico"];
    const entrada: EntradaApuracao = {
      contratoAtivoNoCiclo: true,
      cicloCompleto: true,
      competenciasPct: null,
      certificacoes: null,
      avaliacaoClientes: null,
      caseTecnico: null,
      eficienciaIndividual: individual.cumpriu,
      global: globalAtingido,
    };
    if (individual.cumpriu == null) pendentes.push("eficienciaIndividual");

    let projecao: ProjecaoDoCiclo | null = null;
    if (p.baseCentavos != null) {
      const estado: EstadoParticipante = { baseCentavos: p.baseCentavos, consecutivos: p.consecutivosAntes };
      projecao = projetarCiclo(estado, entrada, { naoApuradoQuebraSequencia: params.naoApuradoQuebraSequencia });
    }

    return {
      id: p.id,
      codfor: p.codfor,
      nome: p.nome,
      produtividade: {
        horasMin: acum.executado,
        dentroMin: acum.dentro,
        acimaMin: acum.acima,
        itens: acum.itens,
        indice: veredProd.indice,
        meta: cfgProd?.meta ?? null,
        atingiu: veredProd.atingiu,
        semBase: veredProd.semBase,
      },
      online: { horasMin: on.totalMin, onlineMin: on.onlineMin, indice: veredOn.pct, meta: cfgOn?.meta ?? null, atingiu: veredOn.atingiu, semBase: veredOn.semBase },
      eficienciaIndividual: individual,
      pendentes,
      baseCentavos: p.baseCentavos,
      projecao,
    };
  });

  return { global: previaGlobal(indices.global, veredGlobal, params.metaEficienciaGlobal), consultores };
}

/** Indicadores que o ciclo nasce com (rascunho): o gestor ajusta pesos e metas antes de publicar. */
export const INDICADORES_PADRAO: { chave: string; tipo: "automatico" | "manual"; peso: number; ativo: boolean; ordem: number }[] = [
  { chave: "produtividade", tipo: "automatico", peso: 50, ativo: true, ordem: 1 },
  { chave: "apontamento_online", tipo: "automatico", peso: 30, ativo: true, ordem: 2 },
  { chave: "retrabalho", tipo: "manual", peso: 10, ativo: true, ordem: 3 },
  { chave: "qualidade_tecnica", tipo: "manual", peso: 5, ativo: true, ordem: 4 },
  { chave: "aderencia_processos", tipo: "manual", peso: 5, ativo: true, ordem: 5 },
  // Desativado: a data prevista de fim está preenchida em 0,2% das atividades (Fase 0).
  { chave: "cronograma", tipo: "manual", peso: 0, ativo: false, ordem: 6 },
];
