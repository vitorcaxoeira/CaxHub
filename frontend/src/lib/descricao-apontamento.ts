// Espelho da regra de backend/src/domain/descricaoApontamento.ts, só pra AVISAR antes de enviar — quem garante é o servidor. Duas runtimes
// sem pacote compartilhado: é UMA regra só, mudar aqui exige mudar lá também.

export const MIN_DESCRICAO = 30;
export const MAX_DESCRICAO = 1000;

/** Texto como ele é contado: sem pontas e com espaços repetidos valendo um. */
export const textoDaDescricao = (texto: string | null | undefined) => (texto ?? "").trim().replace(/\s+/g, " ");

const chaveDeComparacao = (texto: string | null | undefined) =>
  (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export function repeteDescricaoDaAtividade(texto: string, referencias: (string | null | undefined)[]): boolean {
  const chave = chaveDeComparacao(texto);
  if (!chave) return false;
  return referencias.some((r) => !!r && (chave === chaveDeComparacao(r) || chave === chaveDeComparacao(r.trim().slice(0, MAX_DESCRICAO))));
}

/** Proposta INTERNA: a descrição que a atividade empresta. A primeira referência é a descrição da atividade (ver os chamadores). */
export function descricaoHerdada(referencias: (string | null | undefined)[]): string {
  return (referencias.find((r) => r?.trim()) ?? "").trim().slice(0, MAX_DESCRICAO);
}

/**
 * Com que o campo abre. Em proposta INTERNA, como era antes da descrição obrigatória: o texto salvo ou a descrição da atividade.
 * Em proposta de cliente, o texto que o consultor já salvou. Se ele só repete a descrição da atividade (preenchimento automático antigo),
 * abre vazio — a descrição da atividade nunca é carregada no campo.
 */
export function textoInicialDaDescricao(
  texto: string | null | undefined,
  referencias: (string | null | undefined)[],
  interna = false
): string {
  if (interna) return texto?.trim() ? texto : descricaoHerdada(referencias);
  return texto && !repeteDescricaoDaAtividade(texto, referencias) ? texto : "";
}

/** Por que a descrição não serve; `null` quando serve. `referencias` = nome da atividade no cronograma e descrição do item. */
export function erroDeDescricao(
  texto: string | null | undefined,
  referencias: (string | null | undefined)[] = [],
  interna = false
): string | null {
  // Interna: a regra obrigatória não vale. Em branco usa a descrição da atividade; só sobra o tamanho máximo.
  if (interna) {
    const efetiva = (texto ?? "").trim() || descricaoHerdada(referencias);
    if (!efetiva) return "Descreva o que foi realizado: a descrição é obrigatória.";
    return efetiva.length > MAX_DESCRICAO ? `A descrição pode ter no máximo ${MAX_DESCRICAO} caracteres.` : null;
  }
  const contado = textoDaDescricao(texto);
  if (!contado) return "Descreva o que foi realizado: a descrição é obrigatória.";
  if (repeteDescricaoDaAtividade(contado, referencias)) return "A descrição não pode repetir a descrição da atividade: conte o que você fez.";
  if (contado.length < MIN_DESCRICAO) return `A descrição precisa ter pelo menos ${MIN_DESCRICAO} caracteres (faltam ${MIN_DESCRICAO - contado.length}).`;
  if ((texto ?? "").trim().length > MAX_DESCRICAO) return `A descrição pode ter no máximo ${MAX_DESCRICAO} caracteres.`;
  return null;
}
