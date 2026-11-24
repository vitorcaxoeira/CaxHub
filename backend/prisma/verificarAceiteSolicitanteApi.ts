// Teste ponta a ponta do aceite do solicitante na cotação de viagem (status "aguardando_aceite").
// Sobe só o router /solicitacoes-viagem num Express mínimo, cria usuários temporários e apaga tudo
// no final. Roda num SCHEMA ISOLADO (nunca no `public`):
//   1. DATABASE_URL do .env com ?schema=viagem_aceite_e2e
//   2. criar o schema (CREATE SCHEMA viagem_aceite_e2e) e rodar `prisma migrate deploy` com essa URL
//   3. DATABASE_URL=<essa URL> node_modules/.bin/ts-node --transpile-only prisma/verificarAceiteSolicitanteApi.ts
//   4. DROP SCHEMA viagem_aceite_e2e CASCADE
import "dotenv/config";
import assert from "assert";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { solicitacoesViagemRouter } from "../src/routes/solicitacoesViagem";
import { garantirDiretorioUploads } from "../src/config/uploads";

const TAG = `vae${Date.now()}`;

if (!/schema=(?!public\b)[^&]+/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Recusado: rode num schema isolado (DATABASE_URL com ?schema=<outro que não public>). Veja o comentário no topo.");
  process.exit(1);
}

