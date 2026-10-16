// Plano de Evolução Profissional e Eficiência — apuração do ciclo (Fase 2). Funções PURAS, sem banco.
//
// A prévia (previa.ts) mostra o ciclo ao vivo; a APURAÇÃO é o fechamento: o gestor lança o que depende de evidência (competências,
// certificações, avaliação de clientes, case e os indicadores manuais), o sistema junta com os indicadores automáticos e o índice global
// FECHADO do ciclo, e grava um registro congelado (snapshot) com a memória de cálculo que vai para a devolutiva.

import { IndicadorConfig } from "./previa";
import {
  ResultadoIndicador,
  VereditoEficienciaIndividual,
  INDICADORES,
  cumpreEficienciaIndividual,
} from "./eficienciaIndividual";
import {
  AMOSTRA_MINIMA_CLIENTES,
  EntradaApuracao,
  EstadoParticipante,
  MEDIA_MINIMA_CLIENTES,
  NOTA_MINIMA_COMPETENCIAS,
  REFORCADOR_BP_POR_CICLO,
  ResultadoCiclo,
  Tri,
  avaliacaoClientesCumprida,
  formatarPercentual,
} from "./regras";

// ---------------------------------------------------------------- estados

export const STATUS_APURACAO = [
  { chave: "rascunho", rotulo: "Em lançamento" },
  { chave: "apurado", rotulo: "Apurado" },
  { chave: "devolutiva", rotulo: "Devolutiva feita" },
  { chave: "encerrado", rotulo: "Encerrado" },
] as const;
export type StatusApuracao = (typeof STATUS_APURACAO)[number]["chave"];
export const rotuloStatusApuracao = (s: string) => STATUS_APURACAO.find((x) => x.chave === s)?.rotulo ?? s;

export const DESFECHOS = [
  { chave: "mantida", rotulo: "Apuração mantida" },
  { chave: "procedente", rotulo: "Contestação procedente (reabre a apuração)" },
] as const;
export type Desfecho = (typeof DESFECHOS)[number]["chave"];

// ---------------------------------------------------------------- lançamentos do gestor

export interface ManualLancado {
  chave: string;
  atingiu: boolean | null;
}

export interface Lancamentos {
  /** Portão 1: contrato ativo durante todo o ciclo. */
  contratoAtivoNoCiclo: boolean;
  /** Portão 2: os 6 meses integrais (a prorrogação por interrupção formal conta normalmente). */
  cicloCompleto: boolean;
  interrupcaoDias: number;
  /** Portão 3: Avaliação de Competências, 0 a 100. */
  competenciasPct: number | null;
  certificacoesCumpriu: boolean | null;
  clientesMedia: number | null;
  /** Quantas avaliações de clientes responderam no ciclo. null = ainda não lançado. */
  clientesRespostas: number | null;
  caseCumpriu: boolean | null;
  /** Só vale quando NENHUM indicador da eficiência operacional tem base: o gestor decide e justifica. */
  eficienciaIndividualDecisao: boolean | null;
  manuais: ManualLancado[];
}

export const lancamentosVazios = (): Lancamentos => ({
  contratoAtivoNoCiclo: true,
  cicloCompleto: true,
  interrupcaoDias: 0,
  competenciasPct: null,
  certificacoesCumpriu: null,
  clientesMedia: null,
  clientesRespostas: null,
  caseCumpriu: null,
  eficienciaIndividualDecisao: null,
  manuais: [],
});

// ---------------------------------------------------------------- indicadores do ciclo

export interface AutomaticoApurado {
  chave: "produtividade" | "apontamento_online";
  /** Índice em %. */
  valor: number | null;
  horasMin: number;
  atingiu: boolean | null;
  semBase: boolean;
}

export interface IndicadorDaEficiencia {
  chave: string;
  rotulo: string;
  tipo: "automatico" | "manual";
  peso: number;
  meta: number | null;
  valor: number | null;
  atingiu: boolean | null;
  semBase: boolean;
  origem: "automatico" | "gestor";
}

