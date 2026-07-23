// Script de verificação manual dos critérios de aceite da Fase 1 do módulo de
// Auditoria (não é uma suíte automatizada — o projeto não tem framework de teste
// configurado hoje). Roda contra o banco de DEV apontado por DATABASE_URL.
//
// Uso: npx ts-node prisma/verificarAceiteAuditoria.ts
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { processarLinhasProposta, PropostaRow } from "../src/sync/propostaSync";
import { EVENTOS_AUDITORIA } from "../src/audit/taxonomia";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production — este script cria/apaga dados de teste.");
  process.exit(1);
}

const CODEMP = 900001;
const CODPRO_A = 900001; // cenário A: 3 campos monitorados, sem sitpro
const CODPRO_B = 900002; // cenário B: sitpro + outro campo monitorado
const CODPRO_C = 900003; // cenário C: rollback (FK inválida força erro no upsert)
const CODCLI = 900001;
const CODCLI_INEXISTENTE = 999999999;

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

function linhaBase(codpro: number): PropostaRow {
  return {
    codemp: CODEMP,
    codpro,
    codcli: CODCLI,
    qtdhor: 100,
    sitpro: 1,
    pripro: 2,
    forfat: 0,
    obssit: "estado inicial",
    hispro: "histórico não monitorado",
    numprj: 1,
    codfpj: 1,
    idcom: 1,
    codrep: 1,
    numped: 1,
  };
}

async function limparDadosDeTeste() {
  await prisma.auditEvento.deleteMany({ where: { codemp: CODEMP } });
  await prisma.proposta.deleteMany({ where: { codemp: CODEMP } });
  await prisma.cliente.deleteMany({ where: { codcli: { in: [CODCLI] } } });
}

async function prepararCliente() {
  await prisma.cliente.upsert({
    where: { codcli: CODCLI },
    update: {},
    create: {
      codcli: CODCLI,
      nomcli: "Cliente Teste Auditoria",
      apecli: "Teste Auditoria",
      sencli: "",
      tipcli: "J",
      tipmer: "1",
      tipemc: 1,
      codram: "",
      insest: "",
      cgccpf: BigInt(0),
      endcli: "",
      cplend: "",
      cepcli: 0,
      baicli: "",
      cidcli: "",
      sigufs: "SP",
      codpai: "BR",
    },
  });
}

async function cenarioA_diffApenasWhitelist() {
  console.log("\nCenário A — diff só de campos monitorados (3 campos, sem sitpro)");
  await processarLinhasProposta([linhaBase(CODPRO_A)]); // cria a proposta (PROPOSTA_CRIADA)
  await prisma.auditEvento.deleteMany({ where: { codemp: CODEMP, codpro: CODPRO_A } });

  const alterada = linhaBase(CODPRO_A);
  alterada.qtdhor = 200; // monitorado
  alterada.pripro = 1; // monitorado
  alterada.forfat = 3; // monitorado
  alterada.hispro = "histórico mudou também, mas não é monitorado";
  await processarLinhasProposta([alterada]);

  const eventos = await prisma.auditEvento.findMany({ where: { codemp: CODEMP, codpro: CODPRO_A } });
  assert(eventos.length === 1, `gerou exatamente 1 evento (gerou ${eventos.length})`);
  const evento = eventos[0];
  assert(evento?.eventoTipo === EVENTOS_AUDITORIA.PROPOSTA_ALTERADA, "evento é PROPOSTA_ALTERADA");
  const alteracoes = (evento?.alteracoes ?? {}) as Record<string, unknown>;
  assert(Object.keys(alteracoes).length === 3, `diff tem 3 campos (tem ${Object.keys(alteracoes).length})`);
  assert(!("hispro" in alteracoes), "campo fora da whitelist (hispro) não aparece no diff");
}

async function cenarioB_splitDeStatus() {
  console.log("\nCenário B — sitpro muda junto de outro campo: 2 eventos, mesmo correlationId");
  await processarLinhasProposta([linhaBase(CODPRO_B)]);
  await prisma.auditEvento.deleteMany({ where: { codemp: CODEMP, codpro: CODPRO_B } });

  const alterada = linhaBase(CODPRO_B);
  alterada.sitpro = 4; // monitorado, gera PROPOSTA_STATUS_ALTERADO
  alterada.qtdhor = 300; // monitorado, gera PROPOSTA_ALTERADA
  await processarLinhasProposta([alterada]);

  const eventos = await prisma.auditEvento.findMany({ where: { codemp: CODEMP, codpro: CODPRO_B } });
  assert(eventos.length === 2, `gerou exatamente 2 eventos (gerou ${eventos.length})`);
  const tipos = eventos.map((e) => e.eventoTipo).sort();
  assert(
    JSON.stringify(tipos) === JSON.stringify([EVENTOS_AUDITORIA.PROPOSTA_ALTERADA, EVENTOS_AUDITORIA.PROPOSTA_STATUS_ALTERADO].sort()),
    "um evento é PROPOSTA_STATUS_ALTERADO e outro é PROPOSTA_ALTERADA"
  );
  const correlationIds = new Set(eventos.map((e) => e.correlationId));
  assert(correlationIds.size === 1, "os 2 eventos compartilham o mesmo correlationId");
}

