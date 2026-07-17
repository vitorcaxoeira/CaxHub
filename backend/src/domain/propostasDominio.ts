// Domínio "USU_SitPro" do Senior (situação da proposta).
export const SITPRO_LABELS: Record<number, string> = {
  1: "Abertura",
  2: "Comercial",
  3: "Enviada p/ Cliente",
  4: "Aprovada",
  5: "Rejeitada",
  6: "Cancelada",
  7: "Em Execução",
  8: "Executada",
  9: "Levantamento Interno",
};
export const SITPRO_ORDER = [1, 2, 3, 4, 7, 9, 8, 5, 6];

// "Pipeline em aberto" = ainda não decidida (nem aprovada, nem perdida) e ainda não virou projeto.
// Usado pelos KPIs/funil já existentes — não mexer (inclui Levantamento Interno).
export const SITPRO_ABERTA = [1, 2, 3, 9];

// Conjuntos de negócio dos indicadores comerciais novos — "em decisão" aqui EXCLUI
// Levantamento Interno (9), por ser trabalho interno e não venda propriamente dita.
// Distinto de SITPRO_ABERTA de propósito, para não confundir os dois esquemas.
export const SITPRO_EM_DECISAO = [1, 2, 3];
// Ganhas = mesmo conjunto já usado pelo KPI de conversão existente. sitpro=4 (Aprovada)
// sozinho é um estado transitório (a proposta sai dele assim que a execução começa),
// então contar só ele subestima a conversão em ordens de grandeza (testado com dado
// real: 60 vs 3.299 propostas) — sempre usar os 3 juntos.
export const SITPRO_GANHAS = [4, 7, 8];
export const SITPRO_PERDIDAS = [5, 6];
export const SITPRO_DECIDIDAS = [4, 5, 6, 7, 8];

// Domínio "USU_TipVen" do Senior (tipo de venda de serviços).
export const TIPVEN_LABELS: Record<number, string> = {
  1: "Venda Serviços Cliente Novo",
  2: "Venda Consultiva Serviços Base",
  3: "Venda Serviços Reativa Base Clientes",
  4: "Outros Tipos de Propostas",
};

// Domínio "USU_ModPro" do Senior (modalidade da proposta).
export const MODPRO_LABELS: Record<number, string> = {
  0: "Serviço",
  1: "Levantamento",
  2: "DRM",
};

// Domínio "USU_TipProd" do Senior (produto/linha da proposta).
export const SISPRO_LABELS: Record<number, string> = {
  1: "Gestão Empresarial (ERP)",
  2: "Gestão de Pessoas (HCM)",
  3: "Gestão de Acesso e Segurança",
  4: "Implantação",
  5: "SoelX",
  9: "Outros",
};
export const SISPRO_ORDER = [1, 2, 3, 4, 5, 9];

// Domínio "USU_ClaPro" do Senior (classificação de porte do projeto).
export const CLAPRO_LABELS: Record<number, string> = {
  1: "Grandes (>300h)",
  2: "Médios (100–299h)",
  3: "Pequenos (25–99h)",
  4: "Rápidos (até 24h)",
};
export const CLAPRO_ORDER = [1, 2, 3, 4];

// Domínio "USU_PriPro" do Senior (prioridade da proposta/projeto).
export const PRIPRO_LABELS: Record<number, string> = {
  1: "Alta",
  2: "Média",
  3: "Baixa",
};
export function priproLabel(pripro: number | null): string {
  if (pripro === null) return "—";
  return PRIPRO_LABELS[pripro] ?? `Prioridade ${pripro}`;
}

// Domínio "USU_LDepExe" do Senior (departamento executor) — presente tanto em
// Proposta quanto em PropostaItem (mesmo domínio, granularidades diferentes).
export const DEPEXE_LABELS: Record<number, string> = {
  0: "Diretoria",
  1: "Administrativo",
  2: "Comercial",
  3: "Suporte ERP",
  4: "Suporte HCM",
  5: "Suporte TI ERP",
  6: "Suporte TI HCM",
  8: "Consultoria ERP",
  9: "Consultoria HCM",
  10: "Desenvolvimento",
  11: "DHO",
  12: "Documentação",
  13: "Processo Interno",
};

export function depexeLabel(depexe: number | null): string {
  if (depexe === null) return "—";
  return DEPEXE_LABELS[depexe] ?? `Depto. ${depexe}`;
}

// Domínio "USU_TRatForFat" do Senior (forma de faturamento).
export const FORFAT_LABELS: Record<number, string> = {
  0: "Mediante RAT",
  1: "Finalização",
  2: "Antecipado",
  3: "Sem Faturamento",
  4: "Misto (Parte Antecipada e com RAT)",
  5: "Faturamento Via Contrato",
  6: "Antecipado Saldo Finalização",
};

export function forfatLabel(forfat: number | null): string {
  if (forfat === null) return "—";
  return FORFAT_LABELS[forfat] ?? `Forma ${forfat}`;
}

export function sitproLabel(sitpro: number | null): string {
  if (sitpro === null) return "Sem situação";
  return SITPRO_LABELS[sitpro] ?? `Situação ${sitpro}`;
}

export function sitproTone(sitpro: number | null): "success" | "warning" | "destructive" | "neutral" {
  if (sitpro === 7) return "success";
  if (sitpro === 4 || sitpro === 8) return "success";
  if (sitpro === 5 || sitpro === 6) return "destructive";
  if (sitpro === 1 || sitpro === 2 || sitpro === 3 || sitpro === 9) return "warning";
  return "neutral";
}
