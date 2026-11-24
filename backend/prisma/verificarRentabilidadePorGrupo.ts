// Verificação da aba Por Grupo da Rentabilidade (24/11/2026): (1) nos indicadores de CONTAS, a soma dos grupos = total do recorte; (2) o bloco de cada grupo
// = o cálculo com `grupo=` daquele grupo; (3) a origem (link do valor) dentro de um grupo: a soma dos lançamentos = a célula. Só leitura. Express mínimo, JWT local.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarRentabilidadePorGrupo.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { rentabilidadeIndicadoresRouter } from "../src/routes/rentabilidadeIndicadores";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}
const perto = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  if (!admin) throw new Error("precisa de um usuário admin no banco");
  const token = signToken({ userId: admin.id, role: "admin" });

  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/rentabilidade", rentabilidadeIndicadoresRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (caminho: string) => {
    const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  const recorte = "inicio=2026-10&fim=2026-10&restringirModelo=1";
  try {
    const porGrupo = await get(`/rentabilidade/calcular-por-grupo?${recorte}`);
    ok("calcular-por-grupo responde", porGrupo.status === 200 && porGrupo.json.grupos.length > 0, `${porGrupo.json?.grupos?.length} grupos`);
    const grupos: any[] = porGrupo.json.grupos;
    ok("grupos em ordem alfabética, sem grupo por último", grupos.every((g, i) => i === 0 || g.grupo === "" ? true : grupos[i - 1].grupo === "" ? false : grupos[i - 1].grupo.localeCompare(g.grupo, "pt-BR") <= 0));

    // (1) contas: soma dos grupos = total do recorte (indicadores de conta de base realizado, não fórmula nem sistema)
    const config = await prisma.rentabilidadeIndicador.findMany({ where: { tipo: "contas", base: "realizado" }, select: { codigo: true } });
    for (const { codigo } of config.slice(0, 8)) {
      const soma = grupos.reduce((s, g) => s + (g.total[codigo] ?? 0), 0);
      ok(`${codigo}: soma dos grupos = total do recorte`, perto(soma, porGrupo.json.total[codigo] ?? 0), `${soma.toFixed(2)} x ${porGrupo.json.total[codigo] ?? 0}`);
    }

    // (2) cada grupo = o cálculo filtrado por esse grupo
    for (const g of grupos.slice(0, 3)) {
      const filtrado = await get(`/rentabilidade/calcular?${recorte}&grupo=${encodeURIComponent(g.grupo)}`);
      const mesmoTotal = Object.keys(g.total).every((k) => perto(g.total[k] ?? 0, filtrado.json.total[k] ?? 0, 0.02));
      ok(`grupo "${g.rotulo}": total = calcular com grupo=`, filtrado.status === 200 && mesmoTotal);
      ok(`grupo "${g.rotulo}": mesmos CCs`, filtrado.json.linhas.map((l: any) => l.codccu).sort().join() === g.linhas.map((l: any) => l.codccu).sort().join());
    }

    // (3) origem dentro de um grupo: soma dos lançamentos = célula
    const g = grupos.find((x) => x.linhas.some((l: any) => Math.abs(l.valores.ATST ?? 0) >= 0.005));
    if (g) {
      const l = g.linhas.find((x: any) => Math.abs(x.valores.ATST ?? 0) >= 0.005);
      const lanc = await get(`/rentabilidade/origem/lancamentos?${recorte}&indicador=ATST&codccu=${l.codccu}&grupo=${encodeURIComponent(g.grupo)}&pageSize=200`);
      const soma = (lanc.json?.itens ?? []).reduce((s: number, i: any) => s + i.valor, 0);
      ok(`origem ATST em "${g.rotulo}" · CC ${l.codccu}: soma dos lançamentos = célula`, lanc.status === 200 && perto(soma, l.valores.ATST, 0.02), `${soma.toFixed(2)} x ${l.valores.ATST}`);
    } else console.log("    (nenhum grupo com ATST no recorte — origem por grupo não conferida)");

    ok("recorte sem grupo ainda responde igual (calcular)", (await get(`/rentabilidade/calcular?${recorte}`)).status === 200);
  } finally {
    server.close();
    console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
    await prisma.$disconnect();
    process.exit(falhas === 0 ? 0 : 1);
  }
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