async function cenarioC_rollbackNaoDeixaOrfao() {
  console.log("\nCenário C — rollback da transação não deixa evento órfão");
  const antes = await prisma.auditEvento.count();

  const linhaComFkInvalida = linhaBase(CODPRO_C);
  linhaComFkInvalida.codcli = CODCLI_INEXISTENTE; // upsert vai falhar por violação de FK

  let lancouErro = false;
  try {
    await processarLinhasProposta([linhaComFkInvalida]);
  } catch {
    lancouErro = true;
  }

  const depois = await prisma.auditEvento.count();
  assert(lancouErro, "processarLinhasProposta propagou o erro da transação");
  assert(depois === antes, `contagem de eventos não mudou (antes=${antes}, depois=${depois})`);
  const propostaCriada = await prisma.proposta.findUnique({
    where: { codemp_codpro: { codemp: CODEMP, codpro: CODPRO_C } },
  });
  assert(propostaCriada === null, "proposta também não foi criada (upsert fez parte do rollback)");
}

async function cenarioD_paginacaoPorCursor() {
  console.log("\nCenário D — paginação por cursor em massa (≥1000 eventos, com timestamps duplicados)");
  const TOTAL = 1200;
  const agora = new Date();
  const ENTIDADE_ID_PREFIXO = "verificacao-paginacao:";
  const lote = Array.from({ length: TOTAL }).map((_, i) => ({
    // timestamps deliberadamente repetidos a cada 5 linhas, pra forçar desempate por id
    ocorridoEm: new Date(agora.getTime() - Math.floor(i / 5) * 1000),
    origem: "integracao_senior",
    entidadeTipo: "proposta",
    // codemp/codpro ficam nulos de propósito: não há Proposta real por trás desses
    // eventos sintéticos, e a FK composta de AuditEvento exigiria uma linha existente.
    entidadeId: `${ENTIDADE_ID_PREFIXO}${i}`,
    eventoTipo: EVENTOS_AUDITORIA.PROPOSTA_ALTERADA,
    correlationId: randomUUID(),
  }));
  await prisma.auditEvento.createMany({ data: lote });

  const whereTeste: Prisma.AuditEventoWhereInput = { entidadeId: { startsWith: ENTIDADE_ID_PREFIXO } };
  const totalNoBanco = await prisma.auditEvento.count({ where: whereTeste });

  const idsVistos = new Set<string>();
  let cursor: bigint | null = null;
  let ultimaChave: [Date, bigint] | null = null;
  let ordemViolada = false;
  const LIMIT = 100;

  for (let pagina = 0; pagina < 50; pagina++) {
    const args: Prisma.AuditEventoFindManyArgs = {
      where: whereTeste,
      orderBy: [{ ocorridoEm: "desc" }, { id: "desc" }],
      take: LIMIT,
    };
    if (cursor !== null) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }
    const rows = await prisma.auditEvento.findMany(args);
    if (rows.length === 0) break;
    for (const row of rows) {
      const idStr = row.id.toString();
      if (idsVistos.has(idStr)) ordemViolada = true; // reaproveitando a flag: id repetido
      idsVistos.add(idStr);
      const chave: [Date, bigint] = [row.ocorridoEm, row.id];
      if (ultimaChave) {
        const [dataAnterior, idAnterior] = ultimaChave;
        const decrescente =
          chave[0].getTime() < dataAnterior.getTime() ||
          (chave[0].getTime() === dataAnterior.getTime() && chave[1] < idAnterior);
        if (!decrescente) ordemViolada = true;
      }
      ultimaChave = chave;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < LIMIT) break;
  }

  assert(idsVistos.size === totalNoBanco, `percorreu todos os ${totalNoBanco} eventos sem duplicar id (visitou ${idsVistos.size})`);
  assert(!ordemViolada, "ordem estritamente decrescente por (ocorridoEm, id) mantida entre páginas");

  await prisma.auditEvento.deleteMany({ where: whereTeste });
}

async function main() {
  await limparDadosDeTeste();
  await prepararCliente();

  await cenarioA_diffApenasWhitelist();
  await cenarioB_splitDeStatus();
  await cenarioC_rollbackNaoDeixaOrfao();
  await cenarioD_paginacaoPorCursor();

  await limparDadosDeTeste();

  console.log(falhas === 0 ? "\nTodos os critérios de aceite da Fase 1 passaram." : `\n${falhas} critério(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error("Erro inesperado ao rodar a verificação:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
