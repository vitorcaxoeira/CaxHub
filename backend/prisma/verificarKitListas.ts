// Verificação do kit de listas (24/11/2026): "Mais campos (tabela e relacionadas)" em todas as listas por registro e "Por página" 5..200. Para cada lista:
//   - GET <lista>/campos devolve as fontes declaradas, e nenhum campo `sencli`;
//   - ligando um campo de CADA fonte (`campos=`), a lista responde 200 e as linhas trazem as colunas extras;
//   - pageSize = 5 e 200 voltam sem corte (o servidor não limita a 10 nem a 100).
// Só leitura. Convenção do repo: Express mínimo (nunca o server.ts), JWT local.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarKitListas.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { contabilRouter } from "../src/routes/contabil";
import { descontosRouter } from "../src/routes/descontos";
import { financeiroRouter } from "../src/routes/financeiro";
import { fluxoCaixaRouter } from "../src/routes/fluxoCaixa";
import { inadimplenciaRouter } from "../src/routes/inadimplencia";
import { recebimentosRouter } from "../src/routes/recebimentos";
import { pedidosRouter } from "../src/routes/pedidos";
import { projetosRouter } from "../src/routes/projetos";
import { ratsRouter } from "../src/routes/rats";
import { gestaoPropostasRouter } from "../src/routes/gestaoPropostas";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  if (!admin) throw new Error("precisa de um usuário admin no banco");
  const token = signToken({ userId: admin.id, role: "admin" });

  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/contabil", contabilRouter);
  app.use("/descontos", descontosRouter);
  app.use("/financeiro", financeiroRouter);
  app.use("/financeiro/fluxo-caixa", fluxoCaixaRouter);
  app.use("/financeiro/inadimplencia", inadimplenciaRouter);
  app.use("/financeiro/recebimentos", recebimentosRouter);
  app.use("/pedidos", pedidosRouter);
  app.use("/projetos", projetosRouter);
  app.use("/rats", ratsRouter);
  app.use("/gestao-propostas", gestaoPropostasRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (caminho: string) => {
    const r = await fetch(base + caminho, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  // Parâmetros que algumas listas exigem (uma conta/mês com lançamento, uma proposta com RAT).
  const rateio = await prisma.$queryRaw<{ ctared: number; mes: string }[]>`
    SELECT ctared, to_char(date_trunc('month', datlct), 'YYYY-MM') AS mes FROM rateios_lancamento WHERE removido_em_senior IS NULL ORDER BY datlct DESC LIMIT 1`;
  const orc = await prisma.$queryRaw<{ ctared: number; mes: string }[]>`
    SELECT ctared, to_char(mesano, 'YYYY-MM') AS mes FROM orcamentos_contabeis WHERE removido_em_senior IS NULL ORDER BY mesano DESC LIMIT 1`;
  const rat = await prisma.rat.findFirst({ where: { codpro: { not: null } }, select: { codemp: true, codpro: true } });

  const listas: { nome: string; caminho: string; params?: string }[] = [
    { nome: "Lançamentos do Resultado", caminho: "/contabil/resultado/lancamentos", params: `ctareds=${rateio[0]?.ctared}&mesReferencia=${rateio[0]?.mes}` },
    { nome: "Linhas do orçamento", caminho: "/contabil/orcado-realizado/orcamentos", params: `ctareds=${orc[0]?.ctared}&mesReferencia=${orc[0]?.mes}` },
    { nome: "Descontos › Lançamentos", caminho: "/descontos/processos" },
    { nome: "Descontos › Parcelas", caminho: "/descontos/parcelas" },
    { nome: "Descontos › Fechamentos", caminho: "/descontos/fechamentos" },
    { nome: "Contas a Receber › Títulos", caminho: "/financeiro/contas-a-receber/titulos" },
    { nome: "Fluxo de Caixa › Operacional (vencendo hoje)", caminho: "/financeiro/fluxo-caixa/operacional/titulos", params: "corte=vencendo_hoje" },
    { nome: "Fluxo de Caixa › Operacional (recebido hoje)", caminho: "/financeiro/fluxo-caixa/operacional/titulos", params: "corte=recebido_hoje" },
    { nome: "Inadimplência", caminho: "/financeiro/inadimplencia" },
    { nome: "Recebimentos", caminho: "/financeiro/recebimentos", params: "datpgtInicio=2020-01-01&datpgtFim=2030-12-31" },
    { nome: "Mercado › Pedidos", caminho: "/pedidos" },
    { nome: "Projetos › Propostas", caminho: "/projetos/propostas" },
    { nome: "Meus Apontamentos (RATs)", caminho: "/rats/lista" },
    { nome: "RATs da proposta (Gestão)", caminho: "/gestao-propostas/rats", params: `codemp=${rat?.codemp}&codpro=${rat?.codpro}` },
  ];

  try {
    for (const l of listas) {
      console.log(`\n== ${l.nome} ==`);
      const q = (extra: string) => `${l.caminho}?${[l.params, extra].filter(Boolean).join("&")}`;
      const campos = await get(`${l.caminho}/campos${l.params ? "?" + l.params : ""}`);
      ok("GET /campos responde com as fontes", campos.status === 200 && Array.isArray(campos.json?.fontes) && campos.json.fontes.length > 0, `${campos.status} ${campos.json?.error ?? campos.json?.fontes?.map((f: any) => f.id).join(", ")}`);
      const fontes: { id: string; campos: { nome: string }[] }[] = campos.json?.fontes ?? [];
      ok("nenhum campo sencli (senha do cliente)", fontes.every((f) => f.campos.every((c) => !c.nome.endsWith("__sencli"))));
      // Um campo de cada fonte (o primeiro que não seja de controle).
      const escolhidos = fontes.map((f) => f.campos[0]?.nome).filter(Boolean) as string[];
      const comExtras = await get(q(`campos=${encodeURIComponent(escolhidos.join(","))}&page=1&pageSize=5`));
      const linhas: any[] = comExtras.json?.linhas ?? comExtras.json?.itens ?? comExtras.json?.rows ?? [];
      ok(`ligando ${escolhidos.length} campo(s) a lista responde 200`, comExtras.status === 200, `${comExtras.status} ${comExtras.json?.error ?? ""}`);
      if (linhas.length > 0) ok("as linhas trazem as colunas extras", escolhidos.every((c) => c in linhas[0]), escolhidos.join(", "));
      else console.log("    (lista vazia no banco local — colunas extras não conferidas nas linhas)");
      for (const tam of [5, 200]) {
        const r = await get(q(`page=1&pageSize=${tam}`));
        const ls: any[] = r.json?.linhas ?? r.json?.itens ?? r.json?.rows ?? [];
        ok(`pageSize=${tam} responde sem cortar`, r.status === 200 && ls.length <= tam && (r.json?.pageSize === undefined || r.json.pageSize === tam), `${r.status} pageSize=${r.json?.pageSize} linhas=${ls.length}/${r.json?.total ?? "?"}`);
      }
      // Campo fora do catálogo é ignorado (não derruba a lista).
      const lixo = await get(q("campos=nao__existe&page=1&pageSize=5"));
      ok("campo fora do catálogo é ignorado", lixo.status === 200);
    }
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
