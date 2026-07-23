// Script de verificação manual dos critérios de aceite das Fases 1 e 2 do módulo de
// Auditoria (não é uma suíte automatizada — o projeto não tem framework de teste
// configurado hoje). Roda contra o banco de DEV apontado por DATABASE_URL.
//
// Uso: npx ts-node prisma/verificarAceiteAuditoria.ts
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { processarLinhasProposta, PropostaRow } from "../src/sync/propostaSync";
import { processarFilaSincronizacao } from "../src/sync/outboxSenior";
import { EVENTOS_AUDITORIA, ENTIDADES_AUDITORIA } from "../src/audit/taxonomia";
import { criarEventoAuditoria, criarEventosDeData, diffCampos, paraDiff } from "../src/audit/registrarEvento";
import { CAMPOS_AUDITADOS_ALOCACAO, CAMPOS_AUDITADOS_ATIVIDADE_DATAS } from "../src/audit/camposAuditados";
import { entidadeIdAtividade } from "../src/audit/identidadeEntidade";

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
const FASID_TESTE = 900001;

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
  await prisma.atividadeConsultor.deleteMany({ where: { codemp: CODEMP } });
  await prisma.proposta.deleteMany({ where: { codemp: CODEMP } });
  await prisma.cliente.deleteMany({ where: { codcli: { in: [CODCLI] } } });
  await prisma.faseProposta.deleteMany({ where: { fasid: FASID_TESTE } });
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

async function prepararFase() {
  await prisma.faseProposta.upsert({
    where: { fasid: FASID_TESTE },
    update: {},
    create: { fasid: FASID_TESTE, fasdes: "Fase Teste Auditoria" },
  });
}

// AuditEvento.codemp/codpro tem FK pra Proposta — os cenários de atividade/alocação
// também precisam de uma Proposta real por trás pra poder desnormalizar o proposta_id
// no evento, mesmo não usando os campos de Proposta em si.
async function prepararPropostaTeste(codpro: number) {
  await prisma.proposta.upsert({
    where: { codemp_codpro: { codemp: CODEMP, codpro } },
    update: {},
    create: { codemp: CODEMP, codpro, codcli: CODCLI, numprj: 1, codfpj: 1, idcom: 1, codrep: 1, numped: 1 },
  });
}

async function cenarioE_alocacaoCriadaAlteradaRemovida() {
  console.log("\nCenário E — ALOCACAO_CRIADA / ALOCACAO_ALTERADA / ALOCACAO_REMOVIDA");
  await prepararPropostaTeste(900700);

  // Reproduz o mesmo formato de transação interativa usado em alocacao.ts (POST
  // .../alocacoes): cria a linha e, na mesma transação, o evento com o id gerado.
  const criada = await prisma.$transaction(async (tx) => {
    const nova = await tx.atividadeConsultor.create({
      data: { codemp: CODEMP, codpro: 900700, seqite: 1, codfor: 1, qtdhor: 100, sitreg: "A", fasid: FASID_TESTE },
    });
    await criarEventoAuditoria(
      {
        origem: "tela",
        codemp: CODEMP,
        codpro: 900700,
        entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
        entidadeId: entidadeIdAtividade(nova.id),
        entidadeRotulo: "Alocação de teste",
        eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_CRIADA,
        alteracoes: null,
        metadata: { qtdhor: 100 },
        correlationId: randomUUID(),
      },
      tx
    );
    return nova;
  });

  const eventoCriacao = await prisma.auditEvento.findFirst({ where: { entidadeId: entidadeIdAtividade(criada.id) } });
  assert(eventoCriacao?.eventoTipo === EVENTOS_AUDITORIA.ALOCACAO_CRIADA, "ALOCACAO_CRIADA gravado com o id real da linha criada");

  // Alterar qtdhor — mesmo padrão de diff usado em PATCH /alocacoes/:id.
  const diffHoras = diffCampos(CAMPOS_AUDITADOS_ALOCACAO, criada, paraDiff({ qtdhor: 250 }));
  assert(diffHoras.algumaMudanca && "qtdhor" in diffHoras.alteracoes, "diff de qtdhor detecta a mudança 100 -> 250");
  await prisma.$transaction([
    prisma.atividadeConsultor.update({ where: { id: criada.id }, data: { qtdhor: 250 } }),
    criarEventoAuditoria({
      origem: "tela",
      codemp: CODEMP,
      codpro: 900700,
      entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
      entidadeId: entidadeIdAtividade(criada.id),
      entidadeRotulo: "Alocação de teste",
      eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_ALTERADA,
      alteracoes: diffHoras.alteracoes,
      metadata: null,
      correlationId: randomUUID(),
    }),
  ]);
  const eventoAlteracao = await prisma.auditEvento.findFirst({
    where: { entidadeId: entidadeIdAtividade(criada.id), eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_ALTERADA },
  });
  assert(eventoAlteracao !== null, "ALOCACAO_ALTERADA gravado ao mudar qtdhor");

  // Soft-delete — mesmo padrão de PATCH /alocacao/alocacoes/:id (DELETE).
  await prisma.$transaction([
    prisma.atividadeConsultor.update({ where: { id: criada.id }, data: { sitreg: "I" } }),
    criarEventoAuditoria({
      origem: "tela",
      codemp: CODEMP,
      codpro: 900700,
      entidadeTipo: ENTIDADES_AUDITORIA.ALOCACAO,
      entidadeId: entidadeIdAtividade(criada.id),
      entidadeRotulo: "Alocação de teste",
      eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA,
      alteracoes: null,
      metadata: null,
      correlationId: randomUUID(),
    }),
  ]);
  const eventoRemocao = await prisma.auditEvento.findFirst({
    where: { entidadeId: entidadeIdAtividade(criada.id), eventoTipo: EVENTOS_AUDITORIA.ALOCACAO_REMOVIDA },
  });
  assert(eventoRemocao !== null, "ALOCACAO_REMOVIDA gravado no soft-delete (sitreg A -> I)");
}

