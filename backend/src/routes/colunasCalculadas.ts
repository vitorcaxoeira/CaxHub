// Colunas calculadas por fórmula nas listas da tela (28/10/2026): o corpo do POST/PUT de /perfil/calculadas/:tabela. Cada usuário cria as
// suas; publicar (todos da lista veem) é de admin/master. A árvore da fórmula vem lida pela tela: aqui só a estrutura é conferida
// (formulas/formula.ts, validarEstruturaFormula) — as colunas e os tipos são conferidos ao usar, contra a lista de verdade.
import { ErroFormula, validarEstruturaFormula, type No } from "../formulas/formula";

export const FORMATOS_CALCULADA = ["numero", "moeda", "percentual"] as const;
export type FormatoCalculada = (typeof FORMATOS_CALCULADA)[number];
export const MAX_CALCULADAS_POR_LISTA = 20;
const MAX_TITULO = 60;
const MAX_FORMULA = 500;

export interface ColunaCalculadaEntrada {
  titulo: string;
  formula: string;
  arvore: No;
  formato: FormatoCalculada;
  casas: number;
  publicada: boolean;
}

/** Corpo do POST/PUT conferido, ou a mensagem do que está errado (400). */
export function validarColunaCalculada(corpo: unknown): { ok: true; valor: ColunaCalculadaEntrada } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return { ok: false, erro: "Coluna calculada inválida" };
  const { titulo, formula, arvore, formato = "numero", casas = 2, publicada = false } = corpo as Record<string, unknown>;
  if (typeof titulo !== "string" || !titulo.trim() || titulo.trim().length > MAX_TITULO) return { ok: false, erro: `Dê um título de até ${MAX_TITULO} caracteres` };
  if (typeof formula !== "string" || !formula.trim() || formula.length > MAX_FORMULA) return { ok: false, erro: `Fórmula vazia ou longa demais (máximo de ${MAX_FORMULA} caracteres)` };
  if (typeof formato !== "string" || !(FORMATOS_CALCULADA as readonly string[]).includes(formato)) return { ok: false, erro: "Formato inválido" };
  if (typeof casas !== "number" || !Number.isInteger(casas) || casas < 0 || casas > 3) return { ok: false, erro: "Casas decimais de 0 a 3" };
  if (typeof publicada !== "boolean") return { ok: false, erro: "Publicada inválida" };
  try {
    return { ok: true, valor: { titulo: titulo.trim(), formula: formula.trim(), arvore: validarEstruturaFormula(arvore), formato: formato as FormatoCalculada, casas, publicada } };
  } catch (e) {
    return { ok: false, erro: e instanceof ErroFormula ? e.message : "Fórmula inválida" };
  }
}
