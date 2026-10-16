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
  /** Resultados já devolvidos (apuração em "devolutiva" ou "encerrado"), do mais recente ao mais antigo. */
  historico: HistoricoResultadoDto[];
}

export interface HistoricoResultadoDto {
  apuracaoId: number;
  cicloRotulo: string;
  inicio: string;
  fim: string;
  ensaio: boolean;
  status: StatusApuracao;
  statusRotulo: string;
  statusCiclo: "cumprido" | "descumprido" | "nao_apurado" | null;
  percentualBp: number | null;
  valorHora: number | null;
  efetivou: boolean;
  devolutivaEm: string | null;
  contestacao: { recebidaEm: string | null; texto: string } | null;
  desfecho: { resultado: string; texto: string | null } | null;
}

// ---------------------------------------------------------------- apuração (Fase 2)

export type StatusApuracao = "rascunho" | "apurado" | "devolutiva" | "encerrado";
export type TomMemoria = "ok" | "bad" | "warn" | "off";

export interface LancamentosDto {
  contratoAtivoNoCiclo: boolean;
  cicloCompleto: boolean;
  interrupcaoDias: number;
  competenciasPct: number | null;
  certificacoesCumpriu: boolean | null;
  clientesMedia: number | null;
  clientesRespostas: number | null;
  caseCumpriu: boolean | null;
  eficienciaIndividualDecisao: boolean | null;
  manuais: { chave: string; atingiu: boolean | null }[];
}

export type ChaveObservacao = "competencias" | "certificacoes" | "clientes" | "case" | "eficiencia" | "geral";

export interface IndicadorApuradoDto {
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
export interface MemoriaDeCalculoDto {
  titulo: string;
  consultor: string;
  ciclo: string;
  periodo: string;
  apuradoEm: string;
  ensaio: boolean;
  resumo: string;
  secoes: SecaoMemoria[];
  formula: string;
}

export interface ApuracaoListaItem {
  participanteId: number;
  codfor: number;
  nome: string;
  departamento: string | null;
  apuracaoId: number | null;
  status: StatusApuracao | "nao_iniciada";
  statusRotulo: string;
  pendentes: { chave: string; rotulo: string }[];
  statusCiclo: "cumprido" | "descumprido" | "nao_apurado" | null;
  percentualBp: number | null;
  efetivou: boolean;
  devolutivaEm: string | null;
  contestacaoPendente: boolean;
  /** Só o admin recebe. */
  valorHora?: number | null;
}

export interface GlobalFechadoDto {
  executadoMin: number;
  dentroMin: number;
  acimaMin: number;
  itens: number;
  indice: number | null;
  meta: number | null;
  atingiu: boolean | null;
  semBase: boolean;
  calculadoEm: string;
}

export interface ApuracaoListaResposta {
  ciclo: CicloDto;
  ensaio: boolean;
  mostraValores: boolean;
  global: GlobalFechadoDto | null;
  globalAgora: { executadoMin: number; dentroMin: number; indice: number | null; atingiu: boolean | null; semBase: boolean };
  podeFecharGlobal: boolean;
  abreEm: string;
  participantes: ApuracaoListaItem[];
}

export interface ApuracaoDetalheResposta {
  ciclo: CicloDto;
  ensaio: boolean;
  mostraValores: boolean;
  participante: { id: number; codfor: number; nome: string; departamento: string | null; primeiroCicloInicio: string };
  apuracao: {
    id: number | null;
    status: StatusApuracao;
    statusRotulo: string;
    lancamentos: LancamentosDto;
    observacoes: Partial<Record<ChaveObservacao, string>>;
    lancadoEm: string | null;
    indicadores: IndicadorApuradoDto[];
    eficienciaIndividual: { cumpriu: boolean | null; nota: number | null; semBase: boolean | string[]; decisaoManual: boolean };
    pendentes: { chave: string; rotulo: string }[];
    apuradoEm: string | null;
    resultado: {
      statusCiclo: "cumprido" | "descumprido" | "nao_apurado";
      pontuacaoBp: number;
      reforcadorBp: number;
      percentualBp: number;
      efetivou: boolean;
      motivos: string[];
      consecutivosAntes: number;
      consecutivosDepois: number;
      valorHora?: number;
      valorHoraBase?: number;
    } | null;
    devolutiva: { em: string; observacao: string | null } | null;
    contestacao: { recebidaEm: string | null; texto: string } | null;
    desfecho: { resultado: "mantida" | "procedente"; texto: string | null; em: string | null } | null;
    encerradoEm: string | null;
    revisoes: number;
  };
  global: GlobalFechadoDto | null;
  bloqueios: string[];
  podeApurar: boolean;
  estadoAntes: { consecutivos: number; valorHoraBase?: number | null; temBase: boolean };
  memoria: MemoriaDeCalculoDto | null;
}

export interface MemoriaResposta {
  id: number;
  status: StatusApuracao;
  statusRotulo: string;
  mostraValores: boolean;
  devolutivaEm: string | null;
  contestacao: { recebidaEm: string | null; texto: string } | null;
  desfecho: { resultado: string; texto: string | null } | null;
  memoria: MemoriaDeCalculoDto;
}

export const rotuloStatusApuracao: Record<StatusApuracao | "nao_iniciada", string> = {
  nao_iniciada: "Não iniciada",
  rascunho: "Em lançamento",
  apurado: "Apurado",
  devolutiva: "Devolutiva feita",
  encerrado: "Encerrado",
};

export const tomDoStatusApuracao = (s: StatusApuracao | "nao_iniciada"): Tom => (s === "encerrado" ? "ok" : s === "devolutiva" ? "warn" : s === "apurado" ? "warn" : "off");
export const rotuloSituacaoCiclo = (s: "cumprido" | "descumprido" | "nao_apurado" | null) => (s === "cumprido" ? "Cumprido" : s === "descumprido" ? "Descumprido" : s === "nao_apurado" ? "Não apurado" : "—");
export const tomDaSituacaoCiclo = (s: "cumprido" | "descumprido" | "nao_apurado" | null): Tom => (s === "cumprido" ? "ok" : s === "descumprido" ? "bad" : "off");

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
