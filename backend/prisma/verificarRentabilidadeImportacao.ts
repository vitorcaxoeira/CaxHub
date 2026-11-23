// Verificação da importação de E043PCM (modelo_planos) e E615PRJ (projetos) — Rentabilidade,
// 17/11/2026. Roda os dois jobs de verdade (SÓ LEITURA no Senior; grava nas tabelas locais novas) e
// confere contagem contra a origem, idempotência, normalização do " " do Senior e o cruzamento com
// o que o CaxHub já tem (plano_contabil.despar, clientes.codccu).
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarRentabilidadeImportacao.ts
import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { runSqlViaSoap } from "../src/soap/client";
import { runModeloPlanoSync, JOB_NAME as JOB_PCM } from "../src/sync/modeloPlanoSync";
import { runProjetoSync, JOB_NAME as JOB_PRJ } from "../src/sync/projetoSync";
import { SYNC_JOBS } from "../src/sync/registry";

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
  console.log("== registro nos painéis ==");
  for (const j of [JOB_PCM, JOB_PRJ]) ok(`job ${j} no registry`, SYNC_JOBS.some((s) => s.jobName === j));

  console.log("\n== E043PCM -> modelo_planos ==");
  await runModeloPlanoSync();
  const l1 = await ultimoLog(JOB_PCM);
  ok("sync terminou com sucesso", l1?.status === "success", l1?.message ?? "");
  const origemPcm = n(((await runSqlViaSoap("SELECT COUNT(*) AS t FROM e043pcm")) as any[])[0].t);
  const localPcm = await prisma.modeloPlano.count();
  ok("linhas locais = linhas do Senior", localPcm === origemPcm, `${localPcm} x ${origemPcm}`);
  const vazios = await prisma.modeloPlano.count({ where: { despar: "" } });
  const espacos = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM modelo_planos WHERE despar <> btrim(despar)`;
  ok("nenhum despar vazio ou com espaço sobrando (virou NULL)", vazios === 0 && n(espacos[0].c) === 0);
  const porDespar = await prisma.$queryRaw<{ despar: string | null; c: bigint }[]>`SELECT despar, COUNT(*) AS c FROM modelo_planos WHERE codmpc IN (6, 200) GROUP BY despar ORDER BY COUNT(*) DESC`;
  console.log("    modelos 6 (contas) e 200 (CCs) por despar:", JSON.stringify(porDespar.map((r) => `${r.despar ?? "∅"}=${r.c}`)));

  // Cruzamento: o BI lê o Setor de e043pcm (modelo da empresa), o CaxHub já lia de e045pla.despar.
  const cruz = await prisma.$queryRaw<{ iguais: bigint; diferentes: bigint; so_pla: bigint; so_pcm: bigint }[]>`
    SELECT
      SUM(CASE WHEN COALESCE(p.despar,'') = COALESCE(x.despar,'') AND COALESCE(p.despar,'') <> '' THEN 1 ELSE 0 END) AS iguais,
      SUM(CASE WHEN COALESCE(p.despar,'') <> '' AND COALESCE(x.despar,'') <> '' AND p.despar <> x.despar THEN 1 ELSE 0 END) AS diferentes,
      SUM(CASE WHEN COALESCE(p.despar,'') <> '' AND COALESCE(x.despar,'') = '' THEN 1 ELSE 0 END) AS so_pla,
      SUM(CASE WHEN COALESCE(p.despar,'') = '' AND COALESCE(x.despar,'') <> '' THEN 1 ELSE 0 END) AS so_pcm
    FROM plano_contabil p
    JOIN empresa e ON e.codemp = p.codemp
    LEFT JOIN modelo_planos x ON x.codmpc = e.codmpc AND x.ctared = p.ctared`;
  console.log("    plano_contabil.despar (e045pla) x modelo_planos.despar (e043pcm, modelo da empresa):", JSON.stringify(cruz[0], (_, v) => (typeof v === "bigint" ? Number(v) : v)));

  console.log("\n== E615PRJ -> projetos ==");
  await runProjetoSync();
  const l2 = await ultimoLog(JOB_PRJ);
  ok("sync terminou com sucesso", l2?.status === "success", l2?.message ?? "");
  const origemPrj = n(((await runSqlViaSoap("SELECT COUNT(*) AS t FROM e615prj")) as any[])[0].t);
  const localPrj = await prisma.projeto.count();
  ok("linhas locais = linhas do Senior", localPrj === origemPrj, `${localPrj} x ${origemPrj}`);
  const ccEspaco = await prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM projetos WHERE codccu IS NOT NULL AND btrim(codccu) = ''`;
  ok('nenhum codccu " " (virou NULL)', n(ccEspaco[0].c) === 0);
  const semCc = await prisma.projeto.count({ where: { codccu: null } });
  const origemSemCc = n(((await runSqlViaSoap("SELECT COUNT(*) AS t FROM e615prj WHERE codccu IS NULL OR codccu = ''")) as any[])[0].t);
  ok("projetos sem CC batem com o Senior", semCc === origemSemCc, `${semCc} x ${origemSemCc}`);
  // Projeto apontando pra CC que não está em centros_custo: tem que ser um CC que NÃO existe nem
  // no Senior (dado sujo da origem — hoje o projeto 47 aponta pro CC 1047, inexistente na E044CCU),
  // nunca um CC que existe lá e deixamos de importar.
  const orfaos = await prisma.$queryRaw<{ numprj: number; codccu: string }[]>`SELECT p.numprj, p.codccu FROM projetos p WHERE p.codccu IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo x WHERE x.codemp = p.codemp AND x.codccu = p.codccu)`;
  let orfaosExistentesNoSenior = 0;
  for (const o of orfaos) {
    const r = (await runSqlViaSoap(`SELECT COUNT(*) AS t FROM e044ccu WHERE codccu = '${o.codccu}'`)) as any[];
    if (n(r[0].t) > 0) orfaosExistentesNoSenior++;
  }
  ok("projeto com CC fora de centros_custo só quando o CC não existe no Senior", orfaosExistentesNoSenior === 0, `${orfaos.length} órfão(s): ${orfaos.map((o) => `projeto ${o.numprj} → CC ${o.codccu}`).join("; ") || "nenhum"}`);
  const amostra = await prisma.projeto.findMany({ where: { numprj: { in: [1, 2, 47] } }, orderBy: { numprj: "asc" }, select: { numprj: true, nomprj: true, codcli: true, codccu: true, datipj: true, datfpj: true, cli0800: true } });
  console.log("    amostra:", JSON.stringify(amostra));
  ok("projeto 1 = Altermed, cliente 7, CC 1001, cliente 0800 = 8", amostra[0]?.codcli === 7 && amostra[0]?.codccu === "1001" && amostra[0]?.cli0800 === 8);

  // Cruzamento com o ajuste 01: o CC do projeto e o CC do cliente (E085RAT) concordam?
  const cruzCc = await prisma.$queryRaw<{ iguais: bigint; diferentes: bigint; projeto_sem: bigint; cliente_sem: bigint }[]>`
    SELECT
      SUM(CASE WHEN p.codccu IS NOT NULL AND c.codccu IS NOT NULL AND p.codccu = c.codccu THEN 1 ELSE 0 END) AS iguais,
      SUM(CASE WHEN p.codccu IS NOT NULL AND c.codccu IS NOT NULL AND p.codccu <> c.codccu THEN 1 ELSE 0 END) AS diferentes,
      SUM(CASE WHEN p.codccu IS NULL AND c.codccu IS NOT NULL THEN 1 ELSE 0 END) AS projeto_sem,
      SUM(CASE WHEN p.codccu IS NOT NULL AND c.codccu IS NULL THEN 1 ELSE 0 END) AS cliente_sem
    FROM projetos p LEFT JOIN clientes c ON c.codcli = p.codcli`;
  console.log("    CC do projeto (e615prj) x CC do cliente (e085rat):", JSON.stringify(cruzCc[0], (_, v) => (typeof v === "bigint" ? Number(v) : v)));

  // RAT -> projeto (o JOIN do BI de consultoria): quantas RATs acham projeto e CC?
  const ratPrj = await prisma.$queryRaw<{ rats: bigint; com_projeto: bigint; com_cc: bigint }[]>`
    SELECT COUNT(*) AS rats,
           SUM(CASE WHEN p.numprj IS NOT NULL THEN 1 ELSE 0 END) AS com_projeto,
           SUM(CASE WHEN p.codccu IS NOT NULL THEN 1 ELSE 0 END) AS com_cc
    FROM rats r LEFT JOIN projetos p ON p.codemp = r.codemp AND p.numprj = r.numprj
    WHERE r.numprj IS NOT NULL`;
  console.log("    RATs (numprj preenchido) achando projeto/CC:", JSON.stringify(ratPrj[0], (_, v) => (typeof v === "bigint" ? Number(v) : v)));

  console.log("\n== idempotência (2ª rodada) ==");
  const antesPcm = await prisma.modeloPlano.count();
  const antesPrj = await prisma.projeto.count();
  await runModeloPlanoSync();
  await runProjetoSync();
  ok("contagens não mudam", (await prisma.modeloPlano.count()) === antesPcm && (await prisma.projeto.count()) === antesPrj);
  const l3 = await ultimoLog(JOB_PCM);
  const l4 = await ultimoLog(JOB_PRJ);
  ok("2ª rodada também com sucesso", l3?.status === "success" && l4?.status === "success");
}

main()
  .catch((e) => {
    console.error("ERRO", e);
    falhas++;
  })
  .finally(async () => {
    console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
    await prisma.$disconnect();
    process.exit(falhas === 0 ? 0 : 1);
  });
