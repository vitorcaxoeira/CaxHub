// Verificação manual da detecção de registros excluídos no Senior (sync/varrerRemovidos.ts)
// — não é suíte automatizada, o projeto não tem framework de teste configurado. Roda
// contra o banco de DEV apontado por DATABASE_URL, no mesmo molde de
// verificarAceiteAuditoria.ts.
//
// Uso: node_modules/.bin/ts-node prisma/verificarVarreduraRemocoes.ts
//
// Simula o Senior chamando processarLinhasPedido() com linhas sintéticas: "excluir um
// pedido no Senior" é simplesmente não passar mais aquela linha na rodada seguinte.
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { PedidoRow, processarLinhasPedido } from "../src/sync/pedidoSync";
import { varrerRemovidos } from "../src/sync/varrerRemovidos";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production — este script cria/apaga dados de teste.");
  process.exit(1);
}

const CODEMP = 900001;
const CODFIL = 1;
const CODCLI_X = 900001;
const CODCLI_Y = 900002;
const NUMPED_A = 900001;
const NUMPED_B = 900002;
const NUMPED_C = 900003;
const NUMPED_Y = 900004;

const JOB = "verificacao-varredura";
// Escopo sintético: tudo que o script cria vive sob CODEMP 900001, então a varredura
// nunca encosta em pedido real do banco de dev.
const ESCOPO: Prisma.PedidoWhereInput = { codemp: CODEMP };

let falhas = 0;

function assert(condicao: boolean, mensagem: string) {
  if (condicao) {
    console.log(`  OK: ${mensagem}`);
  } else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

function linha(numped: number, codcli = CODCLI_X): PedidoRow {
  return {
    codemp: CODEMP,
    codfil: CODFIL,
    numped,
    datemi: "2026-01-15",
    codcli,
    codcpg: "001",
    sitped: 1,
  };
}

async function limparDadosDeTeste() {
  await prisma.pedido.deleteMany({ where: { codemp: CODEMP } });
}

async function estado(numped: number) {
  return prisma.pedido.findUnique({
    where: { codemp_codfil_numped: { codemp: CODEMP, codfil: CODFIL, numped } },
    select: { vistoEmSync: true, removidoEmSenior: true },
  });
}

// Contagem "da origem" coerente com o que foi processado — nos cenários em que a guarda
// de truncamento não é o objeto do teste, ela precisa passar pra não mascarar o resultado.
const origemCom = (n: number) => async () => n;

async function cenarioExclusaoEResurreicao() {
  console.log("\nCenário 1 — exclusão simples e ressurreição");
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B), linha(NUMPED_C)], t1);

  const nada = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t1, linhasProcessadas: 3, escopo: ESCOPO, contarOrigem: origemCom(3),
  });
  assert(nada.marcados === 0, "rodada completa não marca ninguém");

  // Rodada seguinte sem o B = B foi excluído no Senior.
  const t2 = new Date(t1.getTime() + 1000);
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_C)], t2);
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t2, linhasProcessadas: 2, escopo: ESCOPO, contarOrigem: origemCom(2),
  });
  assert(varredura.marcados === 1, "marca exatamente 1 (o pedido que sumiu)");
  assert((await estado(NUMPED_B))?.removidoEmSenior != null, "B ficou marcado como removido");
  assert((await estado(NUMPED_A))?.removidoEmSenior == null, "A continua vivo");
  assert((await estado(NUMPED_C))?.removidoEmSenior == null, "C continua vivo");

  // B volta a aparecer no Senior.
  const t3 = new Date(t2.getTime() + 1000);
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B), linha(NUMPED_C)], t3);
  assert((await estado(NUMPED_B))?.removidoEmSenior == null, "B ressuscita sozinho ao reaparecer no Senior");
}

async function cenarioGuardaTruncamento() {
  console.log("\nCenário 2 — guarda contra resposta truncada do SOAP");
  await limparDadosDeTeste();
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B), linha(NUMPED_C)], t1);

  // O pior caso real: a paginação devolve zero linha, o job grava "success", e a varredura
  // acharia que a tabela inteira foi excluída.
  const t2 = new Date(t1.getTime() + 1000);
  const antes = await prisma.pedido.count({ where: { ...ESCOPO, removidoEmSenior: null } });
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t2, linhasProcessadas: 0, escopo: ESCOPO, contarOrigem: origemCom(3),
  });
  const depois = await prisma.pedido.count({ where: { ...ESCOPO, removidoEmSenior: null } });

  assert(!varredura.executada, "varredura não executa quando origem e processado divergem");
  assert(varredura.marcados === 0 && antes === depois, "nenhuma linha foi alterada");
  console.log(`    motivo: ${varredura.motivo}`);
}

