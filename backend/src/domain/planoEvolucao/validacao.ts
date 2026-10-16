// Plano de Evolução Profissional e Eficiência — validação das entradas das rotas. Funções PURAS, sem banco.
// Mesmo desenho de domain/eficienciaAcoes.ts: `{ ok: true, dados } | { ok: false, erro }`, mensagens em português para a tela mostrar como estão.

import { DEPEXE_LABELS } from "../propostasDominio";
import { dataIsoValida } from "./calendario";
import { CHAVES_INDICADORES, INDICADORES } from "./eficienciaIndividual";
import { DefinicaoOnline } from "./eficienciaIndividual";

export type Validacao<T> = { ok: true; dados: T } | { ok: false; erro: string };
const erro = (mensagem: string): { ok: false; erro: string } => ({ ok: false, erro: mensagem });

export const TEXTO_LONGO_MAX = 1000;
export const MOTIVO_MAX = 300;
export const VALOR_HORA_MAX = 99_999.99;

const numeroOuNulo = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
};

const textoOuNulo = (v: unknown, max: number, nome: string): Validacao<string | null | undefined> => {
  if (v === undefined) return { ok: true, dados: undefined };
  if (v === null || v === "") return { ok: true, dados: null };
  if (typeof v !== "string") return erro(`${nome} inválido.`);
  const t = v.trim();
  if (t.length > max) return erro(`${nome} passa de ${max} caracteres.`);
  return { ok: true, dados: t || null };
};

// ---------------------------------------------------------------- ciclo

export function validarNovoCiclo(corpo: unknown): Validacao<{ ano: number; semestre: 1 | 2 }> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const ano = Number(c.ano);
  const semestre = Number(c.semestre);
  if (!Number.isInteger(ano) || ano < 2026 || ano > 2100) return erro("Informe o ano do ciclo (2026 em diante).");
  if (semestre !== 1 && semestre !== 2) return erro("O semestre é 1 (jan a jun) ou 2 (jul a dez).");
  return { ok: true, dados: { ano, semestre } };
}

export interface IndicadorEditado {
  chave: string;
  peso: number;
  meta: number | null;
  ativo: boolean;
}

export interface EdicaoCiclo {
  metaEficienciaGlobal?: number | null;
  departamentosArea?: number[];
  amostraMinimaHoras?: number;
  definicaoOnline?: DefinicaoOnline;
  notaMinimaEficienciaIndividual?: number;
  naoApuradoQuebraSequencia?: boolean;
  certificacoesExigidas?: string | null;
  atividadesElegiveisClientes?: string | null;
  corteEvidencias?: string;
  apuracaoAte?: string;
  devolutivaEm?: string;
  contestacaoAte?: string;
  indicadores?: IndicadorEditado[];
}

const CAMPOS_DATA = ["corteEvidencias", "apuracaoAte", "devolutivaEm", "contestacaoAte"] as const;

