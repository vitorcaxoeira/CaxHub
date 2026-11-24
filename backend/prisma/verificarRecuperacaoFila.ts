// Verificação da retomada de envios interrompidos por reinício (sync/outboxSenior.ts e
// sync/outboxSeniorDespesa.ts). NÃO chama o ERP. Não é suíte automatizada.
//
// Uso:
//   node_modules/.bin/ts-node prisma/verificarRecuperacaoFila.ts
//
// Cria pendências descartáveis já em "enviando" (como ficam quando o processo morre no meio do
// envio), chama a recuperação restrita aos ids criados e confere o destino de cada tipo. Apaga tudo
// no fim. Recusa rodar em produção.
import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { recuperarEnviosInterrompidos } from "../src/sync/outboxSenior";
import { recuperarEnviosDespesaInterrompidos } from "../src/sync/outboxSeniorDespesa";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production.");
  process.exit(1);
}

let falhas = 0;
function assert(condicao: boolean, mensagem: string) {
  if (condicao) console.log(`  OK: ${mensagem}`);
  else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

async function main() {
  const comSeqati = await prisma.atividadeConsultor.findFirst({ where: { seqati: { gt: 0 } }, select: { id: true } });
  const semSeqati = await prisma.atividadeConsultor.findFirst({ where: { seqati: null }, select: { id: true } });
  if (!comSeqati) {
    console.error("Nenhuma atividade com seqati no banco local para ancorar o teste.");
    process.exit(1);
  }

  const criadas: number[] = [];
  const nova = async (atividadeId: number, tipo: string) => {
    const p = await prisma.sincronizacaoPendente.create({ data: { atividadeId, tipo, payload: {}, status: "enviando" } });
    criadas.push(p.id);
    return p.id;
  };

  try {
    const apontamento = await nova(comSeqati.id, "criar_apontamento");
    const fechar = await nova(comSeqati.id, "fechar_rat");
    const remover = await nova(comSeqati.id, "remover_atividade");
    const criarComSeqati = await nova(comSeqati.id, "criar_atividade");
    const criarSemSeqati = semSeqati ? await nova(semSeqati.id, "criar_atividade") : null;
    const jaEnviada = await prisma.sincronizacaoPendente.create({
      data: { atividadeId: comSeqati.id, tipo: "criar_apontamento", payload: {}, status: "enviado" },
    });
    criadas.push(jaEnviada.id);

    const r = await recuperarEnviosInterrompidos({ apenasIds: criadas });
    const status = async (id: number) => (await prisma.sincronizacaoPendente.findUnique({ where: { id } }))?.status;

    assert((await status(apontamento)) === "pendente", "apontamento interrompido volta pra fila");
    assert((await status(fechar)) === "pendente", "fechar_rat interrompido volta pra fila");
    assert((await status(remover)) === "pendente", "remover_atividade interrompido volta pra fila");
    assert((await status(criarComSeqati)) === "pendente", "criar_atividade com seqati volta pra fila");
    if (criarSemSeqati != null) {
      assert((await status(criarSemSeqati)) === "bloqueado", "criar_atividade SEM seqati fica bloqueado");
    } else {
      console.log("  (sem atividade sem seqati no banco local: caso 'bloqueado' não exercitado)");
    }
    assert((await status(jaEnviada.id)) === "enviado", 'pendência "enviado" não é tocada');
    assert(r.voltaramParaFila === 4 && r.bloqueadas === (criarSemSeqati != null ? 1 : 0), `contagem devolvida confere (${JSON.stringify(r)})`);

    const erro = (await prisma.sincronizacaoPendente.findUnique({ where: { id: apontamento } }))?.ultimoErro;
    assert(!!erro && erro.includes("reinício"), "ultimoErro explica o motivo");

    // Fila de despesa
    const despesa = await prisma.registroDespesaViagem.findFirst({ select: { id: true } });
    if (despesa) {
      const d = await prisma.sincronizacaoPendenteDespesa.create({ data: { despesaId: despesa.id, tipo: "enviar_despesa", payload: {}, status: "enviando" } });
      try {
        const n = await recuperarEnviosDespesaInterrompidos({ apenasIds: [d.id] });
        const depois = await prisma.sincronizacaoPendenteDespesa.findUnique({ where: { id: d.id } });
        assert(n === 1 && depois?.status === "pendente", "despesa interrompida volta pra fila");
      } finally {
        await prisma.sincronizacaoPendenteDespesa.delete({ where: { id: d.id } });
      }
    } else {
      console.log("  (sem despesa no banco local: fila de despesa não exercitada)");
    }
  } finally {
    await prisma.sincronizacaoPendente.deleteMany({ where: { id: { in: criadas } } });
    await prisma.syncLog.deleteMany({ where: { query: "recuperação de envios interrompidos", runAt: { gte: new Date(Date.now() - 60_000) } } }).catch(() => undefined);
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
