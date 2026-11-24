// Verificação da reserva atômica da fila de envio ao Senior (sync/outboxSenior.ts). NÃO chama o ERP.
// Não é suíte automatizada — o projeto não tem framework de teste de banco configurado.
//
// Uso:
//   node_modules/.bin/ts-node prisma/verificarReservaFila.ts
//
// Cria uma pendência descartável (tipo inexistente, nunca processada por ninguém), dispara
// várias reservas ao mesmo tempo com a MESMA condição de processarFilaSincronizacao
// (`where: { id, status: "pendente" }`) e exige que exatamente uma vença. Apaga a pendência no fim.
import "dotenv/config";
import { prisma } from "../src/db/prisma";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production.");
  process.exit(1);
}

async function main() {
  const atividade = await prisma.atividadeConsultor.findFirst({ select: { id: true } });
  if (!atividade) {
    console.error("Nenhuma atividade no banco local para ancorar a pendência de teste.");
    process.exit(1);
  }

  const pendencia = await prisma.sincronizacaoPendente.create({
    data: { atividadeId: atividade.id, tipo: "verificacao_reserva_fila", payload: {}, status: "pendente" },
  });

  let falhas = 0;
  try {
    const tentativas = await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.sincronizacaoPendente.updateMany({
          where: { id: pendencia.id, status: "pendente" },
          data: { status: "enviando" },
        })
      )
    );
    const vencedoras = tentativas.filter((t) => t.count === 1).length;
    if (vencedoras === 1) console.log("  OK: de 8 reservas simultâneas, exatamente 1 venceu");
    else {
      console.error(`  FALHOU: ${vencedoras} reservas venceram (esperado 1)`);
      falhas++;
    }

    const depois = await prisma.sincronizacaoPendente.findUnique({ where: { id: pendencia.id } });
    if (depois?.status === "enviando") console.log('  OK: a pendência ficou "enviando"');
    else {
      console.error(`  FALHOU: status final ${depois?.status}`);
      falhas++;
    }

    const repetida = await prisma.sincronizacaoPendente.updateMany({
      where: { id: pendencia.id, status: "pendente" },
      data: { status: "enviando" },
    });
    if (repetida.count === 0) console.log("  OK: nova reserva depois de reservada não pega nada");
    else {
      console.error("  FALHOU: reserva repetida pegou a pendência");
      falhas++;
    }
  } finally {
    await prisma.sincronizacaoPendente.delete({ where: { id: pendencia.id } });
    await prisma.$disconnect();
  }

  if (falhas > 0) {
    console.error(`\n${falhas} verificação(ões) falharam.`);
    process.exit(1);
  }
  console.log("\nTudo certo.");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