async function cenarioGuardaTeto() {
  console.log("\nCenário 3 — teto de remoções por execução");
  await limparDadosDeTeste();
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B), linha(NUMPED_C)], t1);

  // 3 vivos, 3 candidatos, teto de 1: acima do limite, não marca nada.
  const t2 = new Date(t1.getTime() + 1000);
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t2, linhasProcessadas: 0, escopo: ESCOPO,
    contarOrigem: origemCom(0), teto: { pct: 0, minimo: 1 },
  });
  assert(!varredura.executada && varredura.marcados === 0, "acima do teto não marca nada");
  assert(varredura.candidatos === 3, "mas informa quantos seriam (3)");
  console.log(`    motivo: ${varredura.motivo}`);
}

// O teto real usado pelo sync por cliente (runPedidoSyncPorClientes). Precisa deixar
// esvaziar um cliente pequeno por inteiro, mas travar marcação em massa quando o escopo é
// grande — o botão "Sinc. ERP — N clientes do filtro" pode cobrir a base toda numa clicada.
const TETO_POR_CLIENTE = { pct: 0.1, minimo: 25 };

async function cenarioTetoPorCliente() {
  console.log("\nCenário 3b — teto do sync por cliente (10% / mínimo 25)");

  // Cliente pequeno esvaziado por completo: 5 vivos, 5 candidatos, abaixo do mínimo de 25.
  await limparDadosDeTeste();
  const t1 = new Date();
  const cinco = [900101, 900102, 900103, 900104, 900105].map((n) => linha(n));
  await processarLinhasPedido(cinco, t1);
  const t2 = new Date(t1.getTime() + 1000);
  const pequeno = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t2, linhasProcessadas: 0, escopo: ESCOPO,
    contarOrigem: origemCom(0), teto: TETO_POR_CLIENTE,
  });
  assert(pequeno.marcados === 5, "cliente pequeno pode ser esvaziado por inteiro (5 de 5)");

  // Escopo grande: 40 vivos, 30 candidatos. 30 > max(25, 10% de 40 = 4) -> trava.
  await limparDadosDeTeste();
  const t3 = new Date();
  const quarenta = Array.from({ length: 40 }, (_, i) => linha(900200 + i));
  await processarLinhasPedido(quarenta, t3);
  const t4 = new Date(t3.getTime() + 1000);
  await processarLinhasPedido(quarenta.slice(30), t4); // só 10 continuam vindo
  const grande = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t4, linhasProcessadas: 10, escopo: ESCOPO,
    contarOrigem: origemCom(10), teto: TETO_POR_CLIENTE,
  });
  assert(!grande.executada && grande.marcados === 0, "30 candidatos de 40 estoura o teto e não marca");
  assert(grande.candidatos === 30, "mas reporta os 30 candidatos");

  // Mesmo escopo, 20 candidatos: 20 < 25 -> passa.
  await limparDadosDeTeste();
  const t5 = new Date();
  await processarLinhasPedido(quarenta, t5);
  const t6 = new Date(t5.getTime() + 1000);
  await processarLinhasPedido(quarenta.slice(20), t6); // 20 continuam vindo
  const dentro = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t6, linhasProcessadas: 20, escopo: ESCOPO,
    contarOrigem: origemCom(20), teto: TETO_POR_CLIENTE,
  });
  assert(dentro.marcados === 20, "20 candidatos ficam dentro do mínimo de 25 e são marcados");
}

async function cenarioSimular() {
  console.log("\nCenário 4 — modo simular conta sem escrever");
  await limparDadosDeTeste();
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B)], t1);

  const t2 = new Date(t1.getTime() + 1000);
  await processarLinhasPedido([linha(NUMPED_A)], t2);
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "simular", inicio: t2, linhasProcessadas: 1, escopo: ESCOPO, contarOrigem: origemCom(1),
  });
  assert(varredura.candidatos === 1, "detecta 1 candidato");
  assert(varredura.marcados === 0, "não marca nada em simulação");
  assert((await estado(NUMPED_B))?.removidoEmSenior == null, "B segue sem marcação no banco");
}

