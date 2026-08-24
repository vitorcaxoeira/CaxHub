// "14,7s" abaixo de 1 min, "8m 40s" a partir daí — mesmo formato usado nas mensagens de
// SyncLog dos jobs já instrumentados (ex.: "308.244 linhas em 58s (fetch 44s, escrita
// 12s...)"). Compartilhado entre a tela de administração (Importados do Senior) e os
// widgets de "última atualização" (Contas a Receber, Contábil) — duas cópias divergiriam
// no primeiro ajuste de formato.
export function formatarDuracao(ms: number): string {
  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1).replace(".", ",")}s`;
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  return `${minutos}m ${resto}s`;
}
