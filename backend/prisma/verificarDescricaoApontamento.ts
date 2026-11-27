// Verificação de ponta a ponta da descrição obrigatória nos apontamentos (domain/descricaoApontamento.ts): sobe SÓ os routers envolvidos
// numa porta livre (sem os jobs agendados) e chama as rotas de verdade, com um consultor e um admin de teste.
//
// Segurança: roda só em banco local; liga a trava SENIOR_SOMENTE_LEITURA no próprio processo; e NUNCA confirma um apontamento com sucesso —
// só exercita a recusa, em atividade com o teto estourado, de modo que nem uma falha na regra criaria RAT ou item na fila do Senior.
// Cria e apaga só o que é dele (empresa de teste CODEMP); se já houver algo nela, para sem tocar em nada.
//
// Uso: npx ts-node prisma/verificarDescricaoApontamento.ts
process.env.SENIOR_SOMENTE_LEITURA = "true";

import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { attachCorrelationId } from "../src/audit/correlationId";
import { signToken } from "../src/auth/jwt";
import { atividadesRouter } from "../src/routes/atividades";
import { apontamentosRouter } from "../src/routes/apontamentos";
import { solicitacoesApontamentoRouter } from "../src/routes/solicitacoesApontamento";

const banco = new URL(process.env.DATABASE_URL ?? "postgres://invalido").hostname;
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(banco)) {
  console.error("Recusando rodar fora do banco local — este script cria e apaga dados de teste.");
  process.exit(1);
}

const CODEMP = 900047;
const CODFOR = 900047;
const SEQATI_BASE = 900047000n;
const EMAIL_CONSULTOR = "zz-teste-descricao@caxhub.test";
const EMAIL_ADMIN = "zz-teste-descricao-admin@caxhub.test";
const NOME_ATIVIDADE = "ZZ-TESTE Apoio para consultoria de folha de pagamento";

const TEXTO = (n: number) => `ZZ-TESTE passo ${n}: ajustei a regra de cálculo e validei com o cliente`;

let falhas = 0;
function conferir(condicao: boolean, mensagem: string, detalhe?: unknown) {
  if (condicao) console.log(`  OK: ${mensagem}`);
  else {
    console.error(`  FALHOU: ${mensagem}${detalhe === undefined ? "" : ` → ${JSON.stringify(detalhe)}`}`);
    falhas++;
  }
}

async function limpar() {
  const doTeste = { codemp: CODEMP };
  await prisma.auditEvento.deleteMany({ where: doTeste });
  await prisma.atividadeHistoricoMovimentacao.deleteMany({ where: { atividade: doTeste } });
  await prisma.notificacao.deleteMany({ where: { atividade: doTeste } });
  await prisma.solicitacaoApontamento.deleteMany({ where: { atividade: doTeste } });
  await prisma.atividadeSessaoExecucao.deleteMany({ where: { atividade: doTeste } });
  await prisma.atividadeConsultor.deleteMany({ where: doTeste });
  await prisma.propostaItem.deleteMany({ where: doTeste });
  await prisma.proposta.deleteMany({ where: doTeste });
  await prisma.cliente.deleteMany({ where: { codcli: CODEMP } });
  await prisma.faseProposta.deleteMany({ where: { fasid: CODEMP } });
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL_CONSULTOR, EMAIL_ADMIN] } } });
  await prisma.consultor.deleteMany({ where: doTeste });
}