/** Edição parcial de um ciclo em rascunho: só o que veio no corpo entra no resultado. */
export function validarEdicaoCiclo(corpo: unknown): Validacao<EdicaoCiclo> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const saida: EdicaoCiclo = {};

  const meta = numeroOuNulo(c.metaEficienciaGlobal);
  if (meta !== undefined) {
    if (Number.isNaN(meta) || (meta !== null && (meta <= 0 || meta > 100))) return erro("A meta do índice global é um percentual entre 0 e 100.");
    saida.metaEficienciaGlobal = meta;
  }

  if (c.departamentosArea !== undefined) {
    const lista = Array.isArray(c.departamentosArea) ? c.departamentosArea.map(Number) : [];
    const unicos = [...new Set(lista)];
    if (unicos.length === 0 || unicos.some((d) => !Number.isInteger(d) || !(d in DEPEXE_LABELS))) return erro("Escolha ao menos um departamento válido para a área.");
    saida.departamentosArea = unicos.sort((a, b) => a - b);
  }

  if (c.amostraMinimaHoras !== undefined) {
    const n = Number(c.amostraMinimaHoras);
    if (!Number.isInteger(n) || n < 0 || n > 500) return erro("A amostra mínima é um número inteiro de horas entre 0 e 500.");
    saida.amostraMinimaHoras = n;
  }

  if (c.definicaoOnline !== undefined) {
    if (c.definicaoOnline !== "A" && c.definicaoOnline !== "B") return erro("A definição de apontamento online é A ou B.");
    saida.definicaoOnline = c.definicaoOnline;
  }

  if (c.notaMinimaEficienciaIndividual !== undefined) {
    const n = Number(c.notaMinimaEficienciaIndividual);
    if (!Number.isInteger(n) || n < 1 || n > 100) return erro("A nota mínima da eficiência individual é um percentual entre 1 e 100.");
    saida.notaMinimaEficienciaIndividual = n;
  }

  if (c.naoApuradoQuebraSequencia !== undefined) {
    if (typeof c.naoApuradoQuebraSequencia !== "boolean") return erro("Informe sim ou não para a quebra da sequência.");
    saida.naoApuradoQuebraSequencia = c.naoApuradoQuebraSequencia;
  }

  for (const [campo, nome] of [["certificacoesExigidas", "As certificações exigidas"], ["atividadesElegiveisClientes", "As atividades elegíveis"]] as const) {
    const t = textoOuNulo(c[campo], TEXTO_LONGO_MAX, nome);
    if (!t.ok) return t;
    if (t.dados !== undefined) saida[campo] = t.dados;
  }

  for (const campo of CAMPOS_DATA) {
    if (c[campo] === undefined) continue;
    if (!dataIsoValida(c[campo])) return erro("Data inválida no calendário do ciclo.");
    saida[campo] = c[campo] as string;
  }

  if (c.indicadores !== undefined) {
    if (!Array.isArray(c.indicadores)) return erro("Indicadores inválidos.");
    const vistos = new Set<string>();
    const lista: IndicadorEditado[] = [];
    for (const bruto of c.indicadores as Record<string, unknown>[]) {
      const chave = String(bruto?.chave ?? "");
      if (!CHAVES_INDICADORES.includes(chave)) return erro(`Indicador desconhecido: ${chave || "(vazio)"}.`);
      if (vistos.has(chave)) return erro(`O indicador ${chave} aparece duas vezes.`);
      vistos.add(chave);
      const peso = Number(bruto.peso);
      if (!Number.isInteger(peso) || peso < 0 || peso > 100) return erro("O peso de cada indicador é um número inteiro entre 0 e 100.");
      const tipo = INDICADORES.find((i) => i.chave === chave)!.tipo;
      const m = numeroOuNulo(bruto.meta);
      if (tipo === "automatico" && m !== undefined && m !== null && (Number.isNaN(m) || m <= 0 || m > 100)) return erro("A meta de um indicador é um percentual entre 0 e 100.");
      lista.push({ chave, peso, meta: tipo === "automatico" ? (m == null || Number.isNaN(m) ? null : m) : null, ativo: bruto.ativo !== false });
    }
    saida.indicadores = lista;
  }

  return { ok: true, dados: saida };
}

/** O calendário interno precisa estar em ordem: início <= corte <= apuração <= devolutiva <= contestação <= fim. */
export function validarCalendario(c: { inicio: string; fim: string; corteEvidencias: string; apuracaoAte: string; devolutivaEm: string; contestacaoAte: string }): string | null {
  const ordem = [c.inicio, c.corteEvidencias, c.apuracaoAte, c.devolutivaEm, c.contestacaoAte, c.fim];
  for (let i = 1; i < ordem.length; i++) if (ordem[i] < ordem[i - 1]) return "As datas do calendário do ciclo precisam estar em ordem: corte de evidências, apuração, devolutiva, contestação e encerramento.";
  return null;
}

export interface CicloParaPublicar {
  metaEficienciaGlobal: number | null;
  departamentosArea: number[];
  indicadores: { chave: string; peso: number; meta: number | null; ativo: boolean; tipo: string }[];
}

/** O que falta para publicar (e travar) o ciclo. Lista vazia = pode publicar. */
export function pendenciasDePublicacao(c: CicloParaPublicar): string[] {
  const p: string[] = [];
  if (c.metaEficienciaGlobal == null) p.push("Defina a meta do Índice de Eficiência Global.");
  if (c.departamentosArea.length === 0) p.push("Escolha os departamentos que formam a área.");
  const ativos = c.indicadores.filter((i) => i.ativo);
  if (ativos.length === 0) p.push("Ative ao menos um indicador da eficiência operacional.");
  const soma = ativos.reduce((t, i) => t + i.peso, 0);
  if (ativos.length > 0 && soma !== 100) p.push(`Os pesos dos indicadores ativos precisam somar 100 (hoje somam ${soma}).`);
  for (const i of ativos) {
    if (i.tipo === "automatico" && i.meta == null) p.push(`Defina a meta do indicador "${INDICADORES.find((x) => x.chave === i.chave)?.rotulo ?? i.chave}".`);
  }
  return p;
}

// ---------------------------------------------------------------- participante

export interface NovoParticipante {
  codfor: number;
  dataAdesao: string;
  valorHoraBase: number;
  ciclosConsecutivosAntes: number;
}

const valorHoraValido = (v: unknown): number | null => {
  const n = numeroOuNulo(v);
  if (n == null || Number.isNaN(n) || n <= 0 || n > VALOR_HORA_MAX) return null;
  return Math.round(n * 100) / 100;
};

