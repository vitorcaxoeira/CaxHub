// Teste do registro das leituras do Kyria: roda syncs REAIS (só leitura na API, escrita no banco local) e confere as linhas de kyria_leituras e
// kyria_leituras_paginas; provoca uma falha com token inválido; sobe só o syncKyriaRouter num Express mínimo (sem os syncs agendados do server.ts)
// para conferir as listas e a limpeza (com auditoria). Apaga o que criou por id no final.
//   node_modules/.bin/ts-node --transpile-only prisma/verificarKyriaLeituras.ts
import "dotenv/config";
import assert from "assert";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { syncKyriaRouter } from "../src/routes/syncKyria";
import { runKyriaTeamsSync } from "../src/kyria/teamsSync";
import { runKyriaTicketsSync } from "../src/kyria/ticketsSync";
import { runKyriaTicketHoursSync } from "../src/kyria/ticketHoursSync";
import { marcarLeiturasInterrompidas } from "../src/kyria/registroLeitura";

const TAG = `ZZ-TESTE-LEIT-${Date.now()}`;

async function main() {
  const antesIds = new Set((await prisma.kyriaLeitura.findMany({ select: { id: true } })).map((l) => l.id));
  const novas = async () => prisma.kyriaLeitura.findMany({ where: { id: { notIn: [...antesIds] } }, orderBy: { id: "asc" }, include: { chamadas: { orderBy: { id: "asc" } } } });

  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/sync-kyria", syncKyriaRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sync-kyria`;
  const roleAdmin = await prisma.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin" } });
  const roleCons = await prisma.role.upsert({ where: { name: "consultoria" }, update: {}, create: { name: "consultoria" } });
  const admin = await prisma.user.create({ data: { email: `${TAG}-admin@teste.local`, nome: "Teste admin", roleId: roleAdmin.id, status: "ativo" } });
  const outro = await prisma.user.create({ data: { email: `${TAG}-cons@teste.local`, nome: "Teste consultor", roleId: roleCons.id, status: "ativo" } });
  const T = { admin: signToken({ userId: admin.id, role: "admin" }), cons: signToken({ userId: outro.id, role: "consultoria" }) };
  const api = async (quem: keyof typeof T, metodo: string, rota: string) => {
    const r = await fetch(base + rota, { method: metodo, headers: { Authorization: `Bearer ${T[quem]}` } });
    const ct = r.headers.get("content-type") ?? "";
    return { status: r.status, dados: (ct.includes("json") ? await r.json() : await r.text()) as any };
  };
  const tokenReal = process.env.KYRIA_API_TOKEN;

  try {
    // 1. sync real de times (1 página) e de tickets (várias páginas de 750)
    await runKyriaTeamsSync();
    await runKyriaTicketsSync();
    let ls = await novas();
    const times = ls.find((l) => l.jobName === "kyria-teams-sync")!;
    const tickets = ls.find((l) => l.jobName === "kyria-tickets-sync")!;
    assert.ok(times && tickets, "uma leitura por job executado");
    assert.strictEqual(times.status, "concluida");
    assert.strictEqual(times.recurso, "/teams");
    assert.strictEqual(times.limite, 750);
    assert.strictEqual(times.chamadas.length, 1);
    assert.strictEqual(times.paginas, 1);
    assert.strictEqual(times.linhas, await prisma.kyriaTeam.count({ where: { status: "active" } }) + (await prisma.kyriaTeam.count({ where: { status: "inactive" } })));
    assert.strictEqual(tickets.status, "concluida");
    assert.ok(tickets.chamadas.length >= 2, "tickets paginou");
    assert.strictEqual(tickets.chamadas.filter((c) => c.status === "ok").length, tickets.paginas);
    assert.strictEqual(tickets.chamadas.reduce((s, c) => s + c.linhas, 0), tickets.linhas);
    // a 1ª chamada não tem cursor; a seguinte envia o cursor devolvido pela anterior
    assert.strictEqual(tickets.chamadas[0].cursor, null);
    assert.strictEqual(tickets.chamadas[1].cursor, tickets.chamadas[0].proximoCursor);
    assert.strictEqual(tickets.chamadas[0].limite, 750);
    assert.ok(tickets.chamadas[0].kb > 0 && tickets.chamadas[0].msKyria > 0 && tickets.chamadas[0].httpStatus === 200);
    assert.ok(tickets.chamadas[0].requestId, "requestId do Kyria gravado");
    assert.ok(tickets.finalizadaEm, "leitura finalizada");
    console.log(`  tickets: ${tickets.linhas} linhas em ${tickets.chamadas.length} chamadas (${tickets.chamadas.map((c) => c.msKyria + "ms").join(", ")})`);

    // 2. relatório (não paginado): limite nulo
    await runKyriaTicketHoursSync();
    ls = await novas();
    const horas = ls.find((l) => l.jobName === "kyria-ticket-hours-sync");
    if (horas) {
      assert.strictEqual(horas.limite, null);
      assert.ok(horas.chamadas.length >= 1);
      console.log(`  relatório de horas: status ${horas.status}, ${horas.chamadas.length} chamada(s), http ${horas.chamadas.map((c) => c.httpStatus).join(",")}`);
    }

    // 3. falha provocada (token inválido): leitura "falhou", chamada com erro e status 401
    process.env.KYRIA_API_TOKEN = "kyria_live_token_invalido_do_teste";
    await runKyriaTeamsSync();
    process.env.KYRIA_API_TOKEN = tokenReal;
    ls = await novas();
    const falha = ls.filter((l) => l.jobName === "kyria-teams-sync").pop()!;
    assert.strictEqual(falha.status, "falhou");
    assert.ok(falha.erro && /HTTP 401|UNAUTHORIZED|recusou/i.test(falha.erro), `erro esperado de autenticação, veio: ${falha.erro}`);
    assert.strictEqual(falha.chamadas.length, 1);
    assert.strictEqual(falha.chamadas[0].status, "erro");
    assert.strictEqual(falha.chamadas[0].httpStatus, 401);
    assert.strictEqual(falha.paginas, 0);
    // o SyncLog continua registrando a falha como antes
    const log = await prisma.syncLog.findFirst({ where: { jobName: "kyria-teams-sync" }, orderBy: { id: "desc" } });
    assert.strictEqual(log?.status, "error");
    await runKyriaTeamsSync(); // volta ao normal
    ls = await novas();

    // 4. boot: leitura "em andamento" vira "interrompida"
    const presa = await prisma.kyriaLeitura.create({ data: { jobName: "kyria-teams-sync", recurso: "/teams", limite: 750, timeoutMs: 20000 } });
    assert.ok((await marcarLeiturasInterrompidas()) >= 1);
    assert.strictEqual((await prisma.kyriaLeitura.findUnique({ where: { id: presa.id } }))?.status, "interrompida");

    // 5. rotas
    assert.strictEqual((await api("cons", "GET", "/leituras")).status, 403, "só admin");
    let r = await api("admin", "GET", "/leituras?pageSize=50");
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados).slice(0, 200));
    const linhaTickets = r.dados.itens.find((l: any) => l.id === tickets.id);
    assert.ok(linhaTickets, "leitura de tickets na lista");
    assert.strictEqual(linhaTickets.tabela, "Tickets");
    assert.strictEqual(linhaTickets.status, "Concluída");
    assert.strictEqual(linhaTickets.chamadas, tickets.chamadas.length);
    assert.strictEqual(linhaTickets.linhas, tickets.linhas);
    assert.ok(linhaTickets.msMax >= linhaTickets.msMedio);
    r = await api("admin", "GET", "/leituras?job=kyria-tickets-sync&pageSize=50");
    assert.ok(r.dados.itens.length >= 1 && r.dados.itens.every((l: any) => l.jobName === "kyria-tickets-sync"), "filtro por tabela");
    r = await api("admin", "GET", "/leituras?status=falhou&pageSize=50");
    assert.ok(r.dados.itens.some((l: any) => l.id === falha.id) && r.dados.itens.every((l: any) => l.statusCodigo === "falhou"), "filtro por status");
    r = await api("admin", "GET", "/leituras?de=2099-01-01&pageSize=50");
    assert.strictEqual(r.dados.itens.length, 0, "filtro por período");
    r = await api("admin", "GET", `/chamadas?leituraId=${tickets.id}&pageSize=50`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.dados.itens.length, tickets.chamadas.length);
    assert.strictEqual(r.dados.itens[0].cursor, null);
    r = await api("admin", "GET", "/chamadas?pageSize=50");
    assert.strictEqual(r.dados.itens.length, 0, "sem leituraId não lista nada");
    r = await api("admin", "GET", `/leituras/csv?job=kyria-tickets-sync`);
    assert.strictEqual(r.status, 200);
    assert.ok(String(r.dados).includes("Tickets"), "csv traz a tabela");

    // 6. limpeza: preserva a leitura em andamento, apaga as chamadas em cascata e audita
    const andamento = await prisma.kyriaLeitura.create({ data: { jobName: "kyria-tickets-sync", recurso: "/tickets", limite: 750, timeoutMs: 20000 } });
    const logAntes = await prisma.syncLog.count();
    const cursorAntes = await prisma.kyriaSyncCursor.count();
    assert.strictEqual((await api("admin", "DELETE", "/nao-existe/leituras")).status, 404);
    assert.strictEqual((await api("cons", "DELETE", "/kyria-teams-sync/leituras")).status, 403);
    r = await api("admin", "DELETE", "/kyria-tickets-sync/leituras");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.dados.chamadasApagadas, tickets.chamadas.length);
    assert.ok(await prisma.kyriaLeitura.findUnique({ where: { id: andamento.id } }), "a leitura em andamento fica");
    assert.strictEqual(await prisma.kyriaLeitura.count({ where: { id: tickets.id } }), 0, "a concluída some");
    assert.strictEqual(await prisma.kyriaLeituraPagina.count({ where: { leituraId: tickets.id } }), 0, "as chamadas saem em cascata");
    assert.ok((await prisma.kyriaLeitura.count({ where: { jobName: "kyria-teams-sync" } })) >= 1, "as de outra tabela ficam");
    assert.strictEqual(await prisma.syncLog.count(), logAntes, "o SyncLog nunca é tocado");
    assert.strictEqual(await prisma.kyriaSyncCursor.count(), cursorAntes, "o cursor do feed nunca é tocado");
    const audit = await prisma.auditEvento.findFirst({ where: { usuarioId: admin.id, eventoTipo: "KYRIA_LEITURAS_LIMPAS" } });
    assert.ok(audit && audit.entidadeId === "kyria-tickets-sync", "limpeza auditada");
  } catch (e) {
    console.error("FALHOU:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    process.env.KYRIA_API_TOKEN = tokenReal;
    try {
      // limpa só o que este teste criou (as leituras novas, por id; as chamadas saem em cascata)
      const criadas = await prisma.kyriaLeitura.findMany({ where: { id: { notIn: [...antesIds] } }, select: { id: true } });
      await prisma.kyriaLeitura.deleteMany({ where: { id: { in: criadas.map((c) => c.id) } } });
      await prisma.auditEvento.deleteMany({ where: { usuarioId: { in: [admin.id, outro.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, outro.id] } } });
      // o syncLog das execuções falhas provocadas (token inválido) não deve poluir a tela: remove só as linhas de erro criadas agora
      await prisma.syncLog.deleteMany({ where: { jobName: "kyria-teams-sync", status: "error", message: { contains: "401" }, runAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } } });
    } catch (e) {
      console.error("Falha na limpeza:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
    server.close();
    await prisma.$disconnect();
  }
  if (!process.exitCode) console.log("OK: leituras do Kyria — todas as verificações passaram");
}

main();
