// Domínios do módulo de Despesas de Viagem (RDV) — mesmo padrão de contabilDominio.ts
// (Record<código, label> + função `xxxLabel` com fallback). Usado por
// backend/src/routes/rats.ts, backend/src/routes/ratVisualizacao.ts e pelos syncs em
// src/sync/*ViagemSync.ts.
//
// Rótulos confirmados em 13/08/2026 nas tabelas de lista do Senior — R996LSF/R998LSF
// (`keynam` = código gravado, `valkey` = rótulo legível; ver domain/hierarquiaPlano.ts pro
// mesmo cuidado de sempre ir ao dicionário certo antes de inferir de dado bruto — a tentativa
// inicial olhou a tabela errada, R940END, que está vazia nesta instalação).

// Domínio "USU_LTIPDES" do Senior — tipo da despesa (RegistroDespesaViagem.tipdes).
export const TIPDES_LABELS: Record<number, string> = {
  1: "Deslocamento/km Rodado",
  2: "Estadias/Alimentação",
  3: "Pedágios",
  4: "Ligações Telefônicas",
  5: "Táxi/Metrô/Ônibus",
  6: "Outros",
  7: "Deslocamento por Rota",
};

export function tipdesLabel(tipdes: number | null): string {
  if (tipdes == null) return "—";
  return TIPDES_LABELS[tipdes] ?? `Tipo ${tipdes}`;
}

// A aba "Despesas" da tela de lançamento só oferece estes — 4 (Ligações Telefônicas) ficou de
// fora a pedido do Vitor. 7 (Deslocamento por Rota) tem aba própria: ver TIPDES_DESLOCAMENTO_ROTA.
export const TIPDES_DESPESA_AVULSA = [1, 2, 3, 5, 6] as const;

// A aba "Deslocamento" da tela é inteira sobre este tipo — confirmado com dado real: das
// 15.034 linhas hoje, `moddes`/`rotid` só aparecem preenchidos nas 8 linhas de tipdes=7.
export const TIPDES_DESLOCAMENTO_ROTA = 7;

// Domínio "USU_LRdvTipDes" do Senior — modalidade (RegistroDespesaViagem.moddes E
// PercursoViagem.modtra compartilham o mesmo domínio).
export const MODDES_LABELS: Record<string, string> = {
  "0": "Carro Próprio",
  "1": "Aéreo",
  "2": "Uber/Taxi/Carona",
};

export function moddesLabel(moddes: string | null): string {
  if (!moddes || moddes.trim() === "") return "—";
  return MODDES_LABELS[moddes.trim()] ?? moddes;
}

// Domínio "LSimNao" do Senior — compartilhado por RegistroDespesaViagem.fatrdv (fatura
// cliente) e .reerdv (reembolsa consultor).
export const LSIMNAO_LABELS: Record<string, string> = {
  S: "Sim",
  N: "Não",
};

export function simNaoLabel(valor: string | null): string {
  if (!valor) return "—";
  return LSIMNAO_LABELS[valor] ?? valor;
}

// Domínio "LSitReg" do Senior (situação de registro) — usado por RotaViagem.sitreg.
export const SITREG_LABELS: Record<string, string> = {
  A: "Ativo",
  I: "Inativo",
};

export function sitregLabel(valor: string | null): string {
  if (!valor) return "—";
  return SITREG_LABELS[valor] ?? valor;
}
