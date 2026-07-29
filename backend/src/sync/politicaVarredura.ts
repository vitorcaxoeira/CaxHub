// Em que modo cada job de sincronização roda a varredura de registros removidos no
// Senior (ver varrerRemovidos.ts). É AQUI que o rollout acontece, tabela por tabela:
//
//   desligada -> simular -> marcar
//
// "simular" conta e reporta no painel de administração sem escrever nada; só depois de
// alguns dias com número estável e chaves conferidas no Senior é que a tabela sobe pra
// "marcar". Nenhuma tabela deve pular direto pra "marcar".
export type ModoVarredura = "desligada" | "simular" | "marcar";

// Só os jobs listados aqui varrem. O default é "desligada" de propósito: um job novo
// (ou um dos 25 que ainda não foram adaptados) nunca começa a marcar registro sozinho.
const MODOS: Record<string, ModoVarredura> = {
  // Piloto do mecanismo, promovido pra "marcar" em 29/07/2026 depois de a simulação
  // detectar corretamente 1 exclusão real (pedido 1/1/12045) numa base de 12.126, com as
  // duas guardas passando limpas.
  "pedidos-sync": "marcar",
  // Sync sob demanda de clientes (ações "Sinc. ERP" em Mercado > Listar Pedidos).
  "pedidos-sync-cliente": "marcar",
};

export function modoVarredura(jobName: string): ModoVarredura {
  // Válvula de emergência: desliga a varredura de todos os jobs sem precisar de deploy,
  // só mexendo no .env e reiniciando o container.
  if (process.env.SYNC_VARREDURA === "off") return "desligada";
  return MODOS[jobName] ?? "desligada";
}