async function main() {
  garantirDiretorioUploads();
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/viagem", solicitacoesViagemRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/viagem`;

  // Só admin entra no módulo sem ser líder de departamento; os três papéis do fluxo são admins.
  const roleAdmin = await prisma.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin" } });
  const mk = (n: string) => prisma.user.create({ data: { email: `${TAG}-${n}@teste.local`, nome: `Teste ${n}`, roleId: roleAdmin.id, status: "ativo" } });
  const [solic, atend, gestor] = await Promise.all([mk("solicitante"), mk("atendente"), mk("gestor")]);
  const T = {
    solic: signToken({ userId: solic.id, role: "admin" }),
    atend: signToken({ userId: atend.id, role: "admin" }),
    gestor: signToken({ userId: gestor.id, role: "admin" }),
  };

  async function api(quem: keyof typeof T, metodo: string, rota: string, corpo?: unknown) {
    const r = await fetch(base + rota, {
      method: metodo,
      headers: { Authorization: `Bearer ${T[quem]}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
  }
  const passo = (msg: string) => console.log(`  ✔ ${msg}`);

  const pedido = (cidade: string) => ({
    finalidade: "interna",
    motivo: `Teste ${cidade}`,
    dataInicio: "2026-11-10",
    dataFim: "2026-11-12",
    cidadesDestino: cidade,
    viajantes: [{ nome: "Fulano de Tal", cpf: "" }],
    itens: [{ tipo: "hospedagem", viajantes: [0], cidade, dataInicio: "2026-11-10", dataFim: "2026-11-12" }],
  });

  // Cria a solicitação, assume e deixa uma cotação selecionada (pronta pra enviar).
  async function prepararCotada(cidade: string) {
    const criar = await api("solic", "POST", "/", pedido(cidade));
    assert.equal(criar.status, 201, JSON.stringify(criar.corpo));
    const id = criar.corpo.id as number;
    assert.equal((await api("atend", "POST", `/${id}/assumir`)).status, 200);
    const cot = await api("atend", "POST", `/${id}/cotacoes`, { fornecedor: "Hotel A", valor: 900 });
    assert.equal(cot.status, 201);
    const cotId = cot.corpo.solicitacao.cotacoes[0].id as number;
    assert.equal((await api("atend", "POST", `/${id}/cotacoes/${cotId}/selecionar`, { selecionada: true })).status, 200);
    return id;
  }

  try {
    // --- antes da cotação ---
    const criar = await api("solic", "POST", "/", pedido("São Paulo"));
    const id = criar.corpo.id as number;
    const url = (s: string) => `/${id}/${s}`;
    const estado = async (quem: keyof typeof T) => (await api(quem, "GET", `/${id}`)).corpo.solicitacao;

    assert.equal((await api("atend", "POST", url("enviar-aceite"))).status, 409, "enviar-aceite em 'solicitada' deve dar 409");
    assert.equal((await api("atend", "POST", url("assumir"))).status, 200);
    assert.equal((await api("atend", "POST", url("enviar-aceite"))).status, 400, "sem cotação selecionada deve dar 400");
    passo("enviar-aceite recusado sem cotação selecionada");

    const cot = await api("atend", "POST", url("cotacoes"), { fornecedor: "Hotel A", valor: 900 });
    const cotId = cot.corpo.solicitacao.cotacoes[0].id as number;
    await api("atend", "POST", url(`cotacoes/${cotId}/selecionar`), { selecionada: true });

    // --- quem pode enviar ---
    assert.equal((await estado("atend")).pode.enviarAceite, true);
    assert.equal((await estado("solic")).pode.enviarAceite, false);
    assert.equal((await api("solic", "POST", url("enviar-aceite"))).status, 400, "o próprio solicitante não envia pra si mesmo");
    passo("não dá pra enviar o aceite pra si mesmo (flag e servidor)");

    // --- envio ao solicitante ---
    const env = await api("atend", "POST", url("enviar-aceite"));
    assert.equal(env.status, 200, JSON.stringify(env.corpo));
    assert.equal(env.corpo.solicitacao.status, "aguardando_aceite");
    passo("enviar-aceite → aguardando_aceite");
    assert.equal((await api("atend", "POST", url("enviar-aceite"))).status, 409, "2º envio deve dar 409");
    assert.equal((await api("atend", "POST", url("enviar-aprovacao"))).status, 409, "enviar-aprovacao em aguardando_aceite deve dar 409");
    assert.equal((await api("atend", "POST", url("cotacoes"), { fornecedor: "X", valor: 1 })).status, 409, "cotação travada em aguardando_aceite");
    assert.equal((await estado("atend")).pode.editar, false, "atendimento não edita em aguardando_aceite");
    passo("cotações e edição travadas, duplicidade → 409");

    assert.ok(await prisma.notificacao.findFirst({ where: { userId: solic.id, tipo: "viagem_aguardando_aceite", solicitacaoViagemId: id } }), "solicitante deve ser notificado");
    passo("solicitante notificado");

    // --- quem responde ---
    assert.equal((await estado("solic")).pode.responderAceite, true);
    assert.equal((await estado("atend")).pode.responderAceite, false);
    assert.equal((await api("atend", "POST", url("responder-aceite"), { acao: "aceitar" })).status, 403, "só o solicitante responde (nem outro admin)");
    assert.equal((await api("gestor", "POST", url("responder-aceite"), { acao: "aceitar" })).status, 403);
    assert.equal((await api("solic", "POST", url("responder-aceite"), { acao: "talvez" })).status, 400);
    passo("só o solicitante responde; ação inválida → 400");

    // --- recusa: motivo obrigatório ---
    assert.equal((await api("solic", "POST", url("responder-aceite"), { acao: "recusar" })).status, 400, "recusa sem motivo deve dar 400");
    assert.equal((await api("solic", "POST", url("responder-aceite"), { acao: "recusar", observacao: "   " })).status, 400);
    const rec = await api("solic", "POST", url("responder-aceite"), { acao: "recusar", observacao: "Hotel longe do cliente" });
    assert.equal(rec.status, 200, JSON.stringify(rec.corpo));
    assert.equal(rec.corpo.solicitacao.status, "em_cotacao");
    assert.equal(rec.corpo.solicitacao.aceiteDecisao, "recusada");
    assert.equal(rec.corpo.solicitacao.aceiteObservacao, "Hotel longe do cliente");
    assert.equal((await api("solic", "POST", url("responder-aceite"), { acao: "recusar", observacao: "de novo" })).status, 409, "2º clique → 409");
    passo("recusa exige motivo e volta para em_cotacao guardando o motivo");
    assert.ok(await prisma.notificacao.findFirst({ where: { userId: atend.id, tipo: "viagem_recusada", solicitacaoViagemId: id } }), "atendente responsável notificado da recusa");
    passo("atendente notificado da recusa");

    // --- reenvia e aceita SEM motivo ---
    assert.equal((await api("atend", "POST", url("enviar-aceite"))).status, 200);
    assert.equal((await estado("atend")).aceiteDecisao, null, "novo envio zera a resposta anterior");
    const ok = await api("solic", "POST", url("responder-aceite"), { acao: "aceitar" });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.solicitacao.status, "aguardando_aprovacao");
    assert.equal(ok.corpo.solicitacao.aceiteDecisao, "aceita");
    assert.equal(ok.corpo.solicitacao.aceiteObservacao, null);
    passo("aceitar sem motivo → aguardando_aprovacao");
    assert.ok(await prisma.notificacao.findFirst({ where: { userId: gestor.id, tipo: "viagem_aguardando_aprovacao", solicitacaoViagemId: id } }), "aprovador notificado");
    assert.ok(await prisma.notificacao.findFirst({ where: { userId: atend.id, tipo: "viagem_aceita", solicitacaoViagemId: id } }), "atendente notificado do aceite");
    passo("aprovador e atendente notificados do aceite");

    // --- o gestor segue o fluxo normal ---
    const apr = await api("gestor", "POST", url("decidir"), { acao: "aprovar" });
    assert.equal(apr.status, 200, JSON.stringify(apr.corpo));
    assert.equal(apr.corpo.solicitacao.status, "aprovada");
    passo("gestor aprova normalmente depois do aceite");

    // --- devolver do gestor abre rodada nova: zera a resposta anterior ---
    const id2 = await prepararCotada("Rio");
    await api("atend", "POST", `/${id2}/enviar-aceite`);
    await api("solic", "POST", `/${id2}/responder-aceite`, { acao: "aceitar", observacao: "ok" });
    const dev = await api("gestor", "POST", `/${id2}/decidir`, { acao: "devolver", observacao: "Caro demais" });
    assert.equal(dev.corpo.solicitacao.status, "em_cotacao");
    assert.equal(dev.corpo.solicitacao.aceiteDecisao, null, "devolver do gestor zera o aceite da rodada anterior");
    passo("devolver do gestor zera a resposta do solicitante");

    // --- caminho direto, sem passar pelo solicitante, continua valendo ---
    const dir = await api("atend", "POST", `/${id2}/enviar-aprovacao`);
    assert.equal(dir.status, 200, JSON.stringify(dir.corpo));
    assert.equal(dir.corpo.solicitacao.status, "aguardando_aprovacao");
    passo("enviar-aprovacao direto ao gestor continua funcionando");

    // --- solicitante cancela enquanto espera o aceite ---
    const id3 = await prepararCotada("BH");
    await api("atend", "POST", `/${id3}/enviar-aceite`);
    const antesCancelar = (await api("solic", "GET", `/${id3}`)).corpo.solicitacao;
    assert.equal(antesCancelar.status, "aguardando_aceite");
    assert.equal(antesCancelar.pode.cancelar, true);
    assert.equal((await api("solic", "POST", `/${id3}/cancelar`, { motivo: "Desisti" })).status, 200);
    passo("solicitante cancela enquanto aguarda o aceite");

    // --- lista: o status novo filtra ---
    const id4 = await prepararCotada("Curitiba");
    await api("atend", "POST", `/${id4}/enviar-aceite`);
    const lista = await api("solic", "GET", "/?escopo=minhas&status=aguardando_aceite");
    assert.ok(lista.corpo.solicitacoes.some((x: { id: number }) => x.id === id4), "filtro por aguardando_aceite deve achar a solicitação");
    assert.ok(lista.corpo.kpis.aguardando_aceite >= 1);
    passo("filtro e KPI do status novo na lista");

    // --- auditoria ---
    const eventos = await prisma.auditEvento.findMany({ where: { entidadeTipo: "solicitacao_viagem", entidadeId: String(id) }, select: { eventoTipo: true } });
    const tipos = eventos.map((e) => e.eventoTipo);
    for (const t of ["VIAGEM_ENVIADA_ACEITE", "VIAGEM_RECUSADA_SOLICITANTE", "VIAGEM_ACEITA_SOLICITANTE"]) assert.ok(tipos.includes(t), `auditoria sem ${t}: ${tipos}`);
    passo("auditoria registrou enviada, recusada e aceita");

    console.log("\nOK — fluxo do aceite do solicitante validado.");
  } finally {
    await prisma.solicitacaoViagem.deleteMany({ where: { solicitante: { email: { startsWith: TAG } } } });
    await prisma.notificacao.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    server.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