/** Resultado de cada indicador ATIVO do ciclo: o automático vem do cálculo, o manual do que o gestor lançou. */
export function resultadosDosIndicadores(config: IndicadorConfig[], automaticos: AutomaticoApurado[], manuais: ManualLancado[]): IndicadorDaEficiencia[] {
  return config
    .filter((i) => i.ativo)
    .map((i) => {
      const rotulo = INDICADORES.find((d) => d.chave === i.chave)?.rotulo ?? i.chave;
      if (i.tipo === "automatico") {
        const a = automaticos.find((x) => x.chave === i.chave);
        return { chave: i.chave, rotulo, tipo: "automatico", peso: i.peso, meta: i.meta, valor: a?.valor ?? null, atingiu: a?.atingiu ?? null, semBase: a?.semBase ?? true, origem: "automatico" };
      }
      const m = manuais.find((x) => x.chave === i.chave);
      return { chave: i.chave, rotulo, tipo: "manual", peso: i.peso, meta: null, valor: null, atingiu: m?.atingiu ?? null, semBase: false, origem: "gestor" };
    });
}

export interface EficienciaIndividualApurada {
  veredito: VereditoEficienciaIndividual;
  /** O que entra no requisito 6.4 (null = não dá para concluir). */
  cumpriu: Tri;
  /** O gestor decidiu manualmente porque nenhum indicador tinha base. */
  decisaoManual: boolean;
}

export function eficienciaIndividualDaApuracao(indicadores: IndicadorDaEficiencia[], notaMinimaPct: number, decisao: boolean | null): EficienciaIndividualApurada {
  const resultados: ResultadoIndicador[] = indicadores.map((i) => ({ chave: i.chave, peso: i.peso, atingiu: i.atingiu }));
  const veredito = cumpreEficienciaIndividual(resultados, notaMinimaPct);
  if (veredito.cumpriu == null && decisao != null) return { veredito, cumpriu: decisao, decisaoManual: true };
  return { veredito, cumpriu: veredito.cumpriu, decisaoManual: false };
}

/**
 * O que ainda falta lançar para apurar. Com portão fechado (contrato inativo ou ciclo incompleto) o ciclo é "não apurado" e nada mais
 * é exigido. Indicador manual ATIVO e com peso fica pendente enquanto o gestor não disser se atingiu; já o automático sem base não
 * é pendência (KPI honesto: sem amostra não se reprova), só o conjunto inteiro sem base exige a decisão do gestor.
 */
export function pendenciasDeLancamento(config: IndicadorConfig[], l: Lancamentos, eficiencia: { cumpriu: Tri }): string[] {
  if (!l.contratoAtivoNoCiclo || !l.cicloCompleto) return [];
  const p: string[] = [];
  if (l.competenciasPct == null) p.push("competencias");
  if (l.certificacoesCumpriu == null) p.push("certificacoes");
  if (l.clientesRespostas == null || (l.clientesRespostas >= AMOSTRA_MINIMA_CLIENTES && l.clientesMedia == null)) p.push("avaliacaoClientes");
  if (l.caseCumpriu == null) p.push("caseTecnico");
  for (const i of config.filter((x) => x.ativo && x.tipo === "manual" && x.peso > 0)) {
    if (l.manuais.find((m) => m.chave === i.chave)?.atingiu == null) p.push(`indicador:${i.chave}`);
  }
  if (eficiencia.cumpriu == null) p.push("eficienciaIndividual");
  return p;
}

