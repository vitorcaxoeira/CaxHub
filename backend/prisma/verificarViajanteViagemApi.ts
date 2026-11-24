// Teste ponta a ponta da visão do VIAJANTE nas solicitações de viagem: quem viaja (e não é admin nem
// líder) enxerga, só leitura, as viagens Reservadas/Finalizadas em que está. Sobe os routers
// /solicitacoes-viagem, /auditoria e /dashboard num Express mínimo e apaga tudo no final. Roda num
// SCHEMA ISOLADO (nunca no `public`):
//   1. DATABASE_URL do .env com ?schema=viagem_viajante_e2e
//   2. criar o schema (CREATE SCHEMA viagem_viajante_e2e) e rodar `prisma migrate deploy` com essa URL
//   3. DATABASE_URL=<essa URL> node_modules/.bin/ts-node --transpile-only prisma/verificarViajanteViagemApi.ts
//   4. DROP SCHEMA viagem_viajante_e2e CASCADE
import "dotenv/config";
import assert from "assert";
import express from "express";
import fs from "fs";
import path from "path";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { solicitacoesViagemRouter } from "../src/routes/solicitacoesViagem";
import { auditoriaRouter } from "../src/routes/auditoria";
import { dashboardRouter } from "../src/routes/dashboard";
import { VIAGEM_DIR, garantirDiretorioUploads } from "../src/config/uploads";

