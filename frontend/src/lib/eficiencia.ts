// Painel de Eficiência — tipos do payload de /api/eficiencia e formatação. Toda "hora" do payload
// está em MINUTOS (como no Senior); só aqui vira texto.

export type Tom = "ok" | "warn" | "bad" | "off";

/** Como o estouro é lido: "item" = soma do estouro de cada item (padrão); "proposta" = só o total da proposta (saldo de um item compensa outro). */
export type ModoEstouro = "item" | "proposta";

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
  atipicaConsumo: number;
  atipicaAcimaMin: number;
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
  | { tipo: "aba"; aba: "propostas" | "equipe" | "qualidade" | "acoes"; filtro?: string };

export interface Alerta {
  severidade: Tom;
  rotulo: string;
  peso: number;
  titulo: string;
  detalhe: string;
  alvo: AlvoAlerta;
  /** Texto sugerido para o botão "Criar ação". Ausente = alerta que não vira ação. */
  acaoSugerida?: string;
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
  modpro: number | null;
  modproRotulo: string;
  depexe: number | null;
  depexeRotulo: string;
  interna: boolean;
  vendido: number;
  executado: number;
  acima: number;
  saldo: number;
  impacto: number;
  /** Os dois jeitos de ler o estouro (o do modo escolhido já está em `acima`). */
  acimaPorItem: number;
  acimaGlobal: number;
  semAlocacao: number;
  consumo: number | null;
  eficiencia: number | null;
  situacao: Tom;
  critico: boolean;
  faixa: string;
  itens: number;
  /** A pessoa marcou esta proposta pra ficar FORA dos cálculos (escolha dela, guardada no navegador). Vem na lista pra dar pra desmarcar. */
  ignorada: boolean;
  /** Fora da curva (consumo e estouro muito altos): só uma marca de aviso, não muda conta nenhuma. */
  atipica: boolean;
}

export interface ConsultorLinha {
  /** Marcado pela pessoa pra ficar fora dos indicadores da equipe: a linha vem com os números reais, mas não entra nos totais. */
  ignorado: boolean;
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
  atipicas: { codemp: number; codpro: number; cliente: string; vendido: number; executado: number; acima: number; consumo: number | null; ignorada: boolean }[];
  itensSemValorHora: number;
  estouroSemValorHora: number;
  apontadoSemItem: { apontamentos: number; minutos: number } | null;
}

export interface MotivoExclusao {
  chave: string;
  rotulo: string;
}

export interface ExclusaoLinha {
  id: number;
  ratItemId: number;
  codemp: number;
  codpro: number;
  cliente: string | null;
  seqite: number;
  item: string | null;
  /** Nome só de quem é do time do usuário; nulo = "Outro consultor". */
  consultor: string | null;
  minutos: number;
  motivo: string;
  motivoRotulo: string;
  observacao: string | null;
  excluidoPorNome: string;
  excluidoEm: string;
  podeRestaurar: boolean;
}

export interface ExclusoesPainel {
  total: number;
  minutos: number;
  lista: ExclusaoLinha[];
}

export interface ApontamentoLinha {
  id: number;
  data: string | null;
  horini: number | null;
  horfim: number | null;
  minutos: number;
  descricao: string | null;
  numrat: number | null;
  consultor: string | null;
  excluido: boolean;
  motivo: string | null;
  motivoRotulo: string | null;
  observacao: string | null;
  excluidoPorNome: string | null;
  excluidoEm: string | null;
}

export interface ApontamentosDoItemResposta {
  podeDecidir: boolean;
  total: number;
  minutosTotal: number;
  truncado: boolean;
  apontamentos: ApontamentoLinha[];
}

export type StatusAcao = "aberta" | "andamento" | "concluida";

export const STATUS_ACAO_ROTULO: Record<StatusAcao, string> = { aberta: "Aberta", andamento: "Em andamento", concluida: "Concluída" };

export interface ContagemAcoes {
  abertas: number;
  atrasadas: number;
  concluidas: number;
  todas: number;
  /** Abertas que vencem de hoje até 5 dias úteis (as atrasadas têm contagem própria). */
  vencemEm5DiasUteis: number;
}

export interface AcaoDto {
  id: number;
  titulo: string;
  observacao: string | null;
  codemp: number | null;
  codpro: number | null;
  cliente: string | null;
  codforAlvo: number | null;
  alvoNome: string | null;
  origemAlerta: string | null;
  responsavelCodfor: number;
  responsavelNome: string;
  /** Data de calendário "AAAA-MM-DD". */
  prazo: string;
  status: StatusAcao;
  statusRotulo: string;
  atrasada: boolean;
  concluidaEm: string | null;
  criadoPorNome: string;
  criadoEm: string;
  podeEditar: boolean;
  podeMudarStatus: boolean;
}

export type FiltroAcoes = "abertas" | "atrasadas" | "concluidas" | "todas";

export interface AcoesResposta {
  hoje: string;
  contagens: ContagemAcoes;
  acoes: AcaoDto[];
}

export interface ResponsavelOpcao {
  codfor: number;
  nome: string;
}

