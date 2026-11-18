// Apresentação da tela Administração › Custo-hora real (18/11/2026). Funções PURAS (com teste). As regras do cálculo (qual fonte vale, encargo vigente,
// conta do CLT) moram no servidor (backend/src/domain/custoHora.ts); aqui só o que se vê.

export type ClasseEvento = "remuneracao" | "beneficio" | "encargo_folha";
export type OrigemCusto = "clt_folha" | "pj_contrato" | "manual";

export const ROTULO_CLASSE: Record<ClasseEvento, string> = {
  remuneracao: "Remuneração",
  beneficio: "Benefício",
  encargo_folha: "Encargo da folha",
};

export const AJUDA_CLASSE: Record<ClasseEvento, string> = {
  remuneracao: "Entra no custo e na base dos encargos percentuais (salário, horas extras, comissões, férias...).",
  beneficio: "Entra no custo, fora da base dos percentuais (vale-refeição, plano de saúde...).",
  encargo_folha: "Encargo que a própria folha já calcula (FGTS, INSS patronal informativos): entra no custo, fora da base.",
};

export const ROTULO_ORIGEM: Record<OrigemCusto, string> = {
  clt_folha: "CLT · folha",
  pj_contrato: "PJ · contrato",
  manual: "Manual",
};

/** Tipo do evento no Senior (R008EVC.TipEve), como o resto do CaxHub o chama (domain/rh/dominios.ts). */
export const ROTULO_TIPO_EVENTO: Record<number, string> = {
  0: "Sem tipo",
  1: "Provento",
  2: "Vantagem",
  3: "Desconto",
  4: "Outros",
  5: "Outros env. provento",
  6: "Outros env. desconto",
};

export const rotuloTipoEvento = (tipo: number | null | undefined): string => (tipo == null ? "Sem cadastro" : (ROTULO_TIPO_EVENTO[tipo] ?? `Tipo ${tipo}`));

/** "2026-10-01" → "10/2026". */
export function rotuloCompetencia(competencia: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(competencia ?? "");
  return m ? `${m[2]}/${m[1]}` : "—";
}

/** O mês anterior ao de `hoje`, no formato do <input type="month"> (AAAA-MM): o último mês que costuma ter folha fechada. */
export function mesAnterior(hoje = new Date()): string {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0-11: o mês anterior (1-12) é o próprio índice
  return mes === 0 ? `${ano - 1}-12` : `${ano}-${String(mes).padStart(2, "0")}`;
}

/** Percentual com até 4 casas, sem zeros sobrando: 20 → "20", 8.33 → "8,33", 5.8 → "5,8". */
export function formatarPercentual(valor: number | null | undefined): string {
  return valor == null ? "—" : `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
}

export interface ResumoOrigens {
  clt_folha: number;
  pj_contrato: number;
  manual: number;
  semCusto: number;
}

/** Quantos consultores há por origem no mês e quantos ATIVOS ficaram sem custo (o que pede atenção). */
export function resumirResultado(linhas: { ativo: boolean; origem: string | null; custoHora: number | null }[]): ResumoOrigens {
  const r: ResumoOrigens = { clt_folha: 0, pj_contrato: 0, manual: 0, semCusto: 0 };
  for (const l of linhas) {
    if (l.custoHora != null && (l.origem === "clt_folha" || l.origem === "pj_contrato" || l.origem === "manual")) r[l.origem]++;
    else if (l.ativo) r.semCusto++;
  }
  return r;
}

/** Texto curto de como o custo-hora foi obtido, a partir do detalhe gravado pelo job (CLT: custo mensal ÷ horas; PJ mensal: preço ÷ horas). */
export function descreverDetalhe(origem: string | null, detalhe: unknown): string {
  const d = (detalhe ?? {}) as Record<string, unknown>;
  const reais = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
  if (origem === "clt_folha" && typeof d.custoMensal === "number") return `${reais(d.custoMensal)} no mês ÷ ${d.horasMes} h`;
  const fixo = d.fixo as { qtd?: number; valorMensal?: number } | null | undefined;
  if (origem === "pj_contrato" && fixo && typeof d.precoContrato === "number") return `${reais(d.precoContrato)} por hora · contrato fixo (${fixo.qtd} h = ${reais(fixo.valorMensal)}/mês)`;
  if (origem === "pj_contrato" && d.mensal === true) return `${reais(d.precoContrato)} (preço mensal) ÷ ${d.horasMes} h`;
  if (origem === "pj_contrato" && typeof d.precoContrato === "number") return `${reais(d.precoContrato)} por hora (contrato)`;
  return "";
}
