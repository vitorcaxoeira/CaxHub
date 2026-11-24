// Painel de Eficiência — Plano de ação (funções puras, sem Prisma).
//
// Uma ação é "o que o gestor combinou a partir de um alerta": título, responsável (consultor do time), prazo e status.
// Datas de prazo são datas de CALENDÁRIO (sem hora), trocadas como "AAAA-MM-DD" e comparadas como texto — a comparação
// lexicográfica de datas ISO equivale à cronológica e foge de toda confusão de fuso. "Hoje" é o dia em São Paulo.

export const STATUS_ACAO = [
  { chave: "aberta", rotulo: "Aberta" },
  { chave: "andamento", rotulo: "Em andamento" },
  { chave: "concluida", rotulo: "Concluída" },
] as const;

export type StatusAcao = (typeof STATUS_ACAO)[number]["chave"];

export const TITULO_ACAO_MAX = 200;
export const OBSERVACAO_ACAO_MAX = 1000;
export const ORIGEM_ALERTA_MAX = 200;

export function rotuloStatusAcao(chave: string): string {
  return STATUS_ACAO.find((s) => s.chave === chave)?.rotulo ?? chave;
}

const FORMATO_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Dia de hoje em São Paulo, "AAAA-MM-DD" (o servidor pode estar em UTC: às 22h de SP já é "amanhã" lá). */
export function hojeIso(agora: Date = new Date()): string {
  return FORMATO_SP.format(agora);
}

/** "AAAA-MM-DD" que é uma data real (rejeita 2026-02-31) entre 2000 e 2100. */
export function dataIsoValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [a, m, d] = valor.split("-").map(Number);
  if (a < 2000 || a > 2100) return false;
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

/** Soma `n` dias úteis (seg–sex; feriado não é considerado) a uma data ISO. */
export function somarDiasUteis(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  let restantes = n;
  while (restantes > 0) {
    data.setUTCDate(data.getUTCDate() + 1);
    const dia = data.getUTCDay();
    if (dia !== 0 && dia !== 6) restantes--;
  }
  return data.toISOString().slice(0, 10);
}

export type Validacao<T> = { ok: true; dados: T } | { ok: false; erro: string };

export interface NovaAcao {
  titulo: string;
  observacao: string | null;
  prazo: string;
  responsavelCodfor: number;
  codemp: number | null;
  codpro: number | null;
  codforAlvo: number | null;
  origemAlerta: string | null;
}

function textoOpcional(valor: unknown, max: number, nome: string): Validacao<string | null> {
  if (valor == null || valor === "") return { ok: true, dados: null };
  if (typeof valor !== "string") return { ok: false, erro: `${nome} inválido.` };
  const t = valor.trim();
  if (t.length > max) return { ok: false, erro: `${nome} passa de ${max} caracteres.` };
  return { ok: true, dados: t || null };
}

function inteiroOpcional(valor: unknown, nome: string): Validacao<number | null> {
  if (valor == null || valor === "") return { ok: true, dados: null };
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, erro: `${nome} inválido.` };
  return { ok: true, dados: n };
}

function tituloValido(valor: unknown): Validacao<string> {
  if (typeof valor !== "string" || valor.trim().length === 0) return { ok: false, erro: "Descreva o que precisa ser feito." };
  const t = valor.trim();
  if (t.length > TITULO_ACAO_MAX) return { ok: false, erro: `O título passa de ${TITULO_ACAO_MAX} caracteres.` };
  return { ok: true, dados: t };
}

