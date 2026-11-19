// Linha do tempo do VALOR-HORA do consultor PJ (custo-hora real, bloco C da Rentabilidade, 18/11/2026), montada a partir do histórico de reajuste
// do contrato de compra dele (E460REA) e do preço atual do item (E460CCS.PreUni). Funções PURAS: a rota só busca as linhas e chama aqui.
//
// Como o Senior guarda: cada linha da E460REA é UM reajuste — `vlratu` é o valor DEPOIS dele e `vlrrea` quanto subiu, com `ultrea` = data de
// vigência. Então o valor ANTES do 1º reajuste é `vlratu - vlrrea`, e entre dois reajustes vale o `vlratu` do mais recente. O histórico NÃO é
// contínuo (o Senior tem reajuste sem linha aqui): por isso o preço atual do item é conferido à parte e, se destoar do último valor do
// histórico, vira um aviso (`divergencia`) — nunca um ponto inventado na linha do tempo, porque a data da mudança não se sabe.
//
// PJ: o custo é o valor BRUTO do contrato; as retenções (ISS, IRRF, INSS...) ficam só como informação (decisão do Vitor, 17/11/2026).

export interface ReajusteContrato {
  /** Data de vigência do novo valor (AAAA-MM-DD). */
  ultrea: string;
  /** Quanto o valor subiu neste reajuste. */
  vlrrea: number | null;
  /** Valor depois do reajuste. */
  vlratu: number | null;
  perrea?: number | null;
  desrea?: string | null;
}

export interface VigenciaValorHora {
  /** Vigência a partir de (AAAA-MM-DD). `null` = desde sempre (valor original do contrato, ou único valor conhecido). */
  desde: string | null;
  valor: number;
  origem: "inicial" | "reajuste" | "preco_atual";
  /** Percentual do reajuste (só em `origem = reajuste`). */
  percentual: number | null;
}

export interface LinhaDoTempoValorHora {
  vigencias: VigenciaValorHora[];
  /** Preço atual do item quando destoa (mais de R$ 0,01) do último valor do histórico; `null` quando bate ou não há como comparar. */
  divergencia: { precoAtual: number; ultimoValorDoHistorico: number } | null;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/** Dia 1900-12-31 é o "vazio" de data do Senior. */
function dataValida(d: string | null | undefined): d is string {
  return !!d && !d.startsWith("1900-12-31");
}

export function montarLinhaDoTempo(reajustes: ReajusteContrato[], precoAtual: number | null): LinhaDoTempoValorHora {
  const validos = reajustes.filter((r) => dataValida(r.ultrea) && r.vlratu != null);
  // Ordem por data; na mesma data vale o último que veio (a sync é por chave, então não há duplicata real — defesa barata).
  const porData = new Map<string, ReajusteContrato>();
  for (const r of [...validos].sort((a, b) => a.ultrea.localeCompare(b.ultrea))) porData.set(r.ultrea.slice(0, 10), r);
  const ordenados = [...porData.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (ordenados.length === 0) {
    return { vigencias: precoAtual != null ? [{ desde: null, valor: centavos(precoAtual), origem: "preco_atual", percentual: null }] : [], divergencia: null };
  }

  const vigencias: VigenciaValorHora[] = [];
  const [, primeiro] = ordenados[0];
  if (primeiro.vlrrea != null) {
    vigencias.push({ desde: null, valor: centavos((primeiro.vlratu as number) - primeiro.vlrrea), origem: "inicial", percentual: null });
  }
  for (const [data, r] of ordenados) {
    vigencias.push({ desde: data, valor: centavos(r.vlratu as number), origem: "reajuste", percentual: r.perrea ?? null });
  }

  const ultimo = vigencias[vigencias.length - 1].valor;
  const divergencia = precoAtual != null && Math.abs(precoAtual - ultimo) > 0.01 ? { precoAtual: centavos(precoAtual), ultimoValorDoHistorico: ultimo } : null;
  return { vigencias, divergencia };
}

/** A vigência que vale numa data (AAAA-MM-DD): a última que começou até ela. `null` se não há linha do tempo. */
export function vigenciaEm(vigencias: VigenciaValorHora[], data: string): VigenciaValorHora | null {
  let achado: VigenciaValorHora | null = null;
  for (const v of vigencias) {
    if (v.desde === null || v.desde <= data) achado = v;
  }
  return achado;
}

/** Valor-hora vigente numa data (AAAA-MM-DD): o da última vigência que começou até ela. `null` se não há linha do tempo. */
export function valorHoraEm(vigencias: VigenciaValorHora[], data: string): number | null {
  return vigenciaEm(vigencias, data)?.valor ?? null;
}

export interface EntradaLinhaDoContrato {
  /** O contrato é de VALOR FIXO (view USU_VBI01CTRCS, codmot = 12, com quantidade): ver domain/contratoFixo.ts. */
  fixo: boolean;
  /** Valor-hora da view de contratos do Senior (`ContratoConsultor.vlrhor`) — o mesmo que o card "Valor-hora · Projeção de ganhos" da Home usa. */
  vlrhorDaView: number | null;
  reajustes: ReajusteContrato[];
  /** Preço atual do item do contrato (E460CCS.PreUni). */
  precoAtualDoItem: number | null;
}

/**
 * Linha do tempo do valor-hora de UM contrato, com a regra do contrato de VALOR FIXO (18/11/2026, pedido do Vitor): no fixo o valor-hora é o `vlrhor`
 * da view, como na Home (valor da nota = vlrhor × qtdctr, a quantidade é em horas), e NÃO o histórico de reajuste da E460REA — nesses contratos o
 * Senior mistura no histórico o valor por hora (antes de virar fixo) e o total do mês (depois: 93,897 × 150 = 14.084,55), então ler a linha do tempo
 * daria hora de R$ 14 mil. O valor-hora do fixo vale como único valor conhecido (`preco_atual`), sem comparação com o histórico. Contrato por hora:
 * a linha do tempo dos reajustes, como sempre.
 */
export function linhaDoTempoDoContrato(e: EntradaLinhaDoContrato): LinhaDoTempoValorHora {
  if (e.fixo) {
    return { vigencias: e.vlrhorDaView != null ? [{ desde: null, valor: e.vlrhorDaView, origem: "preco_atual", percentual: null }] : [], divergencia: null };
  }
  return montarLinhaDoTempo(e.reajustes, e.precoAtualDoItem ?? e.vlrhorDaView);
}