async function cenarioEscopoParcial() {
  console.log("\nCenário 5 — escopo parcial (sync por cliente)");
  await limparDadosDeTeste();
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A, CODCLI_X), linha(NUMPED_Y, CODCLI_Y)], t1);

  // Sincroniza SÓ o cliente Y, e o pedido dele sumiu. O do cliente X não foi consultado
  // nesta rodada e não pode ser tocado.
  const t2 = new Date(t1.getTime() + 1000);
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t2, linhasProcessadas: 0,
    escopo: { ...ESCOPO, codcli: { in: [CODCLI_Y] } },
    contarOrigem: origemCom(0), teto: { pct: 1, minimo: 10 },
  });
  assert(varredura.marcados === 1, "marca o pedido do cliente sincronizado");
  assert((await estado(NUMPED_Y))?.removidoEmSenior != null, "pedido do cliente Y marcado");
  assert((await estado(NUMPED_A))?.removidoEmSenior == null, "pedido do cliente X intocado (fora do escopo)");
}

async function cenarioImunidadeNull() {
  console.log("\nCenário 6 — linha nunca carimbada é imune");
  await limparDadosDeTeste();
  // Pedido criado direto no banco, sem passar por sync: vistoEmSync fica NULL. É o caso
  // dos registros que nascem no CaxHub (Rat/RatItem/AtividadeConsultor), onde isso é
  // decisivo. `NULL < x` é NULL em SQL, então ele nunca entra na varredura.
  await prisma.pedido.create({
    data: { codemp: CODEMP, codfil: CODFIL, numped: NUMPED_A, datemi: new Date("2026-01-15"), codcli: CODCLI_X, codcpg: "001", sitped: 1 },
  });
  assert((await estado(NUMPED_A))?.vistoEmSync == null, "pedido criado fora do sync tem vistoEmSync NULL");

  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: new Date(), linhasProcessadas: 0, escopo: ESCOPO,
    contarOrigem: origemCom(0), teto: { pct: 1, minimo: 10 },
  });
  assert(varredura.candidatos === 0 && varredura.marcados === 0, "linha sem carimbo nunca é varrida");
  assert((await estado(NUMPED_A))?.removidoEmSenior == null, "e continua viva no banco");
}

async function cenarioPuladas() {
  console.log("\nCenário 7 — run com linhas puladas não varre");
  await limparDadosDeTeste();
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B)], t1);

  const t2 = new Date(t1.getTime() + 1000);
  await processarLinhasPedido([linha(NUMPED_A)], t2);
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: JOB, modo: "marcar", inicio: t2, linhasProcessadas: 1, escopo: ESCOPO,
    contarOrigem: origemCom(1), puladas: 1,
  });
  assert(!varredura.executada, "não varre quando o run pulou linha por motivo técnico");
  assert((await estado(NUMPED_B))?.removidoEmSenior == null, "candidato não foi marcado");
}

async function cenarioPoliticaDesligada() {
  console.log("\nCenário 8 — job fora da política não varre");
  await limparDadosDeTeste();
  const t1 = new Date();
  await processarLinhasPedido([linha(NUMPED_A), linha(NUMPED_B)], t1);

  const t2 = new Date(t1.getTime() + 1000);
  await processarLinhasPedido([linha(NUMPED_A)], t2);
  // Sem `modo`, o helper consulta politicaVarredura.ts — e um jobName desconhecido é
  // "desligada" por padrão. Esse default é o que impede um job novo de começar a marcar
  // registro sozinho.
  const varredura = await varrerRemovidos<Prisma.PedidoWhereInput>(prisma.pedido, {
    jobName: "job-que-nao-existe-na-politica", inicio: t2, linhasProcessadas: 1, escopo: ESCOPO, contarOrigem: origemCom(1),
  });
  assert(!varredura.executada && varredura.modo === "desligada", "default da política é não varrer");
}

async function main() {
  console.log("Verificação da varredura de registros removidos no Senior");
  await limparDadosDeTeste();
  try {
    await cenarioExclusaoEResurreicao();
    await cenarioGuardaTruncamento();
    await cenarioGuardaTeto();
    await cenarioTetoPorCliente();
    await cenarioSimular();
    await cenarioEscopoParcial();
    await cenarioImunidadeNull();
    await cenarioPuladas();
    await cenarioPoliticaDesligada();
  } finally {
    await limparDadosDeTeste();
    await prisma.$disconnect();
  }

  console.log(falhas === 0 ? "\nTodos os cenários passaram." : `\n${falhas} verificação(ões) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
