// Verificação ponta a ponta dos indicadores configuráveis da Rentabilidade (17/11/2026), contra o banco local. Convenção do repo: verificar*.ts,
// rodado com ts-node --transpile-only; Express mínimo (nunca o server.ts, que agenda syncs reais).
//
// Nenhuma conta mora aqui: a configuração vem do arquivo JSON do BI (fora do repo) e entra pela MESMA rota que a tela usa, depois de passar pelo
// leitor de texto de fórmula da tela (frontend/src/lib/formulas/formula.ts) — o servidor só aceita a árvore. Os números esperados abaixo são os
// do print do BI (jul/2026). Exige a tabela de indicadores VAZIA no começo e a deixa vazia no fim.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarRentabilidadeIndicadores.ts [caminho/indicadores-bi.json]
import "dotenv/config";
import assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { rentabilidadeIndicadoresRouter } from "../src/routes/rentabilidadeIndicadores";
import ts from "typescript";

// O leitor de texto de fórmula é da TELA (frontend/src/lib/formulas/formula.ts, módulo ESM puro, sem dependência de navegador). Em vez de copiá-lo,
// o arquivo é transpilado em memória: continua existindo um leitor só.
type ColunaDisponivel = { nome: string; titulo: string; tipo: "decimal" };
function carregarLeitorDaTela(): { analisarFormula: (texto: string, colunas: ColunaDisponivel[]) => { ok: true; arvore: any } | { ok: false; erro: string } } {
  const fonte = readFileSync(resolve(__dirname, "../../frontend/src/lib/formulas/formula.ts"), "utf-8");
  const js = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const modulo = { exports: {} as any };
  new Function("exports", "module", js)(modulo.exports, modulo);
  return modulo.exports;
}
const { analisarFormula } = carregarLeitorDaTela();

const ARQUIVO = process.argv[2] ?? "D:/Projeto com IA/Exemplos/Soeltech/Rentabilidade/indicadores-bi.json";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}
const perto = (a: number | null | undefined, b: number, tol = 0.006) => typeof a === "number" && Math.abs(a - b) <= tol;

