// Normaliza texto pra busca: sem acento, sem diferença de maiúscula. "curitibanos" tem que
// achar "Curitibanos"; "edson" tem que achar "Édson".
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
