import { runLancamentoContabilSync } from "./lancamentoContabilSync";
import { runRateioLancamentoSync } from "./rateioLancamentoSync";

// RateioLancamento é o detalhe de LancamentoContabil — mesma ordem que registry.ts já usa
// ("RateioLancamento roda depois de Lançamentos Contábeis"). Mesmo padrão de
// contasReceberSyncOrchestrator.ts, só que com 2 jobs em vez de 9.
const JOBS: [string, () => Promise<void>][] = [
  ["lancamentoContabil", runLancamentoContabilSync],
  ["rateioLancamento", runRateioLancamentoSync],
];

// Lock em memória — processo único (sem cluster), suficiente pra evitar duas
// sincronizações simultâneas disparadas pelo botão "Atualizar" de Resultado Analítico.
let emAndamento = false;

export function sincronizacaoContabilEmAndamento(): boolean {
  return emAndamento;
}

export async function runSincronizacaoContabil(): Promise<void> {
  emAndamento = true;
  try {
    for (const [nome, run] of JOBS) {
      console.log(`[sincronizacao-contabil] iniciando ${nome}...`);
      await run();
    }
  } finally {
    emAndamento = false;
  }
}
