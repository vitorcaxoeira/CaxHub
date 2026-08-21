// Verificação da Fase 5 (última) do plano "Filtros na importação do ERP Senior" (recorte
// retroativo) — não é suíte automatizada, o projeto não tem framework de teste configurado.
// Roda contra o banco de DEV apontado por DATABASE_URL, no mesmo molde de
// verificarVarreduraRemocoes.ts: dado sintético sob CODEMP 900001/900002 — nunca toca linha
// real —, criado e apagado pelo próprio script.
//
// Uso: node_modules/.bin/ts-node prisma/verificarFase5Recorte.ts
import { prisma } from "../src/db/prisma";
import { diagnosticarRecorte, marcarOrfaosDoRecorte, suportaMarcarRemovido } from "../src/sync/recorteRetroativo";
import type { SyncJobDescriptor } from "../src/sync/registry";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production — este script cria/apaga dados de teste.");
  process.exit(1);
}

// Só os campos que recorteRetroativo.ts realmente lê (`tabelaLocal`) — não precisa do
// SyncJobDescriptor completo (evita importar SYNC_JOBS/registry.ts só pra isto).
const JOB_PEDIDO = { tabelaLocal: "pedidos", displayName: "Pedidos (teste)" } as SyncJobDescriptor;
const JOB_EMPRESA = { tabelaLocal: "empresa", displayName: "Empresa (teste)" } as SyncJobDescriptor;

const CODEMP_DENTRO = 900001;
const CODEMP_FORA = 900002;
const CODFIL = 1;

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

async function limparDadosDeTeste() {
  await prisma.pedido.deleteMany({ where: { codemp: { in: [CODEMP_DENTRO, CODEMP_FORA] } } });
  await prisma.empresa.deleteMany({ where: { codemp: { in: [CODEMP_DENTRO, CODEMP_FORA] } } });
}

