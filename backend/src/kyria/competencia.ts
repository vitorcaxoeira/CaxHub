// Regra de negócio dos relatórios de horas (pedido do Vitor, 24/09/2026): `from`/`to` SEMPRE
// cobrem um mês completo — do dia 01 ao último dia — e o mês consultado é a "competência" do
// registro (entra na chave de busca). Centralizado aqui pro preview do Mapeamento de Campos e
// pro job de import usarem a mesma regra.

export interface IntervaloCompetencia {
  /** YYYY-MM-01 — também é o valor do campo `competencia`. */
  from: string;
  /** YYYY-MM-<último dia do mês> */
  to: string;
}

/** `mes` de 1 a 12. */
export function intervaloDaCompetencia(ano: number, mes: number): IntervaloCompetencia {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error(`Competência inválida: ${ano}-${mes}`);
  }
  // Dia 0 do mês seguinte = último dia deste mês (UTC, sem depender do fuso da máquina).
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return { from: `${ano}-${mm}-01`, to: `${ano}-${mm}-${String(ultimoDia).padStart(2, "0")}` };
}

export function competenciaAtual(agora: Date = new Date()): IntervaloCompetencia {
  return intervaloDaCompetencia(agora.getFullYear(), agora.getMonth() + 1);
}
