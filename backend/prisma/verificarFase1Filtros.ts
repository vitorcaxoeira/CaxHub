// Verificação da Fase 1 do plano "Filtros na importação do ERP Senior" (fundação, sem
// mudança de comportamento) — não é suíte automatizada, o projeto não tem framework de
// teste configurado. Script puro, sem tocar no banco.
//
// Uso: node_modules/.bin/ts-node prisma/verificarFase1Filtros.ts
//
// Critérios de aceite da Fase 1 (ver plano):
//   1. A query montada por cada um dos 35 jobs com lista de predicados vazia é byte a byte
//      idêntica à query original do job (montarQuerySenior é no-op sem predicados).
//   2. extrairTabela/extrairColunas não lançam exceção pra nenhuma das 35 queries reais —
//      inclui o caso com WHERE embutido (atividadeConsultorSync) e todas as variações
//      USU_*/E0nn*.
//   3. SYNC_JOBS (sync/registry.ts) tem os 35 jobs com tabelaSenior/colunas/temDicionario
//      preenchidos, e temDicionario é false só nos 2 jobs sem registro no dicionário do
//      Senior (views USU_VBI00Cons/USU_VBI01CTRCS).
import { Prisma } from "@prisma/client";
import { montarQuerySenior, extrairTabela, extrairColunas } from "../src/sync/consultaSenior";
import { SYNC_JOBS } from "../src/sync/registry";

import { JOB_NAME as ATIVIDADE_CONSULTOR_JOB, BASE_QUERY as ATIVIDADE_CONSULTOR_QUERY } from "../src/sync/atividadeConsultorSync";
import { JOB_NAME as CENTRO_CUSTO_JOB, BASE_QUERY as CENTRO_CUSTO_QUERY } from "../src/sync/centroCustoSync";
import { JOB_NAME as CLIENTE_JOB, BASE_QUERY as CLIENTE_QUERY } from "../src/sync/clienteSync";
import { JOB_NAME as CONSULTOR_JOB, QUERY as CONSULTOR_QUERY } from "../src/sync/consultorSync";
import { JOB_NAME as CONTRATO_CONSULTOR_JOB, QUERY as CONTRATO_CONSULTOR_QUERY } from "../src/sync/contratoConsultorSync";
import { JOB_NAME as CONDICAO_PAGAMENTO_JOB, QUERY as CONDICAO_PAGAMENTO_QUERY } from "../src/sync/condicaoPagamentoSync";
import { JOB_NAME as CONTA_CORRENTE_JOB, BASE_QUERY as CONTA_CORRENTE_QUERY } from "../src/sync/contaCorrenteSync";
import { JOB_NAME as DEPARTAMENTO_GESTOR_JOB, BASE_QUERY as DEPARTAMENTO_GESTOR_QUERY } from "../src/sync/departamentoGestorSync";
import { JOB_NAME as DEPARTAMENTO_TIME_JOB, BASE_QUERY as DEPARTAMENTO_TIME_QUERY } from "../src/sync/departamentoTimeSync";
import { JOB_NAME as EMPRESA_JOB, QUERY as EMPRESA_QUERY } from "../src/sync/empresaSync";
import { JOB_NAME as FASE_PROPOSTA_JOB, QUERY as FASE_PROPOSTA_QUERY } from "../src/sync/fasePropostaSync";
import { JOB_NAME as FILIAL_JOB, QUERY as FILIAL_QUERY } from "../src/sync/filialSync";
import { JOB_NAME as FORMA_PAGAMENTO_JOB, QUERY as FORMA_PAGAMENTO_QUERY } from "../src/sync/formaPagamentoSync";
import { JOB_NAME as LANCAMENTO_CONTABIL_JOB, QUERY as LANCAMENTO_CONTABIL_QUERY } from "../src/sync/lancamentoContabilSync";
import { JOB_NAME as MOEDA_JOB, QUERY as MOEDA_QUERY } from "../src/sync/moedaSync";
import { JOB_NAME as MOVIMENTO_CONTA_JOB, BASE_QUERY as MOVIMENTO_CONTA_QUERY } from "../src/sync/movimentoContaSync";
import { JOB_NAME as MOVIMENTO_TITULO_JOB, BASE_QUERY as MOVIMENTO_TITULO_QUERY } from "../src/sync/movimentoTituloReceberSync";
import { JOB_NAME as NATUREZA_FINANCEIRA_JOB, QUERY as NATUREZA_FINANCEIRA_QUERY } from "../src/sync/naturezaFinanceiraSync";
import { JOB_NAME as ORCAMENTO_CONTABIL_JOB, QUERY as ORCAMENTO_CONTABIL_QUERY } from "../src/sync/orcamentoContabilSync";
import { JOB_NAME as PEDIDO_JOB, BASE_QUERY as PEDIDO_QUERY } from "../src/sync/pedidoSync";
import { JOB_NAME as REGISTRO_DESPESA_VIAGEM_JOB, BASE_QUERY as REGISTRO_DESPESA_VIAGEM_QUERY } from "../src/sync/registroDespesaViagemSync";
import { JOB_NAME as ROTA_VIAGEM_JOB, QUERY as ROTA_VIAGEM_QUERY } from "../src/sync/rotaViagemSync";
import { JOB_NAME as PERCURSO_VIAGEM_JOB, QUERY as PERCURSO_VIAGEM_QUERY } from "../src/sync/percursoViagemSync";
import { JOB_NAME as ROTA_PERCURSO_JOB, QUERY as ROTA_PERCURSO_QUERY } from "../src/sync/rotaPercursoSync";
import { JOB_NAME as PLANO_CONTABIL_JOB, BASE_QUERY as PLANO_CONTABIL_QUERY } from "../src/sync/planoContabilSync";
import { JOB_NAME as PORTADOR_JOB, QUERY as PORTADOR_QUERY } from "../src/sync/portadorSync";
import { JOB_NAME as PROPOSTA_ITEM_JOB, QUERY as PROPOSTA_ITEM_QUERY } from "../src/sync/propostaItemSync";
import { JOB_NAME as PROPOSTA_JOB, QUERY as PROPOSTA_QUERY } from "../src/sync/propostaSync";
import { JOB_NAME as RAT_JOB, BASE_QUERY as RAT_QUERY } from "../src/sync/ratSync";
import { JOB_NAME as RAT_ITEM_JOB, BASE_QUERY as RAT_ITEM_QUERY } from "../src/sync/ratItemSync";
import { JOB_NAME as RATEIO_LANCAMENTO_JOB, QUERY as RATEIO_LANCAMENTO_QUERY } from "../src/sync/rateioLancamentoSync";
import { JOB_NAME as REPRESENTANTE_JOB, BASE_QUERY as REPRESENTANTE_QUERY } from "../src/sync/representanteSync";
import { JOB_NAME as TIPO_TITULO_JOB, QUERY as TIPO_TITULO_QUERY } from "../src/sync/tipoTituloSync";
import { JOB_NAME as TITULO_RECEBER_JOB, BASE_QUERY as TITULO_RECEBER_QUERY } from "../src/sync/tituloReceberSync";
import { JOB_NAME as TRANSACAO_JOB, BASE_QUERY as TRANSACAO_QUERY } from "../src/sync/transacaoSync";

