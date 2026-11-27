// Verificação do reenvio da criação de alocação que nasceu sem horas (caso da alocação 491325,
// 27/11/2026): sync/outboxSenior.ts (`reviverCriacaoInvalida`) e POST /api/sincronizacao/:id/reprocessar.
// NÃO chama o ERP: `alocarAtividades` é trocado por um dublê. Não é suíte automatizada.
//
// Uso, só contra um banco DESCARTÁVEL (a fila é disparada de verdade):
//   PERMITIR_TESTE_DB=1 SOAP_URL=http://127.0.0.1:1/ DATABASE_URL=postgresql://postgres@127.0.0.1:PORTA/BANCO \
//   JWT_SECRET=teste node_modules/.bin/ts-node prisma/verificarRevivalCriacao.ts
import express from "express";
import { Prisma } from "@prisma/client";
import * as soap from "../src/soap/client";

const url = process.env.DATABASE_URL ?? "";
if (process.env.NODE_ENV === "production" || process.env.PERMITIR_TESTE_DB !== "1" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Recusando rodar: exige PERMITIR_TESTE_DB=1 e DATABASE_URL local, fora de produção.");
  process.exit(1);
}

const enviados: soap.AlocarAtividadesPayload[] = [];
let proximoSeqAti = 90000;
let seqAtiForcado: number | null = null;
(soap as { alocarAtividadesViaSoap: unknown }).alocarAtividadesViaSoap = async (payload: soap.AlocarAtividadesPayload) => {
  enviados.push(payload);
  const seqAti = seqAtiForcado ?? ++proximoSeqAti;
  return { statusProcesso: 1, resultados: [{ ideExt: payload.ideExt, itens: [{ ideExt: payload.ideExt, seqAti, msg: null }] }] };
};

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require("../src/db/prisma") as typeof import("../src/db/prisma");
const outbox = require("../src/sync/outboxSenior") as typeof import("../src/sync/outboxSenior");
const regras = require("../src/sync/regrasFilaSenior") as typeof import("../src/sync/regrasFilaSenior");
const { sincronizacaoRouter } = require("../src/routes/sincronizacao") as typeof import("../src/routes/sincronizacao");
const { signToken } = require("../src/auth/jwt") as typeof import("../src/auth/jwt");

let falhas = 0;
function assert(condicao: boolean, mensagem: string) {
  if (condicao) console.log(`  OK: ${mensagem}`);
  else {
    console.error(`  FALHOU: ${mensagem}`);
    falhas++;
  }
}

const FASE = 999001;
const CODPRO = 999001;

// Preenche com qualquer valor as colunas obrigatórias que não interessam a este teste.
function preencherObrigatorios(modelo: string, fixos: Record<string, unknown>): Record<string, unknown> {
  const padrao: Record<string, unknown> = { Int: 1, BigInt: 1n, Float: 0, Decimal: 0, String: "T", Boolean: false, DateTime: new Date() };
  const campos = Prisma.dmmf.datamodel.models.find((m) => m.name === modelo)!.fields;
  const dados = campos
    .filter((c) => c.kind === "scalar" && c.isRequired && !c.hasDefaultValue && !c.isUpdatedAt)
    .map((c) => [c.name, padrao[c.type]]);
  return { ...Object.fromEntries(dados), ...fixos };
}

