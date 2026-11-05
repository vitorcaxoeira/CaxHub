// Quem vê os VALORES (valor/hora, total do item e total da proposta) na tela de visualização de uma proposta (05/11/2026, pedido do Vitor):
// admin, perfil Comercial e gestor de área (gerencia algum departamento). Os demais veem a proposta sem nenhum valor. A decisão é do servidor:
// quem não pode ver nem recebe o número na resposta (esconder só na tela deixaria o valor na aba Rede do navegador).
export function podeVerValoresDaProposta(role: string, departamentosGerenciados: readonly number[]): boolean {
  return role === "admin" || role === "comercial" || departamentosGerenciados.length > 0;
}
