// Domínios contábeis do Senior — mesmo padrão de propostasDominio.ts (Record<código,
// label> + função `xxxLabel` com fallback). Usado pelas visões de Resultado Analítico
// (backend/src/routes/contabil.ts).

// Domínio "LGruCta" do Senior (grupo/natureza da conta no plano contábil — PlanoContabil.defgru
// e NaturezaFinanceira.defgru compartilham o mesmo domínio).
export const DEFGRU_LABELS: Record<string, string> = {
  A: "Ativo (Contábil - Devedora)",
  P: "Passivo (Contábil - Credora)",
  D: "Despesas (Contábil - Devedora)",
  R: "Receitas (Contábil - Credora)",
  X: "Ambas (Contábil - Desp./Rec.)",
  M: "Receitas Financeiras",
  N: "Despesas Financeiras",
  U: "Conta Auxiliar",
  L: "Patrimônio Líquido",
  V: "Custo de Venda",
  C: "Custo de Produção",
  S: "Custo de Ordem Dedutora",
  E: "Custo de Ordem Credora",
  O: "Outros",
  T: "Contas de Compensação",
};

export function defgruLabel(defgru: string | null): string {
  if (!defgru) return "—";
  return DEFGRU_LABELS[defgru] ?? defgru;
}

// Domínio "LNatCtb" do Senior (natureza devedora/credora — PlanoContabil.natcta e
// NaturezaFinanceira.natfin compartilham o mesmo domínio).
export const NATCTA_LABELS: Record<string, string> = {
  D: "Devedora",
  C: "Credora",
};

export function natctaLabel(natcta: string | null): string {
  if (!natcta) return "—";
  return NATCTA_LABELS[natcta] ?? natcta;
}

// Domínio "LAnaSin" do Senior (analítico/sintético — repetido em PlanoContabil,
// CentroCusto e NaturezaFinanceira). A=Analítico é sempre a FOLHA da hierarquia (onde há
// lançamento); S=Sintético é sempre um nó agregador (sem lançamento direto).
export const ANASIN_LABELS: Record<string, string> = {
  A: "Analítico",
  S: "Sintético",
};

export function anasinLabel(anasin: string | null): string {
  if (!anasin) return "—";
  return ANASIN_LABELS[anasin] ?? anasin;
}

// Domínio "LSitLot" do Senior — mesmo domínio serve LancamentoContabil.sitlct e
// RateioLancamento.sitrat.
export const SITLOT_LABELS: Record<number, string> = {
  1: "A Contabilizar",
  2: "Contabilizado",
  3: "Excluído",
  4: "Desativado",
};

export function sitlotLabel(sitlot: number | null): string {
  if (sitlot === null) return "—";
  return SITLOT_LABELS[sitlot] ?? `Situação ${sitlot}`;
}

// Só rateio com sitrat=2 (Contabilizado) entra no realizado — validado célula a célula
// contra o relatório de origem em 12/08/2026 (ver backend/src/routes/contabil.ts): não
// precisou olhar LancamentoContabil.sitlct pra bater os números, só este filtro no rateio.
export const SITRAT_CONTABILIZADO = 2;

