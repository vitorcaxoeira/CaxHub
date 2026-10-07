// Teste ponta a ponta do serviço "Outros" (pedido simples de material/equipamento) nas solicitações:
// sem cotação, aceite, aprovação nem reserva; o atendimento assume e conclui; o "para quem" acompanha desde
// a abertura, só leitura. Sobe os routers /solicitacoes-viagem e /dashboard num Express mínimo e apaga tudo
// no final. Roda num SCHEMA ISOLADO (nunca no `public`):
//   1. DATABASE_URL do .env com ?schema=viagem_outros_e2e
//   2. criar o schema (CREATE SCHEMA viagem_outros_e2e) e rodar `prisma migrate deploy` com essa URL
//   3. DATABASE_URL=<essa URL> node_modules/.bin/ts-node --transpile-only prisma/verificarOutrosApi.ts
//   4. DROP SCHEMA viagem_outros_e2e CASCADE
import "dotenv/config";
import assert from "assert";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { solicitacoesViagemRouter } from "../src/routes/solicitacoesViagem";
import { dashboardRouter } from "../src/routes/dashboard";
import { garantirDiretorioUploads } from "../src/config/uploads";

const TAG = `vou${Date.now()}`;

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
  app.use("/dashboard", dashboardRouter);
  const server = app.listen(0);
  const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const roleAdmin = await prisma.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin" } });
  const roleCons = await prisma.role.upsert({ where: { name: "consultoria" }, update: {}, create: { name: "consultoria" } });
  const mk = (n: string, roleId: number) => prisma.user.create({ data: { email: `${TAG}-${n}@teste.local`, nome: `Teste ${n}`, roleId, status: "ativo" } });
  const [solic, atend, colab, outro] = await Promise.all([mk("solicitante", roleAdmin.id), mk("atendente", roleAdmin.id), mk("colaborador", roleCons.id), mk("outro", roleCons.id)]);
  const T = {
    solic: signToken({ userId: solic.id, role: "admin" }),
    atend: signToken({ userId: atend.id, role: "admin" }),
    colab: signToken({ userId: colab.id, role: "consultoria" }),
    outro: signToken({ userId: outro.id, role: "consultoria" }),
  };

  async function api(quem: keyof typeof T, metodo: string, rota: string, corpo?: unknown, prefixo = "/viagem") {
    const r = await fetch(host + prefixo + rota, {
      method: metodo,
      headers: { Authorization: `Bearer ${T[quem]}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* corpo não JSON */
    }
    return { status: r.status, corpo: json };
  }
  const passo = (msg: string) => console.log(`  ✔ ${msg}`);

  const itemOutro = (descricao: string, quantidade: number) => ({ tipo: "outro", viajantes: [0], descricao, quantidade });
  const pedido = (extra: Record<string, unknown> = {}) => ({
    finalidade: "interna",
    motivo: "Colaborador novo precisa de equipamento",
    dataFim: "2026-11-20",
    viajantes: [{ userId: colab.id, nome: "Teste colaborador", cpf: "" }],
    itens: [itemOutro("Teclado ABNT2", 1), itemOutro('Monitor 24"', 2)],
    ...extra,
  });

  try {
    // --- validação ---
    const misto = await api("solic", "POST", "/", pedido({ cidadesDestino: "SP", dataInicio: "2026-11-10", itens: [itemOutro("Teclado", 1), { tipo: "hospedagem", viajantes: [0], cidade: "SP", dataInicio: "2026-11-10", dataFim: "2026-11-12" }] }));
    assert.equal(misto.status, 400);
    assert.ok(String(misto.corpo.error).includes("Outros não pode ser combinado"), misto.corpo.error);
    assert.equal((await api("solic", "POST", "/", pedido({ itens: [itemOutro("", 1)] }))).status, 400, "descrição obrigatória");
    assert.equal((await api("solic", "POST", "/", pedido({ itens: [itemOutro("Mouse", 0)] }))).status, 400, "quantidade mínima 1");
    assert.equal((await api("solic", "POST", "/", pedido({ itens: [itemOutro("Mouse", 1.5)] }))).status, 400, "quantidade inteira");
    assert.equal((await api("solic", "POST", "/", pedido({ dataFim: undefined }))).status, 400, "prazo obrigatório");
    assert.equal((await api("solic", "POST", "/", pedido({ viajantes: [] }))).status, 400, "para quem obrigatório");
    assert.equal((await api("solic", "POST", "/", pedido({ motivo: "" }))).status, 400, "justificativa obrigatória");
    passo("não mistura com viagem; descrição, quantidade, prazo, para quem e justificativa validados");

    // --- criação ---
    const criar = await api("solic", "POST", "/", pedido());
    assert.equal(criar.status, 201, JSON.stringify(criar.corpo));
    const id = criar.corpo.id as number;
    const u = (s: string) => `/${id}/${s}`;
    const det = (await api("atend", "GET", `/${id}`)).corpo.solicitacao;
    assert.equal(det.tipo, "outros");
    assert.equal(det.status, "solicitada");
    assert.equal(det.cidadesDestino, "");
    assert.equal(det.dataInicio, det.dataFim, "pedido guarda só o prazo (dataInicio acompanha dataFim)");
    assert.equal(det.itens.length, 2);
    assert.deepEqual(det.itens.map((i: { descricao: string; quantidade: number }) => [i.descricao, i.quantidade]), [["Teclado ABNT2", 1], ['Monitor 24"', 2]]);
    assert.equal(det.pode.assumir, true);
    assert.ok(!det.pode.cotar && !det.pode.enviarAprovacao && !det.pode.enviarAceite && !det.pode.reservar && !det.pode.decidir && !det.pode.concluir, JSON.stringify(det.pode));
    passo("pedido Outros criado (tipo, itens, prazo) e sem ações de viagem");

    // --- notificações de abertura ---
    const nAtend = await prisma.notificacao.findFirst({ where: { userId: atend.id, tipo: "viagem_solicitada", solicitacaoViagemId: id } });
    assert.ok(nAtend && nAtend.mensagem.includes("pedido #") && nAtend.mensagem.includes("Teclado ABNT2"), nAtend?.mensagem);
    const nColab = await prisma.notificacao.findFirst({ where: { userId: colab.id, tipo: "viagem_pedido_para_voce", solicitacaoViagemId: id } });
    assert.ok(nColab, "o colaborador é avisado de que pediram algo pra ele, com link");
    passo("atendimento e colaborador notificados na abertura");

    // --- o "para quem" acompanha desde a abertura, só leitura ---
    assert.equal((await api("colab", "GET", "/?escopo=minhas")).corpo.solicitacoes.some((x: { id: number }) => x.id === id), true, "colaborador vê o pedido já em 'solicitada'");
    const dcolab = await api("colab", "GET", `/${id}`);
    assert.equal(dcolab.status, 200);
    assert.ok(Object.values(dcolab.corpo.solicitacao.pode).every((v) => v === false), JSON.stringify(dcolab.corpo.solicitacao.pode));
    assert.equal((await api("colab", "GET", "/meu-perfil", undefined, "/dashboard")).corpo.viajante, true, "menu libera 'Minhas Solicitações' ao colaborador");
    assert.equal((await api("outro", "GET", `/${id}`)).status, 403, "quem não é do pedido não abre");
    assert.equal((await api("colab", "POST", u("concluir"))).status, 403, "colaborador não conclui");
    assert.equal((await api("colab", "POST", u("cancelar"), { motivo: "x" })).status, 403, "colaborador não cancela");
    const resumo = (await api("colab", "GET", "/?escopo=minhas")).corpo.solicitacoes.find((x: { id: number }) => x.id === id);
    assert.equal(resumo.tipo, "outros");
    assert.equal(resumo.resumoItens.length, 2);
    passo("colaborador acompanha desde a abertura, só leitura, e a lista traz o resumo dos itens");

    // --- o que não se aplica a Outros ---
    for (const [metodo, rota, corpo] of [
      ["POST", u("enviar-aceite"), undefined],
      ["POST", u("enviar-aprovacao"), undefined],
      ["POST", u("decidir"), { acao: "aprovar" }],
      ["POST", u("reservar"), undefined],
      ["POST", u("cotacoes"), { fornecedor: "X", valor: 10 }],
      ["PUT", `/${id}/itens/${det.itens[0].id}/reserva`, { localizador: "A", valorReservado: 1 }],
    ] as [string, string, unknown][]) {
      const r = await api("atend", metodo, rota, corpo);
      assert.equal(r.status, 409, `${metodo} ${rota} deveria dar 409, deu ${r.status}: ${JSON.stringify(r.corpo)}`);
    }
    passo("aceite, aprovação, decisão, reserva e cotação → 409 em pedido Outros");

    // --- atendimento ---
    assert.equal((await api("atend", "POST", u("concluir"))).status, 409, "não conclui antes de assumir");
    const assumiu = await api("atend", "POST", u("assumir"));
    assert.equal(assumiu.status, 200);
    assert.equal(assumiu.corpo.solicitacao.status, "em_cotacao");
    assert.equal(assumiu.corpo.solicitacao.pode.concluir, true);
    assert.equal(assumiu.corpo.solicitacao.pode.cotar, false);
    assert.equal((await api("colab", "GET", `/${id}`)).status, 200, "colaborador segue vendo em atendimento");
    const concl = await api("atend", "POST", u("concluir"));
    assert.equal(concl.status, 200, JSON.stringify(concl.corpo));
    assert.equal(concl.corpo.solicitacao.status, "finalizada");
    assert.equal((await api("atend", "POST", u("concluir"))).status, 409, "2º clique → 409");
    passo("assumir → em atendimento → concluir (finalizada); 2º clique → 409");

    assert.ok(await prisma.notificacao.findFirst({ where: { userId: solic.id, tipo: "viagem_concluida", solicitacaoViagemId: id } }), "solicitante avisado da conclusão");
    assert.ok(await prisma.notificacao.findFirst({ where: { userId: colab.id, tipo: "viagem_concluida", solicitacaoViagemId: id } }), "colaborador avisado da conclusão, com link");
    passo("solicitante e colaborador notificados da conclusão");

    const evento = await prisma.auditEvento.findFirst({ where: { entidadeTipo: "solicitacao_viagem", entidadeId: String(id), eventoTipo: "VIAGEM_FINALIZADA" } });
    assert.equal(evento?.entidadeRotulo, `Pedido #${id}`, "o histórico fala 'Pedido', não 'Viagem'");
    const aberto = await prisma.auditEvento.findFirst({ where: { entidadeTipo: "solicitacao_viagem", entidadeId: String(id), eventoTipo: "VIAGEM_SOLICITADA" } });
    const meta = aberto?.metadata as { descricoes?: string[]; viajantes?: number } | null;
    assert.deepEqual(meta?.descricoes, ["Teclado ABNT2 ×1", 'Monitor 24" ×2'], "o histórico guarda o que foi pedido");
    passo("auditoria rotula como Pedido e guarda as descrições dos itens");

    // --- filtro de término: pendente nunca some; concluído com prazo passado some ---
    const pend = (await api("solic", "POST", "/", pedido({ dataFim: "2026-10-01" }))).corpo.id as number;
    const pass = (await api("solic", "POST", "/", pedido({ dataFim: "2026-10-01", itens: [itemOutro("Cadeira", 1)] }))).corpo.id as number;
    await api("atend", "POST", `/${pass}/assumir`);
    await api("atend", "POST", `/${pass}/concluir`);
    const filtrada = await api("colab", "GET", "/?escopo=minhas&de=2026-10-07");
    const ids = filtrada.corpo.solicitacoes.map((x: { id: number }) => x.id);
    assert.ok(ids.includes(pend), "pedido pendente com prazo vencido continua aparecendo");
    assert.ok(!ids.includes(pass), "pedido concluído com prazo vencido sai da tela");
    assert.ok(ids.includes(id), "concluído com prazo futuro continua");
    assert.ok((await api("colab", "GET", "/?escopo=minhas")).corpo.solicitacoes.some((x: { id: number }) => x.id === pass), "sem data, o histórico volta");
    passo("filtro de término: pendente vencido fica, concluído vencido sai, sem data volta tudo");

    // --- busca pelo item ---
    const busca = await api("atend", "GET", "/?escopo=atendimento&q=Cadeira");
    assert.ok(busca.corpo.solicitacoes.some((x: { id: number }) => x.id === pass), "busca encontra pelo texto do item");
    passo("busca pelo texto do item");

    // --- cancelamento ---
    const canc = await api("atend", "POST", `/${pend}/cancelar`, { motivo: "Já comprado" });
    assert.equal(canc.status, 200);
    assert.equal((await api("colab", "GET", `/${pend}`)).status, 403, "cancelado deixa de ser visível ao colaborador");
    const aviso = await prisma.notificacao.findFirst({ where: { userId: colab.id, tipo: "viagem_cancelada_viajante" } });
    assert.ok(aviso && aviso.solicitacaoViagemId === null && aviso.mensagem.includes("Seu pedido") && aviso.mensagem.includes("Já comprado"), aviso?.mensagem);
    passo("cancelado some pro colaborador; aviso com motivo e sem link");

    console.log("\nOK — serviço Outros validado.");
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
