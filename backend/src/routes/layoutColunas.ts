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
  /** Título próprio por coluna (12/11/2026): só o texto exibido; o nome técnico não muda. Vazio = títulos originais da tela. */
  titulos: Record<string, string>;
  /**
   * Última coluna parada ("congelar até aqui", 09/11/2026): ela e as visíveis antes dela, na ordem, ficam paradas ao rolar na horizontal.
   * null = sem escolha (vale o padrão da tela); "" = nenhuma parada, de propósito; "nome" = o limite.
   */
  congeladaAte: string | null;
}

const TABELA_VALIDA = /^[a-z0-9._-]{1,80}$/;
const MAX_COLUNAS = 100;
const MAX_NOME = 60;
/** Tamanho máximo do título que a pessoa dá a uma coluna. */
export const MAX_TITULO = 60;
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

/** `titulos`: { nome da coluna: texto de 1 a MAX_TITULO caracteres, sem as pontas em branco }. */
function titulosValidos(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const pares = Object.entries(v);
  return pares.length <= MAX_COLUNAS && pares.every(([nome, t]) => nomeValido(nome) && typeof t === "string" && t.length > 0 && t.length <= MAX_TITULO && t === t.trim());
}

/** `congeladaAte`: ausente/null = padrão da tela; texto (até MAX_NOME, pode ser vazio = nenhuma) = a escolha. Qualquer outra coisa é inválida. */
function congeladaAteValida(v: unknown): v is string | null | undefined {
  return v == null || (typeof v === "string" && v.length <= MAX_NOME);
}

/**
 * Corpo do PUT: `{ ordem: string[], ocultas: string[], larguras?: { coluna: px } }`, sem repetição e sem exagero de tamanho. `larguras`
 * ausente vale `{}` (tela anterior às larguras). null = inválido (400).
 */
export function validarLayoutColunas(corpo: unknown): LayoutColunas | null {
  if (!corpo || typeof corpo !== "object") return null;
  const { ordem, ocultas, larguras = {}, resumos = {}, titulos = {}, congeladaAte } = corpo as Record<string, unknown>;
  if (!listaValida(ordem) || !listaValida(ocultas) || !largurasValidas(larguras) || !resumosValidos(resumos) || !titulosValidos(titulos) || !congeladaAteValida(congeladaAte)) return null;
  return { ordem, ocultas, larguras, resumos, titulos, congeladaAte: congeladaAte ?? null };
}

const NOME_CAMPO_EXTRA = /^[a-z0-9]+__[A-Za-z0-9_]+$/;
/** Teto de campos extras por lista (o mesmo de consultas/camposRelacionados.ts, que ainda confere cada nome contra o catálogo). */
const MAX_CAMPOS_EXTRAS = 40;

/** Campos extras do PUT (12/11/2026): lista de nomes "fonte__campo", sem repetição. null = inválido (400). */
export function validarCamposExtras(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_CAMPOS_EXTRAS) return null;
  if (!v.every((n) => typeof n === "string" && n.length <= MAX_NOME && NOME_CAMPO_EXTRA.test(n))) return null;
  return new Set(v).size === v.length ? (v as string[]) : null;
}
