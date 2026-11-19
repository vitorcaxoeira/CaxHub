// Verificação ponta a ponta dos ajustes 01–03 da Rentabilidade (17/11/2026), contra o banco local e
// o Senior (SÓ LEITURA no Senior). Convenção do repo: verificar*.ts, rodado com ts-node
// --transpile-only; Express mínimo (nunca o server.ts, que agenda syncs reais).
// Tudo que grava no banco local pelas rotas (times do departamento, vínculo de membro) é revertido
// no finally; o que o ajuste 01 grava (clientes.codccu) é o efeito desejado da própria sync.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarRentabilidadeAjustes.ts
import "dotenv/config";
import assert from "assert";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { syncKyriaDepartamentosRouter } from "../src/routes/syncKyriaDepartamentos";
import { syncKyriaDadosRouter } from "../src/routes/syncKyriaDados";
import { sincronizarCentroCustoDosClientes } from "../src/sync/clienteCentroCusto";
import { JOB_NAME as MEMBERS_JOB } from "../src/kyria/membersSync";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  assert(admin, "precisa de um usuário admin no banco local");
  const tokenAdmin = signToken({ userId: admin.id, role: "admin" });
  const tokenOutro = signToken({ userId: admin.id, role: "consultor" });

  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/sync-kyria/dados", syncKyriaDadosRouter);
  app.use("/sync-kyria/departamentos-times", syncKyriaDepartamentosRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chamar = async (metodo: string, caminho: string, token: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  let departamentoRestaurar: { codemp: number; depexe: number; antes: string[] } | null = null;
  let membroRestaurar: { id: string } | null = null;

  try {
    // ---------- Ajuste 01: CC do cliente ----------
    console.log("\n== Ajuste 01 — clientes.codccu (E085RAT) ==");
    const r1 = await sincronizarCentroCustoDosClientes();
    console.log("   ", r1);
    const comCc = await prisma.cliente.count({ where: { codccu: { not: null } } });
    ok("clientes com codccu preenchido", comCc > 100, `${comCc}`);
    const r2 = await sincronizarCentroCustoDosClientes();
    ok("segunda execução não regrava nada (idempotente)", /0 atualizados, 0 zerados/.test(r2), r2);
    const amostra = await prisma.cliente.findMany({ where: { codcli: { in: [1, 2, 3, 7] } }, select: { codcli: true, apecli: true, codccu: true }, orderBy: { codcli: "asc" } });
    console.log("    amostra:", JSON.stringify(amostra));
    ok("codcli 1 → CC 90 e codcli 2 → CC 1020 (valores vistos no Senior)", amostra.find((c) => c.codcli === 1)?.codccu === "90" && amostra.find((c) => c.codcli === 2)?.codccu === "1020");
    const orfaos = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM clientes c WHERE c.codccu IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo x WHERE x.codccu = c.codccu)`;
    ok("todo codccu de cliente existe em centros_custo", Number(orfaos[0].n) === 0, `órfãos: ${orfaos[0].n}`);

    // ---------- Ajuste 02: Departamento x Time Kyria ----------
    console.log("\n== Ajuste 02 — Departamento x Time Kyria ==");
    const semPerm = await chamar("GET", "/sync-kyria/departamentos-times", tokenOutro);
    ok("não-admin recebe 403", semPerm.status === 403, `${semPerm.status}`);
    const lista = await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin);
    ok("GET devolve departamentos e times", lista.status === 200 && lista.json.departamentos.length > 0 && lista.json.timesDisponiveis.length > 0, `${lista.json?.departamentos?.length} deptos, ${lista.json?.timesDisponiveis?.length} times`);
    console.log("    times:", lista.json.timesDisponiveis.map((t: any) => t.label).join(" | "));
    console.log("    deptos:", lista.json.departamentos.map((d: any) => `${d.depexe}=${d.depexeLabel}`).join(" | "));
    const dep = lista.json.departamentos[0];
    departamentoRestaurar = { codemp: dep.codemp, depexe: dep.depexe, antes: dep.times };
    const doisTimes = lista.json.timesDisponiveis.slice(0, 2).map((t: any) => t.value);
    const put = await chamar("PUT", `/sync-kyria/departamentos-times/${dep.codemp}/${dep.depexe}`, tokenAdmin, { timeIds: doisTimes });
    ok("PUT grava 2 times", put.status === 200, `${put.status}`);
    const depois = await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin);
    const gravado = depois.json.departamentos.find((d: any) => d.codemp === dep.codemp && d.depexe === dep.depexe).times;
    ok("GET seguinte devolve os 2 times gravados", gravado.length === 2 && doisTimes.every((t: string) => gravado.includes(t)));
    const invalido = await chamar("PUT", `/sync-kyria/departamentos-times/${dep.codemp}/${dep.depexe}`, tokenAdmin, { timeIds: ["time-que-nao-existe"] });
    ok("time inexistente → 400", invalido.status === 400, `${invalido.status}`);
    const semDepto = await chamar("PUT", `/sync-kyria/departamentos-times/${dep.codemp}/9999`, tokenAdmin, { timeIds: [] });
    ok("departamento inexistente → 404", semDepto.status === 404, `${semDepto.status}`);
    const aposInvalido = await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin);
    ok("PUT inválido não alterou o que estava gravado", aposInvalido.json.departamentos.find((d: any) => d.depexe === dep.depexe).times.length === 2);

    // ---------- Ajuste 03: vínculo membro Kyria → consultor só pra attendant ----------
    console.log("\n== Ajuste 03 — vínculo só para role attendant ==");
    const consultor = await prisma.consultor.findFirst({ select: { codusu: true } });
    assert(consultor, "precisa de um consultor");
    const naoAtendente = await prisma.kyriaMember.findFirst({ where: { role: { notIn: ["attendant", "admin", "manager"] }, codusu: null }, select: { id: true, role: true } });
    const atendente = await prisma.kyriaMember.findFirst({ where: { role: "attendant", codusu: null }, select: { id: true } });
    assert(naoAtendente && atendente, "precisa de um membro não-atendente e um atendente sem vínculo");
    membroRestaurar = { id: atendente.id };

    const colunas = await chamar("GET", `/sync-kyria/dados/${MEMBERS_JOB}?page=1&pageSize=5`, tokenAdmin);
    const colCodusu = colunas.json?.colunas?.find((c: any) => c.rotulo === "codusu");
    ok("coluna codusu informa a restrição (role = attendant, admin ou manager)", colCodusu?.vinculoRestrito?.campo === "role" && JSON.stringify(colCodusu.vinculoRestrito.valores) === JSON.stringify(["attendant", "admin", "manager"]), JSON.stringify(colCodusu?.vinculoRestrito));
    ok("outras colunas não têm restrição", colunas.json.colunas.filter((c: any) => c.rotulo !== "codusu").every((c: any) => c.vinculoRestrito === null));

    const barrado = await chamar("PATCH", `/sync-kyria/dados/${MEMBERS_JOB}/${naoAtendente.id}`, tokenAdmin, { campo: "codusu", valor: consultor.codusu });
    ok(`membro "${naoAtendente.role}" NÃO pode ser vinculado → 400`, barrado.status === 400, `${barrado.status} ${barrado.json?.error}`);
    const continuaNulo = await prisma.kyriaMember.findUnique({ where: { id: naoAtendente.id }, select: { codusu: true } });
    ok("e o codusu dele continua nulo", continuaNulo?.codusu === null);
    const removerNoOutro = await chamar("PATCH", `/sync-kyria/dados/${MEMBERS_JOB}/${naoAtendente.id}`, tokenAdmin, { campo: "codusu", valor: null });
    ok("remover vínculo de não-atendente continua permitido", removerNoOutro.status === 200, `${removerNoOutro.status}`);
    const liberado = await chamar("PATCH", `/sync-kyria/dados/${MEMBERS_JOB}/${atendente.id}`, tokenAdmin, { campo: "codusu", valor: consultor.codusu });
    ok("atendente PODE ser vinculado → 200", liberado.status === 200, `${liberado.status} ${liberado.json?.error ?? ""}`);
    const gravouAtendente = await prisma.kyriaMember.findUnique({ where: { id: atendente.id }, select: { codusu: true } });
    ok("e o codusu foi gravado", gravouAtendente?.codusu === consultor.codusu);
  } finally {
    if (membroRestaurar) await prisma.kyriaMember.update({ where: { id: membroRestaurar.id }, data: { codusu: null } });
    if (departamentoRestaurar) {
      const d = departamentoRestaurar;
      await prisma.departamentoTimeKyria.deleteMany({ where: { codemp: d.codemp, depexe: d.depexe } });
      if (d.antes.length) await prisma.departamentoTimeKyria.createMany({ data: d.antes.map((kyriaTeamId) => ({ codemp: d.codemp, depexe: d.depexe, kyriaTeamId })) });
    }
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
