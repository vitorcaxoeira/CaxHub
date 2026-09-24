// Regras puras do módulo Gestão 5S (sem banco): sensos, cálculo de percentuais e permissões.

export const SENSOS = [
  { chave: "seiri", nome: "Seiri", rotulo: "Seiri – Utilização" },
  { chave: "seiton", nome: "Seiton", rotulo: "Seiton – Organização" },
  { chave: "seiso", nome: "Seiso", rotulo: "Seiso – Limpeza" },
  { chave: "seiketsu", nome: "Seiketsu", rotulo: "Seiketsu – Padronização" },
  { chave: "shitsuke", nome: "Shitsuke", rotulo: "Shitsuke – Disciplina" },
] as const;

export type Senso = (typeof SENSOS)[number]["chave"];
export const CHAVES_SENSO: Senso[] = SENSOS.map((s) => s.chave);

export const TIPOS_AREA = ["setor", "comum"] as const;
export type TipoArea = (typeof TIPOS_AREA)[number];

export const PAPEIS_5S = ["coordenador", "avaliador", "lider"] as const;
export type Papel5S = (typeof PAPEIS_5S)[number];

export const STATUS_AVALIACAO = ["em_andamento", "finalizada"] as const;
export type StatusAvaliacao = (typeof STATUS_AVALIACAO)[number];

export const NOTA_MIN = 1;
export const NOTA_MAX = 5;

export function ehSenso(valor: unknown): valor is Senso {
  return typeof valor === "string" && (CHAVES_SENSO as string[]).includes(valor);
}

export interface RespostaCalculo {
  senso: string;
  nota: number | null;
  naoSeAplica: boolean;
}

export type PercentuaisPorSenso = Record<Senso, number | null>;

export interface Percentuais {
  porSenso: PercentuaisPorSenso;
  geral: number | null;
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// % do senso = soma das notas / (5 × perguntas respondidas). NA e perguntas sem resposta saem
// do denominador, então "não se aplica" nunca puxa a nota do setor pra baixo. Senso sem nenhuma
// resposta aplicável fica null e não entra na média geral (que é a média simples dos sensos
// avaliados, como na planilha).
export function calcularPercentuais(respostas: RespostaCalculo[]): Percentuais {
  const porSenso = {} as PercentuaisPorSenso;
  const validos: number[] = [];
  for (const senso of CHAVES_SENSO) {
    const doSenso = respostas.filter((r) => r.senso === senso && !r.naoSeAplica && r.nota != null);
    if (doSenso.length === 0) {
      porSenso[senso] = null;
      continue;
    }
    const soma = doSenso.reduce((acc, r) => acc + (r.nota as number), 0);
    const perc = arredondar((soma / (doSenso.length * NOTA_MAX)) * 100);
    porSenso[senso] = perc;
    validos.push(perc);
  }
  const geral = validos.length ? arredondar(validos.reduce((a, b) => a + b, 0) / validos.length) : null;
  return { porSenso, geral };
}

export function media(valores: Array<number | null | undefined>): number | null {
  const v = valores.filter((x): x is number => typeof x === "number");
  return v.length ? arredondar(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

export type Tendencia = "melhora" | "queda" | "estavel" | null;

// Diferença dentro de ±1 ponto percentual conta como estável.
export function tendencia(atual: number | null, anterior: number | null): Tendencia {
  if (atual == null || anterior == null) return null;
  const diff = atual - anterior;
  if (diff > 1) return "melhora";
  if (diff < -1) return "queda";
  return "estavel";
}

function dd(n: number): string {
  return String(n).padStart(2, "0");
}

// "Avaliação 5S – 18/09/2026 – Administrativo". A data é a do dia civil (UTC, como vem do @db.Date).
export function montarTitulo(data: Date, areaNome: string): string {
  return `Avaliação 5S – ${dd(data.getUTCDate())}/${dd(data.getUTCMonth() + 1)}/${data.getUTCFullYear()} – ${areaNome}`;
}

export function hojeComoData(): Date {
  const agora = new Date();
  // Dia civil no fuso do servidor (o negócio é em horário de Brasília), gravado como meia-noite UTC.
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
}

export function chaveMes(data: Date): string {
  return `${data.getUTCFullYear()}-${dd(data.getUTCMonth() + 1)}`;
}

// ── Permissões ──────────────────────────────────────────────────────────────────────────────

export interface Acesso5S {
  papel: Papel5S | null;
  // Áreas onde o participante é líder (vazio para os demais papéis).
  areasLider: number[];
}

export interface AreaAcesso {
  id: number;
  tipo: string;
  setorVinculadoId: number | null;
}

export function temAcesso(acesso: Acesso5S): boolean {
  return acesso.papel != null;
}

export function podeGerenciarCadastros(acesso: Acesso5S): boolean {
  return acesso.papel === "coordenador";
}

export function podeAvaliar(acesso: Acesso5S): boolean {
  return acesso.papel === "coordenador" || acesso.papel === "avaliador";
}

export function podeObservar(acesso: Acesso5S): boolean {
  return acesso.papel != null;
}

// Coordenador e avaliador veem tudo. O líder vê os setores dele, todos os ambientes comuns sem
// vínculo (compartilhados) e os ambientes vinculados a um dos setores dele.
export function podeVerArea(acesso: Acesso5S, area: AreaAcesso): boolean {
  if (acesso.papel === "coordenador" || acesso.papel === "avaliador") return true;
  if (acesso.papel !== "lider") return false;
  if (area.tipo === "setor") return acesso.areasLider.includes(area.id);
  if (area.setorVinculadoId == null) return true;
  return acesso.areasLider.includes(area.setorVinculadoId);
}

// Líder só registra observação nas áreas que ele enxerga.
export function podeObservarArea(acesso: Acesso5S, area: AreaAcesso): boolean {
  return podeObservar(acesso) && podeVerArea(acesso, area);
}
