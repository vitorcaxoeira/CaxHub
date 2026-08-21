// Verificação da Fase 2 do plano "Filtros na importação do ERP Senior" (catálogo de campos,
// só leitura) — não é suíte automatizada, o projeto não tem framework de teste configurado.
// Chama o SOAP de verdade (dicionário do Senior) pra parte 2 — precisa de rede/credenciais
// válidas no .env, igual qualquer sync real.
//
// Uso: node_modules/.bin/ts-node prisma/verificarFase2Campos.ts
import { SYNC_JOBS } from "../src/sync/registry";
import { camposEspelhados, camposErp } from "../src/sync/catalogoCampos";

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

async function main() {
  console.log("\n=== 1. camposEspelhados — instantâneo, sem SOAP, para todos os 35 jobs ===");
  for (const job of SYNC_JOBS) {
    const campos = camposEspelhados(job);
    assert(campos.length === job.colunas.length, `${job.jobName}: ${campos.length} campos (esperado ${job.colunas.length})`);
    const semTipo = campos.filter((c) => c.tipoPrisma === null);
    if (semTipo.length > 0) {
      console.log(`    aviso: ${job.jobName} tem ${semTipo.length} coluna(s) sem match no schema local: ${semTipo.map((c) => c.alias).join(", ")}`);
    }
  }
  // Caso conhecido: Rat.dataApr é o único campo do projeto sem @map — dataapr (alias em
  // minúsculas da query) não bate com o nome real da coluna (dataApr, mixed-case). Confirma
  // que o catálogo trata isso como observação, não como exceção lançada.
  const rat = SYNC_JOBS.find((j) => j.jobName === "rat-sync")!;
  const camposRat = camposEspelhados(rat);
  const dataApr = camposRat.find((c) => c.alias === "dataapr");
  assert(!!dataApr, "rat-sync: coluna dataapr presente no catálogo");
  assert(dataApr?.tipoPrisma === null && !!dataApr?.observacao, "rat-sync: dataapr sem match local, com observação explicando por quê");

  console.log("\n=== 2. camposErp — round-trip SOAP real (cacheado), 3 tabelas representativas ===");
  const amostra = [
    "empresa-sync", // E-padrão, dattyp simples
    "atividades_consultor-sync", // USU_T customizada
    "consultores-sync", // view USU_V sem dicionário — deve devolver temDicionario:false
  ];
  for (const jobName of amostra) {
    const job = SYNC_JOBS.find((j) => j.jobName === jobName)!;
    const inicio = Date.now();
    const resultado = await camposErp(job);
    const ms = Date.now() - inicio;
    if (jobName === "consultores-sync") {
      assert(resultado.temDicionario === false && resultado.campos.length === 0, `${jobName}: temDicionario=false, sem campos (${ms}ms)`);
      continue;
    }
    assert(resultado.temDicionario === true, `${jobName}: temDicionario=true`);
    assert(resultado.campos.length > 0, `${jobName}: ${resultado.campos.length} campos do dicionário real (${ms}ms)`);
    const espelhados = resultado.campos.filter((c) => c.espelhado);
    assert(espelhados.length === job.colunas.length, `${jobName}: ${espelhados.length} campos marcados espelhado=true (esperado ${job.colunas.length})`);
    const comDominio = resultado.campos.filter((c) => c.dominio);
    console.log(`    ${jobName}: ${comDominio.length} campo(s) com domínio — ${comDominio.map((c) => `${c.origem}(${c.dominio}${c.valoresDominio ? `:${c.valoresDominio.length}v` : ""})`).join(", ") || "nenhum"}`);

    // Cache: segunda chamada pro mesmo job deve ser bem mais rápida (sem round-trip novo).
    const inicio2 = Date.now();
    await camposErp(job);
    const ms2 = Date.now() - inicio2;
    assert(ms2 < ms || ms2 < 50, `${jobName}: segunda chamada usou cache (${ms2}ms vs ${ms}ms da primeira)`);
  }

  console.log(`\n${falhas === 0 ? "TUDO OK" : `${falhas} FALHA(S)`}\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Script falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
