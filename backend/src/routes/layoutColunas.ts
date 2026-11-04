// Arrumação das colunas de uma tabela da tela, por usuário (26/10/2026): ordem, colunas ocultas e largura de cada coluna, gravadas em
// `preferencias_colunas`. O backend não conhece as colunas de cada tela, só valida o formato; nome que a tela não tem mais é descartado lá
// (frontend/src/components/colunas/layoutColunas.ts).
import { FUNCOES_RESUMO, type FuncaoResumo } from "../sync/resumoColuna";

export interface LayoutColunas {
  ordem: string[];
  ocultas: string[];
  /** Largura em px por coluna; vazio = layout automático da tela. */
  larguras: Record<string, number>;
  /** Resumo do rodapé por coluna (função da lista FUNCOES_RESUMO); vazio = nenhum. */
  resumos: Record<string, string>;
}

const TABELA_VALIDA = /^[a-z0-9._-]{1,80}$/;
const MAX_COLUNAS = 100;
const MAX_NOME = 60;
export const LARGURA_MIN = 40;
export const LARGURA_MAX = 2000;

/** Chave da tabela na tela (ex.: "plannix.obra.materiais"). */
export function tabelaValida(tabela: unknown): tabela is string {
  return typeof tabela === "string" && TABELA_VALIDA.test(tabela);
}

const nomeValido = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_NOME;

function listaValida(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_COLUNAS && v.every(nomeValido) && new Set(v).size === v.length;
}

function largurasValidas(v: unknown): v is Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const pares = Object.entries(v);
  return (
    pares.length <= MAX_COLUNAS &&
    pares.every(([nome, px]) => nomeValido(nome) && Number.isInteger(px) && (px as number) >= LARGURA_MIN && (px as number) <= LARGURA_MAX)
  );
}

function resumosValidos(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const pares = Object.entries(v);
  return pares.length <= MAX_COLUNAS && pares.every(([nome, f]) => nomeValido(nome) && typeof f === "string" && FUNCOES_RESUMO.has(f as FuncaoResumo));
}

/**
 * Corpo do PUT: `{ ordem: string[], ocultas: string[], larguras?: { coluna: px } }`, sem repetição e sem exagero de tamanho. `larguras`
 * ausente vale `{}` (tela anterior às larguras). null = inválido (400).
 */
export function validarLayoutColunas(corpo: unknown): LayoutColunas | null {
  if (!corpo || typeof corpo !== "object") return null;
  const { ordem, ocultas, larguras = {}, resumos = {} } = corpo as Record<string, unknown>;
  if (!listaValida(ordem) || !listaValida(ocultas) || !largurasValidas(larguras) || !resumosValidos(resumos)) return null;
  return { ordem, ocultas, larguras, resumos };
}