// Domínio "LOriLct" do Senior (origem/módulo que gerou o lançamento contábil).
export const ORILCT_LABELS: Record<string, string> = {
  MAN: "Manual",
  VEN: "Mercado - NF de Saída",
  VEF: "Mercado - Faturas",
  EST: "Estoques - Movimentos",
  REC: "C. Receber - Movimentos",
  AFR: "C. Receber - Ajuste Financeiro",
  RAM: "C. Receber - Ajuste Valor de Mercado",
  ARV: "C. Receber - Variação Cambial",
  CPR: "Suprimentos - NF de Entrada",
  COF: "Suprimentos - Faturas",
  PAG: "C. Pagar - Movimentos",
  COM: "C. Pagar - Comissões",
  AFP: "C. Pagar - Ajuste Financeiro",
  PAM: "C. Pagar - Ajuste Valor de Mercado",
  APV: "C. Pagar - Variação Cambial",
  TES: "Tesouraria - Movimentos",
  PRD: "Produção",
  PAT: "Patrimônio",
  IVE: "Tributos - Vendas",
  ICO: "Tributos - Compras",
  IVZ: "Tributos - Redução Z",
  IOD: "Tributos - Outros Documentos",
  IMP: "Tributos - Apuração/Cálculo",
  RPA: "Tributos - Recibo de Pagamento Autônomo",
  UIV: "Tributos - Unidade Imobiliária Vendida",
  IVR: "Tributos - Unidade Imobiliária Vendida - Valores Recebidos",
  IVO: "Tributos - Unidade Imobiliária Vendida - Custo Orçado",
  IVI: "Tributos - Unidade Imobiliária Vendida - Custo Incorrido",
  PRJ: "Projetos - Lançamentos Manuais",
  CTC: "Cota Capital - Movimentos",
  VRB: "Vetorh - Rubi",
  REG: "Regente",
};

export function orilctLabel(orilct: string | null): string {
  if (!orilct) return "—";
  return ORILCT_LABELS[orilct] ?? orilct;
}

// Domínio "LDebCre" do Senior (lado do rateio). É este campo que dá o sinal do
// realizado: crédito soma, débito subtrai (ver SITRAT_CONTABILIZADO acima).
export const DEBCRE_LABELS: Record<string, string> = {
  D: "Débito",
  C: "Crédito",
};

export function debcreLabel(debcre: string | null): string {
  if (!debcre) return "—";
  return DEBCRE_LABELS[debcre] ?? debcre;
}

// "Receitas x Despesas" — o nível que fica ENTRE a Conta Paralela e a árvore de contas no
// relatório de origem. Não é uma conta: é o `defgru` da conta agrupado, e os códigos "00"/"10"
// são só chave de ordenação (Receitas antes de Despesas), deixando espaço pra intercalar outros
// grupos depois sem renumerar. Validado célula a célula contra o relatório em 13/08/2026:
// agrupar o realizado de ADM/2026 por defgru dá exatamente as duas linhas do print, nos 8 meses.
//
// Hoje só existem D e R entre as contas com `despar`, mas LGruCta tem 15 valores — daí o
// fallback ordenado no fim: um grupo novo aparece no relatório (depois de Receitas e Despesas,
// com o rótulo do domínio) em vez de sumir silenciosamente. Quando isso acontecer, vale definir
// a ordem certa com o Vitor em vez de deixar tudo em "90".
const DEFGRU_BUCKETS: Record<string, { ordem: string; rotulo: string }> = {
  R: { ordem: "00", rotulo: "Receitas" },
  D: { ordem: "10", rotulo: "Despesas" },
};

export function defgruBucket(defgru: string | null): { ordem: string; rotulo: string } {
  if (!defgru) return { ordem: "90", rotulo: "Sem grupo contábil" };
  return DEFGRU_BUCKETS[defgru] ?? { ordem: "90", rotulo: defgruLabel(defgru) };
}

// "Conta Paralela" (PlanoContabil.despar) — hoje coincide 1:1 com departamento (mesmos
// códigos de USU_LDepExe usados em Proposta.depexe/DEPEXE_LABELS). Confirmado no Senior
// em 12/08/2026: cada despar cai só num depexe. Ainda NÃO usado pra RBAC — é o gancho
// pronto pra "gestor só vê o resultado do próprio departamento", quando entrar.
export const DESPAR_PARA_DEPEXE: Record<string, number> = {
  ADM: 1, // Administrativo
  COM: 2, // Comercial
  SERP: 3, // Suporte ERP
  SHCM: 4, // Suporte HCM
  CERP: 8, // Consultoria ERP
  CHCM: 9, // Consultoria HCM
  DEV: 10, // Desenvolvimento
};