export function validarNovoParticipante(corpo: unknown): Validacao<NovoParticipante> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const codfor = Number(c.codfor);
  if (!Number.isInteger(codfor) || codfor <= 0) return erro("Escolha o consultor.");
  if (!dataIsoValida(c.dataAdesao)) return erro("Informe a data de assinatura do Termo de Ciência.");
  const valorHoraBase = valorHoraValido(c.valorHoraBase);
  if (valorHoraBase == null) return erro("Informe o Valor Hora Base contratado (maior que zero).");
  const consecutivos = c.ciclosConsecutivosAntes === undefined || c.ciclosConsecutivosAntes === "" ? 0 : Number(c.ciclosConsecutivosAntes);
  if (!Number.isInteger(consecutivos) || consecutivos < 0 || consecutivos > 9) return erro("Os ciclos consecutivos anteriores vão de 0 a 9.");
  return { ok: true, dados: { codfor, dataAdesao: c.dataAdesao as string, valorHoraBase, ciclosConsecutivosAntes: consecutivos } };
}

export const MOTIVOS_VALOR_BASE = [
  { chave: "reajuste", rotulo: "Reajuste contratual" },
  { chave: "efetivacao", rotulo: "Efetivação (10 ciclos)" },
] as const;

export interface NovoValorBase {
  valorHoraBase: number;
  desde: string;
  motivo: "reajuste" | "efetivacao";
  observacao: string | null;
}

export function validarValorBase(corpo: unknown): Validacao<NovoValorBase> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const valorHoraBase = valorHoraValido(c.valorHoraBase);
  if (valorHoraBase == null) return erro("Informe o novo Valor Hora Base (maior que zero).");
  if (!dataIsoValida(c.desde)) return erro("Informe desde quando o novo valor vale.");
  const motivo = MOTIVOS_VALOR_BASE.find((m) => m.chave === c.motivo)?.chave;
  if (!motivo) return erro("Escolha o motivo: reajuste contratual ou efetivação.");
  const obs = textoOuNulo(c.observacao, MOTIVO_MAX, "A observação");
  if (!obs.ok) return obs;
  return { ok: true, dados: { valorHoraBase, desde: c.desde as string, motivo, observacao: obs.dados ?? null } };
}

export function validarEncerramento(corpo: unknown): Validacao<{ motivo: string }> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (typeof c.motivo !== "string" || c.motivo.trim().length === 0) return erro("Explique o motivo do encerramento.");
  const motivo = c.motivo.trim();
  if (motivo.length > MOTIVO_MAX) return erro(`O motivo passa de ${MOTIVO_MAX} caracteres.`);
  return { ok: true, dados: { motivo } };
}

// ---------------------------------------------------------------- apuração (Fase 2)

export const CHAVES_OBSERVACAO = ["competencias", "certificacoes", "clientes", "case", "eficiencia", "geral"] as const;
export type ChaveObservacao = (typeof CHAVES_OBSERVACAO)[number];
export const OBSERVACAO_MAX = 500;

export interface EdicaoLancamentos {
  contratoAtivoNoCiclo?: boolean;
  cicloCompleto?: boolean;
  interrupcaoDias?: number;
  competenciasPct?: number | null;
  certificacoesCumpriu?: boolean | null;
  clientesMedia?: number | null;
  clientesRespostas?: number | null;
  caseCumpriu?: boolean | null;
  eficienciaIndividualDecisao?: boolean | null;
  manuais?: { chave: string; atingiu: boolean | null }[];
  observacoes?: Partial<Record<ChaveObservacao, string | null>>;
}

// undefined = não veio; null = limpar; boolean = valor. Qualquer outra coisa é erro.
const triEstado = (v: unknown): boolean | null | undefined | "invalido" => (v === undefined ? undefined : v === null ? null : typeof v === "boolean" ? v : "invalido");