/** Os 5 requisitos no formato que o motor de regras (regras.ts) espera. */
export function montarEntrada(l: Lancamentos, eficienciaCumpriu: Tri, globalAtingido: Tri): EntradaApuracao {
  return {
    contratoAtivoNoCiclo: l.contratoAtivoNoCiclo,
    cicloCompleto: l.cicloCompleto,
    competenciasPct: l.competenciasPct,
    certificacoes: l.certificacoesCumpriu,
    avaliacaoClientes: l.clientesRespostas == null ? null : avaliacaoClientesCumprida(l.clientesMedia, l.clientesRespostas),
    caseTecnico: l.caseCumpriu,
    eficienciaIndividual: eficienciaCumpriu,
    global: globalAtingido,
  };
}

// ---------------------------------------------------------------- sequência de ciclos

export interface CicloAnterior {
  id: number;
  rotulo: string;
  inicio: string;
  fim: string;
  /** Ciclo anterior à vigência: simulação, fora da sequência real. */
  ensaio: boolean;
  /** Apuração deste participante neste ciclo, se existir. */
  apuracao: { status: StatusApuracao; consecutivosDepois: number | null } | null;
}

/**
 * Ciclos REAIS anteriores a `inicio` em que o participante já devia estar (a partir do 1º ciclo dele) e que ainda não têm apuração
 * ENCERRADA. Apurar um ciclo com lacuna anterior calcularia o reforçador errado, então é bloqueado.
 */
export function lacunasAnteriores(ciclos: CicloAnterior[], inicio: string, primeiroCicloInicio: string): CicloAnterior[] {
  return ciclos.filter((c) => !c.ensaio && c.fim < inicio && c.fim >= primeiroCicloInicio && c.apuracao?.status !== "encerrado");
}

/**
 * Ciclos consecutivos cumpridos antes de `inicio`: o do último ciclo REAL encerrado antes dele; sem histórico, o informado na adesão
 * (`ciclosConsecutivosAntes`, trazido de fora do CaxHub). Ensaio nunca alimenta a sequência.
 */
export function consecutivosAntesDoCiclo(baselineNaAdesao: number, ciclos: CicloAnterior[], inicio: string): number {
  const anteriores = ciclos.filter((c) => !c.ensaio && c.fim < inicio && c.apuracao?.status === "encerrado").sort((a, b) => b.fim.localeCompare(a.fim));
  const ultimo = anteriores[0];
  return ultimo?.apuracao?.consecutivosDepois ?? baselineNaAdesao;
}

// ---------------------------------------------------------------- snapshot e memória de cálculo

export interface GlobalFechado {
  indice: number | null;
  meta: number;
  atingiu: boolean | null;
  semBase: boolean;
  executadoMin: number;
  dentroMin: number;
  acimaMin: number;
  itens: number;
  calculadoEm: string;
}

export interface SnapshotApuracao {
  versao: 1;
  geradoEm: string;
  ciclo: {
    id: number;
    rotulo: string;
    inicio: string;
    fim: string;
    ensaio: boolean;
    amostraMinimaHoras: number;
    notaMinimaEficienciaIndividual: number;
    definicaoOnline: "A" | "B";
    departamentosAreaRotulos: string[];
    indicadores: IndicadorConfig[];
  };
  participante: { id: number; codfor: number; nome: string };
  estadoAntes: EstadoParticipante;
  lancamentos: Lancamentos;
  indicadores: IndicadorDaEficiencia[];
  eficienciaIndividual: { cumpriu: Tri; nota: number | null; pontos: number; base: number; semBase: string[]; decisaoManual: boolean };
  global: GlobalFechado;
  entrada: EntradaApuracao;
  resultado: ResultadoCiclo;
  estadoDepois: EstadoParticipante;
}

const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = (x: number | null) => (x == null ? "—" : `${nf1.format(x)}%`);
const brlC = (centavos: number) => moeda.format(centavos / 100);
const horas = (min: number) => `${Math.round(min / 60).toLocaleString("pt-BR")} h`;
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export type TomMemoria = "ok" | "bad" | "warn" | "off";
export interface LinhaMemoria {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: TomMemoria;
}
export interface SecaoMemoria {
  titulo: string;
  nota?: string;
  linhas: LinhaMemoria[];
}
export interface MemoriaDeCalculo {
  titulo: string;
  consultor: string;
  ciclo: string;
  periodo: string;
  apuradoEm: string;
  ensaio: boolean;
  /** Resultado em uma linha: "Cumprido · 6,5% sobre a base". */
  resumo: string;
  secoes: SecaoMemoria[];
  formula: string;
}

