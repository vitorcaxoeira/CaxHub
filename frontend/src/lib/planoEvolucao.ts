// Plano de Evolução Profissional e Eficiência (consultores PJ) — tipos da API (routes/planoEvolucao.ts) e formatadores.
// Horas chegam em MINUTOS, como no resto do Painel de Eficiência (use hh/hn de ./eficiencia). Datas, como "AAAA-MM-DD".
import type { Tom } from "./eficiencia";

export type StatusCiclo = "rascunho" | "publicado" | "encerrado";

export interface IndicadorCiclo {
  chave: string;
  rotulo: string;
  descricao: string;
  tipo: "automatico" | "manual";
  peso: number;
  meta: number | null;
  ativo: boolean;
  ordem: number;
}

export interface CicloDto {
  id: number;
  ano: number;
  semestre: number;
  rotulo: string;
  inicio: string;
  fim: string;
  status: StatusCiclo;
  editavel: boolean;
  metaEficienciaGlobal: number | null;
  departamentosArea: number[];
  departamentosAreaRotulos: string[];
  amostraMinimaHoras: number;
  definicaoOnline: "A" | "B";
  notaMinimaEficienciaIndividual: number;
  naoApuradoQuebraSequencia: boolean;
  certificacoesExigidas: string | null;
  atividadesElegiveisClientes: string | null;
  corteEvidencias: string;
  apuracaoAte: string;
  devolutivaEm: string;
  contestacaoAte: string;
  publicadoEm: string | null;
  indicadores: IndicadorCiclo[];
  pendenciasPublicacao: string[];
}

export interface CiclosResposta {
  hoje: string;
  atualId: number | null;
  ciclos: CicloDto[];
  indicadoresDisponiveis: { chave: string; rotulo: string; tipo: string; descricao: string }[];
  departamentos: { valor: number; rotulo: string }[];
  motivosValorBase: { chave: string; rotulo: string }[];
}

export interface ResultadoCicloDto {
  status: "cumprido" | "descumprido" | "nao_apurado";
  statusRotulo: string;
  motivos: string[];
  pontuacaoBp: number;
  reforcadorBp: number;
  percentualBp: number;
  percentualRotulo: string;
  cicloNaSequencia: number | null;
  efetivou: boolean;
  /** R$ por hora. Só vem para o admin e para o próprio consultor. */
  valorHora?: number;
}

export interface ProjecaoDto {
  comGlobal: ResultadoCicloDto;
  semGlobal: ResultadoCicloDto;
}

export interface PreviaIndicador {
  horasMin: number;
  indice: number | null;
  meta: number | null;
  atingiu: boolean | null;
  semBase: boolean;
}

export interface PreviaConsultorDto {
  id: number;
  codfor: number;
  nome: string;
  produtividade: PreviaIndicador & { dentroMin: number; acimaMin: number; itens: number };
  online: PreviaIndicador & { onlineMin: number };
  eficienciaIndividual: { cumpriu: boolean | null; pontos: number; base: number; nota: number | null; semBase: string[] };
  pendentes: string[];
  valorHoraBase?: number | null;
  projecao: ProjecaoDto | null;
}

export interface PreviaGlobalDto {
  executadoMin: number;
  dentroMin: number;
  acimaMin: number;
  itens: number;
  indice: number | null;
  meta: number | null;
  atingiu: boolean | null;
  semBase: boolean;
}

export interface PreviaResposta {
  calculadoEm: string;
  ensaio: boolean;
  ciclo: CicloDto;
  mostraValores: boolean;
  escopo: "admin" | "gestor";
  global: PreviaGlobalDto;
  consultores: PreviaConsultorDto[];
}

export interface HistoricoBase {
  id: number;
  valorHoraBase: number;
  desde: string;
  motivo: string;
  motivoRotulo: string;
  observacao: string | null;
}

export interface ParticipanteDto {
  id: number;
  codfor: number;
  nome: string;
  departamento: string | null;
  dataAdesao: string;
  primeiroCicloInicio: string;
  versaoRegulamento: string;
  ciclosConsecutivosAntes: number;
  status: "ativo" | "encerrado";
  encerradoEm: string | null;
  motivoEncerramento: string | null;
  valorHoraBase?: number | null;
  historicoBase?: HistoricoBase[];
}

export interface ParticipantesResposta {
  mostraValores: boolean;
  participantes: ParticipanteDto[];
}

export interface MeuPlanoResposta {
  participante: {
    dataAdesao: string;
    primeiroCicloInicio: string;
    versaoRegulamento: string;
    status: string;
    ciclosConsecutivosAntes: number;
    historicoBase: HistoricoBase[];
  };
  ciclo: CicloDto | null;
  calculadoEm?: string;
  /** Ciclo anterior à vigência: simulação com dados reais. */
  ensaio?: boolean;
  global?: PreviaGlobalDto;
  consultor?: PreviaConsultorDto | null;
  aviso: string | null;
}

// ---------------------------------------------------------------- apresentação

/** Rótulo de cada requisito/motivo que a API devolve. */
export const ROTULO_REQUISITO: Record<string, string> = {
  competencias: "Avaliação de Competências (mínimo 80%)",
  certificacoes: "Certificações Técnicas",
  avaliacaoClientes: "Avaliação de Clientes",
  caseTecnico: "Case Técnico",
  eficienciaIndividual: "Eficiência Individual",
  global: "Eficiência Global da área",
  contrato: "Contrato ativo no ciclo",
  ciclo_incompleto: "Ciclo completo (6 meses)",
};

/** Verdadeiro = no alvo, falso = fora, null = sem base ainda. */
export const tomDaMeta = (atingiu: boolean | null): Tom => (atingiu == null ? "off" : atingiu ? "ok" : "bad");

const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 83,3% a partir de um número já em % (0 a 100). */
export const pctNum = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : `${nf1.format(x)}%`);
/** R$ 1.234,50 */
export const brl2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : nfMoeda.format(v));
/** "5,5%" a partir de pontos-base (550). */
export const pctBp = (bp: number) => `${(bp / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export const rotuloStatusCiclo: Record<StatusCiclo, string> = { rascunho: "Rascunho", publicado: "Publicado", encerrado: "Encerrado" };

/** Os 10 ciclos da matriz do regulamento (item 7.3): pontuação + reforçador, com e sem o requisito global. */
export function matrizDoRegulamento(base = 100): { ciclo: number; reforcador: number; comGlobal: { pct: number; valor: number }; semGlobal: { pct: number; valor: number } }[] {
  return Array.from({ length: 10 }, (_, i) => {
    const reforcador = 0.5 * i;
    const comGlobal = 5 + reforcador;
    const semGlobal = 4 + reforcador;
    const valor = (p: number) => Math.round((base * 100 * (100 + p)) / 100) / 100;
    return { ciclo: i + 1, reforcador, comGlobal: { pct: comGlobal, valor: valor(comGlobal) }, semGlobal: { pct: semGlobal, valor: valor(semGlobal) } };
  });
}
