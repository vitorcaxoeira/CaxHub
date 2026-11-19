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
    return `${reais(d.custoMensal)} contabilizado no mês${partes} ÷ ${d.horasMes} h`;
  }
  const fixo = d.fixo as { qtd?: number; valorMensal?: number } | null | undefined;
  if (origem === "pj_contrato" && fixo && typeof d.precoContrato === "number") return `${reais(d.precoContrato)} por hora · contrato fixo (${fixo.qtd} h = ${reais(fixo.valorMensal)}/mês)`;
  if (origem === "pj_contrato" && d.mensal === true) return `${reais(d.precoContrato)} (preço mensal) ÷ ${d.horasMes} h`;
  if (origem === "pj_contrato" && typeof d.precoContrato === "number") return `${reais(d.precoContrato)} por hora (contrato)`;
  return "";
}