const QUERIES: [string, string][] = [
  [ATIVIDADE_CONSULTOR_JOB, ATIVIDADE_CONSULTOR_QUERY],
  [CENTRO_CUSTO_JOB, CENTRO_CUSTO_QUERY],
  [CLIENTE_JOB, CLIENTE_QUERY],
  [CONSULTOR_JOB, CONSULTOR_QUERY],
  [CONTRATO_CONSULTOR_JOB, CONTRATO_CONSULTOR_QUERY],
  [CONDICAO_PAGAMENTO_JOB, CONDICAO_PAGAMENTO_QUERY],
  [CONTA_CORRENTE_JOB, CONTA_CORRENTE_QUERY],
  [DEPARTAMENTO_GESTOR_JOB, DEPARTAMENTO_GESTOR_QUERY],
  [DEPARTAMENTO_TIME_JOB, DEPARTAMENTO_TIME_QUERY],
  [EMPRESA_JOB, EMPRESA_QUERY],
  [FASE_PROPOSTA_JOB, FASE_PROPOSTA_QUERY],
  [FILIAL_JOB, FILIAL_QUERY],
  [FORMA_PAGAMENTO_JOB, FORMA_PAGAMENTO_QUERY],
  [LANCAMENTO_CONTABIL_JOB, LANCAMENTO_CONTABIL_QUERY],
  [MOEDA_JOB, MOEDA_QUERY],
  [MOVIMENTO_CONTA_JOB, MOVIMENTO_CONTA_QUERY],
  [MOVIMENTO_TITULO_JOB, MOVIMENTO_TITULO_QUERY],
  [NATUREZA_FINANCEIRA_JOB, NATUREZA_FINANCEIRA_QUERY],
  [ORCAMENTO_CONTABIL_JOB, ORCAMENTO_CONTABIL_QUERY],
  [PEDIDO_JOB, PEDIDO_QUERY],
  [REGISTRO_DESPESA_VIAGEM_JOB, REGISTRO_DESPESA_VIAGEM_QUERY],
  [ROTA_VIAGEM_JOB, ROTA_VIAGEM_QUERY],
  [PERCURSO_VIAGEM_JOB, PERCURSO_VIAGEM_QUERY],
  [ROTA_PERCURSO_JOB, ROTA_PERCURSO_QUERY],
  [PLANO_CONTABIL_JOB, PLANO_CONTABIL_QUERY],
  [PORTADOR_JOB, PORTADOR_QUERY],
  [PROPOSTA_ITEM_JOB, PROPOSTA_ITEM_QUERY],
  [PROPOSTA_JOB, PROPOSTA_QUERY],
  [RAT_JOB, RAT_QUERY],
  [RAT_ITEM_JOB, RAT_ITEM_QUERY],
  [RATEIO_LANCAMENTO_JOB, RATEIO_LANCAMENTO_QUERY],
  [REPRESENTANTE_JOB, REPRESENTANTE_QUERY],
  [TIPO_TITULO_JOB, TIPO_TITULO_QUERY],
  [TITULO_RECEBER_JOB, TITULO_RECEBER_QUERY],
  [TRANSACAO_JOB, TRANSACAO_QUERY],
];

