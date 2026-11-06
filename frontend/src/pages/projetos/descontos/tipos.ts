import type { SituacaoParcela, StatusProcesso } from "./comum";

// Formas das respostas de /api/descontos (backend/src/routes/descontos.ts).

export interface ParcelaDetalhe {
  id: number;
  numero: number;
  competencia: string; // AAAA-MM
  vencimento: string; // AAAA-MM-DD
  valor: number;
  valorDescontado: number;
  restante: number;
  situacao: SituacaoParcela;
  situacaoRotulo: string;
  transportada: boolean;
  observacao: string | null;
}

export interface EventoHistorico {
  id: string;
  ocorridoEm: string;
  usuario: string;
  evento: string;
  alteracoes: Record<string, { de: unknown; para: unknown; rotulo?: string }> | null;
  metadata: Record<string, unknown> | null;
  parcelaId: string | null;
}

export interface ProcessoDetalhe {
  id: number;
  numero: string;
  codfor: number;
  consultor: string;
  tipoId: number;
  tipo: string;
  modo: "total_parcelado" | "mensal_fixo";
  modoRotulo: string;
  valorTotal: number;
  valorParcela: number;
  qtdParcelas: number;
  vigenciaInicio: string;
  vigenciaFim: string;
  competenciaInicial: string; // AAAA-MM
  diaVencimento: number;
  observacao: string | null;
  status: StatusProcesso;
  statusRotulo: string;
  criadoEm: string;
  totalDescontado: number;
  saldoDevedor: number;
  parcelas: ParcelaDetalhe[];
  podeAdministrar: boolean;
  editavelPorCompleto: boolean;
  historico: EventoHistorico[];
}

export interface Simulacao {
  valido: boolean;
  erro?: string;
  valorTotal?: number;
  valorParcela?: number;
  competenciaFinal?: string;
  vencimentoFinal?: string;
  parcelas?: { numero: number; competencia: string; vencimento: string; valor: number }[];
}