async function cenarioF_dataIncluidaEAlterada() {
  console.log("\nCenário F — DATA_INCLUIDA (null -> valor) e DATA_ALTERADA (valor -> outro valor)");
  await prepararPropostaTeste(900701);

  const criada = await prisma.atividadeConsultor.create({
    data: {
      codemp: CODEMP,
      codpro: 900701,
      seqite: 1,
      codfor: 1,
      qtdhor: 100,
      sitreg: "A",
      fasid: FASID_TESTE,
      dataPrevistaInicio: new Date("2026-01-01"),
      dataPrevistaFim: null,
    },
  });

  const correlationId = randomUUID();
  const operacoes = criarEventosDeData(
    CAMPOS_AUDITADOS_ATIVIDADE_DATAS,
    { dataPrevistaInicio: criada.dataPrevistaInicio, dataPrevistaFim: criada.dataPrevistaFim },
    { dataPrevistaInicio: new Date("2026-02-01"), dataPrevistaFim: new Date("2026-03-01") },
    {
      origem: "tela",
      codemp: CODEMP,
      codpro: 900701,
      entidadeTipo: ENTIDADES_AUDITORIA.ATIVIDADE,
      entidadeId: entidadeIdAtividade(criada.id),
      entidadeRotulo: "Atividade de teste",
      correlationId,
    }
  );
  assert(operacoes.length === 2, `criarEventosDeData gerou 2 operações (gerou ${operacoes.length})`);
  await prisma.$transaction(operacoes);

  const eventos = await prisma.auditEvento.findMany({ where: { entidadeId: entidadeIdAtividade(criada.id) } });
  const tipos = eventos.map((e) => e.eventoTipo).sort();
  assert(
    JSON.stringify(tipos) === JSON.stringify([EVENTOS_AUDITORIA.DATA_ALTERADA, EVENTOS_AUDITORIA.DATA_INCLUIDA].sort()),
    "um evento é DATA_INCLUIDA (dataPrevistaFim, era null) e outro é DATA_ALTERADA (dataPrevistaInicio, tinha valor)"
  );
  const correlationIds = new Set(eventos.map((e) => e.correlationId));
  assert(correlationIds.size === 1, "os 2 eventos de data compartilham o mesmo correlationId");
}

async function cenarioG_ativadeEnviadaSenior() {
  console.log("\nCenário G — ATIVIDADE_ENVIADA_SENIOR (fila outbox assíncrona)");

  const pendentesExistentes = await prisma.sincronizacaoPendente.count({ where: { status: "pendente" } });
  if (pendentesExistentes > 0) {
    console.log(
      `  PULADO: já existem ${pendentesExistentes} item(ns) reais na fila outbox — processarFilaSincronizacao() mexeria neles. Rode este cenário manualmente com a fila vazia.`
    );
    return;
  }
  await prepararPropostaTeste(900702);

  const atividade = await prisma.atividadeConsultor.create({
    data: { codemp: CODEMP, codpro: 900702, seqite: 1, codfor: 1, qtdhor: 100, sitreg: "A", fasid: FASID_TESTE },
  });
  const pendente = await prisma.sincronizacaoPendente.create({
    data: { atividadeId: atividade.id, tipo: "mover_coluna", payload: { teste: true }, status: "pendente", tentativas: 0 },
  });

  await processarFilaSincronizacao(); // enviarParaSenior é um stub que sempre falha — testa o caminho de erro

  const evento = await prisma.auditEvento.findFirst({
    where: { entidadeId: entidadeIdAtividade(atividade.id), eventoTipo: EVENTOS_AUDITORIA.ATIVIDADE_ENVIADA_SENIOR },
  });
  assert(evento !== null, "ATIVIDADE_ENVIADA_SENIOR gravado mesmo em falha de envio (auditoria registra tentativas)");
  const metadata = (evento?.metadata ?? {}) as Record<string, unknown>;
  assert(metadata.sucesso === false, "metadata.sucesso é false (canal do Senior é stub que sempre falha)");
  assert(typeof metadata.duracaoMs === "number", "metadata.duracaoMs é numérico");

  const pendenteAtualizado = await prisma.sincronizacaoPendente.findUnique({ where: { id: pendente.id } });
  assert(pendenteAtualizado?.tentativas === 1, "tentativas incrementou de 0 para 1 na fila");

  await prisma.sincronizacaoPendente.delete({ where: { id: pendente.id } });
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
  await prepararFase();

  await cenarioA_diffApenasWhitelist();
  await cenarioB_splitDeStatus();
  await cenarioC_rollbackNaoDeixaOrfao();
  await cenarioD_paginacaoPorCursor();
  await cenarioE_alocacaoCriadaAlteradaRemovida();
  await cenarioF_dataIncluidaEAlterada();
  await cenarioG_ativadeEnviadaSenior();

  await limparDadosDeTeste();

  console.log(
    "\nNota: KANBAN_RAIA_ALTERADA, ATIVIDADE_INICIADA e ATIVIDADE_PARADA nascem inline em " +
      "PATCH /atividades/:id/mover (não é uma função exportável isolada como os cenários acima) — " +
      "verificar manualmente: mover um card pra uma coluna com contaComoExecucao=true e depois pra " +
      "outra, e conferir os 3 eventos gerados em GET /api/auditoria?entidadeId=<id>&agrupar=true."
  );

  console.log(falhas === 0 ? "\nTodos os critérios de aceite automatizáveis passaram." : `\n${falhas} critério(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error("Erro inesperado ao rodar a verificação:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
