// Arrumação das colunas de uma tabela (26/10/2026): ordem, colunas ocultas e largura de cada coluna, por usuário, guardadas no servidor
// (GET/PUT/DELETE /api/perfil/colunas/:tabela, backend/src/routes/perfil.ts). Funções PURAS, com teste. O servidor não conhece as
// colunas da tela: quem resolve o que vale é `resolverLayout`, contra a lista padrão da tela.
import type { FuncaoResumo } from "./resumo";

export interface LayoutSalvo {
  ordem: string[];
  ocultas: string[];
  /** Largura em px por coluna; vazio = layout automático da tabela (como era antes de qualquer ajuste). */
  larguras?: Record<string, number>;
  /** Resumo do rodapé por coluna (soma, média...; ver resumo.ts); vazio = nenhum (28/10/2026). */
  resumos?: Record<string, FuncaoResumo>;
}

export interface LayoutResolvido {
  ordem: string[];
  ocultas: string[];
  visiveis: string[];
  larguras: Record<string, number>;
  resumos: Record<string, FuncaoResumo>;
}

/** Mesmos limites do servidor (backend/src/routes/layoutColunas.ts). */
export const LARGURA_MIN = 40;
export const LARGURA_MAX = 2000;
export const limitarLargura = (px: number) => Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(px)));

/**
 * Junta o que foi salvo com as colunas que a tela tem hoje: nome que não existe mais é ignorado, coluna nova (criada depois que o usuário
 * arrumou) entra logo depois da coluna que vem antes dela no padrão, e coluna obrigatória nunca fica oculta.
 */
export function resolverLayout(padrao: string[], salvo: LayoutSalvo | null, obrigatorias: string[] = []): LayoutResolvido {
  const existe = new Set(padrao);
  const ordem = (salvo?.ordem ?? []).filter((n) => existe.has(n));
  padrao.forEach((nome, i) => {
    if (ordem.includes(nome)) return;
    const anterior = padrao
      .slice(0, i)
      .reverse()
      .find((n) => ordem.includes(n));
    ordem.splice(anterior ? ordem.indexOf(anterior) + 1 : 0, 0, nome);
  });
  const ocultas = (salvo?.ocultas ?? []).filter((n) => existe.has(n) && !obrigatorias.includes(n));
  const larguras = Object.fromEntries(
    Object.entries(salvo?.larguras ?? {})
      .filter(([n, px]) => existe.has(n) && Number.isFinite(px))
      .map(([n, px]) => [n, limitarLargura(px)]),
  );
  const resumos = Object.fromEntries(Object.entries(salvo?.resumos ?? {}).filter(([n]) => existe.has(n))) as Record<string, FuncaoResumo>;
  return { ordem, ocultas, visiveis: ordem.filter((n) => !ocultas.includes(n)), larguras, resumos };
}

/** Leva `nome` para o lugar de `destino` (arrastar e soltar): indo para a direita fica depois dele, para a esquerda, antes. */
export function moverColuna(ordem: string[], nome: string, destino: string): string[] {
  const de = ordem.indexOf(nome);
  const para = ordem.indexOf(destino);
  if (de < 0 || para < 0 || de === para) return ordem;
  const nova = ordem.filter((n) => n !== nome);
  nova.splice(para, 0, nome);
  return nova;
}

/** Sobe (-1) ou desce (+1) uma posição na ordem; na ponta, não muda. */
export function moverPasso(ordem: string[], nome: string, passo: -1 | 1): string[] {
  const de = ordem.indexOf(nome);
  const vizinho = ordem[de + passo];
  return de < 0 || vizinho === undefined ? ordem : moverColuna(ordem, nome, vizinho);
}

/** Mostra ou oculta; coluna obrigatória não oculta. */
export function alternarOculta(ocultas: string[], nome: string, obrigatorias: string[] = []): string[] {
  if (ocultas.includes(nome)) return ocultas.filter((n) => n !== nome);
  return obrigatorias.includes(nome) ? ocultas : [...ocultas, nome];
}

/**
 * Nova largura de `nome`. No primeiro ajuste (nada salvo ainda) `medidas` traz a largura atual de cada coluna visível, medida na tela:
 * todas são guardadas, para a tabela ficar como estava e só a coluna puxada mudar.
 */
export function definirLargura(larguras: Record<string, number>, nome: string, px: number, medidas?: Record<string, number>): Record<string, number> {
  const base = Object.keys(larguras).length === 0 && medidas ? Object.fromEntries(Object.entries(medidas).map(([n, v]) => [n, limitarLargura(v)])) : larguras;
  return { ...base, [nome]: limitarLargura(px) };
}

/** Igual ao padrão da tela (mesma ordem, nada oculto, sem largura ajustada e sem resumo): não há o que guardar. */
export function ehPadrao(padrao: string[], layout: LayoutSalvo): boolean {
  return (
    layout.ocultas.length === 0 &&
    Object.keys(layout.larguras ?? {}).length === 0 &&
    Object.keys(layout.resumos ?? {}).length === 0 &&
    layout.ordem.length === padrao.length &&
    layout.ordem.every((n, i) => n === padrao[i])
  );
}
