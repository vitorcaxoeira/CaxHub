import { runAtividadeConsultorSync } from "./atividadeConsultorSync";
import { runRatSync } from "./ratSync";
import { runRatItemSync } from "./ratItemSync";

// Sync sob demanda do domínio "projetos" pro Modo Painel/TV — mesmo molde de
// contabilSyncOrchestrator.ts (2 jobs), aqui com 3. Ordem = a mesma dependência que os
// crons noturnos já codificam (registry.ts): atividadeConsultor (0 4 * * *) -> rat
// (15 4 * * *) -> ratItem (30 4 * * *), esta última porque RatItem.ratId depende de Rat
// já existir. Sempre roda o modo COMPLETO (sem `desde`) — mesmo espírito do cron
// automático, que "sempre roda completo (sem 'desde') — o modo incremental só é usado
// quando disparado manualmente pela tela de administração" (ver movimentoTituloReceberSync.ts).
//
// propostas-sync / propostas_itens-sync ficam de fora DE PROPÓSITO: mudam pouco, o cron
// noturno já cobre, e entrariam no caminho crítico de toda rotação da TV.
const JOBS: [string, () => Promise<void>][] = [
  ["atividadeConsultor", () => runAtividadeConsultorSync()],
  ["rat", () => runRatSync()],
  ["ratItem", () => runRatItemSync()],
];

export const JOBS_PROJETOS = ["atividades_consultor-sync", "rat-sync", "rat-item-sync"];

// Lock em memória — processo único (sem cluster), suficiente pra nunca rodar duas
// sincronizações de projetos ao mesmo tempo (várias TVs podem tentar disparar juntas).
let emAndamento = false;

export function sincronizacaoProjetosEmAndamento(): boolean {
  return emAndamento;
}

export async function runSincronizacaoProjetos(): Promise<void> {
  emAndamento = true;
  try {
    for (const [nome, run] of JOBS) {
      console.log(`[sincronizacao-projetos] iniciando ${nome}...`);
      await run();
    }
  } finally {
    emAndamento = false;
  }
}
