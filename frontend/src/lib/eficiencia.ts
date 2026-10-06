// Painel de Eficiência — tipos do payload de /api/eficiencia e formatação. Toda "hora" do payload
// está em MINUTOS (como no Senior); só aqui vira texto.

export type Tom = "ok" | "warn" | "bad" | "off";

export const tomTexto: Record<Tom, string> = { ok: "text-success", warn: "text-warning", bad: "text-destructive", off: "text-muted" };
export const tomFundo: Record<Tom, string> = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive", off: "bg-muted/50" };
export const tomChip: Record<Tom, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-destructive/15 text-destructive",
  off: "bg-surface-2 text-muted",
};
export const ROTULO_PROPOSTA: Record<Tom, string> = { bad: "Estouro", warn: "Atenção", ok: "No prazo", off: "Não iniciada" };
export const ROTULO_ITEM: Record<Tom, string> = { bad: "Estourado", warn: "Perto do limite", ok: "No prazo", off: "Não iniciado" };

export interface Limiares {
  pertoDoLimite: number;
  estouroMinimoMin: number;
  criticoMin: number;
  criticoConsumo: number;
  mesesAtencao: number;
  mesesSobrecarga: number;
  capacidadePadraoHorasMes: number;
  eficienciaOk: number;
  eficienciaAtencao: number;
}

export interface ResumoCarteira {
  propostas: number;
  vendido: number;
  executado: number;
  dentro: number;
  acima: number;
  saldo: number;
  impacto: number;
  semAlocacao: number;
  eficiencia: number | null;
  propostasPorSituacao: Record<Tom, number>;
  itensPorSituacao: Record<Tom, number>;
  itensPertoDoLimite: number;
  saldoPertoDoLimite: number;
}

export type AlvoAlerta =
  | { tipo: "proposta"; codemp: number; codpro: number }
  | { tipo: "consultor"; codfor: number }
  | { tipo: "aba"; aba: "propostas" | "equipe" | "qualidade"; filtro?: string };

export interface Alerta {
  severidade: Tom;
  rotulo: string;
  peso: number;
  titulo: string;
  detalhe: string;
  alvo: AlvoAlerta;
}

export interface ParetoLinha {
  codemp: number;
  codpro: number;
  cliente: string;
  acima: number;
  consumo: number | null;
  impacto: number;
  acumulado: number;
}

export interface FaixaConsumo {
  chave: string;
  rotulo: string;
  tom: Tom;
  propostas: number;
  vendido: number;
}

export interface PontoTendencia {
  mes: string;
  total: number;
  dentro: number;
}

export interface PropostaLinha {
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string;
  sitpro: number | null;
  sitproRotulo: string;
  sispro: number | null;
  sisproRotulo: string;
  depexe: number | null;
  depexeRotulo: string;
  interna: boolean;
  vendido: number;
  executado: number;
  acima: number;
  saldo: number;
  impacto: number;
  semAlocacao: number;
  consumo: number | null;
  eficiencia: number | null;
  situacao: Tom;
  critico: boolean;
  faixa: string;
  itens: number;
}

export interface ConsultorLinha {
  codfor: number;
  nome: string;
  departamento: string | null;
  alocado: number;
  executado: number;
  eficiencia: number | null;
  pendente: number;
  revisar: number;
  meses: number;
  propostasComSaldo: number;
}

export interface MapaAlocacao {
  consultores: { codfor: number; nome: string; executado: number }[];
  propostas: { codemp: number; codpro: number; cliente: string; executado: number }[];
  celulas: { codfor: number; codemp: number; codpro: number; executado: number; alocado: number; parteDaProposta: number }[];
}

export interface ClienteLinha {
  codcli: number;
  cliente: string;
  interna: boolean;
  propostas: number;
  propostasComEstouro: number;
  vendido: number;
  executado: number;
  dentro: number;
  acima: number;
  saldo: number;
  impacto: number;
  consumo: number | null;
  eficiencia: number | null;
  situacao: Tom;
}

export interface Qualidade {
  semAlocacao: { codemp: number; codpro: number; cliente: string; semAlocacao: number; executado: number }[];
  aRevisar: {
    codemp: number;
    codpro: number;
    cliente: string;
    seqite: number;
    item: string;
    codfor: number;
    consultor: string;
    alocado: number;
    executado: number;
    revisar: number;
  }[];
  atipicas: { codemp: number; codpro: number; cliente: string; vendido: number; executado: number; acima: number; consumo: number | null }[];
  itensSemValorHora: number;
  estouroSemValorHora: number;
  apontadoSemItem: { apontamentos: number; minutos: number } | null;
}