const simNao = (v: boolean | null): { valor: string; tom: TomMemoria } => (v == null ? { valor: "não lançado", tom: "off" } : v ? { valor: "cumprido", tom: "ok" } : { valor: "não cumprido", tom: "bad" });

/**
 * Memória de cálculo da devolutiva (item 11.3 do regulamento): os 5 requisitos, o portão, o reforçador e o Valor Hora do Ciclo, a partir
 * do snapshot (nunca do estado atual: o que foi apurado é o que se explica). `mostrarValores` esconde os R$ de quem não pode ver
 * (o gestor vê só os percentuais; o valor hora é dado sensível).
 */
export function montarMemoriaDeCalculo(s: SnapshotApuracao, mostrarValores: boolean): MemoriaDeCalculo {
  const r = s.resultado;
  const l = s.lancamentos;
  const secoes: SecaoMemoria[] = [];

  // 1. Portão
  const comp = l.competenciasPct;
  secoes.push({
    titulo: "Portão de entrada do ciclo (item 4)",
    nota: "Os três são eliminatórios: sem eles o ciclo não é apurado ou não pontua.",
    linhas: [
      { rotulo: "Contrato ativo durante o ciclo", valor: l.contratoAtivoNoCiclo ? "sim" : "não", tom: l.contratoAtivoNoCiclo ? "ok" : "bad" },
      { rotulo: "Ciclo completo (6 meses)", valor: l.cicloCompleto ? "sim" : "não", tom: l.cicloCompleto ? "ok" : "bad", detalhe: l.interrupcaoDias > 30 ? `Interrupção formal de ${l.interrupcaoDias} dias: ciclo prorrogado pelo mesmo número de dias.` : undefined },
      {
        rotulo: "Avaliação de Competências",
        valor: comp == null ? "não lançada" : `${nf1.format(comp)}%`,
        detalhe: `mínimo ${NOTA_MINIMA_COMPETENCIAS}%`,
        tom: comp == null ? "off" : comp >= NOTA_MINIMA_COMPETENCIAS ? "ok" : "bad",
      },
    ],
  });

  // 2. Requisitos individuais
  const cert = simNao(l.certificacoesCumpriu);
  const caso = simNao(l.caseCumpriu);
  const clientesOk = l.clientesRespostas == null ? null : avaliacaoClientesCumprida(l.clientesMedia, l.clientesRespostas);
  const cl = simNao(clientesOk);
  const clientesDetalhe =
    l.clientesRespostas == null
      ? undefined
      : l.clientesRespostas < AMOSTRA_MINIMA_CLIENTES
        ? `${l.clientesRespostas} avaliação(ões) respondida(s): menos de ${AMOSTRA_MINIMA_CLIENTES}, considerado cumprido (a falta de resposta não é do consultor).`
        : `média ${l.clientesMedia == null ? "—" : nf2.format(l.clientesMedia)} em ${l.clientesRespostas} avaliações (meta: ${nf1.format(MEDIA_MINIMA_CLIENTES)} ou mais).`;
  const ei = s.eficienciaIndividual;
  const eiValor = simNao(ei.cumpriu);
  secoes.push({
    titulo: "Requisitos individuais (indivisíveis)",
    nota: "Cumprir três dos quatro dá 0%, não 3%. Cada um vale 1 ponto percentual.",
    linhas: [
      { rotulo: "6.1 Certificações Técnicas", valor: cert.valor, tom: cert.tom },
      { rotulo: "6.2 Avaliação de Clientes", valor: cl.valor, tom: cl.tom, detalhe: clientesDetalhe },
      { rotulo: "6.3 Case Técnico", valor: caso.valor, tom: caso.tom },
      {
        rotulo: "6.4 Eficiência Individual",
        valor: eiValor.valor,
        tom: eiValor.tom,
        detalhe: ei.decisaoManual
          ? "Nenhum indicador tinha base no ciclo: decisão registrada pelo gestor."
          : ei.nota == null
            ? undefined
            : `nota ${nf1.format(ei.nota)}% dos pesos com base (mínimo ${s.ciclo.notaMinimaEficienciaIndividual}%).`,
      },
    ],
  });

  // 3. Indicadores da eficiência operacional
  secoes.push({
    titulo: "Eficiência Individual: indicadores do ciclo",
    nota: `Eficiência medida pelo item da proposta, nos itens de ${s.ciclo.departamentosAreaRotulos.join(" e ")}. Abaixo de ${s.ciclo.amostraMinimaHoras} h executadas, o indicador automático fica sem base.`,
    linhas: s.indicadores.map((i) => ({
      rotulo: `${i.rotulo} (peso ${i.peso})`,
      valor: i.semBase ? "sem base" : i.tipo === "manual" ? (i.atingiu == null ? "não lançado" : i.atingiu ? "atingido" : "não atingido") : `${pct(i.valor)}${i.atingiu == null ? "" : i.atingiu ? " · atingido" : " · não atingido"}`,
      detalhe: i.tipo === "automatico" ? (i.meta != null ? `meta ${pct(i.meta)}` : "meta não definida") : "lançado pelo gestor, com evidência",
      tom: i.atingiu == null ? "off" : i.atingiu ? "ok" : "bad",
    })),
  });

  // 4. Global
  const g = s.global;
  secoes.push({
    titulo: "Requisito global (coletivo, opcional)",
    nota: "Resultado da área inteira, igual para todos. Não atingir não é descumprimento: só tira o 5º ponto.",
    linhas: [
      { rotulo: "Eficiência global da área", valor: g.semBase ? "sem base" : pct(g.indice), detalhe: `meta ${pct(g.meta)} · ${horas(g.dentroMin)} dentro do orçado de ${horas(g.executadoMin)} executadas em ${g.itens} itens`, tom: g.atingiu == null ? "off" : g.atingiu ? "ok" : "warn" },
      {
        rotulo: "Meta global",
        valor: g.atingiu == null ? "sem base (o 5º ponto não é concedido)" : g.atingiu ? "atingida (+1 ponto)" : "não atingida (sem o 5º ponto)",
        tom: g.atingiu == null ? "off" : g.atingiu ? "ok" : "warn",
        detalhe: g.atingiu == null ? "Poucas horas na área para medir o índice: o requisito global é opcional e, sem como medir, não pontua." : undefined,
      },
    ],
  });

  // 5. Resultado
  const base = s.estadoAntes.baseCentavos;
  const linhasResultado: LinhaMemoria[] = [
    {
      rotulo: "Situação do ciclo",
      valor: r.status === "cumprido" ? "cumprido" : r.status === "descumprido" ? "descumprido" : "não apurado",
      tom: r.status === "cumprido" ? "ok" : r.status === "descumprido" ? "bad" : "off",
      detalhe: r.motivos.length > 0 ? `motivo: ${r.motivos.map(rotuloMotivo).join(", ")}` : undefined,
    },
    { rotulo: "Pontuação do ciclo", valor: formatarPercentual(r.pontuacaoBp), detalhe: r.pontuacaoBp === 500 ? "4 individuais + global" : r.pontuacaoBp === 400 ? "4 individuais, sem o global" : undefined },
    {
      rotulo: "Reforçador de consistência",
      valor: formatarPercentual(r.reforcadorBp),
      detalhe: `${s.estadoAntes.consecutivos} ciclo(s) consecutivo(s) já cumprido(s) × ${nf1.format(REFORCADOR_BP_POR_CICLO / 100)} p.p.`,
    },
    { rotulo: "Percentual do ciclo", valor: formatarPercentual(r.percentualBp), detalhe: "pontuação + reforçador", tom: r.status === "cumprido" ? "ok" : undefined },
  ];
  if (mostrarValores) {
    linhasResultado.push({ rotulo: "Valor Hora Base vigente", valor: brlC(base) });
    linhasResultado.push({ rotulo: "Valor Hora do Ciclo", valor: brlC(r.valorHoraCentavos), tom: r.status === "cumprido" ? "ok" : undefined, detalhe: r.status === "descumprido" ? "volta ao valor base" : r.status === "nao_apurado" ? "sem percentual neste ciclo" : undefined });
  }
  linhasResultado.push({
    rotulo: "Sequência",
    valor: r.status === "cumprido" ? (r.efetivou ? "10º ciclo consecutivo: EFETIVAÇÃO" : `${r.cicloNaSequencia}º ciclo consecutivo`) : r.status === "descumprido" ? "zerada: o plano recomeça no próximo ciclo" : "mantida",
    tom: r.efetivou ? "ok" : undefined,
    detalhe: r.efetivou ? (mostrarValores ? `o valor do ciclo (${brlC(r.valorHoraCentavos)}) passa a ser o novo Valor Hora Base; o plano recomeça sobre ele` : "o valor do ciclo passa a ser o novo Valor Hora Base; o plano recomeça sobre ele") : undefined,
  });
  secoes.push({ titulo: "Resultado do ciclo", linhas: linhasResultado });

  const formula =
    r.status === "cumprido"
      ? `Valor Hora do Ciclo = Valor Hora Base × (1 + ${formatarPercentual(r.pontuacaoBp)} + ${formatarPercentual(r.reforcadorBp)})${mostrarValores ? ` = ${brlC(base)} × ${nf2.format(1 + r.percentualBp / 10_000)} = ${brlC(r.valorHoraCentavos)}` : ""}. Sempre sobre a base, nunca sobre o ciclo anterior.`
      : "Sem pontuação neste ciclo: o valor volta (ou fica) na base vigente.";

  return {
    titulo: "Memória de cálculo",
    consultor: s.participante.nome,
    ciclo: s.ciclo.rotulo,
    periodo: `${dataBr(s.ciclo.inicio)} a ${dataBr(s.ciclo.fim)}`,
    apuradoEm: s.geradoEm,
    ensaio: s.ciclo.ensaio,
    resumo: `${r.status === "cumprido" ? "Cumprido" : r.status === "descumprido" ? "Descumprido" : "Não apurado"} · ${formatarPercentual(r.percentualBp)} sobre a base`,
    secoes,
    formula,
  };
}

export function rotuloMotivo(m: string): string {
  const mapa: Record<string, string> = {
    competencias: "Avaliação de Competências abaixo de 80%",
    certificacoes: "Certificações Técnicas",
    avaliacaoClientes: "Avaliação de Clientes",
    caseTecnico: "Case Técnico",
    eficienciaIndividual: "Eficiência Individual",
    contrato: "contrato não ativo no ciclo",
    ciclo_incompleto: "ciclo incompleto",
  };
  return mapa[m] ?? m;
}

export const rotuloPendencia = (p: string): string => (p.startsWith("indicador:") ? `Indicador ${INDICADORES.find((i) => i.chave === p.slice(10))?.rotulo ?? p.slice(10)}` : (({ competencias: "Avaliação de Competências", certificacoes: "Certificações Técnicas", avaliacaoClientes: "Avaliação de Clientes", caseTecnico: "Case Técnico", eficienciaIndividual: "Decisão sobre a Eficiência Individual (nenhum indicador tem base)" } as Record<string, string>)[p] ?? p));