const JOBS_SEM_DICIONARIO = new Set([CONSULTOR_JOB, CONTRATO_CONSULTOR_JOB]);

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

console.log(`\n=== 1. montarQuerySenior([]) é byte a byte idêntico à query original (${QUERIES.length} jobs) ===`);
assert(QUERIES.length === 35, `35 constantes de query mapeadas (achei ${QUERIES.length})`);
for (const [jobName, query] of QUERIES) {
  const montada = montarQuerySenior(query, []);
  assert(montada === query, `${jobName}: idêntica (${query.length} chars)`);
}

console.log(`\n=== 2. extrairTabela/extrairColunas não lançam exceção em nenhuma das ${QUERIES.length} queries ===`);
for (const [jobName, query] of QUERIES) {
  try {
    const tabela = extrairTabela(query);
    const colunas = extrairColunas(query);
    assert(tabela.length > 0 && colunas.length > 0, `${jobName}: tabela="${tabela}", ${colunas.length} colunas`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(false, `${jobName}: lançou exceção — ${message}`);
  }
}

console.log(`\n=== 3. SYNC_JOBS (registry.ts) — 35 jobs com catálogo preenchido ===`);
assert(SYNC_JOBS.length === 35, `SYNC_JOBS tem 35 entradas (achei ${SYNC_JOBS.length})`);
for (const job of SYNC_JOBS) {
  const esperaSemDicionario = JOBS_SEM_DICIONARIO.has(job.jobName);
  assert(job.tabelaSenior.length > 0, `${job.jobName}: tabelaSenior preenchida ("${job.tabelaSenior}")`);
  assert(job.colunas.length > 0, `${job.jobName}: colunas preenchidas (${job.colunas.length})`);
  // Fase 2: tabelaLocal precisa bater com um @@map real do schema.prisma, senão o catálogo
  // de campos (catalogoCampos.ts) nunca acha o tipo local pra nenhuma coluna deste job.
  assert(job.tabelaLocal.length > 0, `${job.jobName}: tabelaLocal preenchida ("${job.tabelaLocal}")`);
  const modeloLocal = Prisma.dmmf.datamodel.models.some((m) => m.dbName === job.tabelaLocal);
  assert(modeloLocal, `${job.jobName}: tabelaLocal ("${job.tabelaLocal}") bate com um @@map real do schema.prisma`);
  assert(
    job.temDicionario === !esperaSemDicionario,
    `${job.jobName}: temDicionario=${job.temDicionario} (esperado ${!esperaSemDicionario})`
  );
}
// Nenhum jobName do catálogo de dicionário fica órfão (job renomeado/removido sem atualizar o Set).
const jobNamesRegistry = new Set(SYNC_JOBS.map((j) => j.jobName));
for (const jobName of JOBS_SEM_DICIONARIO) {
  assert(jobNamesRegistry.has(jobName), `JOBS_SEM_DICIONARIO: "${jobName}" existe em SYNC_JOBS`);
}

console.log(`\n${falhas === 0 ? "TUDO OK" : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
