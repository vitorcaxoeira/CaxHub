// Formato do GET /dashboard/produtividade (backend/src/domain/relatorioProdutividade.ts) e os formatadores que o
// relatório impresso (RelatorioProdutividade.tsx) e o detalhe do dia em "Horas por semana" (Home) compartilham.

export interface ItemProdutividade {
  tipo: "item";
  data: string; // AAAA-MM-DD
  horini: number; // minutos desde a meia-noite
  horfim: number;
  minutos: number;
  codpro: number | null;
  numrat: number | null;
  cliente: string | null;
  sitrat: number | null;
  sitratLabel: string;
  // Domínio USU_LFatSer: S = faturamento normal, A = antecipado, N = sem faturamento.
  fatser: string | null;
}

export interface DeslocamentoProdutividade {
  tipo: "deslocamento";
  data: string;
  minutos: number;
  numrats: number[];
}

export interface SubtotalProdutividade {
  tipo: "subtotal";
  data: string;
  rotulo: "Domingo" | "Data fim do mês";
  minutos: number;
}

export type BlocoProdutividade = ItemProdutividade | DeslocamentoProdutividade | SubtotalProdutividade;

export interface MesProdutividade {
  ano: number;
  mes: number;
  inicio: string;
  fim: string;
  blocos: BlocoProdutividade[];
  totais: {
    minutosTrabalhados: number;
    minutosDeslocamento: number;
    valorHora: number | null;
    valorTrabalhadas: number | null;
    valorDeslocamento: number | null;
    valorNota: number | null;
  };
}

export interface DadosProdutividade {
  consultor: { codfor: number; nome: string };
  meses: MesProdutividade[];
}

// "08:02" a partir de minutos desde a meia-noite (ou de uma duração).
export const hhmm = (minutos: number) => {
  const h = String(Math.floor(minutos / 60)).padStart(2, "0");
  return `${h}:${String(minutos % 60).padStart(2, "0")}`;
};

// Código de RAT/proposta com ponto de milhar, como o Senior imprime (851.254).
export const milhar = new Intl.NumberFormat("pt-BR", { useGrouping: true });
