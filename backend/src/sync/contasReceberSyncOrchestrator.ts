import { runEmpresaSync } from "./empresaSync";
import { runFilialSync } from "./filialSync";
import { runPortadorSync } from "./portadorSync";
import { runClienteSync } from "./clienteSync";
import { runTipoTituloSync } from "./tipoTituloSync";
import { runTransacaoSync } from "./transacaoSync";
import { runTituloReceberSync } from "./tituloReceberSync";
import { runMovimentoTituloReceberSync } from "./movimentoTituloReceberSync";
import { runContaCorrenteSync } from "./contaCorrenteSync";

// Ordem respeita as FKs entre as tabelas (mesma logica de backend/scripts/run-all-syncs.ts).
const JOBS: [string, () => Promise<void>][] = [
  ["empresa", runEmpresaSync],
  ["filial", runFilialSync],
  ["portador", runPortadorSync],
  ["contaCorrente", runContaCorrenteSync],
  ["cliente", runClienteSync],
  ["tipoTitulo", runTipoTituloSync],
  ["transacao", runTransacaoSync],
  ["tituloReceber", runTituloReceberSync],
  ["movimentoTituloReceber", runMovimentoTituloReceberSync],
];

// Lock em memoria — processo unico (sem cluster), suficiente pra evitar duas
// sincronizacoes simultaneas disparadas pelo botao "Atualizar".
let emAndamento = false;

export function sincronizacaoContasReceberEmAndamento(): boolean {
  return emAndamento;
}

export async function runSincronizacaoContasReceber(): Promise<void> {
  emAndamento = true;
  try {
    for (const [nome, run] of JOBS) {
      console.log(`[sincronizacao-contas-receber] iniciando ${nome}...`);
      await run();
    }
  } finally {
    emAndamento = false;
  }
}
