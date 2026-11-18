// Verificação do espelho de /labels do Kyria (mapeamento #16, 18/11/2026), contra o banco local e a API real do Kyria (SÓ LEITURA no Kyria).
// Convenção do repo: verificar*.ts, ts-node --transpile-only; Express mínimo (nunca o server.ts, que agenda syncs reais). Roda o job de verdade
// (grava em kyria_labels, que é o efeito desejado do próprio job) e exercita as rotas que a tela usa, com JWT local de admin.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarKyriaLabels.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { syncKyriaRouter } from "../src/routes/syncKyria";
import { syncKyriaDadosRouter } from "../src/routes/syncKyriaDados";
import { KYRIA_SYNC_JOBS } from "../src/kyria/registry";
import { JOB_NAME, runKyriaLabelsSync } from "../src/kyria/labelsSync";
import { listAllLabels } from "../src/kyria/client";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  if (!admin) throw new Error("precisa de um usuário admin no banco local");
  const token = signToken({ userId: admin.id, role: "admin" });
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/sync-kyria/dados", syncKyriaDadosRouter);
  app.use("/sync-kyria", syncKyriaRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chamar = async (caminho: string) => {
    const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  try {
    console.log("\n== registro do job ==");
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === JOB_NAME);
    ok("job no catálogo, na tabela local certa", !!job && job.tabelaLocal === "kyria_labels" && job.path === "/labels");
    ok("horário 5:20, entre status (5:15) e tickets (5:30)", job?.cronExpr === "20 5 * * *");

    console.log("\n== importação ==");
    const naApi = await listAllLabels();
    await runKyriaLabelsSync();
    const log = await prisma.syncLog.findFirst({ where: { jobName: JOB_NAME }, orderBy: { id: "desc" } });
    ok("job terminou com sucesso", log?.status === "success", log?.message ?? "");
    const locais = await prisma.kyriaLabel.findMany();
    ok("linhas locais = etiquetas na API", locais.length === naApi.length, `${locais.length} x ${naApi.length}`);
    const naoBatem = naApi.filter((a) => {
      const l = locais.find((x) => x.id === a.id);
      return !l || l.key !== a.key || l.name !== a.name || l.color !== a.color || l.status !== a.status || l.groupId !== a.groupId || l.teamId !== a.teamId || l.sortOrder !== a.sortOrder;
    });
    ok("cada campo confere com a API", naoBatem.length === 0, `${naoBatem.length} divergentes`);
    ok("os nomes longos (acima de 32 caracteres) cabem", locais.some((l) => l.name.length > 32) && locais.some((l) => l.key.length > 32), `key máx ${Math.max(...locais.map((l) => l.key.length))}, name máx ${Math.max(...locais.map((l) => l.name.length))}`);
    await runKyriaLabelsSync();
    ok("segunda rodada não duplica", (await prisma.kyriaLabel.count()) === naApi.length);

    console.log("\n== rotas que a tela usa ==");
    const lista = await chamar("/sync-kyria");
    const j = lista.json?.jobs?.find((x: any) => x.jobName === JOB_NAME);
    ok("GET /sync-kyria lista o job com URL completa, registros e próxima execução", lista.status === 200 && !!j && /\/api\/v1\/labels$/.test(j.urlCompleta) && j.totalRegistros === naApi.length && !!j.proximaExecucao, j ? `${j.displayName} · ${j.urlCompleta} · ${j.totalRegistros} registros` : String(lista.status));
    const dados = await chamar(`/sync-kyria/dados/${JOB_NAME}?page=1&pageSize=5`);
    ok('"Ver dados" abre a tabela', dados.status === 200 && dados.json.total === naApi.length && dados.json.itens?.length === 5 && dados.json.tabelaLocal === "kyria_labels", `status ${dados.status}`);
  } finally {
    server.close();
    console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
    await prisma.$disconnect();
    process.exit(falhas === 0 ? 0 : 1);
  }
}
main().catch(async (e) => {
  console.error("ERRO", e);
  await prisma.$disconnect();
  process.exit(1);
});
