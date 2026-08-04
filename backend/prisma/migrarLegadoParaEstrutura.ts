// Reconciliação de alocações órfãs — as que não têm `estruturaAtividadeId` e por isso não
// aparecem no cronograma (que agrupa por nó da EAP, ver routes/alocacao.ts).
//
// A REGRA NÃO MORA MAIS AQUI. Desde 04/08/2026 ela é `reconciliarAlocacoesOrfas` em
// src/domain/reconciliarEstrutura.ts, chamada automaticamente no fim do
// atividadeConsultorSync — o Senior não sabe preencher aquele campo, então toda alocação
// importada nascia invisível, e um script manual só resolvia até a próxima importação.
//
// Este arquivo sobrou como a porta de linha de comando da MESMA função: serve pra rodar a
// reconciliação sob demanda (backfill, ou depois de mexer no recorte) e pra ver o relatório
// antes de gravar. Duas cópias da regra divergiriam no primeiro ajuste.
//
// Idempotente: só toca alocação sem nó.
//
// Uso:
//   node_modules/.bin/ts-node prisma/migrarLegadoParaEstrutura.ts              (relatório)
//   node_modules/.bin/ts-node prisma/migrarLegadoParaEstrutura.ts --aplicar    (grava)
import { prisma } from "../src/db/prisma";
import { reconciliarAlocacoesOrfas, resumirReconciliacao } from "../src/domain/reconciliarEstrutura";
import { SITPRO_ALOCAVEL } from "../src/domain/propostasDominio";

const aplicar = process.argv.includes("--aplicar");

// Recalcula o mesmo recorte da função, sem gravar nada — é o que dá pra conferir o alcance
// antes de aplicar.
async function relatorio() {
  const orfas = await prisma.atividadeConsultor.findMany({
    where: { sitreg: "A", estruturaAtividadeId: null },
    select: { id: true, codemp: true, codpro: true, seqite: true, codfor: true, qtdhor: true },
  });
  const chaves = [...new Set(orfas.map((a) => `${a.codemp}-${a.codpro}`))];
  const propostas = await prisma.proposta.findMany({
    where: {
      OR: chaves.map((c) => {
        const [codemp, codpro] = c.split("-").map(Number);
        return { codemp, codpro };
      }),
    },
    select: { codemp: true, codpro: true, sitpro: true },
  });
  const alocaveis = new Set(
    propostas.filter((p) => p.sitpro != null && SITPRO_ALOCAVEL.includes(p.sitpro)).map((p) => `${p.codemp}-${p.codpro}`)
  );
  const modoItem = new Set(
    (await prisma.propostaModoAlocacao.findMany({ where: { modo: "item" }, select: { codemp: true, codpro: true } })).map(
      (m) => `${m.codemp}-${m.codpro}`
    )
  );

  const elegiveis = orfas.filter((a) => alocaveis.has(`${a.codemp}-${a.codpro}`) && !modoItem.has(`${a.codemp}-${a.codpro}`));
  const itens = await prisma.propostaItem.findMany({ select: { codemp: true, codpro: true, seqite: true } });
  const temItem = new Set(itens.map((i) => `${i.codemp}-${i.codpro}-${i.seqite}`));
  const semItem = elegiveis.filter((a) => !temItem.has(`${a.codemp}-${a.codpro}-${a.seqite}`));
  const horas = elegiveis.reduce((s, a) => s + (a.qtdhor ?? 0), 0);
  const propostasAfetadas = [...new Set(elegiveis.map((a) => `${a.codemp}-${a.codpro}`))];

  console.log(`\n=== Reconciliação de alocações órfãs ${aplicar ? "(APLICANDO)" : "(RELATÓRIO — nada será gravado)"} ===\n`);
  console.log(`Alocações ativas sem nó, no total da base: ${orfas.length}`);
  console.log(`  fora do recorte alocável (sitpro não ${SITPRO_ALOCAVEL.join("/")}) ou modo "item": ${orfas.length - elegiveis.length}`);
  console.log(`  >> ELEGÍVEIS: ${elegiveis.length} alocações (${Math.round(horas / 60)}h) em ${propostasAfetadas.length} propostas`);
  console.log(`     das quais aguardando o PropostaItem chegar (ficam pra próxima passagem): ${semItem.length}`);
  console.log(`\npropostas: ${propostasAfetadas.join(", ")}`);
  const semQtd = elegiveis.filter((a) => a.qtdhor == null || a.qtdhor <= 0);
  if (semQtd.length > 0) {
    console.log(`\n${semQtd.length} com qtdhor inválido — o nó é criado assim mesmo (duracaoHoras nula), pra não`);
    console.log(`ficarem invisíveis: ${semQtd.map((a) => `${a.codemp}-${a.codpro}/${a.seqite}#${a.id}`).join(", ")}`);
  }
}

async function main() {
  await relatorio();

  if (!aplicar) {
    console.log("\nRodar com --aplicar para gravar.\n");
    return;
  }

  const r = await reconciliarAlocacoesOrfas();
  console.log(`\nConcluído: ${resumirReconciliacao(r)}.`);
  if (r.pendentes.length > 0) {
    console.log(`Aguardando item: ${r.pendentes.map((p) => `${p.codemp}-${p.codpro}/${p.seqite}#${p.id}`).join(", ")}`);
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
