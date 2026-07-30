// Teste controlado do canal de escrita `registrarAtividades` (ver src/soap/client.ts).
// Não é suíte automatizada — o projeto não tem framework de teste configurado.
//
// Uso:
//   node_modules/.bin/ts-node prisma/verificarEnvioApontamento.ts            # só formatos, NÃO chama o ERP
//   node_modules/.bin/ts-node prisma/verificarEnvioApontamento.ts <ratItemId> --enviar
//
// O modo padrão é seguro: valida a conversão de data/hora e imprime o XML que SERIA
// enviado, sem tocar no Senior. O `--enviar` é explícito de propósito — ele grava de
// verdade no ERP, e escrita não tem desfazer pelo serviço.
import "dotenv/config";
import { prisma } from "../src/db/prisma";
import {
  formatarDataSenior,
  formatarHoraSenior,
  ideExtItem,
  ideExtRat,
  montarEnvelopeRegistrarAtividades,
  registrarAtividadesViaSoap,
  RegistrarAtividadesPayload,
  SIS_ORI,
  TIP_EVE,
} from "../src/soap/client";

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
  console.log("\nConversão de hora (minutos desde a meia-noite -> hh:mm)");
  assert(formatarHoraSenior(0) === "00:00", "0 vira 00:00");
  assert(formatarHoraSenior(480) === "08:00", "480 vira 08:00 (amostra real do Senior)");
  assert(formatarHoraSenior(720) === "12:00", "720 vira 12:00");
  assert(formatarHoraSenior(1439) === "23:59", "1439 vira 23:59");
  // O caso que pega quem trata o campo como HHMM: 480 viraria "4:80".
  assert(!formatarHoraSenior(480).includes("80"), "não interpreta o valor como HHMM");

  console.log("\nConversão de data (-> dd/mm/yyyy, em UTC)");
  assert(formatarDataSenior(new Date("2026-07-13T00:00:00.000Z")) === "13/07/2026", "13/07/2026");
  assert(formatarDataSenior(new Date("2026-01-05T00:00:00.000Z")) === "05/01/2026", "zero à esquerda no dia e no mês");
  // @db.Date é gravado como meia-noite UTC; formatar em horário local jogaria a data
  // um dia pra trás no Brasil (UTC-3).
  assert(formatarDataSenior(new Date("2026-03-01T00:00:00.000Z")) === "01/03/2026", "meia-noite UTC não volta um dia");
}

async function montarPayload(ratItemId: number): Promise<RegistrarAtividadesPayload> {
  const item = await prisma.ratItem.findUnique({ where: { id: ratItemId }, include: { rat: true } });
  if (!item) throw new Error(`RatItem ${ratItemId} não encontrado`);
  if (item.datati == null || item.horini == null || item.horfim == null) {
    throw new Error(`RatItem ${ratItemId} sem data/hora — nada a enviar`);
  }
  if (item.numrat != null) {
    throw new Error(`RatItem ${ratItemId} já tem numrat ${item.numrat} — já foi registrado no Senior`);
  }
  const rat = item.rat;
  if (rat.codpro == null) throw new Error(`RAT ${rat.id} sem codpro`);

  return {
    codEmp: rat.codemp,
    codFor: rat.codfor,
    codPro: rat.codpro,
    ideExt: ideExtRat(rat.id),
    sisOri: SIS_ORI,
    tipEve: TIP_EVE,
    itens: [
      {
        ideExt: ideExtItem(item.id),
        seqite: item.seqite ?? 0,
        datAti: formatarDataSenior(item.datati),
        horIni: formatarHoraSenior(item.horini),
        horFim: formatarHoraSenior(item.horfim),
        desAti: item.desati ?? "",
      },
    ],
  };
}

async function main() {
  console.log("Verificação do envio de apontamento para o Senior");
  verificarFormatos();

  const ratItemId = Number(process.argv[2]);
  const enviar = process.argv.includes("--enviar");

  if (Number.isFinite(ratItemId)) {
    const payload = await montarPayload(ratItemId);
    console.log(`\nPayload do RatItem ${ratItemId}:`);
    console.log(JSON.stringify(payload, null, 2));
    console.log("\nXML que seria enviado (credenciais mascaradas):");
    console.log(montarEnvelopeRegistrarAtividades(payload, "***", "***"));

    if (enviar) {
      console.log("\n--enviar informado: CHAMANDO O ERP DE VERDADE...");
      const resposta = await registrarAtividadesViaSoap(payload);
      console.log("\nResposta:");
      console.log(JSON.stringify(resposta, null, 2));
      console.log(`\nstatusProcesso=${resposta.statusProcesso} (1 = sucesso)`);
      for (const r of resposta.resultados) {
        console.log(`  RAT ${r.ideExt} -> numRat=${r.numRat}`);
        for (const i of r.itens) {
          console.log(`    item ${i.ideExt} -> seqRat=${i.seqRat} status=${i.status} msg=${i.msg ?? "-"}`);
        }
      }
      console.log("\nATENÇÃO: se deu certo, o registro existe no Senior. O write-back local NÃO foi feito");
      console.log("por este script — quem faz isso é o fluxo do outbox (sync/outboxSenior.ts).");
    } else {
      console.log("\nNada foi enviado. Repita com --enviar pra chamar o ERP de verdade.");
    }
  } else {
    console.log("\nNenhum ratItemId informado — só os formatos foram verificados.");
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
