// Verificação da ORIGEM do valor na Rentabilidade (24/11/2026, fase 2: TODAS as colunas). Para cada coluna visível, em alguns CCs, no total do recorte e dentro de um grupo:
//   lançamentos  -> /rentabilidade/origem/lancamentos: o total da lista = o valor da célula de /rentabilidade/calcular;
//   horas        -> /rentabilidade/origem/horas: o total da lista = o valor da célula (horas ou custo das horas);
//   fórmula      -> /rentabilidade/origem: o valor de cada coluna citada = a célula dela na MESMA linha, o total (das de TOTAL()) = o total do recorte.
// Só leitura. Convenção do repo: Express mínimo (nunca o server.ts), JWT local.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarRentabilidadeOrigem.ts
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
  const tokenOutro = signToken({ userId: admin.id, role: "consultor" });

  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/rentabilidade", rentabilidadeIndicadoresRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (caminho: string, t = token) => {
    const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${t}` } });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  /** Confere UMA célula: `valores` = os valores da linha (ou do total) de /calcular, `qs` = o recorte (+ codccu/grupo) da origem. */
  async function conferir(rotulo: string, codigo: string, qs: string, valores: Record<string, number | null>, totalDoRecorte: Record<string, number | null>) {
    const esperado = valores[codigo] ?? 0;
    const res = await get(`/rentabilidade/origem?${qs}&indicador=${codigo}`);
    if (res.status !== 200) return ok(`${rotulo}: origem responde`, false, `${res.status} ${res.json?.error ?? ""}`);
    ok(`${rotulo} [${res.json.tipo}]: valor do resumo = célula`, perto(res.json.valor, esperado), `${res.json.valor} x ${esperado}`);
    if (res.json.tipo === "lancamentos" || res.json.tipo === "horas") {
      const rota = res.json.tipo === "lancamentos" ? "lancamentos" : "horas";
      const lista = await get(`/rentabilidade/origem/${rota}?${qs}&indicador=${codigo}&pageSize=5`);
      ok(`${rotulo}: total da lista de ${rota} = célula`, lista.status === 200 && perto(lista.json.totais?.valor ?? 0, esperado, 0.1), `${lista.status} ${lista.json?.totais?.valor} x ${esperado} (${lista.json?.total} linhas)`);
      const partes = (res.json.componentes ?? []).reduce((s: number, c: any) => s + c.sinal * c.valor, 0);
      ok(`${rotulo}: componentes somam o valor`, perto(partes, esperado, 0.1), `${partes.toFixed(2)}`);
    } else {
      const refs: any[] = res.json.referencias ?? [];
      ok(`${rotulo}: traz a fórmula e as colunas citadas`, !!res.json.indicador.formula && refs.length > 0, res.json.indicador.formula);
      for (const ref of refs) {
        ok(`${rotulo}: ${ref.codigo} = célula da mesma linha`, perto(ref.valor, valores[ref.codigo] ?? 0), `${ref.valor} x ${valores[ref.codigo] ?? 0}`);
        if (ref.total !== null) ok(`${rotulo}: TOTAL(${ref.codigo}) = total do recorte`, perto(ref.total, totalDoRecorte[ref.codigo] ?? 0), `${ref.total} x ${totalDoRecorte[ref.codigo] ?? 0}`);
      }
    }
  }

  try {
    for (const modelo of ["1", "0"]) {
      console.log(`\n== recorte 2026-10, restringirModelo=${modelo} ==`);
      const recorte = `inicio=2026-10&fim=2026-10&restringirModelo=${modelo}`;
      const calc = await get(`/rentabilidade/calcular?${recorte}`);
      ok("calcular responde", calc.status === 200 && calc.json.linhas.length > 0, `${calc.json?.linhas?.length} CCs`);
      const colunas: { codigo: string; origem?: boolean }[] = calc.json.colunas;
      ok("TODA coluna visível tem origem", colunas.every((c) => c.origem === true), colunas.filter((c) => !c.origem).map((c) => c.codigo).join(",") || `${colunas.length} colunas`);

      // total do recorte
      for (const c of colunas) await conferir(`total · ${c.codigo}`, c.codigo, recorte, calc.json.total, calc.json.total);
      // alguns CCs (os 3 primeiros com movimento)
      for (const l of calc.json.linhas.slice(0, 3)) for (const c of colunas) await conferir(`CC ${l.codccu} · ${c.codigo}`, c.codigo, `${recorte}&codccu=${l.codccu}`, l.valores, calc.json.total);
    }

    console.log("\n== dentro de um grupo (aba Por Grupo) ==");
    const recorte = "inicio=2026-10&fim=2026-10&restringirModelo=1";
    const porGrupo = await get(`/rentabilidade/calcular-por-grupo?${recorte}`);
    const g = porGrupo.json.grupos.find((x: any) => x.linhas.length >= 3);
    ok("há um grupo com CCs", !!g);
    if (g) {
      const colunas: { codigo: string }[] = porGrupo.json.colunas;
      const grupoQs = `${recorte}&grupo=${encodeURIComponent(g.grupo)}`;
      for (const c of colunas) await conferir(`grupo ${g.rotulo} · ${c.codigo}`, c.codigo, grupoQs, g.total, g.total);
      const l = g.linhas[0];
      for (const c of colunas) await conferir(`grupo ${g.rotulo} · CC ${l.codccu} · ${c.codigo}`, c.codigo, `${grupoQs}&codccu=${l.codccu}`, l.valores, g.total);
    }

    console.log("\n== limites ==");
    ok("código desconhecido = 404 (resumo)", (await get("/rentabilidade/origem?inicio=2026-10&fim=2026-10&indicador=XYZ")).status === 404);
    ok("horas numa coluna de lançamentos = 404", (await get("/rentabilidade/origem/horas?inicio=2026-10&fim=2026-10&indicador=ATST")).status === 404);
    ok("lançamentos numa coluna de horas = 404", (await get("/rentabilidade/origem/lancamentos?inicio=2026-10&fim=2026-10&indicador=HorasKyria")).status === 404);
    ok("período inválido = 400", (await get("/rentabilidade/origem?inicio=xx&fim=2026-10&indicador=ATST")).status === 400);
    ok("não-admin recebe 403", (await get("/rentabilidade/origem?inicio=2026-10&fim=2026-10&indicador=ATST", tokenOutro)).status === 403);
    ok("campos relacionados disponíveis nos lançamentos", (await get("/rentabilidade/origem/lancamentos/campos?inicio=2026-10&fim=2026-10&indicador=ATST")).status === 200);
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
