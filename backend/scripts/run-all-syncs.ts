import "dotenv/config";
import { runEmpresaSync } from "../src/sync/empresaSync";
import { runFilialSync } from "../src/sync/filialSync";
import { runClienteSync } from "../src/sync/clienteSync";
import { runTipoTituloSync } from "../src/sync/tipoTituloSync";
import { runTituloReceberSync } from "../src/sync/tituloReceberSync";
import { runMovimentoTituloReceberSync } from "../src/sync/movimentoTituloReceberSync";
import { runRepresentanteSync } from "../src/sync/representanteSync";
import { runCentroCustoSync } from "../src/sync/centroCustoSync";
import { runMovimentoContaSync } from "../src/sync/movimentoContaSync";
import { runNaturezaFinanceiraSync } from "../src/sync/naturezaFinanceiraSync";
import { runPortadorSync } from "../src/sync/portadorSync";
import { runMoedaSync } from "../src/sync/moedaSync";
import { runTransacaoSync } from "../src/sync/transacaoSync";
import { prisma } from "../src/db/prisma";

async function main() {
  const jobs: [string, () => Promise<void>][] = [
    ["empresa", runEmpresaSync],
    ["filial", runFilialSync],
    ["cliente", runClienteSync],
    ["tipoTitulo", runTipoTituloSync],
    ["transacao", runTransacaoSync],
    ["tituloReceber", runTituloReceberSync],
    ["movimentoTituloReceber", runMovimentoTituloReceberSync],
    ["representante", runRepresentanteSync],
    ["centroCusto", runCentroCustoSync],
    ["movimentoConta", runMovimentoContaSync],
    ["naturezaFinanceira", runNaturezaFinanceiraSync],
    ["portador", runPortadorSync],
    ["moeda", runMoedaSync],
  ];

  for (const [name, fn] of jobs) {
    const t0 = Date.now();
    console.log(`>> iniciando ${name}...`);
    await fn();
    console.log(`<< ${name} concluido em ${Date.now() - t0}ms`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