const TAG = `vvi${Date.now()}`;
// CPFs válidos (dígito verificador) só pra teste.
const CPF_VIAJANTE = "52998224725";
const CPF_EXTERNO = "11144477735";

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
  app.use("/auditoria", auditoriaRouter);
  app.use("/dashboard", dashboardRouter);
  const server = app.listen(0);
  const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const roleAdmin = await prisma.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin" } });
  const roleCons = await prisma.role.upsert({ where: { name: "consultoria" }, update: {}, create: { name: "consultoria" } });
  const roleAdm = await prisma.role.upsert({ where: { name: "administrativo" }, update: {}, create: { name: "administrativo" } });
  const mk = (n: string, roleId: number) => prisma.user.create({ data: { email: `${TAG}-${n}@teste.local`, nome: `Teste ${n}`, roleId, status: "ativo" } });
  const [solic, atend, gestor, viaj, outro, viajAdm] = await Promise.all([
    mk("solicitante", roleAdmin.id),
    mk("atendente", roleAdmin.id),
    mk("gestor", roleAdmin.id),
    mk("viajante", roleCons.id),
    mk("outro", roleCons.id),
    mk("viajanteadm", roleAdm.id),
  ]);
  const T = {
    solic: signToken({ userId: solic.id, role: "admin" }),
    atend: signToken({ userId: atend.id, role: "admin" }),
    gestor: signToken({ userId: gestor.id, role: "admin" }),
    viaj: signToken({ userId: viaj.id, role: "consultoria" }),
    outro: signToken({ userId: outro.id, role: "consultoria" }),
    viajAdm: signToken({ userId: viajAdm.id, role: "administrativo" }),
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
      /* download: corpo binário/texto */
    }
    return { status: r.status, corpo: json, texto };
  }
  const passo = (msg: string) => console.log(`  ✔ ${msg}`);
  const perfil = async (quem: keyof typeof T) => (await api(quem, "GET", "/meu-perfil", undefined, "/dashboard")).corpo;

  const pedido = (cidade: string, viajantes: object[]) => ({
    finalidade: "interna",
    motivo: `Teste ${cidade}`,
    dataInicio: "2026-11-10",
    dataFim: "2026-11-12",
    cidadesDestino: cidade,
    viajantes,
    itens: [{ tipo: "hospedagem", viajantes: viajantes.map((_, i) => i), cidade, dataInicio: "2026-11-10", dataFim: "2026-11-12" }],
  });

  // Leva a solicitação até "aprovada" (pronta pra reservar).
  async function ateAprovada(viajantes: object[], cidade: string) {
    const criar = await api("solic", "POST", "/", pedido(cidade, viajantes));
    assert.equal(criar.status, 201, JSON.stringify(criar.corpo));
    const id = criar.corpo.id as number;
    assert.equal((await api("atend", "POST", `/${id}/assumir`)).status, 200);
    const cot = await api("atend", "POST", `/${id}/cotacoes`, { fornecedor: "Hotel A", valor: 900 });
    const cotId = cot.corpo.solicitacao.cotacoes[0].id as number;
    await api("atend", "POST", `/${id}/cotacoes/${cotId}/selecionar`, { selecionada: true });
    assert.equal((await api("atend", "POST", `/${id}/enviar-aprovacao`)).status, 200);
    assert.equal((await api("gestor", "POST", `/${id}/decidir`, { acao: "aprovar", valorAprovado: 1000 })).status, 200);
    return id;
  }
  async function reservar(id: number) {
    const itemId = (await api("atend", "GET", `/${id}`)).corpo.solicitacao.itens[0].id as number;
    assert.equal((await api("atend", "PUT", `/${id}/itens/${itemId}/reserva`, { fornecedor: "Hotel A", localizador: "ABC123", valorReservado: 900 })).status, 200);
    const r = await api("atend", "POST", `/${id}/reservar`);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.solicitacao.status, "reservada");
  }

  const viajantes = [
    { userId: viaj.id, nome: "Teste Viajante", cpf: CPF_VIAJANTE },
    { nome: "Pessoa Externa", cpf: CPF_EXTERNO },
  ];
  const arquivosCriados: string[] = [];

  try {
    // --- antes de reservar, o viajante não enxerga nada ---
    const id = await ateAprovada(viajantes, "São Paulo");
    assert.equal((await perfil("viaj")).viajante, false, "antes da reserva /meu-perfil não marca viajante");
    assert.equal((await api("viaj", "GET", "/?escopo=minhas")).status, 403, "lista bloqueada antes da reserva");
    assert.equal((await api("viaj", "GET", `/${id}`)).status, 403, "detalhe bloqueado antes da reserva");
    passo("viajante não vê a solicitação enquanto ela não está reservada");

    // --- reserva: o viajante passa a ver e é avisado ---
    await reservar(id);
    assert.equal((await perfil("viaj")).viajante, true, "depois da reserva /meu-perfil marca viajante");
    assert.equal((await perfil("outro")).viajante, false, "quem não viaja continua sem acesso");
    const lista = await api("viaj", "GET", "/?escopo=minhas&status=reservada,finalizada");
    assert.equal(lista.status, 200, JSON.stringify(lista.corpo));
    assert.ok(lista.corpo.solicitacoes.some((x: { id: number }) => x.id === id), "a viagem aparece na lista do viajante");
    assert.equal(lista.corpo.kpis.reservada, 1);
    passo("depois de reservada, aparece em Minhas Solicitações (e /meu-perfil.viajante = true)");

    const det = await api("viaj", "GET", `/${id}`);
    assert.equal(det.status, 200, JSON.stringify(det.corpo));
    const s = det.corpo.solicitacao;
    assert.ok(Object.values(s.pode).every((v) => v === false), `viajante não tem nenhuma ação: ${JSON.stringify(s.pode)}`);
    const meu = s.viajantes.find((p: { userId: number | null }) => p.userId === viaj.id);
    const externo = s.viajantes.find((p: { userId: number | null }) => p.userId == null);
    assert.equal(meu.cpf, CPF_VIAJANTE, "o próprio CPF vem completo");
    assert.ok(String(externo.cpf).includes("*"), "o CPF do outro viajante vem mascarado");
    assert.ok(s.itens[0].localizador === "ABC123" && s.valorAprovado === 1000, "vê localizador e valores (tudo, só leitura)");
    passo("detalhe só leitura: sem ações, próprio CPF inteiro, CPF alheio mascarado");

    // --- só leitura e só o que é dele ---
    assert.equal((await api("viaj", "POST", "/", pedido("Rio", viajantes))).status, 403, "POST bloqueado");
    assert.equal((await api("viaj", "PUT", `/${id}`, pedido("Rio", viajantes))).status, 403, "PUT bloqueado");
    assert.equal((await api("viaj", "POST", `/${id}/cancelar`, { motivo: "x" })).status, 403, "cancelar bloqueado");
    assert.equal((await api("viaj", "POST", `/${id}/finalizar`)).status, 403, "finalizar bloqueado");
    assert.equal((await api("viaj", "GET", "/?escopo=aprovacao")).status, 403, "escopo aprovação bloqueado");
    assert.equal((await api("viaj", "GET", "/?escopo=atendimento")).status, 403, "escopo atendimento bloqueado");
    assert.equal((await api("outro", "GET", `/${id}`)).status, 403, "quem não viaja não abre a viagem");
    passo("escrita, aprovação e atendimento bloqueados; terceiros não abrem a viagem");

    // --- notificação ---
    const notif = await prisma.notificacao.findFirst({ where: { userId: viaj.id, tipo: "viagem_reservada_viajante", solicitacaoViagemId: id } });
    assert.ok(notif, "o viajante é avisado da reserva, com link");
    assert.equal(await prisma.notificacao.count({ where: { userId: solic.id, tipo: "viagem_reservada_viajante" } }), 0, "o solicitante não recebe o aviso do viajante em duplicidade");
    passo("viajante notificado da reserva (com link); solicitante não recebe em dobro");

    // --- anexo: download liberado ---
    const nomeArquivo = `${TAG}.txt`;
    fs.writeFileSync(path.join(VIAGEM_DIR, nomeArquivo), "voucher de teste");
    arquivosCriados.push(path.join(VIAGEM_DIR, nomeArquivo));
    const anexo = await prisma.solicitacaoViagemAnexo.create({
      data: { solicitacaoId: id, userId: solic.id, categoria: "voucher", nomeArquivo: "voucher.txt", caminhoArquivo: nomeArquivo, tamanhoBytes: 16, mimeType: "text/plain" },
    });
    const dl = await api("viaj", "GET", `/${id}/anexos/${anexo.id}/download`);
    assert.equal(dl.status, 200);
    assert.equal(dl.texto, "voucher de teste");
    passo("download de anexo (voucher) liberado");

    // --- histórico contextual ---
    assert.equal((await api("viaj", "GET", `/entidade/solicitacao_viagem/${id}`, undefined, "/auditoria")).status, 200, "viajante lê o histórico da viagem");
    assert.equal((await api("outro", "GET", `/entidade/solicitacao_viagem/${id}`, undefined, "/auditoria")).status, 403, "terceiro não lê o histórico");
    passo("histórico da viagem liberado ao viajante (e negado a terceiros)");

    // --- finalizada continua visível ---
    assert.equal((await api("atend", "POST", `/${id}/finalizar`)).status, 200);
    const fin = await api("viaj", "GET", "/?escopo=minhas&status=finalizada");
    assert.ok(fin.corpo.solicitacoes.some((x: { id: number }) => x.id === id), "finalizada continua na lista");
    assert.equal((await api("viaj", "GET", `/${id}`)).status, 200);
    passo("depois de finalizada, continua visível");

    // --- filtro "término a partir de": viagem que já terminou sai da tela, no dia do término ainda aparece ---
    // A viagem do teste termina em 2026-11-12 (dataFim do cabeçalho, a mesma da coluna "Período e destino").
    const noDia = await api("viaj", "GET", "/?escopo=minhas&status=reservada,finalizada&de=2026-11-12");
    assert.ok(noDia.corpo.solicitacoes.some((x: { id: number }) => x.id === id), "no dia do término a viagem ainda aparece");
    const diaSeguinte = await api("viaj", "GET", "/?escopo=minhas&status=reservada,finalizada&de=2026-11-13");
    assert.ok(!diaSeguinte.corpo.solicitacoes.some((x: { id: number }) => x.id === id), "no dia seguinte ao término a viagem sai da lista");
    assert.equal(diaSeguinte.corpo.total, 0);
    assert.ok((await api("viaj", "GET", "/?escopo=minhas&status=reservada,finalizada")).corpo.solicitacoes.some((x: { id: number }) => x.id === id), "sem data, o histórico inteiro continua acessível");
    passo("filtro de término: aparece no dia, some no dia seguinte, e sem data volta o histórico");

    // --- cancelada: some e o aviso vai sem link ---
    const id2 = await ateAprovada(viajantes, "Rio");
    await reservar(id2);
    assert.equal((await api("viaj", "GET", `/${id2}`)).status, 200);
    assert.equal((await api("atend", "POST", `/${id2}/cancelar`, { motivo: "Evento adiado" })).status, 200);
    assert.equal((await api("viaj", "GET", `/${id2}`)).status, 403, "cancelada deixa de ser visível ao viajante");
    const lista2 = await api("viaj", "GET", "/?escopo=minhas");
    assert.ok(!lista2.corpo.solicitacoes.some((x: { id: number }) => x.id === id2), "cancelada some da lista");
    const aviso = await prisma.notificacao.findFirst({ where: { userId: viaj.id, tipo: "viagem_cancelada_viajante" } });
    assert.ok(aviso, "viajante é avisado do cancelamento");
    assert.equal(aviso!.solicitacaoViagemId, null, "o aviso de cancelamento não leva link (a viagem já não é visível)");
    assert.ok(aviso!.mensagem.includes("Evento adiado"));
    passo("cancelada some da lista; aviso com o motivo e sem link");

    // --- papel de atendimento não amplia a visão do viajante ---
    const id3 = await ateAprovada([{ userId: viajAdm.id, nome: "Adm Viajante", cpf: "" }], "Curitiba");
    await reservar(id3);
    assert.equal((await api("viajAdm", "GET", `/${id3}`)).status, 200, "administrativo vê a própria viagem");
    assert.equal((await api("viajAdm", "GET", "/?escopo=atendimento")).status, 403, "administrativo-viajante não abre o atendimento");
    assert.equal((await api("viajAdm", "GET", `/${id}`)).status, 403, "administrativo-viajante não abre viagem alheia");
    assert.equal((await api("viajAdm", "POST", `/${id3}/finalizar`)).status, 403, "administrativo-viajante não age como atendimento");
    passo("administrativo que também viaja só enxerga a própria viagem, sem poderes de atendimento");

    console.log("\nOK — visão do viajante validada.");
  } finally {
    for (const f of arquivosCriados) fs.unlink(f, () => {});
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
