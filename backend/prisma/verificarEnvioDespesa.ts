// Teste controlado do canal de escrita `ManterItemDespesa` (ver src/soap/client.ts).
// Não é suíte automatizada — o projeto não tem framework de teste configurado.
//
// Uso:
//   node_modules/.bin/ts-node prisma/verificarEnvioDespesa.ts               # só formatos, NÃO chama o ERP
//   node_modules/.bin/ts-node prisma/verificarEnvioDespesa.ts <despesaId> --enviar
//
// O modo padrão é seguro: valida a conversão de data e imprime o XML que SERIA enviado, sem
// tocar no Senior. O `--enviar` é explícito de propósito — ele grava de verdade no ERP, e
// escrita não tem desfazer pelo serviço. IMPORTANTE: o write-back local (seqrdv/enviadoEmSenior)
// NÃO é feito por este script — quem faz isso é o fluxo do outbox (sync/outboxSeniorDespesa.ts).
// Rodar `--enviar` fora do fluxo automático deixa a despesa gravada no Senior mas ainda
// "pendente de envio" localmente até o outbox reconciliar (a busca por
// procurarDespesaNoSenior acha e reconcilia sozinha na próxima varredura).
import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { formatarDataSenior, manterItemDespesaViaSoap, montarEnvelopeManterItemDespesa, TIP_EVE_INCLUIR } from "../src/soap/client";
import { montarPayloadDespesa } from "../src/sync/outboxSeniorDespesa";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production — este script pode gravar no ERP.");
  process.exit(1);
}

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

function verificarFormatos() {
  console.log("\nConversão de data (-> dd/mm/yyyy, em UTC, mesma função de registrarAtividades)");
  assert(formatarDataSenior(new Date("2026-09-07T00:00:00.000Z")) === "07/09/2026", "07/09/2026");
  assert(formatarDataSenior(new Date("2026-01-05T00:00:00.000Z")) === "05/01/2026", "zero à esquerda no dia e no mês");
}

async function montarPayloadDeTeste(despesaId: number) {
  const despesa = await prisma.registroDespesaViagem.findUnique({ where: { id: despesaId } });
  if (!despesa) throw new Error(`Despesa ${despesaId} não encontrada`);
  if (!despesa.origemCaxHub) throw new Error(`Despesa ${despesaId} não nasceu no CaxHub (origemCaxHub=false) — não é pra enviar`);
  if (despesa.enviadoEmSenior != null) {
    throw new Error(`Despesa ${despesaId} já foi enviada ao Senior em ${despesa.enviadoEmSenior.toISOString()}`);
  }
  return montarPayloadDespesa(
    {
      id: despesa.id,
      codemp: despesa.codemp,
      numrat: despesa.numrat,
      seqrdv: despesa.seqrdv,
      datemi: despesa.datemi!,
      desrdv: despesa.desrdv!,
      tipdes: despesa.tipdes!,
      moddes: despesa.moddes,
      qtdrdv: despesa.qtdrdv!,
      vlrunt: Number(despesa.vlrunt),
      fatrdv: despesa.fatrdv!,
      rotid: despesa.rotid,
    },
    TIP_EVE_INCLUIR,
    { incluirSeqRdv: false }
  );
}

async function main() {
  console.log("Verificação do envio de despesa (RDV) para o Senior");
  verificarFormatos();

  const despesaId = Number(process.argv[2]);
  const enviar = process.argv.includes("--enviar");

  if (Number.isFinite(despesaId)) {
    const payload = await montarPayloadDeTeste(despesaId);
    console.log(`\nPayload da despesa ${despesaId}:`);
    console.log(JSON.stringify(payload, null, 2));
    console.log("\nXML que seria enviado (credenciais mascaradas):");
    console.log(montarEnvelopeManterItemDespesa(payload, "***", "***"));

    if (enviar) {
      console.log("\n--enviar informado: CHAMANDO O ERP DE VERDADE...");
      const resposta = await manterItemDespesaViaSoap(payload);
      console.log("\nResposta:");
      console.log(JSON.stringify(resposta, null, 2));
      console.log(`\nstatusProcesso=${resposta.statusProcesso} (1 = sucesso)`);
      for (const r of resposta.resultados) {
        console.log(`  despesa ${r.ideExt} -> seqRdv=${r.seqRdv} status=${r.status} msg=${r.msg ?? "-"}`);
      }
      console.log("\nATENÇÃO: se deu certo, o registro existe no Senior. O write-back local NÃO foi feito");
      console.log("por este script — quem faz isso é o fluxo do outbox (sync/outboxSeniorDespesa.ts).");
    } else {
      console.log("\nNada foi enviado. Repita com --enviar pra chamar o ERP de verdade.");
    }
  } else {
    console.log("\nNenhuma despesaId informada — só os formatos foram verificados.");
  }

  await prisma.$disconnect();
  console.log(falhas === 0 ? "\nTodas as verificações passaram." : `\n${falhas} verificação(ões) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  await prisma.$disconnect();
  process.exit(1);
});