async function main() {
  // A auditoria do envio tem FK pra proposta, e a proposta pra cliente: as duas precisam existir.
  const chaveProposta = { codemp: 1, codpro: CODPRO };
  await prisma.cliente.create({ data: preencherObrigatorios("Cliente", { codcli: CODPRO }) as never });
  await prisma.proposta.create({ data: preencherObrigatorios("Proposta", { ...chaveProposta, codcli: CODPRO }) as never });
  await prisma.faseProposta.upsert({ where: { fasid: FASE }, create: { fasid: FASE, fasdes: "TESTE" }, update: {} });

  const alocacao = (codfor: number, qtdhor: number | null, extra: { seqati?: bigint; sitreg?: string } = {}) =>
    prisma.atividadeConsultor.create({ data: { codemp: 1, codpro: CODPRO, seqite: 1, codfor, qtdhor, fasid: FASE, sitreg: "A", ...extra } });
  const pendencia = (atividadeId: number, tipo: string, status: string, ultimoErro: string | null = null) =>
    prisma.sincronizacaoPendente.create({ data: { atividadeId, tipo, status, ultimoErro, payload: { qtdhor: null } } });
  const ler = (id: number) => prisma.sincronizacaoPendente.findUniqueOrThrow({ where: { id } });
  const maisRecente = (atividadeId: number) =>
    prisma.sincronizacaoPendente.findFirst({
      where: { atividadeId, ...regras.FILTRO_SEM_EDICAO_SUBSTITUIDA },
      orderBy: { id: "desc" },
    });
  // Espera a fila única esvaziar (o disparo imediato é fire-and-forget).
  const esvaziar = () => outbox.processarFilaSincronizacao({ apenasIds: [-1] });

  const app = express();
  app.use(express.json());
  app.use("/s", sincronizacaoRouter);
  const servidor = app.listen(0);
  const porta = (servidor.address() as { port: number }).port;
  const token = signToken({ userId: 999999, role: "admin" });
  const reprocessarPelaTela = async (id: number) => {
    const r = await fetch(`http://127.0.0.1:${porta}/s/${id}/reprocessar`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, corpo: (await r.json()) as { error?: string } };
  };

  try {
    console.log("1) caso 491325: criação inválida + edições bloqueadas, consultor com irmã no item; botão da tela");
    await alocacao(114, 60, { seqati: 14423n });
    const presa = await alocacao(114, 1205);
    const criacao = await pendencia(presa.id, "criar_atividade", "invalido");
    const e1 = await pendencia(presa.id, "editar_atividade", "bloqueado", "bloqueio antigo");
    const e2 = await pendencia(presa.id, "editar_atividade", "bloqueado", "bloqueio antigo");
    assert((await maisRecente(presa.id))?.id === e2.id, "antes: a pendência mais recente é a edição bloqueada");
    const r1 = await reprocessarPelaTela(criacao.id);
    assert(r1.status === 200, `reprocessar da criação inválida responde 200 (${r1.status} ${r1.corpo.error ?? ""})`);
    assert(enviados.length === 1 && enviados[0].tipEve === "I", "saiu exatamente 1 envio, um Incluir");
    assert(enviados[0].itens[0].qtdHor === "20:05" && enviados[0].itens[0].seqAti === undefined, "com as horas atuais (20:05) e sem seqAti");
    assert((await ler(criacao.id)).status === "enviado", "criação ficou enviada");
    assert((await prisma.atividadeConsultor.findUnique({ where: { id: presa.id } }))?.seqati === 90001n, "seqAti gravado na alocação");
    for (const e of [e1, e2]) {
      const depois = await ler(e.id);
      assert(depois.status === "invalido" && /^Substituída/.test(depois.ultimoErro ?? ""), `edição ${e.id} encerrada como substituída`);
    }
    assert((await maisRecente(presa.id))?.id === criacao.id, "depois: quem lê a mais recente vê a criação, não a substituída");
    assert((await reprocessarPelaTela(criacao.id)).status === 400, "reprocessar uma enviada é recusado");
    assert((await reprocessarPelaTela(e1.id)).status === 400, "reprocessar edição substituída é recusado");

    console.log("2) editar a alocação que ganhou horas revive a criação e não cria edição");
    const nova = await alocacao(114, 480);
    const criacaoNova = await pendencia(nova.id, "criar_atividade", "invalido");
    const antes = enviados.length;
    const devolvido = await outbox.enfileirar(nova.id, "editar_atividade", { qtdhor: 480 });
    await esvaziar();
    assert(devolvido === criacaoNova.id, "enfileirar devolve o id da criação");
    assert((await prisma.sincronizacaoPendente.count({ where: { atividadeId: nova.id } })) === 1, "nenhuma pendência de edição nasceu");
    assert(enviados.length === antes + 1 && enviados[antes].tipEve === "I", "saiu 1 Incluir");
    assert((await ler(criacaoNova.id)).status === "enviado", "criação enviada");
    assert((await ler(criacaoNova.id)).payload !== null && (( await ler(criacaoNova.id)).payload as { qtdhor: number }).qtdhor === 480, "retrato atualizado com as horas");

    console.log("3) duas edições ao mesmo tempo: um Incluir só");
    const dupla = await alocacao(500, 120);
    await pendencia(dupla.id, "criar_atividade", "invalido");
    const antesDupla = enviados.length;
    await Promise.all([
      outbox.enfileirar(dupla.id, "editar_atividade", { qtdhor: 120 }),
      outbox.enfileirar(dupla.id, "editar_atividade", { qtdhor: 120 }),
    ]);
    await esvaziar();
    await esvaziar();
    assert(enviados.slice(antesDupla).filter((p) => p.tipEve === "I").length === 1, "exatamente um Incluir");

    console.log("4) recusas: nada é enviado");
    const antesRecusas = enviados.length;
    const semHoras = await alocacao(600, null);
    const cSemHoras = await pendencia(semHoras.id, "criar_atividade", "invalido");
    const comSeqati = await alocacao(601, 60, { seqati: 777n });
    const cComSeqati = await pendencia(comSeqati.id, "criar_atividade", "invalido");
    const manual = await alocacao(602, 60);
    const cManual = await pendencia(manual.id, "criar_atividade", "invalido", "duplicada, não enviar");
    const inativa = await alocacao(603, 60, { sitreg: "I" });
    const cInativa = await pendencia(inativa.id, "criar_atividade", "invalido");
    for (const [rotulo, id] of [["sem horas", cSemHoras.id], ["com seqAti", cComSeqati.id], ["invalidada à mão", cManual.id], ["inativa", cInativa.id]] as const) {
      const r = await reprocessarPelaTela(id);
      assert(r.status === 400 && !!r.corpo.error, `${rotulo}: 400 com explicação`);
      assert((await ler(id)).status === "invalido", `${rotulo}: segue inválida`);
    }
    assert((await maisRecente(semHoras.id))?.id === cSemHoras.id, "filtro não esconde a inválida sem motivo");
    assert((await maisRecente(manual.id))?.id === cManual.id, "filtro não esconde a inválida com motivo manual");
    assert((await outbox.reviverCriacaoInvalida(manual.id)) === null, "edição não revive criação invalidada à mão");
    assert(enviados.length === antesRecusas, "nenhum envio ao Senior");

    console.log("5) Senior devolve o seqAti de uma irmã: bloqueia sem gravar");
    const vitima = await alocacao(700, 60, { seqati: 55555n });
    const outra = await alocacao(700, 60);
    const cOutra = await pendencia(outra.id, "criar_atividade", "invalido");
    seqAtiForcado = 55555;
    await reprocessarPelaTela(cOutra.id);
    seqAtiForcado = null;
    const bloqueada = await ler(cOutra.id);
    assert(bloqueada.status === "bloqueado" && (bloqueada.ultimoErro ?? "").includes(String(vitima.id)), "bloqueada citando a alocação dona");
    assert((await prisma.atividadeConsultor.findUnique({ where: { id: outra.id } }))?.seqati === null, "sem write-back");
  } finally {
    servidor.close();
    const ids = (await prisma.atividadeConsultor.findMany({ where: { codpro: CODPRO }, select: { id: true } })).map((a) => a.id);
    await prisma.sincronizacaoPendente.deleteMany({ where: { atividadeId: { in: ids } } });
    await prisma.atividadeConsultor.deleteMany({ where: { id: { in: ids } } });
    await prisma.auditEvento.deleteMany({ where: { codemp: 1, codpro: CODPRO } });
    await prisma.proposta.delete({ where: { codemp_codpro: chaveProposta } });
    await prisma.cliente.delete({ where: { codcli: CODPRO } });
    await prisma.faseProposta.delete({ where: { fasid: FASE } });
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