/** Edição parcial dos lançamentos do gestor (só o que veio no corpo entra no resultado). Só indicador MANUAL pode ser lançado. */
export function validarLancamentos(corpo: unknown): Validacao<EdicaoLancamentos> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const saida: EdicaoLancamentos = {};

  for (const campo of ["contratoAtivoNoCiclo", "cicloCompleto"] as const) {
    if (c[campo] === undefined) continue;
    if (typeof c[campo] !== "boolean") return erro("Informe sim ou não para o portão do ciclo.");
    saida[campo] = c[campo] as boolean;
  }

  if (c.interrupcaoDias !== undefined) {
    const n = Number(c.interrupcaoDias);
    if (!Number.isInteger(n) || n < 0 || n > 366) return erro("A interrupção formal é um número de dias entre 0 e 366.");
    saida.interrupcaoDias = n;
  }

  if (c.competenciasPct !== undefined) {
    const n = numeroOuNulo(c.competenciasPct);
    if (n === undefined || Number.isNaN(n) || (n !== null && (n < 0 || n > 100))) return erro("A Avaliação de Competências é um percentual entre 0 e 100.");
    saida.competenciasPct = n;
  }

  if (c.clientesMedia !== undefined) {
    const n = numeroOuNulo(c.clientesMedia);
    if (n === undefined || Number.isNaN(n) || (n !== null && (n < 0 || n > 10))) return erro("A média das avaliações de clientes vai de 0 a 10.");
    saida.clientesMedia = n === null ? null : Math.round(n * 100) / 100;
  }

  if (c.clientesRespostas !== undefined) {
    const n = numeroOuNulo(c.clientesRespostas);
    if (n === undefined || Number.isNaN(n) || (n !== null && (!Number.isInteger(n) || n < 0 || n > 1000))) return erro("O número de avaliações respondidas é um inteiro entre 0 e 1000.");
    saida.clientesRespostas = n;
  }

  for (const campo of ["certificacoesCumpriu", "caseCumpriu", "eficienciaIndividualDecisao"] as const) {
    const t = triEstado(c[campo]);
    if (t === "invalido") return erro("Informe cumprido, não cumprido ou deixe em branco.");
    if (t !== undefined) saida[campo] = t;
  }

  if (c.manuais !== undefined) {
    if (!Array.isArray(c.manuais)) return erro("Indicadores manuais inválidos.");
    const manuais = INDICADORES.filter((i) => i.tipo === "manual").map((i) => i.chave as string);
    const vistos = new Set<string>();
    const lista: { chave: string; atingiu: boolean | null }[] = [];
    for (const bruto of c.manuais as Record<string, unknown>[]) {
      const chave = String(bruto?.chave ?? "");
      if (!manuais.includes(chave)) return erro(`O indicador ${chave || "(vazio)"} não é lançado pelo gestor.`);
      if (vistos.has(chave)) return erro(`O indicador ${chave} aparece duas vezes.`);
      vistos.add(chave);
      const t = triEstado(bruto.atingiu);
      if (t === "invalido" || t === undefined) return erro("Informe atingido, não atingido ou deixe em branco.");
      lista.push({ chave, atingiu: t });
    }
    saida.manuais = lista;
  }

  if (c.observacoes !== undefined) {
    if (c.observacoes === null || typeof c.observacoes !== "object" || Array.isArray(c.observacoes)) return erro("Observações inválidas.");
    const obs: Partial<Record<ChaveObservacao, string | null>> = {};
    for (const [chave, valor] of Object.entries(c.observacoes as Record<string, unknown>)) {
      if (!(CHAVES_OBSERVACAO as readonly string[]).includes(chave)) return erro(`Observação desconhecida: ${chave}.`);
      const t = textoOuNulo(valor, OBSERVACAO_MAX, "A observação");
      if (!t.ok) return t;
      if (t.dados !== undefined) obs[chave as ChaveObservacao] = t.dados;
    }
    saida.observacoes = obs;
  }

  return { ok: true, dados: saida };
}

export function validarDevolutiva(corpo: unknown, hoje: string): Validacao<{ devolutivaEm: string; observacao: string | null }> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (!dataIsoValida(c.devolutivaEm)) return erro("Informe a data da reunião de devolutiva.");
  if (c.devolutivaEm > hoje) return erro("A devolutiva só pode ser registrada depois de acontecer (a data não pode ser futura).");
  const obs = textoOuNulo(c.observacao, 1000, "A observação");
  if (!obs.ok) return obs;
  return { ok: true, dados: { devolutivaEm: c.devolutivaEm, observacao: obs.dados ?? null } };
}

export function validarContestacao(corpo: unknown, hoje: string): Validacao<{ recebidaEm: string; texto: string }> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (!dataIsoValida(c.recebidaEm)) return erro("Informe a data em que a contestação foi recebida.");
  if (c.recebidaEm > hoje) return erro("A data de recebimento não pode ser futura.");
  if (typeof c.texto !== "string" || c.texto.trim().length === 0) return erro("Registre o que o consultor contestou.");
  const texto = c.texto.trim();
  if (texto.length > 2000) return erro("A contestação passa de 2000 caracteres.");
  return { ok: true, dados: { recebidaEm: c.recebidaEm, texto } };
}

export function validarDesfecho(corpo: unknown): Validacao<{ resultado: "mantida" | "procedente"; texto: string }> {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.resultado !== "mantida" && c.resultado !== "procedente") return erro("Escolha o desfecho: apuração mantida ou contestação procedente.");
  if (typeof c.texto !== "string" || c.texto.trim().length === 0) return erro("Explique o desfecho (a resposta formal ao consultor).");
  const texto = c.texto.trim();
  if (texto.length > 1000) return erro("O texto do desfecho passa de 1000 caracteres.");
  return { ok: true, dados: { resultado: c.resultado, texto } };
}
