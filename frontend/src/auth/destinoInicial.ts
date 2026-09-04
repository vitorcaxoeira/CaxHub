// ---------------------------------------------------------------------------
// Roteamento por papel no login — mecanismo GENÉRICO (qualquer projeto com um
// papel "conta de quiosque" precisa disto: 3 pontos de entrada, não 1, senão
// a conta cai num beco sem saída silencioso — ver App.tsx e Login.tsx).
// ---------------------------------------------------------------------------

// Papel exclusivo das contas de TV do modo Painel — não enxerga o resto do app.
export const ROLE_PAINEL = "painel";

// Pra onde uma sessão recém-autenticada deve ir, dado só o papel do usuário (a resposta
// do login já traz `role`, então isto decide sem requisição extra). Usado nos 3 pontos de
// entrada possíveis: login (Login.tsx), a rota raiz "/" e o catch-all de rota desconhecida
// (App.tsx) — um usuário do papel painel que tentar qualquer URL fora de /painel volta
// pra cá, nunca pra Home (que não tem nada pra mostrar a ele).
export function destinoInicial(role: string | undefined): string {
  return role === ROLE_PAINEL ? "/painel" : "/";
}