/** Ação nova: título, responsável e prazo são obrigatórios; o prazo não pode estar no passado. */
export function validarNovaAcao(corpo: unknown, hoje: string): Validacao<NovaAcao> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const titulo = tituloValido(c.titulo);
  if (!titulo.ok) return titulo;
  const responsavel = Number(c.responsavelCodfor);
  if (!Number.isInteger(responsavel) || responsavel <= 0) return { ok: false, erro: "Escolha o responsável." };
  if (!dataIsoValida(c.prazo)) return { ok: false, erro: "Informe um prazo válido." };
  if (c.prazo < hoje) return { ok: false, erro: "O prazo não pode ser anterior a hoje." };
  const observacao = textoOpcional(c.observacao, OBSERVACAO_ACAO_MAX, "Observação");
  if (!observacao.ok) return observacao;
  const origem = textoOpcional(c.origemAlerta, ORIGEM_ALERTA_MAX, "Origem");
  if (!origem.ok) return origem;
  const codemp = inteiroOpcional(c.codemp, "Proposta");
  const codpro = inteiroOpcional(c.codpro, "Proposta");
  if (!codemp.ok) return codemp;
  if (!codpro.ok) return codpro;
  if ((codemp.dados == null) !== (codpro.dados == null)) return { ok: false, erro: "Proposta inválida." };
  const alvo = inteiroOpcional(c.codforAlvo, "Consultor de referência");
  if (!alvo.ok) return alvo;
  return {
    ok: true,
    dados: {
      titulo: titulo.dados,
      observacao: observacao.dados,
      prazo: c.prazo,
      responsavelCodfor: responsavel,
      codemp: codemp.dados,
      codpro: codpro.dados,
      codforAlvo: alvo.dados,
      origemAlerta: origem.dados,
    },
  };
}

export interface EdicaoAcao {
  titulo?: string;
  observacao?: string | null;
  prazo?: string;
  responsavelCodfor?: number;
}

/**
 * Edição parcial (só o que vier no corpo). A proposta de referência e a origem não mudam depois de criadas.
 * Se o prazo vier, só confere o formato aqui: a regra "não anterior a hoje" vale quando o prazo MUDA (quem decide é a rota,
 * que conhece o prazo antigo — senão não dá pra editar o título de uma ação que já venceu).
 */
export function validarEdicaoAcao(corpo: unknown): Validacao<EdicaoAcao> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const dados: EdicaoAcao = {};
  if ("titulo" in c) {
    const t = tituloValido(c.titulo);
    if (!t.ok) return t;
    dados.titulo = t.dados;
  }
  if ("observacao" in c) {
    const o = textoOpcional(c.observacao, OBSERVACAO_ACAO_MAX, "Observação");
    if (!o.ok) return o;
    dados.observacao = o.dados;
  }
  if ("prazo" in c) {
    if (!dataIsoValida(c.prazo)) return { ok: false, erro: "Informe um prazo válido." };
    dados.prazo = c.prazo;
  }
  if ("responsavelCodfor" in c) {
    const n = Number(c.responsavelCodfor);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, erro: "Escolha o responsável." };
    dados.responsavelCodfor = n;
  }
  if (Object.keys(dados).length === 0) return { ok: false, erro: "Nada para alterar." };
  return { ok: true, dados };
}

export function validarStatus(corpo: unknown): Validacao<StatusAcao> {
  const status = STATUS_ACAO.find((s) => s.chave === (corpo as { status?: unknown } | null)?.status)?.chave;
  return status ? { ok: true, dados: status } : { ok: false, erro: "Status inválido." };
}

export type FiltroAcoes = "abertas" | "atrasadas" | "concluidas" | "todas";

export function estaAtrasada(a: { status: string; prazo: string }, hoje: string): boolean {
  return a.status !== "concluida" && a.prazo < hoje;
}

export function passaFiltroAcao(a: { status: string; prazo: string }, filtro: FiltroAcoes, hoje: string): boolean {
  if (filtro === "abertas") return a.status !== "concluida";
  if (filtro === "atrasadas") return estaAtrasada(a, hoje);
  if (filtro === "concluidas") return a.status === "concluida";
  return true;
}

export function filtroAcoesValido(valor: unknown): FiltroAcoes {
  return valor === "atrasadas" || valor === "concluidas" || valor === "todas" ? valor : "abertas";
}

export interface ContagemAcoes {
  abertas: number;
  atrasadas: number;
  concluidas: number;
  todas: number;
  /** Abertas que vencem de hoje até 5 dias úteis (as já atrasadas ficam de fora: têm contagem própria). */
  vencemEm5DiasUteis: number;
}

export function contarAcoes(acoes: { status: string; prazo: string }[], hoje: string): ContagemAcoes {
  const limite = somarDiasUteis(hoje, 5);
  const c: ContagemAcoes = { abertas: 0, atrasadas: 0, concluidas: 0, todas: acoes.length, vencemEm5DiasUteis: 0 };
  for (const a of acoes) {
    if (a.status === "concluida") c.concluidas++;
    else {
      c.abertas++;
      if (a.prazo < hoje) c.atrasadas++;
      else if (a.prazo <= limite) c.vencemEm5DiasUteis++;
    }
  }
  return c;
}