async function main() {
  assert((await prisma.rentabilidadeIndicador.count()) === 0, "a tabela de indicadores precisa estar vazia (esta verificação a esvazia no fim)");
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  assert(admin, "precisa de um usuário admin no banco local");
  const tokenAdmin = signToken({ userId: admin.id, role: "admin" });
  const tokenOutro = signToken({ userId: admin.id, role: "consultor" });

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(attachCorrelationId);
  app.use("/rentabilidade", rentabilidadeIndicadoresRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chamar = async (metodo: string, caminho: string, token: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  try {
    console.log("\n== acesso ==");
    ok("não-admin recebe 403 na lista", (await chamar("GET", "/rentabilidade/indicadores", tokenOutro)).status === 403);
    ok("não-admin recebe 403 no cálculo", (await chamar("GET", "/rentabilidade/calcular?inicio=2026-07", tokenOutro)).status === 403);
    const vazia = await chamar("GET", "/rentabilidade/calcular?inicio=2026-07&fim=2026-07", tokenAdmin);
    ok("sem configuração: devolve aviso e nenhuma linha", vazia.status === 200 && vazia.json.linhas.length === 0 && vazia.json.avisos.length === 1);

    console.log("\n== importar o arquivo do BI (como a tela faz) ==");
    const arquivo = JSON.parse(readFileSync(ARQUIVO, "utf-8")) as { indicadores: any[] };
    const colunas: ColunaDisponivel[] = arquivo.indicadores.map((i) => ({ nome: i.codigo, titulo: i.rotulo, tipo: "decimal" }));
    const payload = arquivo.indicadores.map((i) => {
      let formulaArvore = null;
      if (i.tipo === "formula") {
        const a = analisarFormula(i.formula, colunas);
        assert(a.ok, `fórmula de ${i.codigo} não leu: ${a.ok ? "" : a.erro}`);
        formulaArvore = a.arvore;
      }
      return { ...i, formulaTexto: i.formula, formulaArvore };
    });
    const imp = await chamar("POST", "/rentabilidade/importar", tokenAdmin, { modo: "substituir", indicadores: payload });
    ok("importação aceita", imp.status === 200 && imp.json.importados === payload.length, JSON.stringify(imp.json));
    ok("avisa as contas da lista que não existem no plano (759 e 760)", JSON.stringify([...(imp.json.contasForaDoPlano ?? [])].sort()) === "[759,760]", JSON.stringify(imp.json.contasForaDoPlano));

    console.log("\n== jul/2026: os cards do print do BI ==");
    const calc = await chamar("GET", "/rentabilidade/calcular?inicio=2026-07&fim=2026-07", tokenAdmin);
    ok("cálculo responde", calc.status === 200, `${calc.json?.linhas?.length} centros de custo`);
    const t = calc.json.total;
    ok("Gastos com Pessoal −550.615,77", perto(t.Pessoal, -550615.77), String(t.Pessoal));
    ok("Outros Gastos −108.572,90", perto(t.OutrosGastos, -108572.9), String(t.OutrosGastos));
    ok("Repasses −486.475,89", perto(t.Repasses, -486475.89), String(t.Repasses));
    ok("Deduções −82.421,87", perto(t.Deducoes, -82421.87), String(t.Deducoes));
    ok("Receita (ATST + Serviços) 1.094.779,92", perto(t.ReceitaTotal, 1094779.92), String(t.ReceitaTotal));
    ok("Margem −133.306,51", perto(t.Margem, -133306.51), String(t.Margem));
    ok("Margem % −12,18%", perto(t.MargemPct, -0.1218, 0.00005), String(t.MargemPct));
    const elis = calc.json.linhas.find((l: any) => l.codccu === "1102");
    ok("Grupo Elis (CC 1102): receita 215.476,35, repasses −57.040,83, deduções −17.832,46", !!elis && perto(elis.valores.ReceitaTotal, 215476.35) && perto(elis.valores.Repasses, -57040.83) && perto(elis.valores.Deducoes, -17832.46), JSON.stringify(elis?.valores && { r: elis.valores.ReceitaTotal, rep: elis.valores.Repasses, ded: elis.valores.Deducoes }));
    ok("colunas visíveis não trazem os insumos escondidos", !calc.json.colunas.some((c: any) => c.codigo === "PessoalDebito"));
    const somaLinhas = calc.json.linhas.reduce((a: number, l: any) => a + l.valores.Pessoal, 0);
    ok("a soma das linhas fecha com o total (Pessoal)", perto(somaLinhas, t.Pessoal, 0.05), String(somaLinhas));
    const somaPct = calc.json.linhas.reduce((a: number, l: any) => a + (l.valores.HorasPct ?? 0), 0);
    ok("Horas % soma 100% nas linhas", perto(somaPct, 1, 0.0005), String(somaPct));
    ok("horas do suporte (Kyria) de jul/2026 ≈ 215,3 h", perto(t.HorasKyria, 215.3, 0.15), String(t.HorasKyria));
    ok("horas de RAT de jul/2026 ≈ 3.720,8 h", perto(t.HorasRat, 3720.8, 0.15), String(t.HorasRat));

    console.log("\n== o filtro do modelo (INNER JOIN com a E043PCM no BI) ==");
    const semModelo = await chamar("GET", "/rentabilidade/calcular?inicio=2026-07&fim=2026-07&restringirModelo=0", tokenAdmin);
    ok("sem restringir ao modelo, Outros Gastos muda (4 CCs fora do modelo 200)", semModelo.status === 200 && !perto(semModelo.json.total.OutrosGastos, t.OutrosGastos, 0.01), `${semModelo.json.total.OutrosGastos} contra ${t.OutrosGastos}`);

    console.log("\n== diagnóstico (o que o BI não avisa) ==");
    const diag = await chamar("GET", "/rentabilidade/diagnostico?inicio=2026-07&fim=2026-07", tokenAdmin);
    const dobradas = new Set((diag.json.emMaisDeUm ?? []).map((d: any) => d.ctared));
    ok("acusa SÓ as contas 189, 593 e 551 (Deduções e Serviços ao mesmo tempo); variantes só débito/crédito não contam", dobradas.size === 3 && [189, 593, 551].every((c) => dobradas.has(c)), JSON.stringify([...dobradas]));
    ok("lista contas com movimento sem indicador", Array.isArray(diag.json.semIndicador) && diag.json.semIndicador.length > 0, `${diag.json.semIndicador?.length} contas`);

    console.log("\n== validações ==");
    const lista = await chamar("GET", "/rentabilidade/indicadores", tokenAdmin);
    const porCodigo = new Map<string, any>((lista.json.indicadores as any[]).map((i) => [i.codigo, i]));
    const novo = (extra: object) => ({ rotulo: "Teste", tipo: "contas", ...extra });
    ok("código repetido → 400", (await chamar("POST", "/rentabilidade/indicadores", tokenAdmin, novo({ codigo: "ATST" }))).status === 400);
    ok("código inválido → 400", (await chamar("POST", "/rentabilidade/indicadores", tokenAdmin, novo({ codigo: "1ab" }))).status === 400);
    const citaInexistente = analisarFormula("[Fantasma] + 1", [...colunas, { nome: "Fantasma", titulo: "Fantasma", tipo: "decimal" }]);
    assert(citaInexistente.ok);
    ok("fórmula citando indicador que não existe → 400", (await chamar("POST", "/rentabilidade/indicadores", tokenAdmin, novo({ codigo: "Z1", tipo: "formula", formulaTexto: "[Fantasma] + 1", formulaArvore: citaInexistente.arvore }))).status === 400);
    const ciclo = analisarFormula("[HorasPct] + 1", colunas);
    assert(ciclo.ok);
    const horasTotal = porCodigo.get("HorasTotal");
    const cicloResp = await chamar("PUT", `/rentabilidade/indicadores/${horasTotal.id}`, tokenAdmin, { ...horasTotal, formulaTexto: "[HorasPct] + 1", formulaArvore: ciclo.arvore });
    ok("fórmula em círculo (HorasTotal → HorasPct → HorasTotal) → 400 com o caminho", cicloResp.status === 400 && /em círculo/.test(cicloResp.json?.error ?? ""), cicloResp.json?.error);
    const delUsado = await chamar("DELETE", `/rentabilidade/indicadores/${porCodigo.get("ATST").id}`, tokenAdmin);
    ok("excluir indicador citado em fórmula → 409 dizendo quem usa", delUsado.status === 409 && /ReceitaTotal/.test(delUsado.json?.error ?? ""), delUsado.json?.error);
    const renomear = await chamar("PUT", `/rentabilidade/indicadores/${porCodigo.get("ATST").id}`, tokenAdmin, { ...porCodigo.get("ATST"), codigo: "ATST2" });
    ok("mudar o código de um indicador citado → 409", renomear.status === 409);
    ok("período inválido → 400", (await chamar("GET", "/rentabilidade/calcular?inicio=2026-13", tokenAdmin)).status === 400);
    ok("período longo demais → 400", (await chamar("GET", "/rentabilidade/calcular?inicio=2020-01&fim=2026-12", tokenAdmin)).status === 400);
    const orcSetor = await chamar("POST", "/rentabilidade/indicadores", tokenAdmin, novo({ codigo: "Z2", base: "orcado", natureza: "debito" }));
    ok("orçado com natureza débito → 400", orcSetor.status === 400);

    console.log("\n== exportar e importar de volta ==");
    const exp = await chamar("GET", "/rentabilidade/exportar", tokenAdmin);
    ok("exportação traz todos os indicadores com a fórmula em texto", exp.status === 200 && exp.json.indicadores.length === payload.length && exp.json.indicadores.find((i: any) => i.codigo === "Margem").formula === "[ReceitaBruta] - ABS([TotalCustos])");

    console.log("\n== criar, editar e excluir pela tela ==");
    const criado = await chamar("POST", "/rentabilidade/indicadores", tokenAdmin, novo({ codigo: "ReceitaOrcada", rotulo: "Receita orçada (ATST)", base: "orcado", contas: [{ codemp: 1, ctared: 182, acao: "incluir" }] }));
    ok("cria indicador de contas (orçado)", criado.status === 201, JSON.stringify(criado.json));
    const orc = await chamar("GET", "/rentabilidade/calcular?inicio=2026-07&fim=2026-07", tokenAdmin);
    ok("o orçado entra no cálculo (coluna presente)", orc.status === 200 && orc.json.colunas.some((c: any) => c.codigo === "ReceitaOrcada") && typeof orc.json.total.ReceitaOrcada === "number", String(orc.json.total?.ReceitaOrcada));
    ok("exclui o indicador novo (ninguém cita)", (await chamar("DELETE", `/rentabilidade/indicadores/${criado.json.id}`, tokenAdmin)).status === 200);
  } finally {
    await prisma.rentabilidadeIndicador.deleteMany({});
    server.close();
    console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
    await prisma.$disconnect();
    process.exit(falhas === 0 ? 0 : 1);
  }
}
main().catch(async (e) => {
  console.error("ERRO", e);
  await prisma.rentabilidadeIndicador.deleteMany({}).catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});
