// Verificação do espelho de /label-groups do Kyria (mapeamento #20, 18/11/2026), contra o banco local e a API real do Kyria (SÓ LEITURA no Kyria).
// Convenção do repo: verificar*.ts, ts-node --transpile-only; Express mínimo (nunca o server.ts, que agenda syncs reais). Roda o job de verdade
// (grava em kyria_label_groups, que é o efeito desejado do próprio job) e exercita as rotas que a tela usa, com JWT local de admin. O valor
// gravado no campo interno durante o teste é revertido no `finally`.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarKyriaLabelGroups.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { syncKyriaRouter } from "../src/routes/syncKyria";
import { syncKyriaDadosRouter } from "../src/routes/syncKyriaDados";
import { KYRIA_SYNC_JOBS } from "../src/kyria/registry";
import { JOB_NAME, runKyriaLabelGroupsSync } from "../src/kyria/labelGroupsSync";
import { listAllLabelGroups } from "../src/kyria/client";

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
  let grupoDeTeste: string | null = null;

  try {
    console.log("\n== registro do job ==");
    const job = KYRIA_SYNC_JOBS.find((j) => j.jobName === JOB_NAME);
    ok("job no catálogo, na tabela local certa", !!job && job.tabelaLocal === "kyria_label_groups" && job.path === "/label-groups");
    const ordem = KYRIA_SYNC_JOBS.map((j) => j.jobName);
    ok("roda antes de Etiquetas no catálogo e no horário (5:17 antes de 5:20)", ordem.indexOf(JOB_NAME) < ordem.indexOf("kyria-labels-sync") && job?.cronExpr === "17 5 * * *");

    console.log("\n== importação ==");
    const naApi = await listAllLabelGroups();
    await runKyriaLabelGroupsSync();
    const log = await prisma.syncLog.findFirst({ where: { jobName: JOB_NAME }, orderBy: { id: "desc" } });
    ok("job terminou com sucesso", log?.status === "success", log?.message ?? "");
    const locais = await prisma.kyriaLabelGroup.findMany();
    ok("linhas locais = grupos na API", locais.length === naApi.length && naApi.length > 0, `${locais.length} x ${naApi.length}`);
    const naoBatem = naApi.filter((a) => {
      const l = locais.find((x) => x.id === a.id);
      return !l || l.key !== a.key || l.name !== a.name || l.description !== a.description || l.status !== a.status;
    });
    ok("cada campo confere com a API (inclusive description nula)", naoBatem.length === 0, `${naoBatem.length} divergentes`);
    ok("campo interno nasce vazio", locais.every((l) => l.fitroDepTime === null));
    const doLabels = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM kyria_labels l WHERE l.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kyria_label_groups g WHERE g.id = l.group_id)`);
    ok("todo group_id das etiquetas existe nos grupos importados", doLabels[0].n === 0, `${doLabels[0].n} órfãs`);

    console.log("\n== campo interno preservado ==");
    grupoDeTeste = locais[0].id;
    await prisma.kyriaLabelGroup.update({ where: { id: grupoDeTeste }, data: { fitroDepTime: true } });
    await runKyriaLabelGroupsSync();
    const depois = await prisma.kyriaLabelGroup.findUnique({ where: { id: grupoDeTeste } });
    ok("o sync não apaga o valor gravado em fitro_dep_time", depois?.fitroDepTime === true);
    ok("segunda rodada não duplica", (await prisma.kyriaLabelGroup.count()) === naApi.length);

    console.log("\n== rotas que a tela usa ==");
    const lista = await chamar("/sync-kyria");
    const j = lista.json?.jobs?.find((x: any) => x.jobName === JOB_NAME);
    ok("GET /sync-kyria lista o job com URL completa e registros", lista.status === 200 && !!j && /\/api\/v1\/label-groups$/.test(j.urlCompleta) && j.totalRegistros === naApi.length, j ? `${j.displayName} · ${j.urlCompleta} · ${j.totalRegistros} registros` : String(lista.status));
    const dados = await chamar(`/sync-kyria/dados/${JOB_NAME}?page=1&pageSize=10`);
    ok('"Ver dados" abre a tabela com as linhas', dados.status === 200 && dados.json.total === naApi.length && dados.json.itens?.length === naApi.length, `status ${dados.status}`);
    const col = dados.json?.colunas?.find((c: any) => c.rotulo === "fitro_dep_time");
    ok('"Ver dados" reconhece fitro_dep_time como campo interno', !!col && col.ehInterno === true, col ? `ehInterno=${col.ehInterno}` : "coluna não encontrada");
  } finally {
    if (grupoDeTeste) await prisma.kyriaLabelGroup.update({ where: { id: grupoDeTeste }, data: { fitroDepTime: null } }).catch(() => undefined);
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
