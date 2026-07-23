// Script de verificação manual do controle de Start/Stop de atividades (módulo
// Gestão de Projetos > Atividades). Testa a lógica compartilhada
// (montarOperacoesMovimentacao, podeIniciar/podeParar) diretamente — as rotas HTTP
// (POST /:id/start, /:id/stop) chamam exatamente essas mesmas funções, então isso
// cobre o caminho de maior risco (regra de concorrência) sem precisar de um servidor
// HTTP + autenticação de teste. O projeto não tem framework de teste configurado hoje.
//
// Uso: npx ts-node prisma/verificarStartStop.ts
import { randomUUID } from "crypto";
import { prisma } from "../src/db/prisma";
import { EVENTOS_AUDITORIA } from "../src/audit/taxonomia";
import {
  RAIA_A_FAZER,
  RAIA_EM_ANDAMENTO,
  montarOperacoesMovimentacao,
  podeIniciar,
  podeParar,
} from "../src/domain/execucaoAtividade";

if (process.env.NODE_ENV === "production") {
  console.error("Recusando rodar em NODE_ENV=production — este script cria/apaga dados de teste.");
  process.exit(1);
}

const CODEMP = 900002; // faixa diferente de verificarAceiteAuditoria.ts, pra não colidir
const CODCLI = 900002;
const FASID_TESTE = 900002;
const CODFOR_B = 900002; // consultor do cenário B, isolado do C (evita sessão aberta cruzando cenários)
const CODFOR_C = 900003; // mesmo consultor nas duas atividades do cenário C, pra testar a concorrência

