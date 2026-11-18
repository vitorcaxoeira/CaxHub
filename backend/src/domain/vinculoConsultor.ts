// Sugestão de vínculo do consultor com o atendente do Kyria e com o funcionário do HCM (custo-hora real, bloco C da Rentabilidade, 18/11/2026).
// Só SUGERE: quem decide é a pessoa que administra, na tela — o vínculo errado leva horas e custo pra pessoa errada. Funções PURAS, com teste.
// Regra comum: só sugere quando há UM candidato; dois candidatos igualmente bons = ambíguo = nenhuma sugestão (melhor perguntar que chutar).

export type Confianca = "alta" | "media";

export interface Sugestao<T> {
  item: T;
  confianca: Confianca;
  motivo: string;
}

export interface ConsultorParaSugestao {
  nomfor?: string | null;
  nomcom?: string | null;
  email?: string | null;
}

/** Sem acento, minúsculo, só letras/números separados por UM espaço — "José  da Silva-Júnior" e "jose da silva junior" ficam iguais. */
export function normalizarNome(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Os nomes que o consultor tem no Senior (fornecedor e nome completo), já normalizados e sem repetir. */
function nomesDoConsultor(c: ConsultorParaSugestao): string[] {
  return [...new Set([normalizarNome(c.nomfor), normalizarNome(c.nomcom)].filter((n) => n !== ""))];
}

/**
 * Atendente do Kyria: pelo e-mail (igual, sem diferenciar maiúscula) — o e-mail é o que o Kyria e o Senior mais têm em comum — e, na falta, pelo
 * nome IGUAL. Só candidato `attendant` deve entrar na lista de `candidatos` (a regra do vínculo é de quem chama).
 */
export function sugerirAtendenteKyria<T extends { name: string; email: string }>(c: ConsultorParaSugestao, candidatos: T[]): Sugestao<T> | null {
  const email = (c.email ?? "").trim().toLowerCase();
  if (email) {
    const porEmail = candidatos.filter((m) => m.email.trim().toLowerCase() === email);
    if (porEmail.length === 1) return { item: porEmail[0], confianca: "alta", motivo: "mesmo e-mail" };
    if (porEmail.length > 1) return null;
  }
  const nomes = nomesDoConsultor(c);
  if (nomes.length === 0) return null;
  const porNome = candidatos.filter((m) => nomes.includes(normalizarNome(m.name)));
  return porNome.length === 1 ? { item: porNome[0], confianca: "media", motivo: "mesmo nome" } : null;
}

/**
 * Funcionário do HCM, pelo nome: igual ao do fornecedor/nome completo = alta; senão, um nome com 2+ palavras do consultor inteiro contido nas
 * palavras do funcionário ("Luis Henrique" ⊂ "Luis Henrique Souza") = média. Nome de uma palavra só ("Amarildo") nunca sugere por contenção.
 */
export function sugerirColaboradorHcm<T extends { nomfun: string | null }>(c: ConsultorParaSugestao, candidatos: T[]): Sugestao<T> | null {
  const nomes = nomesDoConsultor(c);
  if (nomes.length === 0) return null;

  const iguais = candidatos.filter((f) => nomes.includes(normalizarNome(f.nomfun)));
  if (iguais.length === 1) return { item: iguais[0], confianca: "alta", motivo: "mesmo nome" };
  if (iguais.length > 1) return null;

  const contidos = candidatos.filter((f) => {
    const palavrasDoFuncionario = new Set(normalizarNome(f.nomfun).split(" ").filter(Boolean));
    return nomes.some((n) => {
      const palavras = n.split(" ");
      return palavras.length >= 2 && palavras.every((p) => palavrasDoFuncionario.has(p));
    });
  });
  return contidos.length === 1 ? { item: contidos[0], confianca: "media", motivo: "nome contido no do funcionário" } : null;
}