/** O que o botão "Criar ação" já sabe de onde veio (alerta, proposta, consultor). */
export interface SugestaoAcao {
  titulo?: string;
  origemAlerta?: string;
  codemp?: number;
  codpro?: number;
  codforAlvo?: number;
  /** Texto da referência exibido no formulário (ex.: "PS 5937 · Metalúrgica Gram Serv"). */
  referencia?: string;
}

export interface PainelEficiencia {
  meta: {
    geradoEm: string;
    escopo: "admin" | "gestor";
    departamentosGerenciados: { valor: number; rotulo: string }[] | null;
    capacidadeHorasMes: number;
    limiares: Limiares;
    /** Itens e consultores-numa-proposta ignorados pela pessoa (só os que existem nos dados): alimenta as faixas de aviso. */
    ignoradosNaProposta: { itens: number; consultores: number };
    modoEstouro: ModoEstouro;
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
  financeiro: Financeiro;
  exclusoes: ExclusoesPainel;
  motivosExclusao: MotivoExclusao[];
  acoes: ContagemAcoes;
  qualidade: Qualidade;
}

/** Eficiência financeira. Base: valor-hora de VENDA do item, em R$ (não é faturamento nem custo). */
export interface LinhaFinanceira {
  valorVendido: number;
  valorExecutado: number;
  valorDentro: number;
  valorAcima: number;
  valorSaldo: number;
  /** Parte do valor vendido em itens sem faturamento direto (sem faturamento, comercial, suporte, investimento). */
  valorSemFaturamento: number;
  consumo: number | null;
  eficiencia: number | null;
  /** R$ por hora executada que ficou dentro do vendido. */
  receitaPorHora: number | null;
  /** R$ por hora vendida, em média: a régua pra comparar com a receita por hora executada. */
  valorHoraVendido: number | null;
}
export interface ClienteFinanceiro extends LinhaFinanceira {
  codcli: number;
  cliente: string;
  interna: boolean;
  propostas: number;
}
export interface PropostaFinanceira extends LinhaFinanceira {
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string;
  sitproRotulo: string;
  interna: boolean;
}
export interface Financeiro {
  resumo: LinhaFinanceira;
  clientes: ClienteFinanceiro[];
  propostas: PropostaFinanceira[];
}

export interface FiltrosOpcoes {
  modalidades: { valor: number; rotulo: string }[];
  clientes: { valor: number; rotulo: string }[];
  /** Propostas do escopo ("PS 8568 · Cliente"), com cliente e tipo pra a tela limitar a lista ao que já foi escolhido. */
  propostas: { valor: number; rotulo: string; codcli: number; interna: boolean }[];
  departamentos: { valor: number; rotulo: string }[];
  situacoes: { valor: number; rotulo: string }[];
}

export interface FiltrosEficiencia {
  tipo: "cli" | "int" | "all";
  sitpro: number[];
  modpro: number[];
  codcli: number[];
  codpro: number[];
  depexe: number[];
}

export interface ItemDetalhe {
  /** Marcado pela pessoa pra ficar fora do cálculo da proposta: vem com os números reais, mas não entra nos do topo. */
  ignorado: boolean;
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

/** Consultor que apontou horas na proposta (aba Consultores da gaveta). Horas = RatItem dele nos itens que contam. */
export interface ConsultorDaProposta {
  codfor: number;
  nome: string;
  executado: number;
  alocado: number;
  itens: number;
  parte: number;
  ignorado: boolean;
}

export interface PropostaDetalhe {
  modoEstouro: ModoEstouro;
  /** Os dois jeitos de ler o estouro; o do modo escolhido é `acima`. */
  acimaPorItem: number;
  acimaGlobal: number;
  /** Itens e consultores desta proposta que a pessoa ignorou (só os que existem). */
  ignorados: { itens: number; consultores: number };
  /** Números da proposta SEM ignorar nada, quando há algo ignorado (os do topo já descontam). */
  semIgnorar: { vendido: number; executado: number; acima: number } | null;
  consultores: ConsultorDaProposta[];
  /** Quem está fora do time do usuário: entra somado, sem nome e sem check. */
  outrosConsultores: { quantidade: number; executado: number };
  codemp: number;
  codpro: number;
  codcli: number;
  cliente: string;
  sitproRotulo: string;
  modproRotulo: string;
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
/** R$ sem o símbolo (colunas de tabela, onde o cabeçalho já diz "R$"). */
export const rs = (v: number) => nf0.format(v);
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

/** Minuto do dia -> "08:30". */
export function horaDoDia(min: number | null): string {
  if (min == null) return "—";
  return `${String(Math.trunc(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Minutos -> "3:30" (horas:minutos, sem limite de horas). */
export function hhmm(min: number): string {
  const total = Math.round(Math.abs(min));
  return `${min < 0 ? "-" : ""}${Math.trunc(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Data de calendário (`@db.Date` chega como meia-noite UTC): formata em UTC pra não voltar um dia no fuso do Brasil. */
export function dataBr(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/** Instante (data e hora) no fuso do usuário. */
export function dataHoraBr(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "2026-10-14" -> "14/10/2026" (sem passar por Date: data de calendário não tem fuso). */
export function prazoBr(iso: string): string {
  return iso.split("-").reverse().join("/");
}