export interface PainelEficiencia {
  meta: {
    geradoEm: string;
    escopo: "admin" | "gestor";
    departamentosGerenciados: { valor: number; rotulo: string }[] | null;
    capacidadeHorasMes: number;
    limiares: Limiares;
  };
  resumo: ResumoCarteira;
  carga: { pendente: number; meses: number; consultoresComCarga: number; consultoresEmSobrecarga: number; revisar: number };
  alertas: Alerta[];
  pareto: { linhas: ParetoLinha[]; top3: number };
  faixas: FaixaConsumo[];
  tendencia: PontoTendencia[];
  propostas: PropostaLinha[];
  equipe: { consultores: ConsultorLinha[]; mapa: MapaAlocacao };
  clientes: ClienteLinha[];
  qualidade: Qualidade;
}

export interface FiltrosOpcoes {
  sistemas: { valor: number; rotulo: string }[];
  departamentos: { valor: number; rotulo: string }[];
  situacoes: { valor: number; rotulo: string }[];
}

export interface FiltrosEficiencia {
  tipo: "cli" | "int" | "all";
  sitpro: number[];
  sispro: number[];
  depexe: number[];
}

export interface ItemDetalhe {
  seqite: number;
  descricao: string;
  servico: string | null;
  depexeRotulo: string;
  fatserRotulo: string;
  vendido: number;
  executado: number;
  consumo: number | null;
  situacao: Tom;
  acima: number;
  saldo: number;
  impacto: number;
  valhor: number | null;
  semAlocacao: number;
  outros: { alocado: number; executado: number };
  consultores: { codfor: number; nome: string; alocado: number; executado: number; pendente: number; revisar: number }[];
}

export interface PropostaDetalhe {
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string;
  sitproRotulo: string;
  sisproRotulo: string;
  depexeRotulo: string;
  interna: boolean;
  vendido: number;
  executado: number;
  dentro: number;
  acima: number;
  saldo: number;
  impacto: number;
  semAlocacao: number;
  consumo: number | null;
  eficiencia: number | null;
  situacao: Tom;
  critico: boolean;
  itensPorSituacao: Record<Tom, number>;
  itens: ItemDetalhe[];
}

export interface ConsultorDetalhe {
  codfor: number;
  nome: string;
  departamento: string | null;
  alocado: number;
  executado: number;
  eficiencia: number | null;
  pendente: number;
  revisar: number;
  meses: number;
  propostasComSaldo: number;
  capacidadeHorasMes: number;
  itens: {
    codemp: number;
    codpro: number;
    cliente: string;
    seqite: number;
    descricao: string;
    alocado: number;
    executado: number;
    pendente: number;
    revisar: number;
    vendidoItem: number;
    executadoItem: number;
    situacaoItem: Tom;
  }[];
}

// ---------- formatação ----------

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Minutos -> "1.234" (sem unidade). */
export const hn = (min: number) => nf0.format(min / 60);
/** Minutos -> "1.234 h". */
export const hh = (min: number) => `${nf0.format(min / 60)} h`;
export const pct = (x: number | null) => (x == null || !Number.isFinite(x) ? "—" : `${nf0.format(x * 100)}%`);
export const brl = (v: number) => `R$ ${nf0.format(v)}`;
export const brlCompacto = (v: number) =>
  v >= 1e6 ? `R$ ${nf1.format(v / 1e6)} mi` : v >= 1e3 ? `R$ ${nf0.format(v / 1e3)} mil` : `R$ ${nf0.format(v)}`;
export const meses1 = (m: number) => nf1.format(m);

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-09" -> "set/26". */
export function rotuloMes(mes: string): string {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${ano.slice(2)}`;
}

export function tomEficiencia(valor: number | null, l: Limiares): Tom {
  if (valor == null) return "off";
  if (valor >= l.eficienciaOk) return "ok";
  if (valor >= l.eficienciaAtencao) return "warn";
  return "bad";
}

export function tomMeses(meses: number, l: Limiares): Tom {
  if (meses > l.mesesSobrecarga) return "bad";
  if (meses > l.mesesAtencao) return "warn";
  return "ok";
}

/** Nome sem razão social ("Cliente Ltda" -> "Cliente") pra caber em gráficos. */
export function clienteCurto(nome: string): string {
  return nome.replace(/\s*\b(LTDA|S\/A|S\.A|EIRELI|ME)\b\.?/gi, "").replace(/\s+/g, " ").trim() || nome;
}

/** "Fulano da Silva Souza" -> "Fulano Souza". */
export function nomeCurto(nome: string): string {
  const partes = nome.split(" ").filter((p) => !["de", "da", "do", "dos", "das", "e"].includes(p.toLowerCase()));
  return partes.length > 2 ? `${partes[0]} ${partes[partes.length - 1]}` : nome;
}

/** Tabela -> texto separado por TAB, pra colar no Excel/Teams. */
export function paraTsv(cabecalho: string[], linhas: (string | number)[][]): string {
  return [cabecalho, ...linhas].map((l) => l.join("\t")).join("\n");
}
