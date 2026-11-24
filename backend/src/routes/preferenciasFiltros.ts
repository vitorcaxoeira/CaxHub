// Padrão de cada filtro de uma tela, por usuário (03/11/2026, Acompanhamento de Compra). Validação pura do que a tela manda; quem grava é
// routes/perfil.ts (`preferencias_filtros`). O servidor não conhece os filtros de cada tela: confere só nome e formato; a tela valida o
// valor contra as opções na hora de aplicar (item que sumiu não é forçado).

const CAMPO_VALIDO = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const MAX_ITENS = 500;
const MAX_TEXTO = 200;

export type ObjetoFiltro = Record<string, string | number | boolean | null>;
export type ValorFiltro = string | number | boolean | null | (string | number)[] | ObjetoFiltro[];

/** Nome estável do filtro (ex.: "empFil", "anos"). */
export function campoFiltroValido(campo: unknown): campo is string {
  return typeof campo === "string" && CAMPO_VALIDO.test(campo);
}

const itemValido = (v: unknown): v is string | number =>
  (typeof v === "string" && v.length <= MAX_TEXTO) || (typeof v === "number" && Number.isFinite(v));

const MAX_CHAVES_OBJETO = 8;

// Objeto plano de primitivos (ex.: um cliente {cod, nome} escolhido numa busca do servidor).
const objetoValido = (v: unknown): v is ObjetoFiltro =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length <= MAX_CHAVES_OBJETO &&
  Object.entries(v).every(
    ([k, x]) => CAMPO_VALIDO.test(k) && (x === null || typeof x === "boolean" || itemValido(x)),
  );

/**
 * Valor de filtro aceito: texto (até 200), número, booleano, `null` ("Todas" num select de valor único), lista (até 500) de
 * textos/números ou lista de objetos planos (clientes/fornecedores escolhidos). Lista vazia é válida ("Todos" salvo de propósito,
 * diferente de não ter padrão). Devolve `undefined` quando não serve (a rota responde 400).
 */
export function validarValorFiltro(valor: unknown): ValorFiltro | undefined {
  if (valor === null || typeof valor === "boolean") return valor;
  if (itemValido(valor)) return valor;
  if (!Array.isArray(valor) || valor.length > MAX_ITENS) return undefined;
  if (valor.every(itemValido)) return valor;
  if (valor.every(objetoValido)) return valor;
  return undefined;
}