async function main() {
  await limparDadosDeTeste();
  // Confere que a limpeza realmente zerou antes de criar qualquer dado novo — se sobrou algo
  // sob os sentinelas (de uma rodada anterior interrompida, por exemplo), aborta em vez de
  // seguir com contagem errada.
  const sobrou = await prisma.pedido.count({ where: { codemp: { in: [CODEMP_DENTRO, CODEMP_FORA] } } });
  if (sobrou > 0) {
    console.error(`Sobrou ${sobrou} pedido(s) sob os sentinelas 900001/900002 mesmo depois de limpar — abortando.`);
    process.exit(1);
  }
  try {
    console.log("\n=== 1. suportaMarcarRemovido — só os models com a coluna ===");
    assert(suportaMarcarRemovido(JOB_PEDIDO), "Pedido tem removidoEmSenior — suportaMarcarRemovido=true");
    assert(!suportaMarcarRemovido(JOB_EMPRESA), "Empresa NÃO tem removidoEmSenior — suportaMarcarRemovido=false");

    console.log("\n=== 2. diagnosticarRecorte — sem escopo, nada pra diagnosticar ===");
    const semEscopo = await diagnosticarRecorte(JOB_PEDIDO, null);
    assert(semEscopo.linhasQueSaem === null, "escopoLocal=null -> linhasQueSaem=null (não escopável)");
    const escopoVazio = await diagnosticarRecorte(JOB_PEDIDO, {});
    assert(escopoVazio.linhasQueSaem === null, "escopoLocal={} -> linhasQueSaem=null (filtro vazio, sem retroatividade)");

    // ATENÇÃO — a tabela `pedidos` local tem MILHARES de linhas reais (espelho de produção/
    // homologação). `diagnosticarRecorte`/`marcarOrfaosDoRecorte` operam com `NOT escopoLocal`
    // sobre a tabela INTEIRA de propósito (é o comportamento correto em produção: "quantas
    // linhas HOJE locais ficariam fora do recorte novo") — então um escopo tipo
    // `{codemp: CODEMP_DENTRO}` (só mantém o sentinela) faria TODAS as linhas reais aparecerem
    // como "órfãs", e `marcarOrfaosDoRecorte` marcaria a tabela real inteira como removida.
    // Isso aconteceu de verdade rodando este script pela primeira vez (12224 pedidos reais
    // marcados por engano, revertido manualmente na hora — ver nota no segundo cérebro,
    // [[teste-de-escrita-em-massa-precisa-escopo-invertido]]). Correção: o escopo do TESTE
    // usa `{codemp: {not: CODEMP_FORA}}` — "mantém tudo, MENOS o sentinela de fora" — cujo
    // `NOT` vira exatamente `codemp = CODEMP_FORA`, só as linhas sintéticas, não importa
    // quantas linhas reais existam na tabela.
    console.log("\n=== 3. Dados sintéticos: 3 pedidos dentro do recorte (900001), 2 fora (900002) ===");
    const base = {
      codfil: CODFIL,
      datemi: new Date("2026-01-15"),
      codcli: 1,
      codcpg: "001",
      sitped: 1,
      vistoEmSync: new Date(),
    };
    for (let i = 1; i <= 3; i++) {
      await prisma.pedido.create({ data: { ...base, codemp: CODEMP_DENTRO, numped: i } });
    }
    for (let i = 1; i <= 2; i++) {
      await prisma.pedido.create({ data: { ...base, codemp: CODEMP_FORA, numped: i } });
    }

    // Escopo invertido — ver nota acima. Orfãos = `NOT {codemp: {not: 900002}}` = `codemp =
    // 900002`, por dupla negação — só as 2 linhas sintéticas "de fora", nunca a tabela real.
    const escopoSeguro = { codemp: { not: CODEMP_FORA } };
    const diagnostico = await diagnosticarRecorte(JOB_PEDIDO, escopoSeguro);
    assert(diagnostico.linhasQueSaem === 2, `2 pedidos (codemp ${CODEMP_FORA}) sairiam do recorte (achei ${diagnostico.linhasQueSaem})`);
    assert(diagnostico.suportaMarcar === true, "Pedido suporta marcar");

    // Cinto e suspensório: NUNCA chama a função de escrita sem antes confirmar que o
    // diagnóstico bateu com o esperado — é exatamente a guarda que faltou da primeira vez.
    if (diagnostico.linhasQueSaem !== 2) {
      throw new Error(`Diagnóstico inesperado (${diagnostico.linhasQueSaem}) — abortando ANTES de qualquer escrita, por segurança.`);
    }

    console.log("\n=== 4. marcarOrfaosDoRecorte — marca só quem sai, preserva quem fica ===");
    const marcados = await marcarOrfaosDoRecorte(JOB_PEDIDO, escopoSeguro);
    assert(marcados === 2, `2 linha(s) marcadas nesta chamada (achei ${marcados})`);

    const dentroDepois = await prisma.pedido.findMany({ where: { codemp: CODEMP_DENTRO } });
    assert(dentroDepois.every((p) => p.removidoEmSenior === null), `as 3 linhas dentro do recorte (codemp=${CODEMP_DENTRO}) continuam com removidoEmSenior=null`);
    const foraDepois = await prisma.pedido.findMany({ where: { codemp: CODEMP_FORA } });
    assert(foraDepois.every((p) => p.removidoEmSenior !== null), `as 2 linhas fora do recorte (codemp=${CODEMP_FORA}) foram marcadas`);

    console.log("\n=== 5. Rodar marcarOrfaosDoRecorte de novo não remarca (idempotente) ===");
    const marcadosDeNovo = await marcarOrfaosDoRecorte(JOB_PEDIDO, escopoSeguro);
    assert(marcadosDeNovo === 0, `segunda chamada não marca nada de novo (achei ${marcadosDeNovo})`);

    console.log("\n=== 6. diagnosticarRecorte depois de marcar — ainda conta as 2 (elas continuam locais) ===");
    const diagnosticoDepois = await diagnosticarRecorte(JOB_PEDIDO, escopoSeguro);
    assert(diagnosticoDepois.linhasQueSaem === 2, `ainda conta as 2 linhas (marcar não apaga, só carimba) — achei ${diagnosticoDepois.linhasQueSaem}`);
  } finally {
    await limparDadosDeTeste();
  }

  console.log(`\n${falhas === 0 ? "TUDO OK" : `${falhas} FALHA(S)`}\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Script falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
