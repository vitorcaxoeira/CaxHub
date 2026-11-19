// Verificação do custo-hora real, base (bloco C da Rentabilidade, 18/11/2026): as três syncs dos contratos de compra (E460CTR/CCS/REA, SÓ LEITURA no
// Senior) contra a origem, a linha do tempo do valor-hora contra o dado real e a tela Vínculo de Consultores (rotas) contra o banco local. Convenção do
// repo: verificar*.ts, ts-node --transpile-only; Express mínimo (nunca o server.ts), JWT local. O que o teste grava de vínculo (kyria_members.codusu e
// consultor_vinculos) é restaurado no `finally`.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarCustoHoraBase.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { runSqlViaSoap } from "../src/soap/client";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { consultoresVinculosRouter } from "../src/routes/consultoresVinculos";
import { SYNC_JOBS } from "../src/sync/registry";
import { runContratoCompraSync, JOB_NAME as JOB_CTR } from "../src/sync/contratoCompraSync";
import { runContratoCompraServicoSync, JOB_NAME as JOB_CCS } from "../src/sync/contratoCompraServicoSync";
import { runContratoCompraReajusteSync, JOB_NAME as JOB_REA } from "../src/sync/contratoCompraReajusteSync";
import { carregarFiltrosAtivos } from "../src/sync/filtrosAtivos";
import { carregarModosVarreduraAtivos } from "../src/sync/politicaVarredura";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}
const n = (v: unknown) => Number(v);

async function ultimoLog(jobName: string) {
  return prisma.syncLog.findFirst({ where: { jobName }, orderBy: { id: "desc" }, select: { status: true, message: true } });
}

