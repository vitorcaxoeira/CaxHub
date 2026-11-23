// Apresentação da tela Administração › Custo-hora real (18/11/2026). Funções PURAS (com teste). As regras do cálculo (qual fonte vale, encargo vigente,
// conta do CLT) moram no servidor (backend/src/domain/custoHora.ts); aqui só o que se vê.

export type OrigemCusto = "clt_folha" | "pj_contrato" | "manual";

export const ROTULO_ORIGEM: Record<OrigemCusto, string> = {
  clt_folha: "CLT · contabilização da folha",
  pj_contrato: "PJ · contrato",
  manual: "Manual",
};

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

/** Texto curto de como o custo-hora foi obtido, a partir do detalhe gravado pelo job (CLT: custo contabilizado no mês ÷ horas; PJ mensal: preço ÷ horas). */
export function descreverDetalhe(origem: string | null, detalhe: unknown): string {
  const d = (detalhe ?? {}) as Record<string, unknown>;
  const reais = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
  if (origem === "clt_folha" && typeof d.custoMensal === "number") {
    const partes = typeof d.provisoes === "number" && d.provisoes !== 0 ? ` (folha ${reais(d.folha)} + provisões ${reais(d.provisoes)})` : "";
    return `${reais(d.custoMensal)} contabilizado a débito no mês${partes} ÷ ${d.horasMes} h`;
  }
  const fixo = d.fixo as { qtd?: number; valorMensal?: number } | null | undefined;
  if (origem === "pj_contrato" && fixo && typeof d.precoContrato === "number") return `${reais(d.precoContrato)} por hora · contrato fixo (${fixo.qtd} h = ${reais(fixo.valorMensal)}/mês)`;
  if (origem === "pj_contrato" && d.mensal === true) return `${reais(d.precoContrato)} (preço mensal) ÷ ${d.horasMes} h`;
  if (origem === "pj_contrato" && typeof d.precoContrato === "number") return `${reais(d.precoContrato)} por hora (contrato)`;
  return "";
}

/** Dados mínimos de uma origem de custo-hora para montar a frase de conta (o que a API de origem devolve, sem as tabelas). */
export interface BaseOrigem {
  origem: string;
  custoHora: number;
  detalhe: unknown;
  /** Início (AAAA-MM-DD) da vigência que valeu no mês, quando a origem tem vigências (PJ e manual). */
  vigenteDesde?: string | null;
}

const reaisBR = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");

function diaBR(dia: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * A conta que leva ao custo-hora, numa frase, para o alto do detalhe da origem: CLT = custo contabilizado no mês ÷ horas; PJ = preço do contrato por hora,
 * preço mensal ÷ horas ou contrato fixo; manual = o valor da vigência. O valor é o gravado pelo cálculo (`custoHora`), nunca recalculado aqui.
 */
export function linhaDaConta(b: BaseOrigem): string {
  const d = (b.detalhe ?? {}) as Record<string, unknown>;
  const porHora = `${reaisBR(b.custoHora)} por hora`;
  if (b.origem === "clt_folha") return `${descreverDetalhe("clt_folha", b.detalhe)} = ${porHora}`;
  if (b.origem === "pj_contrato") {
    const fixo = d.fixo as { qtd?: number; valorMensal?: number } | null | undefined;
    if (fixo) return `Contrato de valor fixo: ${fixo.qtd} h = ${reaisBR(fixo.valorMensal)} por mês · valor-hora do contrato ${porHora}`;
    if (d.mensal === true) return `Preço mensal do contrato ${reaisBR(d.precoContrato)} ÷ ${d.horasMes} h = ${porHora}`;
    const desde = diaBR(b.vigenteDesde);
    return `Preço do contrato no mês: ${porHora}${desde ? ` (vigente desde ${desde})` : ""}`;
  }
  if (b.origem === "manual") {
    const desde = diaBR(b.vigenteDesde);
    return `Valor-hora manual${desde ? ` vigente desde ${desde}` : ""}: ${porHora}`;
  }
  return "";
}

export interface LancamentoOrigem {
  ctared: number;
  clacta: string | null;
  descta: string | null;
  opcctb: number | null;
  codclc: number | null;
  historico: string | null;
  debcre: string;
  valor: number;
  /** Entrou na conta do custo-hora: lançamento a DÉBITO numa das contas gravadas pelo cálculo (crédito nunca entra). */
  considerado: boolean;
}

/** Os que entraram na conta vêm primeiro (cada grupo por classificação da conta e código do lançamento): o que a pessoa quer ver é o que formou o valor. */
export function ordenarLancamentos(itens: LancamentoOrigem[]): LancamentoOrigem[] {
  return [...itens].sort((a, b) => Number(b.considerado) - Number(a.considerado) || (a.clacta ?? "").localeCompare(b.clacta ?? "") || (a.codclc ?? 0) - (b.codclc ?? 0) || a.debcre.localeCompare(b.debcre));
}
