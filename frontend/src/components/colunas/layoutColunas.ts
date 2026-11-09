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
  /**
   * Última coluna parada ao rolar na horizontal ("congelar até aqui", 09/11/2026). null/ausente = sem escolha (vale o padrão da tela);
   * "" = nenhuma parada, de propósito; "nome" = ela e as visíveis antes dela, na ordem atual, ficam paradas.
   */
  congeladaAte?: string | null;
}

export interface LayoutResolvido {
  ordem: string[];
  ocultas: string[];
  visiveis: string[];
  larguras: Record<string, number>;
  resumos: Record<string, FuncaoResumo>;
  /** O limite que vale (a escolha do usuário ou o padrão da tela); "" = nenhuma parada. */
  congeladaAte: string;
  /** As colunas paradas: visíveis, da primeira até o limite, na ordem. */
  congeladas: string[];
}

/** Mesmos limites do servidor (backend/src/routes/layoutColunas.ts). */
export const LARGURA_MIN = 40;
export const LARGURA_MAX = 2000;
export const limitarLargura = (px: number) => Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.round(px)));

/**
 * Junta o que foi salvo com as colunas que a tela tem hoje: nome que não existe mais é ignorado, coluna nova (criada depois que o usuário
 * arrumou) entra logo depois da coluna que vem antes dela no padrão, e coluna obrigatória nunca fica oculta. `ocultasPadrao` (04/11/2026):
 * colunas que nascem ocultas quando o usuário ainda não arrumou nada (as que não existiam na tabela antes do kit de colunas); ele as liga
 * no painel "Colunas".
 */
export function resolverLayout(
  padrao: string[],
  salvo: LayoutSalvo | null,
  obrigatorias: string[] = [],
  ocultasPadrao: string[] = [],
  congeladaAtePadrao = "",
): LayoutResolvido {
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
  // Sem nada salvo, GET /api/perfil/colunas devolve { ordem: [], ocultas: [] }; arrumação salva de verdade sempre traz a ordem inteira.
  const temSalvo = salvo != null && salvo.ordem.length > 0;
  const ocultas = (temSalvo ? salvo.ocultas : ocultasPadrao).filter((n) => existe.has(n) && !obrigatorias.includes(n));
  const larguras = Object.fromEntries(
    Object.entries(salvo?.larguras ?? {})
      .filter(([n, px]) => existe.has(n) && Number.isFinite(px))
      .map(([n, px]) => [n, limitarLargura(px)]),
  );
  const resumos = Object.fromEntries(Object.entries(salvo?.resumos ?? {}).filter(([n]) => existe.has(n))) as Record<string, FuncaoResumo>;
  // Escolha do usuário (inclusive "" = nenhuma); sem escolha ou com coluna que a tela não tem mais, vale o padrão da tela.
  const escolhida = salvo?.congeladaAte;
  const padraoExiste = existe.has(congeladaAtePadrao) ? congeladaAtePadrao : "";
  const congeladaAte = escolhida != null && (escolhida === "" || existe.has(escolhida)) ? escolhida : padraoExiste;
  return {
    ordem,
    ocultas,
    visiveis: ordem.filter((n) => !ocultas.includes(n)),
    larguras,
    resumos,
    congeladaAte,
    congeladas: colunasCongeladas(ordem, ocultas, congeladaAte),
  };
}

/**
 * As colunas paradas ao rolar: as VISÍVEIS da primeira até `limite` (inclusive), na ordem atual ("congelar até aqui", como no Excel). Limite vazio ou
 * que não está na ordem = nenhuma. Limite oculto: valem as visíveis antes dele.
 */
export function colunasCongeladas(ordem: string[], ocultas: string[], limite: string): string[] {
  const i = limite ? ordem.indexOf(limite) : -1;
  return i < 0 ? [] : ordem.slice(0, i + 1).filter((n) => !ocultas.includes(n));
}

/** Parte da largura visível da tabela que as colunas paradas podem ocupar: passou disso sobra pouco espaço para rolar o resto. */
export const FRACAO_MAX_CONGELADAS = 0.6;

/** Quantas das colunas paradas (na ordem) cabem em `FRACAO_MAX_CONGELADAS` de `disponivel`; sem largura disponível medida, todas. */
export function quantasCongeladasCabem(larguras: number[], disponivel: number): number {
  if (disponivel <= 0) return larguras.length;
  const teto = disponivel * FRACAO_MAX_CONGELADAS;
  let soma = 0;
  let n = 0;
  for (const largura of larguras) {
    if (soma + largura > teto) break;
    soma += largura;
    n += 1;
  }
  return n;
}

/** O `left` de cada coluna parada: `inicio` (a coluna do ícone) mais a largura das paradas que vêm antes. */
export function deslocamentosCongeladas(nomes: string[], larguras: Record<string, number>, inicio: number): Record<string, number> {
  const lefts: Record<string, number> = {};
  let acumulado = inicio;
  for (const nome of nomes) {
    lefts[nome] = acumulado;
    acumulado += larguras[nome] ?? 0;
  }
  return lefts;
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

/** Igual ao padrão da tela (mesma ordem, só as ocultas por padrão ocultas, sem largura ajustada e sem resumo): não há o que guardar. */
export function ehPadrao(padrao: string[], layout: LayoutSalvo, ocultasPadrao: string[] = [], congeladaAtePadrao = ""): boolean {
  const esperadas = ocultasPadrao.filter((n) => padrao.includes(n));
  // Sem escolha (null/ausente) ou escolha igual ao padrão da tela: nada a guardar.
  const congeladaPadrao = padrao.includes(congeladaAtePadrao) ? congeladaAtePadrao : "";
  return (
    (layout.congeladaAte ?? congeladaPadrao) === congeladaPadrao &&
    layout.ocultas.length === esperadas.length &&
    esperadas.every((n) => layout.ocultas.includes(n)) &&
    Object.keys(layout.larguras ?? {}).length === 0 &&
    Object.keys(layout.resumos ?? {}).length === 0 &&
    layout.ordem.length === padrao.length &&
    layout.ordem.every((n, i) => n === padrao[i])
  );
}