async function main() {
  const jaExiste =
    (await prisma.atividadeConsultor.count({ where: { OR: [{ codemp: CODEMP }, { codfor: CODFOR }] } })) +
    (await prisma.consultor.count({ where: { OR: [{ codemp: CODEMP }, { codfor: CODFOR }] } })) +
    (await prisma.proposta.count({ where: { codemp: CODEMP } })) +
    (await prisma.user.count({ where: { email: { in: [EMAIL_CONSULTOR, EMAIL_ADMIN] } } }));
  if (jaExiste > 0) throw new Error(`Já há dados na empresa de teste ${CODEMP}; nada foi alterado. Confira antes de rodar de novo.`);

  const filaAntes = await prisma.sincronizacaoPendente.count();
  const [colunaAFazer, colunaEmAndamento] = await Promise.all([
    prisma.quadroColuna.findFirstOrThrow({ where: { nome: "A Fazer" } }),
    prisma.quadroColuna.findFirstOrThrow({ where: { nome: "Em Andamento" } }),
  ]);
  const [papelAdmin, papelComum] = await Promise.all([
    prisma.role.findFirstOrThrow({ where: { name: "admin" } }),
    prisma.role.findFirstOrThrow({ where: { name: { not: "admin" } }, orderBy: { id: "asc" } }),
  ]);

  let servidor: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  try {
    await prisma.cliente.create({
      data: {
        codcli: CODEMP, nomcli: "ZZ-TESTE Cliente", apecli: "ZZ", sencli: "", tipcli: "J", tipmer: "1", tipemc: 1, codram: "",
        insest: "", cgccpf: 0n, endcli: "", cplend: "", cepcli: 0, baicli: "", cidcli: "", sigufs: "SP", codpai: "BR",
      },
    });
    await prisma.faseProposta.create({ data: { fasid: CODEMP, fasdes: "ZZ-TESTE Fase" } });
    await prisma.proposta.create({
      data: { codemp: CODEMP, codpro: 1, codcli: CODEMP, numprj: 1, codfpj: 1, idcom: 1, codrep: 1, numped: 1 },
    });
    await prisma.consultor.create({
      data: { codemp: CODEMP, codusu: CODEMP, codfor: CODFOR, nomfor: "ZZ-TESTE Consultor", email: EMAIL_CONSULTOR },
    });
    const usuario = await prisma.user.create({ data: { email: EMAIL_CONSULTOR, nome: "ZZ-TESTE Consultor", roleId: papelComum.id } });
    const admin = await prisma.user.create({ data: { email: EMAIL_ADMIN, nome: "ZZ-TESTE Admin", roleId: papelAdmin.id } });
    const tokenConsultor = signToken({ userId: usuario.id, role: papelComum.name }, "15m");
    const tokenAdmin = signToken({ userId: admin.id, role: "admin" }, "15m");

    const atividades: number[] = [];
    for (const n of [1, 2, 3, 4]) {
      await prisma.propostaItem.create({
        data: { codemp: CODEMP, codpro: 1, seqite: n, numprj: 1, codser: "ZZ", codfpj: 1, depexe: 1, despro: `${NOME_ATIVIDADE} ${n}` },
      });
      const a = await prisma.atividadeConsultor.create({
        data: {
          codemp: CODEMP, codpro: 1, seqite: n, codfor: CODFOR, qtdhor: 100_000, sitreg: "A", fasid: CODEMP,
          colunaId: colunaAFazer.id, seqati: SEQATI_BASE + BigInt(n),
        },
      });
      atividades.push(a.id);
    }
    const [a1, a2, a3, a4] = atividades;

    const app = express();
    app.use(express.json());
    app.use(attachCorrelationId);
    app.use("/atividades", atividadesRouter);
    app.use("/apontamentos", apontamentosRouter);
    app.use("/solicitacoes-apontamento", solicitacoesApontamentoRouter);
    servidor = app.listen(0, "127.0.0.1");
    await new Promise<void>((ok) => servidor!.once("listening", () => ok()));
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    async function chamar(token: string, metodo: string, rota: string, corpo?: unknown): Promise<{ status: number; dados: any }> {
      const r = await fetch(base + rota, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const texto = await r.text();
      return { status: r.status, dados: texto ? JSON.parse(texto) : null };
    }
    const eu = (metodo: string, rota: string, corpo?: unknown) => chamar(tokenConsultor, metodo, rota, corpo);
    const outro = (metodo: string, rota: string, corpo?: unknown) => chamar(tokenAdmin, metodo, rota, corpo);

    const ultimaSessao = (atividadeId: number) =>
      prisma.atividadeSessaoExecucao.findFirstOrThrow({ where: { atividadeId, excluidaEm: null }, orderBy: { id: "desc" } });
    const abertas = () => prisma.atividadeSessaoExecucao.findMany({ where: { fim: null, atividade: { codemp: CODEMP } } });

    console.log("\n1. Parar a própria atividade exige descrição");
    let r = await eu("POST", `/atividades/${a1}/start`);
    conferir(r.status === 200, "inicia a atividade 1", r);
    r = await eu("POST", `/atividades/${a1}/stop`, {});
    conferir(r.status === 400 && r.dados.codigo === "descricao_invalida", "parar sem texto: 400", r);
    r = await eu("POST", `/atividades/${a1}/stop`, { observacao: `${NOME_ATIVIDADE} 1` });
    conferir(r.status === 400 && /não pode repetir/.test(r.dados.error), "parar repetindo a descrição da atividade: 400", r);
    r = await eu("POST", `/atividades/${a1}/stop`, { observacao: "reunião com o cliente" });
    conferir(r.status === 400 && /30 caracteres/.test(r.dados.error), "parar com menos de 30 caracteres: 400", r);
    r = await eu("PATCH", `/atividades/${a1}/mover`, { colunaId: colunaAFazer.id });
    conferir(r.status === 400 && r.dados.codigo === "descricao_invalida", "arrastar pra fora sem texto: 400", r);
    conferir((await abertas()).length === 1, "nenhuma recusa fechou a sessão");
    r = await eu("POST", `/atividades/${a1}/stop`, { observacao: TEXTO(1) });
    conferir(r.status === 200 && (await ultimaSessao(a1)).observacao === TEXTO(1), "parar com descrição válida grava o texto", r);

    console.log("\n2. Nota de progresso e outra atividade em andamento");
    r = await eu("POST", `/atividades/${a2}/start`);
    conferir(r.status === 200, "com tudo descrito, inicia a atividade 2", r);
    r = await outro("PATCH", `/atividades/${a2}/observacao`, { observacao: TEXTO(2) });
    conferir(r.status === 403, "quem não é o dono não escreve a nota: 403", r);
    r = await eu("PATCH", `/atividades/${a2}/observacao`, { observacao: "curta" });
    conferir(r.status === 400, "nota curta: 400", r);
    r = await eu("PATCH", `/atividades/${a2}/observacao`, { observacao: TEXTO(2) });
    conferir(r.status === 200, "nota válida salva", r);
    const sessaoDa2 = await ultimaSessao(a2);
    r = await eu("POST", `/atividades/${a1}/start`);
    conferir(
      r.status === 409 && r.dados.codigo === "descrever_em_andamento" && r.dados.emAndamento.sessaoId === sessaoDa2.id && r.dados.emAndamento.nota === TEXTO(2),
      "iniciar outra: 409 pedindo o que foi feito na que está em andamento",
      r
    );
    r = await eu("POST", `/atividades/${a1}/start`, { observacaoEmAndamento: "curta", sessaoEmAndamentoId: sessaoDa2.id });
    conferir(r.status === 400, "reenvio com descrição curta: 400", r);
    r = await eu("POST", `/atividades/${a1}/start`, { observacaoEmAndamento: TEXTO(3), sessaoEmAndamentoId: sessaoDa2.id + 999999 });
    conferir(r.status === 409 && r.dados.codigo === "descrever_em_andamento", "texto de outra sessão não é aproveitado: pergunta de novo", r);
    conferir((await abertas()).map((s) => s.id).join() === String(sessaoDa2.id), "a atividade 2 continua rodando");
    r = await eu("POST", `/atividades/${a1}/start`, { observacaoEmAndamento: TEXTO(3), sessaoEmAndamentoId: sessaoDa2.id });
    const pausada2 = await ultimaSessao(a2);
    conferir(r.status === 200 && pausada2.fim != null && pausada2.observacao === TEXTO(3), "com a descrição, pausa a outra e inicia", r);

    console.log("\n3. Quem não é o dono para sem descrever, e o consultor fica bloqueado até descrever");
    r = await outro("POST", `/atividades/${a1}/stop`, { observacao: "texto que o gestor tentou gravar pelo consultor" });
    const semDescricao = await ultimaSessao(a1);
    conferir(r.status === 200 && semDescricao.observacao === null, "admin para sem descrever; o texto dele é ignorado", { r, obs: semDescricao.observacao });
    r = await eu("POST", `/atividades/${a2}/start`);
    conferir(r.status === 409 && r.dados.codigo === "descricao_pendente" && r.dados.quantidade === 1 && r.dados.souOConsultor === true, "consultor: início bloqueado", r);
    r = await eu("PATCH", `/atividades/${a2}/mover`, { colunaId: colunaEmAndamento.id });
    conferir(r.status === 409 && r.dados.codigo === "descricao_pendente", "arrastar pra Em Andamento também é bloqueado", r);
    r = await outro("POST", `/atividades/${a2}/start`);
    conferir(r.status === 409 && r.dados.souOConsultor === false && /consultor desta atividade/.test(r.dados.error), "admin iniciando por ele também é bloqueado", r);
    conferir((await abertas()).length === 0, "nada ficou em execução");

    r = await eu("GET", "/apontamentos/sessoes-pendentes");
    const linha = r.dados?.sessoes?.find((s: any) => s.id === semDescricao.id);
    conferir(linha?.semDescricao === true && linha.descricaoAtividade === `${NOME_ATIVIDADE} 1`, "Meus Apontamentos marca a pendência e manda a descrição da atividade", linha);

    // Teto estourado nas atividades dos testes de recusa: mesmo se a regra falhasse, nada iria pra RAT.
    const duasHoras = (atividadeId: number) =>
      prisma.atividadeSessaoExecucao.findFirstOrThrow({ where: { atividadeId, excluidaEm: null }, orderBy: { id: "desc" } }).then((s) =>
        prisma.atividadeSessaoExecucao.update({ where: { id: s.id }, data: { inicio: new Date(s.fim!.getTime() - 2 * 3_600_000) } })
      );
    await duasHoras(a1);
    await prisma.atividadeConsultor.update({ where: { id: a1 }, data: { qtdhor: 1 } });

    console.log("\n4. Confirmar, lançar à mão e pedir horas avulsas exigem descrição");
    r = await eu("POST", "/apontamentos/confirmar", { sessaoId: semDescricao.id });
    conferir(r.status === 400 && r.dados.codigo === "descricao_invalida", "confirmar sem descrição: 400", r);
    r = await eu("POST", "/apontamentos/confirmar", { sessaoId: semDescricao.id, descricao: `${NOME_ATIVIDADE} 1` });
    conferir(r.status === 400 && r.dados.codigo === "descricao_invalida", "confirmar com a descrição da atividade: 400", r);
    r = await eu("POST", "/apontamentos/confirmar-lote", { itens: [{ sessaoId: semDescricao.id }] });
    conferir(r.status === 200 && r.dados.confirmados.length === 0 && /obrigatória/.test(r.dados.falhas[0]?.erro ?? ""), "em lote: vira falha com a mensagem", r);
    const antesDoManual = await prisma.atividadeSessaoExecucao.count({ where: { atividadeId: a1 } });
    r = await outro("POST", "/apontamentos/manual", { atividadeId: a1, inicio: "2026-01-05T09:00:00", fim: "2026-01-05T11:00:00", descricao: "curta" });
    conferir(r.status === 400 && (await prisma.atividadeSessaoExecucao.count({ where: { atividadeId: a1 } })) === antesDoManual, "manual com descrição curta: 400, sem sobrar sessão", r);
    r = await eu("POST", "/solicitacoes-apontamento", { atividadeId: a3, inicio: "2026-01-05T09:00:00", fim: "2026-01-05T10:00:00", motivo: "ZZ-TESTE", descricao: "curta" });
    conferir(r.status === 400 && r.dados.codigo === "descricao_invalida", "pedido de horas avulsas com descrição curta: 400", r);

    r = await eu("PATCH", `/apontamentos/${semDescricao.id}`, { desati: "curta" });
    conferir(r.status === 400, "editar com descrição curta: 400", r);
    r = await eu("PATCH", `/apontamentos/${semDescricao.id}`, { desati: TEXTO(4) });
    conferir(r.status === 200, "descreve em Meus Apontamentos", r);
    r = await eu("POST", `/atividades/${a2}/start`);
    conferir(r.status === 200, "descrito, volta a poder iniciar", r);

    console.log("\n5. Quem não é o dono inicia outra: pausa sem perguntar");
    r = await outro("POST", `/atividades/${a3}/start`);
    const pausadaPeloAdmin = await ultimaSessao(a2);
    conferir(r.status === 200 && pausadaPeloAdmin.fim != null && pausadaPeloAdmin.observacao === null, "admin inicia a 3; a 2 é pausada sem descrição", { r, obs: pausadaPeloAdmin.observacao });
    r = await eu("PATCH", `/apontamentos/${pausadaPeloAdmin.id}`, { desati: TEXTO(5) });
    conferir(r.status === 200, "consultor descreve a que foi pausada", r);

    console.log("\n6. Parada automática deixa a descrição vazia");
    const recuarInicio = async (atividadeId: number) => {
      await prisma.atividadeConsultor.update({ where: { id: atividadeId }, data: { qtdhor: 60 } });
      const s = await ultimaSessao(atividadeId);
      await prisma.atividadeSessaoExecucao.update({ where: { id: s.id }, data: { inicio: new Date(Date.now() - 3 * 3_600_000) } });
    };
    await recuarInicio(a3);
    r = await eu("POST", `/atividades/${a3}/encerrar-automatico`, { observacao: "texto que não pode ser gravado numa parada automática" });
    const automatica = await ultimaSessao(a3);
    conferir(r.status === 200 && r.dados.encerrada === true && automatica.observacao === null, "encerramento automático: sessão sem descrição", { r, obs: automatica.observacao });
    r = await eu("POST", `/atividades/${a4}/start`);
    conferir(r.status === 409 && r.dados.codigo === "descricao_pendente", "a parada automática passa a bloquear", r);
    await eu("PATCH", `/apontamentos/${automatica.id}`, { desati: TEXTO(6) });

    console.log("\n7. \"Encerrar agora\" no alerta de limite exige descrição");
    r = await eu("POST", `/atividades/${a4}/start`);
    conferir(r.status === 200, "inicia a atividade 4", r);
    await recuarInicio(a4);
    r = await eu("POST", `/atividades/${a4}/encerrar-automatico`, { imediato: true });
    conferir(r.status === 400 && r.dados.codigo === "descricao_invalida", "encerrar agora sem texto: 400", r);
    r = await eu("POST", `/atividades/${a4}/encerrar-automatico`, { imediato: true, observacao: TEXTO(7) });
    conferir(r.status === 200 && (await ultimaSessao(a4)).observacao === TEXTO(7), "encerrar agora com descrição grava o texto", r);

    console.log("\n8. Nada foi para o Senior");
    conferir((await prisma.ratItem.count({ where: { codemp: CODEMP } })) === 0, "nenhum item de RAT criado");
    conferir((await prisma.rat.count({ where: { codemp: CODEMP } })) === 0, "nenhuma RAT criada");
    conferir((await prisma.sincronizacaoPendente.count({ where: { atividadeId: { in: atividades } } })) === 0, `nada na fila de envio (fila geral antes: ${filaAntes})`);
  } finally {
    servidor?.close();
    await limpar();
  }

  const sobrou =
    (await prisma.atividadeConsultor.count({ where: { codemp: CODEMP } })) +
    (await prisma.consultor.count({ where: { codemp: CODEMP } })) +
    (await prisma.user.count({ where: { email: { in: [EMAIL_CONSULTOR, EMAIL_ADMIN] } } }));
  conferir(sobrou === 0, "dados de teste apagados");
  console.log(falhas === 0 ? "\nTodos os critérios verificados passaram." : `\n${falhas} critério(s) falharam.`);
}

main()
  .then(() => (process.exitCode = falhas === 0 ? 0 : 1))
  .catch((error) => {
    console.error("Erro ao rodar a verificação:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
