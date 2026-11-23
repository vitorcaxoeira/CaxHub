// Verificação das ETIQUETAS por departamento (Administração > Integração Kyria > Departamento x Time, 18/11/2026), contra o banco local. Convenção do
// repo: verificar*.ts, ts-node --transpile-only; Express mínimo (nunca o server.ts), JWT local. O que o teste grava (flag fitro_dep_time de grupos e as
// ligações do departamento) é revertido no `finally`.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarDepartamentoLabels.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { syncKyriaDepartamentosRouter } from "../src/routes/syncKyriaDepartamentos";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  if (!admin) throw new Error("precisa de um usuário admin no banco local");
  const tokenAdmin = signToken({ userId: admin.id, role: "admin" });
  const tokenOutro = signToken({ userId: admin.id, role: "consultor" });
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/sync-kyria/departamentos-times", syncKyriaDepartamentosRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chamar = async (metodo: string, caminho: string, token: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  const gruposAntes = await prisma.kyriaLabelGroup.findMany({ select: { id: true, name: true, fitroDepTime: true } });
  let departamento: { codemp: number; depexe: number; antes: string[] } | null = null;

  try {
    const grupos = await prisma.kyriaLabelGroup.findMany({ orderBy: { name: "asc" } });
    const comEtiquetas = await prisma.$queryRawUnsafe<{ group_id: string; n: number }[]>(`SELECT group_id, count(*)::int n FROM kyria_labels WHERE group_id IS NOT NULL GROUP BY 1 ORDER BY n DESC`);
    const grupoLigado = grupos.find((g) => g.id === comEtiquetas[0].group_id)!;
    const grupoDesligado = grupos.find((g) => g.id === comEtiquetas[1].group_id)!;
    const totalDoGrupo = comEtiquetas[0].n;

    // Estado de partida controlado: só `grupoLigado` marcado.
    await prisma.kyriaLabelGroup.updateMany({ data: { fitroDepTime: false } });
    await prisma.kyriaLabelGroup.update({ where: { id: grupoLigado.id }, data: { fitroDepTime: true } });

    console.log("\n== acesso ==");
    ok("não-admin recebe 403 (GET e PUT)", (await chamar("GET", "/sync-kyria/departamentos-times", tokenOutro)).status === 403 && (await chamar("PUT", "/sync-kyria/departamentos-times/1/5/labels", tokenOutro, { labelIds: [] })).status === 403);

    console.log("\n== etiquetas oferecidas ==");
    const lista = await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin);
    ok("GET devolve gruposHabilitados = 1", lista.status === 200 && lista.json.gruposHabilitados === 1, String(lista.json?.gruposHabilitados));
    const opcoes: { value: string; label: string }[] = lista.json.labelsDisponiveis;
    ok(`oferece TODAS as etiquetas do grupo marcado (${totalDoGrupo}) e só elas`, opcoes.length === totalDoGrupo, `${opcoes.length} oferecidas`);
    const doGrupo = await prisma.kyriaLabel.findMany({ where: { groupId: grupoLigado.id }, select: { id: true, name: true, status: true } });
    ok("são exatamente as etiquetas do grupo (ativas e inativas)", doGrupo.every((l) => opcoes.some((o) => o.value === l.id)) && opcoes.every((o) => doGrupo.some((l) => l.id === o.value)));
    ok("cada opção traz o grupo em campo próprio (para agrupar na tela) e o rótulo só o nome, com '(inativa)' nas inativas", opcoes.every((o: any) => o.grupo === grupoLigado.name && !o.label.startsWith(grupoLigado.name + " · ")) && doGrupo.filter((l) => l.status === "inactive").every((l) => opcoes.find((o) => o.value === l.id)!.label.endsWith("(inativa)")), JSON.stringify(opcoes[0]));
    const deOutroGrupo = await prisma.kyriaLabel.findFirst({ where: { groupId: grupoDesligado.id } });
    ok("etiqueta de grupo NÃO marcado não é oferecida", !!deOutroGrupo && !opcoes.some((o) => o.value === deOutroGrupo.id));
    const semGrupo = await prisma.kyriaLabel.findFirst({ where: { groupId: null } });
    ok("etiqueta sem grupo não é oferecida", !semGrupo || !opcoes.some((o) => o.value === semGrupo.id));

    console.log("\n== gravar por departamento ==");
    const dep = lista.json.departamentos[0];
    const antes = await prisma.departamentoLabelKyria.findMany({ where: { codemp: dep.codemp, depexe: dep.depexe }, select: { kyriaLabelId: true } });
    departamento = { codemp: dep.codemp, depexe: dep.depexe, antes: antes.map((a) => a.kyriaLabelId) };
    const url = `/sync-kyria/departamentos-times/${dep.codemp}/${dep.depexe}/labels`;
    const duas = opcoes.slice(0, 2).map((o) => o.value);
    ok("PUT grava 2 etiquetas", (await chamar("PUT", url, tokenAdmin, { labelIds: duas })).status === 200);
    const depois = await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin);
    const gravadas = depois.json.departamentos.find((d: any) => d.depexe === dep.depexe).labels as string[];
    ok("GET devolve as 2 gravadas no departamento", gravadas.length === 2 && duas.every((i) => gravadas.includes(i)));
    ok("os times do departamento não foram tocados", JSON.stringify(depois.json.departamentos.find((d: any) => d.depexe === dep.depexe).times) === JSON.stringify(dep.times));
    ok("etiqueta de grupo não marcado → 400", (await chamar("PUT", url, tokenAdmin, { labelIds: [deOutroGrupo!.id] })).status === 400);
    ok("etiqueta inexistente → 400", (await chamar("PUT", url, tokenAdmin, { labelIds: ["nao-existe"] })).status === 400);
    ok("corpo inválido → 400", (await chamar("PUT", url, tokenAdmin, { labelIds: "x" })).status === 400);
    ok("departamento inexistente → 404", (await chamar("PUT", `/sync-kyria/departamentos-times/${dep.codemp}/9999/labels`, tokenAdmin, { labelIds: [] })).status === 404);
    const intacto = (await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin)).json.departamentos.find((d: any) => d.depexe === dep.depexe).labels;
    ok("PUT recusado não altera o que estava gravado", intacto.length === 2);

    console.log("\n== grupo deixa de ser marcado ==");
    await prisma.kyriaLabelGroup.update({ where: { id: grupoLigado.id }, data: { fitroDepTime: false } });
    const semGrupoMarcado = await chamar("GET", "/sync-kyria/departamentos-times", tokenAdmin);
    ok("sem grupo marcado: gruposHabilitados = 0 e as 2 já escolhidas continuam na lista, num grupo \"(sem filtro)\"", semGrupoMarcado.json.gruposHabilitados === 0 && semGrupoMarcado.json.labelsDisponiveis.length === 2 && semGrupoMarcado.json.labelsDisponiveis.every((o: any) => o.grupo === `${grupoLigado.name} (sem filtro)`), JSON.stringify(semGrupoMarcado.json.labelsDisponiveis.map((o: any) => `${o.grupo} > ${o.label}`)));
    ok("dá pra manter as escolhidas (PUT com as mesmas)", (await chamar("PUT", url, tokenAdmin, { labelIds: [duas[0]] })).status === 200);
    ok("mas não acrescentar etiqueta nova de grupo não marcado", (await chamar("PUT", url, tokenAdmin, { labelIds: [duas[0], doGrupo.find((l) => !duas.includes(l.id))!.id] })).status === 400);
    ok("limpar tudo (lista vazia)", (await chamar("PUT", url, tokenAdmin, { labelIds: [] })).status === 200 && (await prisma.departamentoLabelKyria.count({ where: { codemp: dep.codemp, depexe: dep.depexe } })) === 0);
  } finally {
    for (const g of gruposAntes) await prisma.kyriaLabelGroup.update({ where: { id: g.id }, data: { fitroDepTime: g.fitroDepTime } });
    if (departamento) {
      const d = departamento;
      await prisma.departamentoLabelKyria.deleteMany({ where: { codemp: d.codemp, depexe: d.depexe } });
      if (d.antes.length) await prisma.departamentoLabelKyria.createMany({ data: d.antes.map((kyriaLabelId) => ({ codemp: d.codemp, depexe: d.depexe, kyriaLabelId })) });
    }
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