let falhas = 0;
function assert(condicao: boolean, mensagem: string) {
  if (condicao) console.log(`  OK: ${mensagem}`);
  else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

async function limpar() {
  await prisma.auditEvento.deleteMany({ where: { codemp: CODEMP } });
  await prisma.atividadeHistoricoMovimentacao.deleteMany({
    where: { atividade: { codemp: CODEMP } },
  });
  await prisma.atividadeSessaoExecucao.deleteMany({ where: { atividade: { codemp: CODEMP } } });
  await prisma.atividadeConsultor.deleteMany({ where: { codemp: CODEMP } });
  await prisma.proposta.deleteMany({ where: { codemp: CODEMP } });
  await prisma.cliente.deleteMany({ where: { codcli: CODCLI } });
  await prisma.faseProposta.deleteMany({ where: { fasid: FASID_TESTE } });
}

async function preparar() {
  await prisma.cliente.upsert({
    where: { codcli: CODCLI },
    update: {},
    create: {
      codcli: CODCLI,
      nomcli: "Cliente Teste Start/Stop",
      apecli: "Teste",
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
  await prisma.faseProposta.upsert({
    where: { fasid: FASID_TESTE },
    update: {},
    create: { fasid: FASID_TESTE, fasdes: "Fase Teste Start/Stop" },
  });
  await prisma.proposta.upsert({
    where: { codemp_codpro: { codemp: CODEMP, codpro: 1 } },
    update: {},
    create: { codemp: CODEMP, codpro: 1, codcli: CODCLI, numprj: 1, codfpj: 1, idcom: 1, codrep: 1, numped: 1 },
  });
}

// codpro sempre 1 (mesmo da Proposta criada em preparar()) — AuditEvento.codemp/codpro
// tem FK pra Proposta, então precisa apontar pra uma linha que exista de verdade.
// `seqite` varia pra simular "itens diferentes" sem precisar de mais Propostas.
async function criarAtividade(seqite: number, codfor: number): Promise<{ id: number; codpro: number }> {
  const colunaAFazer = await prisma.quadroColuna.findFirstOrThrow({ where: { nome: RAIA_A_FAZER } });
  const a = await prisma.atividadeConsultor.create({
    data: {
      codemp: CODEMP,
      codpro: 1,
      seqite,
      codfor,
      qtdhor: 100,
      sitreg: "A",
      fasid: FASID_TESTE,
      colunaId: colunaAFazer.id,
    },
  });
  return { id: a.id, codpro: 1 };
}

async function cenarioA_podeIniciarPodeParar() {
  console.log("\nCenário A — podeIniciar/podeParar (regra de negócio pura)");
  assert(podeIniciar("A Fazer") === true, 'podeIniciar("A Fazer") === true');
  assert(podeIniciar("Em Andamento") === false, 'podeIniciar("Em Andamento") === false');
  assert(podeIniciar("Bloqueado") === false, 'podeIniciar("Bloqueado") === false');
  assert(podeIniciar("Concluído") === false, 'podeIniciar("Concluído") === false');
  assert(podeParar("Em Andamento") === true, 'podeParar("Em Andamento") === true');
  assert(podeParar("A Fazer") === false, 'podeParar("A Fazer") === false');
  assert(podeParar("Bloqueado") === false, 'podeParar("Bloqueado") === false');
  assert(podeParar("Concluído") === false, 'podeParar("Concluído") === false');
}

async function cenarioB_iniciarAbreSessaoEEventos() {
  console.log("\nCenário B — iniciar move pra 'Em Andamento', abre sessão e gera eventos");
  const atividade1 = await criarAtividade(101, CODFOR_B);
  const [colunaAFazer, colunaEmAndamento] = await Promise.all([
    prisma.quadroColuna.findFirstOrThrow({ where: { nome: RAIA_A_FAZER } }),
    prisma.quadroColuna.findFirstOrThrow({ where: { nome: RAIA_EM_ANDAMENTO } }),
  ]);
  const atividadeRow = await prisma.atividadeConsultor.findUniqueOrThrow({ where: { id: atividade1.id } });

  const correlationId = randomUUID();
  const agora = new Date();
  const { operacoes } = await montarOperacoesMovimentacao({
    atividade: atividadeRow,
    colunaAnterior: colunaAFazer,
    colunaNova: colunaEmAndamento,
    usuarioId: 1,
    origemSessao: "manual",
    correlationId,
    agora,
  });
  await prisma.$transaction(operacoes);

  const atualizada = await prisma.atividadeConsultor.findUniqueOrThrow({ where: { id: atividade1.id } });
  assert(atualizada.colunaId === colunaEmAndamento.id, "atividade foi movida pra coluna Em Andamento");

  const sessaoAberta = await prisma.atividadeSessaoExecucao.findFirst({ where: { atividadeId: atividade1.id, fim: null } });
  assert(sessaoAberta !== null && sessaoAberta.origem === "manual", "sessão de execução aberta com origem 'manual'");

  const eventos = await prisma.auditEvento.findMany({ where: { entidadeId: String(atividade1.id) } });
  const tipos = eventos.map((e) => e.eventoTipo).sort();
  assert(
    JSON.stringify(tipos) === JSON.stringify([EVENTOS_AUDITORIA.ATIVIDADE_INICIADA, EVENTOS_AUDITORIA.KANBAN_RAIA_ALTERADA].sort()),
    "gerou ATIVIDADE_INICIADA + KANBAN_RAIA_ALTERADA"
  );
}

async function cenarioC_concorrenciaAutoPausa() {
  console.log("\nCenário C — iniciar a 2ª atividade do mesmo consultor pausa a 1ª automaticamente");
  const atividade1 = await criarAtividade(201, CODFOR_C);
  const atividade2 = await criarAtividade(202, CODFOR_C);
  const [colunaAFazer, colunaEmAndamento] = await Promise.all([
    prisma.quadroColuna.findFirstOrThrow({ where: { nome: RAIA_A_FAZER } }),
    prisma.quadroColuna.findFirstOrThrow({ where: { nome: RAIA_EM_ANDAMENTO } }),
  ]);

  // Inicia a atividade 1 primeiro (fora da transação combinada, só pra montar o cenário).
  const row1 = await prisma.atividadeConsultor.findUniqueOrThrow({ where: { id: atividade1.id } });
  const { operacoes: opsInicio1 } = await montarOperacoesMovimentacao({
    atividade: row1,
    colunaAnterior: colunaAFazer,
    colunaNova: colunaEmAndamento,
    usuarioId: 1,
    origemSessao: "manual",
    correlationId: randomUUID(),
    agora: new Date(),
  });
  await prisma.$transaction(opsInicio1);

  // Agora simula o que POST /:id/start faz ao iniciar a atividade 2: detecta a sessão
  // aberta da atividade 1 (mesmo codfor), monta as duas movimentações (pausa + início)
  // e roda tudo numa única transação com o mesmo correlationId.
  const sessaoDoConsultor = await prisma.atividadeSessaoExecucao.findFirst({
    where: { fim: null, atividade: { codfor: CODFOR_C, id: { not: atividade2.id } } },
    include: { atividade: { include: { coluna: true } } },
  });
  assert(sessaoDoConsultor !== null, "detectou a sessão aberta da atividade 1 ao tentar iniciar a atividade 2");
  assert(sessaoDoConsultor?.atividadeId === atividade1.id, "a sessão detectada é da atividade 1, não da 2");

  const correlationId = randomUUID();
  const agora = new Date();
  const operacoes = [];

  const { operacoes: opsPausa } = await montarOperacoesMovimentacao({
    atividade: sessaoDoConsultor!.atividade,
    colunaAnterior: sessaoDoConsultor!.atividade.coluna,
    colunaNova: colunaAFazer,
    usuarioId: 1,
    origemSessao: "manual",
    correlationId,
    agora,
  });
  operacoes.push(...opsPausa);

  const row2 = await prisma.atividadeConsultor.findUniqueOrThrow({ where: { id: atividade2.id } });
  const { operacoes: opsInicio2 } = await montarOperacoesMovimentacao({
    atividade: row2,
    colunaAnterior: colunaAFazer,
    colunaNova: colunaEmAndamento,
    usuarioId: 1,
    origemSessao: "manual",
    correlationId,
    agora,
  });
  operacoes.push(...opsInicio2);

  await prisma.$transaction(operacoes);

  const atividade1Depois = await prisma.atividadeConsultor.findUniqueOrThrow({ where: { id: atividade1.id } });
  const atividade2Depois = await prisma.atividadeConsultor.findUniqueOrThrow({ where: { id: atividade2.id } });
  assert(atividade1Depois.colunaId === colunaAFazer.id, "atividade 1 voltou pra 'A Fazer' (foi pausada)");
  assert(atividade2Depois.colunaId === colunaEmAndamento.id, "atividade 2 está em 'Em Andamento' (foi iniciada)");

  const sessao1Aberta = await prisma.atividadeSessaoExecucao.findFirst({ where: { atividadeId: atividade1.id, fim: null } });
  const sessao2Aberta = await prisma.atividadeSessaoExecucao.findFirst({ where: { atividadeId: atividade2.id, fim: null } });
  assert(sessao1Aberta === null, "sessão da atividade 1 foi fechada");
  assert(sessao2Aberta !== null, "sessão da atividade 2 está aberta");

  const eventosAtividade1 = await prisma.auditEvento.findMany({
    where: { entidadeId: String(atividade1.id), correlationId },
  });
  const eventosAtividade2 = await prisma.auditEvento.findMany({
    where: { entidadeId: String(atividade2.id), correlationId },
  });
  assert(
    eventosAtividade1.some((e) => e.eventoTipo === EVENTOS_AUDITORIA.ATIVIDADE_PARADA),
    "ATIVIDADE_PARADA gravado para a atividade 1, com o mesmo correlationId da ação"
  );
  assert(
    eventosAtividade2.some((e) => e.eventoTipo === EVENTOS_AUDITORIA.ATIVIDADE_INICIADA),
    "ATIVIDADE_INICIADA gravado para a atividade 2, com o mesmo correlationId da ação"
  );

  const eventoParada = eventosAtividade1.find((e) => e.eventoTipo === EVENTOS_AUDITORIA.ATIVIDADE_PARADA);
  const metadata = (eventoParada?.metadata ?? {}) as Record<string, unknown>;
  assert(typeof metadata.duracaoMinutos === "number", "evento de parada da atividade 1 tem duracaoMinutos no metadata");
}

async function main() {
  await limpar();
  await preparar();

  await cenarioA_podeIniciarPodeParar();
  await cenarioB_iniciarAbreSessaoEEventos();
  await cenarioC_concorrenciaAutoPausa();

  await limpar();

  console.log(
    "\nNota: validação HTTP dos 409 (start numa atividade que não está em 'A Fazer', stop numa que não está em " +
      "'Em Andamento') e da permissão (403) não está coberta aqui — são checagens simples de rota, verificar " +
      "manualmente via UI ou curl com um token de teste."
  );

  console.log(falhas === 0 ? "\nTodos os critérios verificados passaram." : `\n${falhas} critério(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error("Erro inesperado ao rodar a verificação:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
