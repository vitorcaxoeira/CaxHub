// Colunas calculadas por fórmula (28/10/2026, pedido do Vitor): o que vem de GET /api/perfil/calculadas/:tabela e as regras puras de uso
// (nome na arrumação, formato do valor, conferência contra as colunas que a lista tem hoje). A fórmula é lida e calculada por
// lib/formulas/formula.ts; nas listas do navegador o valor sai de useTabelaLocal.
import { ErroFormula, type ColunaDisponivel, type No, tipoDoNo, type TipoColunaFormula } from "../../lib/formulas/formula";

export type FormatoCalculada = "numero" | "moeda" | "percentual";

export interface ColunaCalculadaSalva {
  id: number;
  titulo: string;
  /** Texto como a pessoa escreveu (para editar); quem vale é a árvore. */
  formula: string;
  arvore: No;
  formato: FormatoCalculada;
  casas: number;
  publicada: boolean;
  /** Criada por quem está olhando. */
  minha: boolean;
  /** Pode editar/excluir: a sua, ou publicada sendo admin/master. */
  podeEditar: boolean;
  autor: string | null;
}

/** O que vai no POST/PUT. */
export interface ColunaCalculadaNova {
  titulo: string;
  formula: string;
  arvore: No;
  formato: FormatoCalculada;
  casas: number;
  publicada: boolean;
}

/** Nome da coluna calculada na arrumação, nos filtros e no resumo. */
export const nomeDaCalculada = (id: number) => `calc_${id}`;
export const ehCalculada = (nome: string) => /^calc_\d+$/.test(nome);

export const ROTULO_FORMATO: Record<FormatoCalculada, string> = { numero: "Número", moeda: "Moeda (R$)", percentual: "Percentual (%)" };

/** Valor formatado como a coluna pediu; vazio = "—". Percentual: o número já está em % (a fórmula multiplica por 100). */
export function formatarCalculada(v: unknown, formato: FormatoCalculada, casas: number): string {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const texto = n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  if (formato === "moeda") return `R$ ${texto}`;
  if (formato === "percentual") return `${texto}%`;
  return texto;
}

/**
 * Confere a fórmula salva contra as colunas que a lista tem AGORA (uma coluna pode ter saído da lista, ou mudado de tipo, depois que a
 * fórmula foi feita). null = vale; texto = o motivo, e a coluna aparece com aviso em vez de quebrar a tela.
 */
export function problemaDaCalculada(arvore: No, tipos: Map<string, TipoColunaFormula>): string | null {
  try {
    return tipoDoNo(arvore, tipos) === "numero" ? null : "A fórmula não dá um número";
  } catch (e) {
    return e instanceof ErroFormula ? e.message : "Fórmula inválida";
  }
}

/** Colunas que entram em fórmula: as da lista com título (as calculadas não entram em outra calculada). */
export function colunasParaFormula(colunas: { nome: string; tipo: string }[], titulos: Record<string, string>): ColunaDisponivel[] {
  return colunas
    .filter((c) => !ehCalculada(c.nome) && c.tipo !== "json")
    .map((c) => ({ nome: c.nome, titulo: titulos[c.nome] ?? c.nome, tipo: c.tipo as TipoColunaFormula }));
}
