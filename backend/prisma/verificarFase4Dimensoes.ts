// Verificação da Fase 4 do plano "Filtros na importação do ERP Senior" (dimensões e
// propagação) — não é suíte automatizada, o projeto não tem framework de teste configurado.
// Puro, sem SOAP nem banco: `colunaDimensaoDoJob`/`jobsComDimensao` só leem `job.colunas`
// (já resolvido em memória por registry.ts).
//
// Uso: node_modules/.bin/ts-node prisma/verificarFase4Dimensoes.ts
import { SYNC_JOBS } from "../src/sync/registry";
import { DIMENSOES, colunaDimensaoDoJob, jobsComDimensao, jobsSemDimensao, dimensaoPorChave } from "../src/sync/dimensoesFiltro";

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

const CODEMP = dimensaoPorChave("codemp");
assert(CODEMP !== null, 'dimensão "codemp" está declarada');
if (!CODEMP) process.exit(1);

console.log("\n=== 1. Cobertura — todo job com alias 'codemp' é reconhecido pela dimensão ===");
// Teste de cobertura do plano (seção E), na versão DERIVADA: em vez de comparar contra um
// mapa mantido à mão (que pode ficar velho), comparamos contra o que os 35 jobs REALMENTE
// têm agora — se algum dia um job ganhar uma coluna "codemp" nova, este teste só passa
// automaticamente (nada pra atualizar), mas se `colunaDimensaoDoJob` tiver uma regressão
// (ex.: comparação case-sensitive quebrada), aparece aqui.
const comAliasCodemp = SYNC_JOBS.filter((job) => job.colunas.some((c) => c.alias.toLowerCase() === "codemp"));
const alcancados = jobsComDimensao(SYNC_JOBS, CODEMP);
assert(alcancados.length === comAliasCodemp.length, `jobsComDimensao achou ${alcancados.length} jobs (esperado ${comAliasCodemp.length}, contagem direta)`);
for (const job of comAliasCodemp) {
  assert(
    alcancados.some((a) => a.job.jobName === job.jobName),
    `${job.jobName}: tem alias "codemp" e foi reconhecido pela dimensão`
  );
}

console.log("\n=== 2. Contagem real (empírica, 21/08/2026) — 27 jobs com codemp, 8 sem ===");
assert(alcancados.length === 27, `27 jobs alcançados pela dimensão codemp (achei ${alcancados.length})`);
const semDimensao = jobsSemDimensao(SYNC_JOBS, CODEMP);
assert(semDimensao.length === 8, `8 jobs sem a dimensão codemp (achei ${semDimensao.length})`);

const ESPERADOS_SEM_CODEMP = [
  "cliente-sync",
  "tipos_titulo-sync",
  "representantes-sync",
  "moedas-sync",
  "fases_proposta-sync",
  "rotas_viagem-sync",
  "percursos_viagem-sync",
  "rotas_percursos-sync",
];
for (const jobName of ESPERADOS_SEM_CODEMP) {
  assert(
    semDimensao.some((j) => j.jobName === jobName),
    `${jobName}: reconhecido como "cadastro compartilhado, sempre completo" (sem codemp)`
  );
}

console.log("\n=== 3. As 4 grafias de origem conhecidas (documentadas no módulo) ===");
const grafiasPorOrigem = new Map<string, number>();
for (const { coluna } of alcancados) {
  grafiasPorOrigem.set(coluna.origem, (grafiasPorOrigem.get(coluna.origem) ?? 0) + 1);
}
for (const [origem, n] of grafiasPorOrigem) {
  console.log(`    ${origem}: ${n} job(s)`);
}
assert(grafiasPorOrigem.size === 4, `exatamente 4 grafias de origem distintas (achei ${grafiasPorOrigem.size})`);
assert(grafiasPorOrigem.get("codemp") === 15, `"codemp" (lowercase) em 15 jobs (achei ${grafiasPorOrigem.get("codemp")})`);
assert(grafiasPorOrigem.get("CodEmp") === 4, `"CodEmp" em 4 jobs (achei ${grafiasPorOrigem.get("CodEmp")})`);
assert(grafiasPorOrigem.get("USU_CodEmp") === 5, `"USU_CodEmp" em 5 jobs (achei ${grafiasPorOrigem.get("USU_CodEmp")})`);
assert(grafiasPorOrigem.get("USU_CODEMP") === 3, `"USU_CODEMP" em 3 jobs (achei ${grafiasPorOrigem.get("USU_CODEMP")})`);

console.log("\n=== 4. Jobs alcançados mas NÃO filtráveis (sem dicionário) ===");
const naoFiltraveis = alcancados.filter((a) => !a.filtravel);
assert(naoFiltraveis.length === 2, `2 jobs com codemp mas sem dicionário (achei ${naoFiltraveis.length})`);
assert(naoFiltraveis.some((a) => a.job.jobName === "consultores-sync"), "consultores-sync: tem codemp, não filtrável (view sem dicionário)");
assert(
  naoFiltraveis.some((a) => a.job.jobName === "contratos-consultores-sync"),
  "contratos-consultores-sync: tem codemp, não filtrável (view sem dicionário)"
);

console.log("\n=== 5. Todo job com filtravel=true tem suportaFiltro=true no registry ===");
// Se um job é alcançado pela dimensão E tem dicionário, mas `run()` ainda não lê
// `filtroDoJob()` (suportaFiltro=false), a propagação "funcionaria" na validação e depois o
// valor salvo seria ignorado pra sempre — pior que dar erro. Confirma que isso não acontece.
for (const { job, filtravel } of alcancados) {
  if (filtravel) assert(job.suportaFiltro, `${job.jobName}: filtravel e suportaFiltro=true (run() de fato consome o filtro)`);
}

console.log(`\n${falhas === 0 ? "TUDO OK" : `${falhas} FALHA(S)`}\n`);
process.exit(falhas === 0 ? 0 : 1);