async function main() {
  // O servidor carrega estes caches no boot; um script avulso precisa fazer o mesmo (senão a varredura fica "desligada por política").
  await carregarFiltrosAtivos(SYNC_JOBS);
  await carregarModosVarreduraAtivos();

  console.log("== registro nos painéis ==");
  for (const j of [JOB_CTR, JOB_CCS, JOB_REA]) ok(`job ${j} no registry`, SYNC_JOBS.some((s) => s.jobName === j));

  console.log("\n== E460CTR -> contratos_compra ==");
  await runContratoCompraSync();
  const l1 = await ultimoLog(JOB_CTR);
  ok("sync terminou com sucesso", l1?.status === "success", l1?.message ?? "");
  const origemCtr = n(((await runSqlViaSoap("SELECT COUNT(*) AS t FROM e460ctr")) as any[])[0].t);
  const localCtr = await prisma.contratoCompra.count();
  ok("linhas locais = linhas do Senior", localCtr === origemCtr, `${localCtr} x ${origemCtr}`);
  const dataVazia = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM contratos_compra WHERE inivig = DATE '1900-12-31' OR fimvig = DATE '1900-12-31' OR ultrea = DATE '1900-12-31'`;
  ok("data vazia do Senior (1900-12-31) virou NULL no cabeçalho", n(dataVazia[0].c) === 0);

  console.log("\n== E460CCS -> contratos_compra_servicos ==");
  await runContratoCompraServicoSync();
  const l2 = await ultimoLog(JOB_CCS);
  ok("sync terminou com sucesso", l2?.status === "success", l2?.message ?? "");
  const origemCcs = n(((await runSqlViaSoap("SELECT COUNT(*) AS t FROM e460ccs")) as any[])[0].t);
  const localCcs = await prisma.contratoCompraServico.count();
  ok("linhas locais = linhas do Senior", localCcs === origemCcs, `${localCcs} x ${origemCcs}`);
  const origemSoma = n(((await runSqlViaSoap("SELECT SUM(PreUni) AS t FROM e460ccs WHERE SitCcs = 'A'")) as any[])[0].t);
  const localSoma = await prisma.$queryRaw<{ t: string }[]>`SELECT SUM(preuni)::text AS t FROM contratos_compra_servicos WHERE sitccs = 'A'`;
  ok("soma do preço unitário dos itens ativos confere (precisão de 10 casas preservada)", Math.abs(n(localSoma[0].t) - origemSoma) < 0.001, `${n(localSoma[0].t).toFixed(4)} x ${origemSoma.toFixed(4)}`);

  console.log("\n== E460REA -> contratos_compra_reajustes ==");
  await runContratoCompraReajusteSync();
  const l3 = await ultimoLog(JOB_REA);
  ok("sync terminou com sucesso", l3?.status === "success", l3?.message ?? "");
  const origemRea = n(((await runSqlViaSoap("SELECT COUNT(*) AS t FROM e460rea")) as any[])[0].t);
  const localRea = await prisma.contratoCompraReajuste.count();
  ok("linhas locais = linhas do Senior", localRea === origemRea, `${localRea} x ${origemRea}`);
  const origemVlr = n(((await runSqlViaSoap("SELECT SUM(VlrAtu) AS t FROM e460rea")) as any[])[0].t);
  const localVlr = await prisma.$queryRaw<{ t: string }[]>`SELECT SUM(vlratu)::text AS t FROM contratos_compra_reajustes`;
  ok("soma do valor após reajuste confere", Math.abs(n(localVlr[0].t) - origemVlr) < 0.01, `${n(localVlr[0].t).toFixed(2)} x ${origemVlr.toFixed(2)}`);

  console.log("\n== idempotência ==");
  await runContratoCompraServicoSync();
  await runContratoCompraReajusteSync();
  ok("segunda rodada não duplica nada", (await prisma.contratoCompraServico.count()) === localCcs && (await prisma.contratoCompraReajuste.count()) === localRea);
  const removidos = await prisma.contratoCompraReajuste.count({ where: { removidoEmSenior: { not: null } } });
  ok("nenhuma linha marcada como removida (varredura desligada por padrão)", removidos === 0);

  console.log("\n== cruzamento com o que o CaxHub já tinha ==");
  const semContrato = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM contratos_consultores cc
    WHERE cc.numctr IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contratos_compra k WHERE k.codemp = cc.codemp AND k.numctr = cc.numctr)`;
  ok("todo contrato apontado pela view de consultores (USU_VBI01CTRCS) existe em contratos_compra", n(semContrato[0].c) === 0, `${semContrato[0].c} sem`);
  const fornecedorErrado = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM contratos_consultores cc JOIN contratos_compra k ON k.codemp = cc.codemp AND k.numctr = cc.numctr
    WHERE cc.codfor IS NOT NULL AND k.codfor <> cc.codfor`;
  ok("o fornecedor do contrato é o do consultor (codfor)", n(fornecedorErrado[0].c) === 0, `${fornecedorErrado[0].c} divergentes`);
  const precoDiferente = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM contratos_consultores cc
    JOIN LATERAL (SELECT preuni FROM contratos_compra_servicos s WHERE s.codemp = cc.codemp AND s.numctr = cc.numctr AND s.sitccs = 'A' ORDER BY s.seqccs LIMIT 1) i ON true
    WHERE cc.vlrhor IS NOT NULL AND abs(cc.vlrhor - i.preuni) > 0.01`;
  console.log(`    contratos em que o valor-hora da view difere do preço do item ativo: ${precoDiferente[0].c}`);

  // ---------- rotas ----------
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  if (!admin) throw new Error("precisa de um usuário admin no banco local");
  const tokenAdmin = signToken({ userId: admin.id, role: "admin" });
  const tokenOutro = signToken({ userId: admin.id, role: "consultor" });
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/consultores-vinculos", consultoresVinculosRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chamar = async (metodo: string, caminho: string, token: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  // Estado de partida guardado pra restaurar no fim.
  const membrosAntes = await prisma.kyriaMember.findMany({ select: { id: true, codusu: true } });
  const vinculosAntes = await prisma.consultorVinculo.findMany();

  try {
    console.log("\n== acesso ==");
    ok("não-admin recebe 403", (await chamar("GET", "/consultores-vinculos", tokenOutro)).status === 403);

    console.log("\n== painel ==");
    const painel = await chamar("GET", "/consultores-vinculos", tokenAdmin);
    ok("GET devolve linhas, atendentes e funcionários", painel.status === 200 && painel.json.linhas.length > 0 && painel.json.atendentes.length > 0 && painel.json.funcionarios.length > 0, `${painel.json?.linhas?.length} consultores, ${painel.json?.atendentes?.length} atendentes, ${painel.json?.funcionarios?.length} funcionários`);
    const linhas: any[] = painel.json.linhas;
    ok("só consultores ativos por padrão", linhas.every((l) => l.ativo));
    const comKyriaNoBanco = membrosAntes.filter((m) => m.codusu != null).length;
    ok("a coluna Kyria reflete o que já estava em kyria_members.codusu", linhas.reduce((s, l) => s + l.kyriaMemberIds.length, 0) === comKyriaNoBanco, `${comKyriaNoBanco} vínculos`);

    ok("cada linha traz contaHabilitada (conhab = 1 no Senior)", linhas.every((l) => typeof l.contaHabilitada === "boolean"));
    const habilitadosNoBanco = await prisma.consultor.count({ where: { sitfor: "A", removidoEmSenior: null, conhab: 1 } });
    ok("contaHabilitada confere com consultores.conhab", linhas.filter((l) => l.contaHabilitada).length === habilitadosNoBanco, `${habilitadosNoBanco} habilitados`);
    const demitidosNoBanco = await prisma.hcmColaborador.count({ where: { sitafa: 7, removidoEmSenior: null } });
    const demitidosNaLista = painel.json.funcionarios.filter((f: any) => f.demitido);
    ok("a lista do HCM traz TODOS os demitidos", demitidosNaLista.length === demitidosNoBanco && demitidosNoBanco > 0, `${demitidosNaLista.length} de ${demitidosNoBanco}`);
    ok("cada demitido vem marcado 'DEMITIDO' no rótulo", demitidosNaLista.every((f: any) => f.label.includes("DEMITIDO")));
    ok("quem não é demitido não leva a marca", painel.json.funcionarios.filter((f: any) => !f.demitido).every((f: any) => !f.label.includes("DEMITIDO")));

    const pj = linhas.find((l) => l.contrato?.vlrhor != null && l.valorHora?.reajustes > 0);
    ok("há consultor PJ com valor-hora e reajustes no painel", !!pj);
    if (pj) {
      ok("regime = pj (contrato) quando não há HCM", pj.hcm !== null || pj.regime === "pj", pj.regime);
      const vh = await chamar("GET", `/consultores-vinculos/${pj.codemp}/${pj.codusu}/valor-hora`, tokenAdmin);
      ok("valor-hora: linha do tempo começa no valor original e termina no atual", vh.status === 200 && vh.json.vigencias.length === pj.valorHora.reajustes + 1 && Math.abs(vh.json.vigencias.at(-1).valor - pj.valorHora.precoAtual) < 0.01, JSON.stringify(vh.json.vigencias.slice(0, 3)));
      ok("valor-hora: retenções vêm só como informação", vh.json.item && "irrf" in vh.json.item.retencoes);
      ok("valor-hora: lista os reajustes com valor anterior e novo", vh.json.reajustes.length === pj.valorHora.reajustes && vh.json.reajustes.every((r: any) => r.valorNovo != null), `${vh.json.reajustes.length} reajustes`);
    }

    console.log("\n== Kyria ==");
    const livre = linhas.find((l) => l.kyriaMemberIds.length === 0 && l.sugestaoKyria);
    const atendenteLivre = painel.json.atendentes.find((a: any) => a.vinculadoA == null);
    const alvo = livre ?? linhas.find((l) => l.kyriaMemberIds.length === 0);
    if (alvo && atendenteLivre) {
      const r1 = await chamar("PUT", `/consultores-vinculos/${alvo.codemp}/${alvo.codusu}/kyria`, tokenAdmin, { memberId: atendenteLivre.value });
      const depois = await prisma.kyriaMember.findUnique({ where: { id: atendenteLivre.value }, select: { codusu: true } });
      ok("vincula atendente livre (grava kyria_members.codusu)", r1.status === 200 && depois?.codusu === alvo.codusu);
      // Trocar por outro atendente livre: o primeiro deixa de apontar pro consultor.
      const outro = painel.json.atendentes.find((a: any) => a.vinculadoA == null && a.value !== atendenteLivre.value);
      if (outro) {
        await chamar("PUT", `/consultores-vinculos/${alvo.codemp}/${alvo.codusu}/kyria`, tokenAdmin, { memberId: outro.value });
        const aposTroca = await prisma.kyriaMember.findMany({ where: { codusu: alvo.codusu }, select: { id: true } });
        ok("trocar o atendente deixa UM só apontando pro consultor", aposTroca.length === 1 && aposTroca[0].id === outro.value);
      }
      const ocupado = await chamar("PUT", `/consultores-vinculos/${linhas[0].codemp}/${linhas[0].codusu === alvo.codusu ? linhas[1].codusu : linhas[0].codusu}/kyria`, tokenAdmin, { memberId: outro?.value ?? atendenteLivre.value });
      ok("atendente já ligado a outro consultor exige confirmação (409)", ocupado.status === 409, ocupado.json?.error ?? "");
      const rem = await chamar("PUT", `/consultores-vinculos/${alvo.codemp}/${alvo.codusu}/kyria`, tokenAdmin, { memberId: null });
      ok("remover o vínculo limpa o campo", rem.status === 200 && (await prisma.kyriaMember.count({ where: { codusu: alvo.codusu } })) === 0);
    } else {
      console.log("    (sem consultor/atendente livre pra exercitar — passo ignorado)");
    }
    const naoAtendente = await prisma.kyriaMember.findFirst({ where: { role: { notIn: ["attendant", "admin", "manager"] } }, select: { id: true } });
    if (naoAtendente) {
      const r = await chamar("PUT", `/consultores-vinculos/${linhas[0].codemp}/${linhas[0].codusu}/kyria`, tokenAdmin, { memberId: naoAtendente.id });
      ok("membro fora de attendant/admin/manager é recusado (400)", r.status === 400, r.json?.error ?? "");
    }
    for (const papel of ["admin", "manager"]) {
      const livre = await prisma.kyriaMember.findFirst({ where: { role: papel, codusu: null }, select: { id: true } });
      const cons = linhas.find((l: any) => l.kyriaMemberIds.length === 0);
      if (!livre || !cons) continue;
      const r = await chamar("PUT", `/consultores-vinculos/${cons.codemp}/${cons.codusu}/kyria`, tokenAdmin, { memberId: livre.id });
      ok(`membro '${papel}' pode ser vinculado (200)`, r.status === 200 && (await prisma.kyriaMember.findUnique({ where: { id: livre.id } }))?.codusu === cons.codusu, `${r.status} ${r.json?.error ?? ""}`);
      await chamar("PUT", `/consultores-vinculos/${cons.codemp}/${cons.codusu}/kyria`, tokenAdmin, { memberId: null });
    }
    ok("memberId inexistente = 404", (await chamar("PUT", `/consultores-vinculos/${linhas[0].codemp}/${linhas[0].codusu}/kyria`, tokenAdmin, { memberId: "nao-existe" })).status === 404);
    ok("corpo inválido = 400", (await chamar("PUT", `/consultores-vinculos/${linhas[0].codemp}/${linhas[0].codusu}/kyria`, tokenAdmin, {})).status === 400);

    console.log("\n== HCM ==");
    const consA = linhas.find((l) => l.hcm == null)!;
    const consB = linhas.find((l) => l.hcm == null && l.codusu !== consA.codusu)!;
    const func = painel.json.funcionarios.find((f: any) => f.vinculadoA == null && !f.demitido) ?? painel.json.funcionarios.find((f: any) => f.vinculadoA == null);
    const h1 = await chamar("PUT", `/consultores-vinculos/${consA.codemp}/${consA.codusu}/hcm`, tokenAdmin, { colaborador: func.value });
    const gravado = await prisma.consultorVinculo.findUnique({ where: { codemp_codusu: { codemp: consA.codemp, codusu: consA.codusu } } });
    ok("vincula funcionário do HCM (consultor_vinculos)", h1.status === 200 && `${gravado?.hcmNumemp}-${gravado?.hcmTipcol}-${gravado?.hcmNumcad}` === func.value);
    const h2 = await chamar("PUT", `/consultores-vinculos/${consB.codemp}/${consB.codusu}/hcm`, tokenAdmin, { colaborador: func.value });
    ok("funcionário já ligado a outro consultor exige confirmação (409)", h2.status === 409, h2.json?.error ?? "");
    const h3 = await chamar("PUT", `/consultores-vinculos/${consB.codemp}/${consB.codusu}/hcm`, tokenAdmin, { colaborador: func.value, forcar: true });
    const aposTroca = await prisma.consultorVinculo.findMany({ where: { hcmNumcad: { not: null } } });
    ok("com confirmação o funcionário muda de consultor (e só um fica com ele)", h3.status === 200 && aposTroca.filter((v) => `${v.hcmNumemp}-${v.hcmTipcol}-${v.hcmNumcad}` === func.value).length === 1 && aposTroca.find((v) => `${v.hcmNumemp}-${v.hcmTipcol}-${v.hcmNumcad}` === func.value)?.codusu === consB.codusu);
    const painel2 = await chamar("GET", "/consultores-vinculos", tokenAdmin);
    const lb = painel2.json.linhas.find((l: any) => l.codusu === consB.codusu);
    ok("o painel mostra o vínculo e o regime 'folha' (sem contrato)", lb.hcm === func.value && (lb.regime === "folha" || lb.regime === "ambos"), lb.regime);
    ok("funcionário ligado some das sugestões dos outros e aparece ocupado nas opções", painel2.json.funcionarios.find((f: any) => f.value === func.value).vinculadoA === consB.codusu);
    ok("colaborador inexistente = 404", (await chamar("PUT", `/consultores-vinculos/${consA.codemp}/${consA.codusu}/hcm`, tokenAdmin, { colaborador: "9-9-999999" })).status === 404);
    ok("colaborador mal formado = 400", (await chamar("PUT", `/consultores-vinculos/${consA.codemp}/${consA.codusu}/hcm`, tokenAdmin, { colaborador: "abc" })).status === 400);
    const h4 = await chamar("PUT", `/consultores-vinculos/${consB.codemp}/${consB.codusu}/hcm`, tokenAdmin, { colaborador: null });
    ok("remover o vínculo HCM zera as três colunas", h4.status === 200 && (await prisma.consultorVinculo.count({ where: { hcmNumcad: { not: null }, codusu: consB.codusu } })) === 0);
    const o1 = await chamar("PUT", `/consultores-vinculos/${consA.codemp}/${consA.codusu}/observacao`, tokenAdmin, { observacao: "  CLT desde 2024  " });
    ok("observação grava aparada", o1.status === 200 && (await prisma.consultorVinculo.findUnique({ where: { codemp_codusu: { codemp: consA.codemp, codusu: consA.codusu } } }))?.observacao === "CLT desde 2024");
    ok("observação longa demais = 400", (await chamar("PUT", `/consultores-vinculos/${consA.codemp}/${consA.codusu}/observacao`, tokenAdmin, { observacao: "x".repeat(501) })).status === 400);

    console.log("\n== preço do contrato mensal ==");
    ok("cada linha traz valorManual e contratoMensal", linhas.every((l) => l.valorManual && typeof l.valorManual.vigencias === "number" && typeof l.contratoMensal === "boolean"));
    const alvoM = linhas.find((l) => l.contrato)!;
    const m1 = await chamar("PUT", `/consultores-vinculos/${alvoM.codemp}/${alvoM.codusu}/contrato-mensal`, tokenAdmin, { mensal: true, desde: "2023-03", ate: "2026-08" });
    const gravM = await prisma.consultorVinculo.findUnique({ where: { codemp_codusu: { codemp: alvoM.codemp, codusu: alvoM.codusu } } });
    ok("marca o contrato como mensal com período", m1.status === 200 && gravM?.contratoMensal === true && gravM.mensalDesde?.toISOString().slice(0, 10) === "2023-03-01" && gravM.mensalAte?.toISOString().slice(0, 10) === "2026-08-01");
    const painelM = await chamar("GET", "/consultores-vinculos", tokenAdmin);
    const lm = painelM.json.linhas.find((l: any) => l.codusu === alvoM.codusu);
    ok("o painel devolve o período em AAAA-MM", lm.contratoMensal === true && lm.mensalDesde === "2023-03" && lm.mensalAte === "2026-08");
    ok("período invertido = 400", (await chamar("PUT", `/consultores-vinculos/${alvoM.codemp}/${alvoM.codusu}/contrato-mensal`, tokenAdmin, { mensal: true, desde: "2026-09", ate: "2026-01" })).status === 400);
    ok("sem o campo mensal = 400", (await chamar("PUT", `/consultores-vinculos/${alvoM.codemp}/${alvoM.codusu}/contrato-mensal`, tokenAdmin, {})).status === 400);
    await chamar("PUT", `/consultores-vinculos/${alvoM.codemp}/${alvoM.codusu}/contrato-mensal`, tokenAdmin, { mensal: false, desde: "2023-03" });
    const gravM2 = await prisma.consultorVinculo.findUnique({ where: { codemp_codusu: { codemp: alvoM.codemp, codusu: alvoM.codusu } } });
    ok("desmarcar apaga o período", gravM2?.contratoMensal === false && gravM2.mensalDesde === null && gravM2.mensalAte === null);

    console.log("\n== sugestões em lote ==");
    const lote = await chamar("POST", "/consultores-vinculos/aplicar-sugestoes", tokenAdmin, { lado: "hcm" });
    ok("aplicar sugestões do HCM responde com a contagem", lote.status === 200 && typeof lote.json.aplicadas === "number", `${lote.json?.aplicadas} aplicadas`);
    ok("lado inválido = 400", (await chamar("POST", "/consultores-vinculos/aplicar-sugestoes", tokenAdmin, { lado: "x" })).status === 400);
  } finally {
    // Restaura o estado de partida (nada do teste fica no banco).
    for (const m of membrosAntes) await prisma.kyriaMember.update({ where: { id: m.id }, data: { codusu: m.codusu } });
    await prisma.consultorVinculo.deleteMany({});
    for (const v of vinculosAntes) await prisma.consultorVinculo.create({ data: v });
    server.close();
    await prisma.$disconnect();
  }

  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
