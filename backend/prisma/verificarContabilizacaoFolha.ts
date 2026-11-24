// Verificação do espelho da R048CTB (hcm_contabilizacao_folha, 19/11/2026) contra o HCM real (SÓ LEITURA no Senior; grava na tabela local nova): carga completa,
// contagem e somas por mês, idempotência, regravação do mês (linha estranha some), e a conciliação com o razão do ERP já espelhado.
// O HCM é lido pelo banco `rhsenior.dbo.` do canal do ERP (o .env local não declara SENIOR_HCM_BANCO): definido aqui, só neste processo.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarContabilizacaoFolha.ts
import "dotenv/config";

process.env.SENIOR_HCM_BANCO = process.env.SENIOR_HCM_BANCO || "rhsenior.dbo.";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}
const perto = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;

async function main() {
  // Importa depois de definir o prefixo: a QUERY do job é montada no import.
  const { prisma } = await import("../src/db/prisma");
  const { runSqlViaSoap } = await import("../src/soap/client");
  const job = await import("../src/sync/hcm/contabilizacaoFolhaSync");
  const { SYNC_JOBS_HCM } = await import("../src/sync/registry");

  console.log("== registro e unidades ==");
  ok("job no painel do HCM", SYNC_JOBS_HCM.some((j) => j.jobName === job.JOB_NAME && j.sistema === "hcm" && j.tabelaLocal === job.TABELA_LOCAL));
  ok("query lê a R048CTB do banco do HCM", /FROM rhsenior\.dbo\.r048ctb$/i.test(job.QUERY), job.QUERY.slice(-40));
  ok("mesesEntre / proximoMes / ultimosMeses", job.mesesEntre("2026-11-01", "2027-02-01").join() === "2026-11-01,2026-12-01,2027-01-01,2027-02-01" && job.proximoMes("2026-12-01") === "2027-01-01" && job.ultimosMeses(3, new Date("2026-01-15T12:00:00Z")).join() === "2025-11-01,2025-12-01,2026-01-01");
  ok("conta do lançamento: reddeb no débito, redcre no crédito", job.contaDoLancamento({ debcre: "D", reddeb: 224, redcre: 0 }) === 224 && job.contaDoLancamento({ debcre: "C", reddeb: 0, redcre: 444 }) === 444 && job.contaDoLancamento({ debcre: "D", reddeb: 0, redcre: 5 }) === null);

  console.log("\n== carga completa (tabela vazia) ==");
  await prisma.hcmContabilizacaoFolha.deleteMany({});
  const t0 = Date.now();
  await job.runContabilizacaoFolhaSync();
  const log = await prisma.syncLog.findFirst({ where: { jobName: job.JOB_NAME }, orderBy: { id: "desc" }, select: { status: true, message: true } });
  ok("sync terminou com sucesso", log?.status === "success", log?.message ?? "");
  console.log(`    (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const origem = (await runSqlViaSoap(`SELECT COUNT(*) AS n, SUM(CASE WHEN debcre = 'D' THEN vallan ELSE 0 END) AS d, SUM(CASE WHEN debcre = 'C' THEN vallan ELSE 0 END) AS c FROM rhsenior.dbo.r048ctb WHERE perrat = 0`)) as { n: number; d: number; c: number }[];
  const local = await prisma.$queryRaw<{ n: number; d: number; c: number }[]>`SELECT count(*)::int AS n, COALESCE(SUM(CASE WHEN debcre = 'D' THEN vallan END), 0)::float8 AS d, COALESCE(SUM(CASE WHEN debcre = 'C' THEN vallan END), 0)::float8 AS c FROM hcm_contabilizacao_folha`;
  ok("linhas locais = linhas originais (perrat = 0) do HCM", local[0].n === origem[0].n, `${local[0].n} x ${origem[0].n}`);
  ok("soma dos débitos confere", perto(local[0].d, origem[0].d, 0.05), `${local[0].d.toFixed(2)} x ${origem[0].d.toFixed(2)}`);
  ok("soma dos créditos confere", perto(local[0].c, origem[0].c, 0.05), `${local[0].c.toFixed(2)} x ${origem[0].c.toFixed(2)}`);
  ok("débito = crédito (a contabilização fecha)", perto(local[0].d, local[0].c, 0.05), `${(local[0].d - local[0].c).toFixed(2)}`);

  const porMesOrigem = (await runSqlViaSoap(`SELECT YEAR(datlan) AS a, MONTH(datlan) AS m, COUNT(*) AS n, SUM(vallan) AS v FROM rhsenior.dbo.r048ctb WHERE perrat = 0 AND datlan >= '2026-05-01' GROUP BY YEAR(datlan), MONTH(datlan) ORDER BY 1, 2`)) as { a: number; m: number; n: number; v: number }[];
  const porMesLocal = await prisma.$queryRaw<{ a: number; m: number; n: number; v: number }[]>`SELECT EXTRACT(YEAR FROM datlan)::int AS a, EXTRACT(MONTH FROM datlan)::int AS m, count(*)::int AS n, SUM(vallan)::float8 AS v FROM hcm_contabilizacao_folha WHERE datlan >= '2026-05-01' GROUP BY 1, 2 ORDER BY 1, 2`;
  ok("mês a mês (desde 05/2026) bate em linhas e valor", porMesOrigem.length === porMesLocal.length && porMesOrigem.every((o, i) => o.n === porMesLocal[i].n && perto(o.v, porMesLocal[i].v, 0.05)), `${porMesLocal.length} meses`);

  const semConta = await prisma.hcmContabilizacaoFolha.count({ where: { ctared: null } });
  ok("toda linha tem conta do plano (reddeb/redcre do lado certo)", semConta === 0, `${semConta} sem conta`);
  const contaTorta = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM hcm_contabilizacao_folha WHERE ctared IS DISTINCT FROM CASE WHEN debcre = 'D' THEN reddeb ELSE redcre END`;
  ok("ctared = reddeb (débito) ou redcre (crédito)", contaTorta[0].n === 0);
  const textoSujo = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM hcm_contabilizacao_folha WHERE cplhis <> btrim(cplhis) OR codccu = ''`;
  ok("textos aparados, sem centro de custo vazio", textoSujo[0].n === 0);

  console.log("\n== idempotência e regravação do mês ==");
  const totalAntes = await prisma.hcmContabilizacaoFolha.count();
  await job.runContabilizacaoFolhaSync();
  ok("rodar de novo (3 últimos meses) não duplica nada", (await prisma.hcmContabilizacaoFolha.count()) === totalAntes);
  const ultimoMes = job.ultimosMeses(1)[0];
  const mesComDado = (await prisma.$queryRaw<{ m: Date }[]>`SELECT date_trunc('month', max(datlan))::date AS m FROM hcm_contabilizacao_folha`)[0].m.toISOString().slice(0, 10);
  const alvo = await prisma.hcmContabilizacaoFolha.findFirst({ where: { datlan: { gte: new Date(`${mesComDado}T00:00:00Z`) } } });
  await prisma.hcmContabilizacaoFolha.create({ data: { numemp: 1, tipcol: 1, numcad: 999999, datlan: alvo!.datlan, debcre: "D", reddeb: 224, ctared: 224, vallan: 123456.78 } });
  await prisma.hcmContabilizacaoFolha.deleteMany({ where: { id: alvo!.id } });
  await job.runContabilizacaoFolhaSync();
  ok("linha inventada no mês some e a apagada volta (o mês é regravado por inteiro)", (await prisma.hcmContabilizacaoFolha.count({ where: { numcad: 999999 } })) === 0 && (await prisma.hcmContabilizacaoFolha.count()) === totalAntes, `mês ${mesComDado}, hoje ${ultimoMes}`);

  console.log("\n== conciliação jul/2026 com o razão do ERP (contas de resultado, grupo 4) ==");
  const hcm = await prisma.$queryRaw<{ ctared: number; liquido: number }[]>`
    SELECT c.ctared, SUM(CASE WHEN c.debcre = 'D' THEN c.vallan ELSE -c.vallan END)::float8 AS liquido
    FROM hcm_contabilizacao_folha c JOIN plano_contabil pc ON pc.codemp = c.numemp AND pc.ctared = c.ctared
    WHERE c.datlan >= '2026-07-01' AND c.datlan < '2026-08-01' AND btrim(pc.clacta) LIKE '4%' GROUP BY c.ctared`;
  const erp = await prisma.$queryRaw<{ ctared: number; liquido: number }[]>`
    SELECT r.ctared, SUM(CASE WHEN r.debcre = 'D' THEN r.vlrrat ELSE -r.vlrrat END)::float8 AS liquido
    FROM rateios_lancamento r JOIN lancamentos_contabeis l ON l.codemp = r.codemp AND l.numlct = r.numlct
    WHERE r.codemp = 1 AND r.sitrat = 2 AND l.sitlct = 2 AND r.removido_em_senior IS NULL AND l.removido_em_senior IS NULL
      AND r.datlct >= '2026-07-01' AND r.datlct < '2026-08-01' AND r.ctared = ANY(${hcm.map((h) => h.ctared)}::int[]) GROUP BY r.ctared`;
  const erpPor = new Map(erp.map((e) => [e.ctared, e.liquido]));
  const nomes = new Map((await prisma.planoContabil.findMany({ where: { codemp: 1, ctared: { in: hcm.map((h) => h.ctared) } }, select: { ctared: true, descta: true } })).map((p) => [p.ctared, p.descta.trim()]));
  const diferentes = hcm.filter((h) => !perto(h.liquido, erpPor.get(h.ctared) ?? 0, 0.05));
  ok(`${hcm.length - diferentes.length} de ${hcm.length} contas batem ao centavo com o razão do ERP`, hcm.length - diferentes.length >= 45, `diferem: ${diferentes.map((d) => d.ctared).join(", ")}`);
  ok("as que diferem são só as de Assistência Médica (a fatura do plano entra no ERP pela empresa)", diferentes.length > 0 && diferentes.every((d) => /as+istencia/i.test(nomes.get(d.ctared) ?? "")), diferentes.map((d) => nomes.get(d.ctared)?.slice(0, 22)).join(" | "));

  await prisma.$disconnect();
  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
