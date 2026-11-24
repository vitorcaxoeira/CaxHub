// Verificação do custo-hora real (bloco C da Rentabilidade, 18-19/11/2026) contra o banco local e os dados reais já espelhados: configuração por rota,
// job (CLT pela contabilização da folha — R048CTB —, PJ pelo contrato, valor manual, precedência), indicador CustoReal. Os VALORES de configuração usados aqui (horas, percentual,
// classes) são de TESTE — o produto não traz nenhum. Convenção do repo: verificar*.ts, ts-node --transpile-only; Express mínimo (nunca o server.ts).
// Tudo que o teste grava (custo_*, vínculos HCM, custo-hora calculado) é restaurado no `finally`.
//
//   node node_modules/ts-node/dist/bin.js --transpile-only prisma/verificarCustoHora.ts
import "dotenv/config";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { custoHoraRouter } from "../src/routes/custoHora";
import { consultoresVinculosRouter } from "../src/routes/consultoresVinculos";
import { calcularRentabilidade } from "../src/domain/rentabilidade/calculo";
import { montarLinhaDoTempo, valorHoraEm } from "../src/domain/valorHoraConsultor";

let falhas = 0;
function ok(nome: string, cond: boolean, extra = "") {
  console.log(`${cond ? "OK   " : "FALHA"} ${nome}${extra ? " — " + extra : ""}`);
  if (!cond) falhas++;
}
const perto = (a: number, b: number, tol = 0.0001) => Math.abs(a - b) <= tol;
const ISO = (d: Date) => d.toISOString().slice(0, 10);

const HORAS_TESTE = 200;
const MESES = ["2026-05-01", "2026-07-01", "2026-10-01"];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: { name: "admin" }, status: { not: "inativo" } }, select: { id: true } });
  if (!admin) throw new Error("precisa de um usuário admin no banco local");
  const tokenAdmin = signToken({ userId: admin.id, role: "admin" });
  const tokenOutro = signToken({ userId: admin.id, role: "consultor" });
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/custo-hora", custoHoraRouter);
  app.use("/consultores-vinculos", consultoresVinculosRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const chamar = async (metodo: string, caminho: string, token: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, json: (await r.json().catch(() => null)) as any };
  };

  // Estado de partida (restaurado no fim).
  const antes = {
    parametros: await prisma.custoParametro.findMany(),
    contasFolha: await prisma.custoContaFolha.findMany(),
    manuais: await prisma.consultorValorHoraManual.findMany(),
    vinculos: await prisma.consultorVinculo.findMany(),
    custos: await prisma.consultorCustoHora.findMany(),
    ultimoLog: (await prisma.syncLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0,
  };
  // O teste parte do zero: a configuração e o resultado que já existirem no banco são guardados acima e voltam no `finally`.
  await prisma.consultorCustoHora.deleteMany({});
  await prisma.consultorValorHoraManual.deleteMany({});
  await prisma.custoContaFolha.deleteMany({});
  await prisma.custoParametro.deleteMany({});

  try {
    console.log("== acesso ==");
    ok("não-admin recebe 403", (await chamar("GET", "/custo-hora/config", tokenOutro)).status === 403);

    console.log("\n== configuração nasce vazia ==");
    const cfg0 = await chamar("GET", "/custo-hora/config", tokenAdmin);
    ok("sem parâmetros nem contas da folha (nada vem do código)", cfg0.status === 200 && Object.keys(cfg0.json.parametros).length === 0 && cfg0.json.contasFolha.length === 0, JSON.stringify(cfg0.json.parametros));
    ok("a contabilização da folha (R048CTB) está importada", cfg0.json.contabilizacaoFolha.linhas > 0, `${cfg0.json.contabilizacaoFolha.linhas} linhas até ${cfg0.json.contabilizacaoFolha.ate}`);

    console.log("\n== sem configuração, o CLT não é calculado e avisa ==");
    const semConfig = await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-10", ate: "2026-10" });
    ok("recalcular responde e avisa o que falta", semConfig.status === 200 && semConfig.json.avisos.some((a: string) => a.includes("horas da escala") && a.includes("contas da folha")), semConfig.json?.avisos?.[0]);
    ok("e nenhum CLT foi gravado", semConfig.json.porOrigem.clt_folha === 0);

    console.log("\n== parâmetros ==");
    ok("horas da escala inválida = 400", (await chamar("PUT", "/custo-hora/parametros/horas_mes", tokenAdmin, { valor: "0" })).status === 400);
    ok("tipos de cálculo não existe mais (a folha vem da contabilização) = 404", (await chamar("PUT", "/custo-hora/parametros/tipos_calculo", tokenAdmin, { valor: "11" })).status === 404);
    ok("parâmetro desconhecido = 404", (await chamar("PUT", "/custo-hora/parametros/xyz", tokenAdmin, { valor: "1" })).status === 404);
    ok("grava horas da escala", (await chamar("PUT", "/custo-hora/parametros/horas_mes", tokenAdmin, { valor: String(HORAS_TESTE) })).status === 200);

    console.log("\n== contas da folha ==");
    const mov0 = await chamar("GET", "/custo-hora/contas-folha/movimento?competencia=2026-07", tokenAdmin);
    const contasMov: { codemp: number; ctared: number; clacta: string | null; descta: string | null; debito: number; selecionada: boolean; colaboradores: number }[] = mov0.json.contas;
    ok("movimento do mês: contas contabilizadas pela folha, com débito, crédito e colaboradores", mov0.status === 200 && contasMov.length > 20 && contasMov.every((c) => c.colaboradores > 0), `${contasMov.length} contas`);
    ok("sem regras, nenhuma conta aparece como selecionada", contasMov.every((c) => !c.selecionada) && mov0.json.totais.debitoSelecionado === 0);
    ok("movimento de competência sem dado volta vazio", (await chamar("GET", "/custo-hora/contas-folha/movimento?competencia=2019-01", tokenAdmin)).json.contas.length === 0);
    ok("regra com ação inválida = 400", (await chamar("PUT", "/custo-hora/contas-folha", tokenAdmin, { regras: [{ codemp: 1, ctared: 224, acao: "somar" }] })).status === 400);
    ok("conta fora do plano = 400", (await chamar("PUT", "/custo-hora/contas-folha", tokenAdmin, { regras: [{ codemp: 1, ctared: 9999999, acao: "incluir" }] })).status === 400);
    // Regras de TESTE: todas as contas de resultado (classificação 4...) que a folha tocou em jul/2026, menos as de Assistência Médica.
    const resultado4 = contasMov.filter((c) => (c.clacta ?? "").startsWith("4"));
    const assistencia = resultado4.filter((c) => /as+istencia/i.test(c.descta ?? ""));
    const regrasSemExclusao = resultado4.map((c) => ({ codemp: c.codemp, ctared: c.ctared, acao: "incluir" }));
    ok("há contas de resultado e de Assistência Médica para testar", resultado4.length > 30 && assistencia.length >= 3, `${resultado4.length} contas, ${assistencia.length} de assistência`);
    // incluir e excluir a MESMA conta é regra repetida: o teste usa uma só regra por conta (a exclusão ganha trocando a ação).
    const regras = resultado4.map((c) => ({ codemp: c.codemp, ctared: c.ctared, acao: assistencia.some((a) => a.ctared === c.ctared) ? "excluir" : "incluir" }));
    const put = await chamar("PUT", "/custo-hora/contas-folha", tokenAdmin, { regras });
    ok("grava as regras de contas da folha", put.status === 200 && put.json.regras === regras.length);
    const mov1 = await chamar("GET", "/custo-hora/contas-folha/movimento?competencia=2026-07", tokenAdmin);
    const selecionadas = new Set<number>(mov1.json.contas.filter((c: any) => c.selecionada).map((c: any) => c.ctared));
    ok("o movimento passa a marcar as selecionadas (as de Assistência Médica ficam de fora)", selecionadas.size === resultado4.length - assistencia.length && assistencia.every((a) => !selecionadas.has(a.ctared)), `${selecionadas.size} selecionadas`);
    const somaSel = mov1.json.contas.filter((c: any) => c.selecionada).reduce((s: number, c: any) => s + c.debito, 0);
    ok("o débito selecionado do mês = soma das contas marcadas", perto(somaSel, mov1.json.totais.debitoSelecionado, 0.02) && mov1.json.totais.debitoSelecionado > 0, `R$ ${mov1.json.totais.debitoSelecionado}`);

    console.log("\n== exportar / importar ==");
    const exp = await chamar("GET", "/custo-hora/exportar", tokenAdmin);
    ok("exporta parâmetros e contas da folha", exp.status === 200 && exp.json.parametros.horas_mes === String(HORAS_TESTE) && exp.json.contasFolha.length === regras.length);
    ok("importar recusa arquivo inválido sem gravar nada", (await chamar("POST", "/custo-hora/importar", tokenAdmin, { parametros: { horas_mes: "-1" }, contasFolha: [{ codemp: 1 }] })).status === 400 && (await prisma.custoContaFolha.count()) === regras.length);
    const imp = await chamar("POST", "/custo-hora/importar", tokenAdmin, { ...exp.json, substituir: true });
    ok("importar o próprio export (substituindo) devolve o mesmo estado", imp.status === 200 && imp.json.contasFolha === regras.length && (await prisma.custoContaFolha.count()) === regras.length);

    console.log("\n== job: CLT pela contabilização da folha ==");
    // Funcionário com lançamentos nas contas escolhidas em TODOS os meses de teste, e consultor sem contrato para receber o vínculo.
    const comFolha = await prisma.$queryRaw<{ numemp: number; tipcol: number; numcad: number; competencia: Date }[]>`
      SELECT DISTINCT c.numemp, c.tipcol, c.numcad, date_trunc('month', c.datlan)::date AS competencia
      FROM hcm_contabilizacao_folha c
      WHERE c.datlan >= '2026-05-01' AND c.datlan < '2026-11-01' AND c.ctared = ANY(${[...selecionadas]}::int[])`;
    const porFunc = new Map<string, Set<string>>();
    for (const l of comFolha) {
      const k = `${l.numemp}-${l.tipcol}-${l.numcad}`;
      porFunc.set(k, (porFunc.get(k) ?? new Set()).add(ISO(l.competencia)));
    }
    const funcTodos = [...porFunc.entries()].find(([, m]) => MESES.every((x) => m.has(x)))!;
    const [fe, ft, fc] = funcTodos[0].split("-").map(Number);
    const contratos = await prisma.contratoConsultor.findMany({ where: { numctr: { not: null }, removidoEmSenior: null } });
    const comContrato = new Set(contratos.map((c) => c.codusu));
    const consultores = await prisma.consultor.findMany({ where: { removidoEmSenior: null, sitfor: "A" }, orderBy: { codusu: "asc" } });
    const semContrato = consultores.filter((c) => !comContrato.has(c.codusu));
    const consClt = semContrato[0];
    await prisma.consultorVinculo.deleteMany({});
    await prisma.consultorVinculo.create({ data: { codemp: consClt.codemp, codusu: consClt.codusu, hcmNumemp: fe, hcmTipcol: ft, hcmNumcad: fc } });

    // Conta feita de outro jeito: só o DÉBITO das contas escolhidas direto na tabela, dividido pelas horas.
    const esperadoClt = async (numemp: number, tipcol: number, numcad: number, mes: string, contas: number[]) => {
      const r = await prisma.$queryRaw<{ v: number }[]>`
        SELECT COALESCE(SUM(vallan), 0)::float8 AS v FROM hcm_contabilizacao_folha
        WHERE debcre = 'D' AND numemp = ${numemp} AND tipcol = ${tipcol} AND numcad = ${numcad} AND date_trunc('month', datlan)::date = ${mes}::date AND ctared = ANY(${contas}::int[])`;
      return Math.round(r[0].v * 100) / 100 / HORAS_TESTE;
    };

    const rec = await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
    ok("recalcular o período responde", rec.status === 200 && rec.json.competencias.length === 6, `${rec.json?.gravados} custos`);
    for (const mes of MESES) {
      const linha = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: consClt.codemp, codusu: consClt.codusu, competencia: new Date(`${mes}T00:00:00Z`) } } });
      const esperado = await esperadoClt(fe, ft, fc, mes, [...selecionadas]);
      ok(`CLT ${mes}: só o débito das contas escolhidas ÷ ${HORAS_TESTE}`, !!linha && linha.origem === "clt_folha" && perto(Number(linha.custoHora), esperado, 0.0002), `${linha ? Number(linha.custoHora) : "—"} x ${esperado.toFixed(4)}`);
    }
    const lc = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: consClt.codemp, codusu: consClt.codusu, competencia: new Date("2026-10-01T00:00:00Z") } } });
    const det: any = lc?.detalhe;
    ok("o detalhe guarda como chegou ao número (folha, provisões, horas, contas)", !!det && det.horasMes === HORAS_TESTE && det.custoMensal > 0 && perto(det.folha + det.provisoes, det.custoMensal, 0.02) && det.porConta.length > 3, JSON.stringify(det?.porConta?.slice(0, 2)));
    ok("nenhuma conta de Assistência Médica entrou no custo", (det?.porConta ?? []).every((c: any) => !assistencia.some((a) => `${a.codemp}:${a.ctared}` === c.conta)));
    const resultado = await chamar("GET", "/custo-hora/resultado?competencia=2026-10", tokenAdmin);
    ok("GET resultado lista o consultor com origem e custo", resultado.status === 200 && resultado.json.linhas.some((l: any) => l.codusu === consClt.codusu && l.origem === "clt_folha" && l.custoHora > 0));
    ok("resultado de competência inválida = 400", (await chamar("GET", "/custo-hora/resultado?competencia=xx", tokenAdmin)).status === 400);

    console.log("\n== origem do custo-hora: CLT (o link no valor) ==");
    const origemClt = await chamar("GET", `/custo-hora/origem/${consClt.codemp}/${consClt.codusu}?competencia=2026-10`, tokenAdmin);
    const oc = origemClt.json;
    ok("origem CLT: devolve consultor, colaborador do HCM e os lançamentos do mês", origemClt.status === 200 && oc.origem === "clt_folha" && oc.consultor.nome.length > 0 && !!oc.clt.colaborador?.nome && oc.clt.lancamentos.length > 5, `${oc.clt?.lancamentos?.length} lançamentos de ${oc.clt?.colaborador?.nome}`);
    ok("a soma dos lançamentos considerados (só débito) = custo mensal gravado no cálculo", perto(oc.clt.totais.considerado, oc.detalhe.custoMensal, 0.02), `${oc.clt.totais.considerado} x ${oc.detalhe.custoMensal}`);
    ok("custo-hora = custo mensal ÷ horas da escala", perto(oc.custoHora, Math.round((oc.detalhe.custoMensal / oc.detalhe.horasMes) * 10000) / 10000, 0.0001), `${oc.custoHora}`);
    const contasDoCalculo = new Set<string>(oc.detalhe.porConta.map((c: any) => c.conta));
    ok("'considerado' bate com as contas gravadas no cálculo (não com as regras de hoje)", oc.clt.lancamentos.every((l: any) => l.considerado === (l.debcre === "D" && contasDoCalculo.has(`1:${l.ctared}`))) && oc.clt.lancamentos.some((l: any) => l.considerado));
    ok("lançamentos trazem conta, histórico, folha × provisão e D/C", oc.clt.lancamentos.every((l: any) => l.clacta && l.descta && l.historico !== undefined && (l.opcctb === 1 || l.opcctb === 3) && (l.debcre === "D" || l.debcre === "C")));
    ok("crédito aparece na lista mas NUNCA é considerado (só débito compõe o custo)", oc.clt.lancamentos.some((l: any) => l.debcre === "C") && oc.clt.lancamentos.filter((l: any) => l.debcre === "C").every((l: any) => !l.considerado));
    ok("os lançamentos de assistência médica aparecem, mas FORA do custo", oc.clt.lancamentos.filter((l: any) => /as+istencia/i.test(l.descta)).every((l: any) => !l.considerado));
    ok("competência sem custo calculado = 404", (await chamar("GET", `/custo-hora/origem/${consClt.codemp}/${consClt.codusu}?competencia=2026-11`, tokenAdmin)).status === 404);
    ok("competência inválida = 400", (await chamar("GET", `/custo-hora/origem/${consClt.codemp}/${consClt.codusu}?competencia=xx`, tokenAdmin)).status === 400);
    ok("não-admin recebe 403", (await chamar("GET", `/custo-hora/origem/${consClt.codemp}/${consClt.codusu}?competencia=2026-10`, tokenOutro)).status === 403);

    // Mudar as regras muda o custo: incluindo também as contas de Assistência Médica (o crédito do desconto subtrai), o custo-hora cai.
    await chamar("PUT", "/custo-hora/contas-folha", tokenAdmin, { regras: regrasSemExclusao });
    await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-10", ate: "2026-10" });
    const semExcluir = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: consClt.codemp, codusu: consClt.codusu, competencia: new Date("2026-10-01T00:00:00Z") } } });
    const todasContas = [...selecionadas, ...assistencia.map((a) => a.ctared)];
    const esperadoTodas = await esperadoClt(fe, ft, fc, "2026-10-01", todasContas);
    ok("incluir as contas de Assistência Médica: o custo acompanha as contas escolhidas (a folha só credita essas contas, então o débito não muda)", !!semExcluir && perto(Number(semExcluir.custoHora), esperadoTodas, 0.0002) && perto(Number(semExcluir.custoHora), Number(lc?.custoHora), 0.0002), `${semExcluir ? Number(semExcluir.custoHora) : "—"} x ${esperadoTodas.toFixed(4)}`);
    await chamar("PUT", "/custo-hora/contas-folha", tokenAdmin, { regras });

    // Mês ainda sem contabilização (o corrente): sem CLT, o consultor fica sem custo naquele mês.
    const corrente = await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-11", ate: "2026-11" });
    ok("mês sem contabilização da folha não gera CLT", corrente.status === 200 && (await prisma.consultorCustoHora.count({ where: { codusu: consClt.codusu, competencia: new Date("2026-11-01T00:00:00Z") } })) === 0);
    await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });

    console.log("\n== job: PJ pelo contrato ==");
    const pj = await (async () => {
      for (const c of contratos) {
        const itens = await prisma.contratoCompraServico.findMany({ where: { codemp: c.codemp, numctr: c.numctr as number, sitccs: "A" }, orderBy: { seqccs: "asc" } });
        const rea = itens[0] ? await prisma.contratoCompraReajuste.findMany({ where: { codemp: c.codemp, numctr: c.numctr as number, seqccs: itens[0].seqccs } }) : [];
        if (c.codmot !== 12 && itens[0] && rea.length >= 3 && consultores.some((x) => x.codusu === c.codusu)) return { c, item: itens[0], rea };
      }
      return null;
    })();
    ok("há consultor PJ com reajustes para conferir", !!pj);
    if (pj) {
      const tl = montarLinhaDoTempo(pj.rea.map((r) => ({ ultrea: ISO(r.ultrea), vlrrea: r.vlrrea == null ? null : Number(r.vlrrea), vlratu: r.vlratu == null ? null : Number(r.vlratu) })), Number(pj.item.preuni));
      for (const mes of MESES) {
        const linha = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: pj.c.codemp, codusu: pj.c.codusu, competencia: new Date(`${mes}T00:00:00Z`) } } });
        const esperado = valorHoraEm(tl.vigencias, mes);
        ok(`PJ ${mes}: valor-hora vigente no mês`, !!linha && linha.origem === "pj_contrato" && esperado != null && perto(Number(linha.custoHora), esperado), `${linha ? Number(linha.custoHora) : "—"} x ${esperado}`);
      }
      const anterior = await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2000-01", ate: "2000-01" });
      ok("antes da emissão do contrato o PJ não tem custo", anterior.status === 200 && (await prisma.consultorCustoHora.count({ where: { codusu: pj.c.codusu, competencia: new Date("2000-01-01T00:00:00Z") } })) === 0);

      console.log("\n== origem do custo-hora: PJ (contrato por hora) ==");
      for (const mes of ["2026-05", "2026-10"]) {
        const o = await chamar("GET", `/custo-hora/origem/${pj.c.codemp}/${pj.c.codusu}?competencia=${mes}`, tokenAdmin);
        const gravado = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: pj.c.codemp, codusu: pj.c.codusu, competencia: new Date(`${mes}-01T00:00:00Z`) } } });
        ok(`origem PJ ${mes}: a vigência aplicada do contrato = o custo-hora gravado`, o.status === 200 && o.json.origem === "pj_contrato" && !!o.json.pj.vigenciaAplicada && perto(o.json.pj.vigenciaAplicada.valor, Number(gravado?.custoHora)) && o.json.pj.historico.contrato.numctr === pj.c.numctr, `${o.json?.pj?.vigenciaAplicada?.valor} x ${gravado ? Number(gravado.custoHora) : "—"}`);
      }
      const oHist = await chamar("GET", `/custo-hora/origem/${pj.c.codemp}/${pj.c.codusu}?competencia=2026-10`, tokenAdmin);
      ok("origem PJ: traz contrato, item, vigências e reajustes", oHist.json.pj.historico.item?.seqccs > 0 && oHist.json.pj.historico.vigencias.length >= 2 && oHist.json.pj.historico.reajustes.length >= 1);

      console.log("\n== PJ com preço MENSAL (escolha explícita por consultor) ==");
      const chavePj = { codemp: pj.c.codemp, codusu: pj.c.codusu };
      // Período mensal de TESTE: de 03/2023 a 08/2026 (o preço deste contrato é mensal até 08/2026 e por hora depois).
      const periodoTeste = { contratoMensal: true, mensalDesde: new Date("2023-03-01T00:00:00Z"), mensalAte: new Date("2026-08-01T00:00:00Z") };
      await prisma.consultorVinculo.upsert({ where: { codemp_codusu: chavePj }, create: { ...chavePj, ...periodoTeste }, update: periodoTeste });
      await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
      for (const mes of MESES) {
        const linha = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { ...chavePj, competencia: new Date(`${mes}T00:00:00Z`) } } });
        const preco = valorHoraEm(tl.vigencias, mes)!;
        const dentro = mes <= "2026-08-01";
        const esperado = dentro ? preco / HORAS_TESTE : preco;
        ok(`${mes}: ${dentro ? `dentro do período mensal → preço ÷ ${HORAS_TESTE} horas` : "depois do período → preço por hora"}`, !!linha && linha.origem === "pj_contrato" && perto(Number(linha.custoHora), esperado, 0.0001) && (linha.detalhe as any)?.mensal === dentro, `${linha ? Number(linha.custoHora) : "—"} x ${esperado.toFixed(4)}`);
      }
      await prisma.consultorVinculo.update({ where: { codemp_codusu: chavePj }, data: { contratoMensal: false, mensalDesde: null, mensalAte: null } });

      console.log("\n== precedência: folha vale mais que contrato ==");
      const outro = [...porFunc.entries()].find(([k, m]) => k !== funcTodos[0] && m.has("2026-10-01"));
      if (outro) {
        const [oe, ot, oc] = outro[0].split("-").map(Number);
        await prisma.consultorVinculo.update({ where: { codemp_codusu: { codemp: pj.c.codemp, codusu: pj.c.codusu } }, data: { hcmNumemp: oe, hcmTipcol: ot, hcmNumcad: oc } });
        await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
        for (const mes of MESES) {
          const tem = outro[1].has(mes);
          const linha = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: pj.c.codemp, codusu: pj.c.codusu, competencia: new Date(`${mes}T00:00:00Z`) } } });
          ok(`${mes}: ${tem ? "há folha → CLT" : "sem folha → contrato (PJ)"}`, linha?.origem === (tem ? "clt_folha" : "pj_contrato"), linha?.origem);
        }
      }
    }

    console.log("\n== contrato de VALOR FIXO (codmot 12): valor-hora como na Home ==");
    const fixos = contratos.filter((c) => c.codmot === 12 && c.vlrhor != null && c.qtdctr != null && consultores.some((x) => x.codusu === c.codusu));
    ok("há contratos de valor fixo para conferir", fixos.length > 0, `${fixos.length} contratos`);
    // Os contratos fixos entram sem vínculo HCM (para não cair na folha) e com a marca "mensal" ligada de propósito: no fixo ela NÃO vale.
    for (const c of fixos) {
      const chaveF = { codemp: c.codemp, codusu: c.codusu };
      await prisma.consultorVinculo.upsert({ where: { codemp_codusu: chaveF }, create: { ...chaveF, contratoMensal: true }, update: { contratoMensal: true, hcmNumemp: null, hcmTipcol: null, hcmNumcad: null } });
    }
    await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
    for (const c of fixos) {
      for (const mes of ["2026-07-01", "2026-10-01"]) {
        const linha = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: c.codemp, codusu: c.codusu, competencia: new Date(`${mes}T00:00:00Z`) } } });
        const det: any = linha?.detalhe;
        ok(`fixo ${c.codusu} ${mes}: valor-hora = vlrhor da view (${Number(c.vlrhor)}), não o total do mês`, !!linha && linha.origem === "pj_contrato" && perto(Number(linha.custoHora), Number(c.vlrhor), 0.00005) && det?.mensal === false && det?.fixo?.qtd === Number(c.qtdctr), `${linha ? Number(linha.custoHora) : "—"}`);
      }
    }
    const davi = fixos.find((c) => c.codusu === 96);
    if (davi) {
      const d = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: davi.codemp, codusu: 96, competencia: new Date("2026-10-01T00:00:00Z") } } });
      ok("Davi Lemes Franz: 93,897 por hora (e não 14.084,55)", Number(d?.custoHora) === 93.897 && (d?.detalhe as any)?.fixo?.valorMensal === 14084.55, JSON.stringify(d?.detalhe));
    }
    const oFixo = await chamar("GET", `/custo-hora/origem/${(davi ?? fixos[0]).codemp}/${(davi ?? fixos[0]).codusu}?competencia=2026-10`, tokenAdmin);
    ok("origem PJ de valor fixo: contrato fixo (qtd × valor-hora), valor-hora da view como vigência aplicada", oFixo.status === 200 && !!oFixo.json.pj.historico.contrato.fixo && oFixo.json.pj.historico.contrato.fixo.qtd > 0 && !!oFixo.json.detalhe.fixo && perto(oFixo.json.pj.vigenciaAplicada.valor, oFixo.json.custoHora, 0.0001), `${oFixo.json?.pj?.vigenciaAplicada?.valor}`);
    const painelF = await chamar("GET", "/consultores-vinculos", tokenAdmin);
    const lf = painelF.json.linhas.find((l: any) => l.codusu === (davi?.codusu ?? fixos[0].codusu));
    ok("o painel marca o contrato como fixo (quantidade e valor mensal)", !!lf?.contrato?.fixo && lf.contrato.fixo.qtd > 0 && lf.contrato.fixo.valorMensal > 0, JSON.stringify(lf?.contrato?.fixo));
    ok("o histórico do valor-hora do fixo não mostra reajuste do Senior nem aviso de divergência", await (async () => {
      const vh = await chamar("GET", `/consultores-vinculos/${lf.codemp}/${lf.codusu}/valor-hora`, tokenAdmin);
      return vh.status === 200 && vh.json.vigencias.length === 1 && vh.json.divergencia === null && vh.json.contrato.fixo != null;
    })());
    for (const c of fixos) await prisma.consultorVinculo.update({ where: { codemp_codusu: { codemp: c.codemp, codusu: c.codusu } }, data: { contratoMensal: false } });

    console.log("\n== valor-hora manual ==");
    const consMan = semContrato.find((c) => c.codusu !== consClt.codusu)!;
    ok("valor manual inválido = 400", (await chamar("POST", `/custo-hora/valor-hora-manual/${consMan.codemp}/${consMan.codusu}`, tokenAdmin, { vigenciaInicio: "2026-06-01", valor: 0 })).status === 400);
    ok("consultor inexistente = 404", (await chamar("POST", "/custo-hora/valor-hora-manual/1/999999", tokenAdmin, { vigenciaInicio: "2026-06-01", valor: 10 })).status === 404);
    ok("grava vigência 06/2026", (await chamar("POST", `/custo-hora/valor-hora-manual/${consMan.codemp}/${consMan.codusu}`, tokenAdmin, { vigenciaInicio: "2026-06-01", valor: 77.7, observacao: "teste" })).status === 200);
    await chamar("POST", "/custo-hora/valor-hora-manual/" + consMan.codemp + "/" + consMan.codusu, tokenAdmin, { vigenciaInicio: "2026-09-01", valor: 80 });
    await chamar("POST", "/custo-hora/valor-hora-manual/" + consMan.codemp + "/" + consMan.codusu, tokenAdmin, { vigenciaInicio: "2026-06-01", valor: 78 });
    const lista = await chamar("GET", `/custo-hora/valor-hora-manual/${consMan.codemp}/${consMan.codusu}`, tokenAdmin);
    ok("mesma vigência corrige o valor (2 linhas, mais nova primeiro)", lista.json.valores.length === 2 && lista.json.valores[0].vigenciaInicio === "2026-09-01" && lista.json.valores[1].valor === 78);
    await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
    const doMes = async (mes: string) => prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: consMan.codemp, codusu: consMan.codusu, competencia: new Date(`${mes}T00:00:00Z`) } } });
    ok("antes da 1ª vigência não há custo (2026-05)", (await doMes("2026-05-01")) === null);
    ok("2026-07 usa a vigência de 06/2026 (78)", Number((await doMes("2026-07-01"))?.custoHora) === 78 && (await doMes("2026-07-01"))?.origem === "manual");
    ok("2026-10 usa a vigência de 09/2026 (80)", Number((await doMes("2026-10-01"))?.custoHora) === 80);
    console.log("\n== origem do custo-hora: valor manual ==");
    const oMan = await chamar("GET", `/custo-hora/origem/${consMan.codemp}/${consMan.codusu}?competencia=2026-07`, tokenAdmin);
    ok("origem manual: lista as vigências e destaca a que valeu no mês (06/2026 = 78)", oMan.status === 200 && oMan.json.origem === "manual" && oMan.json.manual.valores.length === 2 && oMan.json.manual.vigenciaAplicada.vigenciaInicio === "2026-06-01" && oMan.json.manual.vigenciaAplicada.valor === 78 && oMan.json.custoHora === 78);
    const oMan2 = await chamar("GET", `/custo-hora/origem/${consMan.codemp}/${consMan.codusu}?competencia=2026-10`, tokenAdmin);
    ok("origem manual em 10/2026: a vigência de 09/2026 (80)", oMan2.json.manual.vigenciaAplicada.vigenciaInicio === "2026-09-01" && oMan2.json.manual.vigenciaAplicada.valor === 80);
    const idRemover = lista.json.valores[0].id;
    ok("remove uma vigência", (await chamar("DELETE", `/custo-hora/valor-hora-manual/${idRemover}`, tokenAdmin)).status === 200 && (await chamar("DELETE", `/custo-hora/valor-hora-manual/${idRemover}`, tokenAdmin)).status === 404);

    console.log("\n== idempotência ==");
    const n1 = await prisma.consultorCustoHora.count();
    await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
    ok("recalcular de novo não duplica nem perde", (await prisma.consultorCustoHora.count()) === n1, `${n1} linhas`);

    console.log("\n== indicador CustoReal ==");
    // Consultor com horas no Kyria em jul/2026 recebe um valor manual antigo, para haver custo real a somar.
    const membro = await prisma.$queryRaw<{ codusu: number; n: number }[]>`
      SELECT m.codusu, count(*)::int AS n FROM kyria_time_entries e JOIN kyria_members m ON m.id = e.user_id
      WHERE m.codusu IS NOT NULL AND e.started_at >= '2026-07-01' AND e.started_at < '2026-08-01' GROUP BY m.codusu ORDER BY n DESC LIMIT 1`;
    ok("há horas do Kyria em 07/2026 de consultor vinculado", membro.length === 1);
    if (membro.length) {
      const c = consultores.find((x) => x.codusu === membro[0].codusu)!;
      await prisma.consultorValorHoraManual.upsert({ where: { codemp_codusu_vigenciaInicio: { codemp: c.codemp, codusu: c.codusu, vigenciaInicio: new Date("2020-01-01T00:00:00Z") } }, create: { codemp: c.codemp, codusu: c.codusu, vigenciaInicio: new Date("2020-01-01T00:00:00Z"), valor: 50 }, update: { valor: 50 } });
      await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-07", ate: "2026-07" });
    }
    const ind = (codigo: string, fonte: string) => ({ id: 0, codigo, rotulo: codigo, tipo: "sistema" as const, base: "realizado" as const, natureza: "ambos" as const, formato: "moeda" as const, formulaTexto: null, formulaArvore: null, fonte: fonte as any, ordem: 0, visivel: true, contas: [] });
    const recorte = { inicio: "2026-07-01", fim: "2026-08-01", setor: null, ccs: null, restringirModelo: false };
    const r = await calcularRentabilidade(recorte, [ind("CK", "CustoKyria"), ind("CR", "CustoRat"), ind("CT", "CustoReal"), ind("HK", "HorasKyria")]);
    const tot = (cod: string) => Number(r.total[cod] ?? 0);
    ok("CustoReal = CustoKyria + CustoRat no total", perto(tot("CT"), tot("CK") + tot("CR"), 0.01), `${tot("CK").toFixed(2)} + ${tot("CR").toFixed(2)} = ${tot("CT").toFixed(2)}`);
    ok("há custo real de Kyria em 07/2026", tot("CK") > 0);
    const esperadoKyria = await prisma.$queryRaw<{ t: number }[]>`
      WITH ent AS (
        SELECT e.minutes / 60.0 AS horas, date_trunc('month', e.started_at AT TIME ZONE 'America/Sao_Paulo')::date AS mes, m.codusu
        FROM kyria_time_entries e
        JOIN kyria_tickets t ON t.id = e.ticket_id JOIN kyria_customers kc ON kc.id = t.customer_id JOIN clientes cl ON cl.codcli = kc.codcli
        LEFT JOIN kyria_members m ON m.id = e.user_id
        WHERE e.started_at >= '2026-07-01' AND e.started_at < '2026-08-01' AND cl.codccu IS NOT NULL)
      SELECT COALESCE(SUM(ent.horas * (SELECT cch.custo_hora FROM consultor_custo_hora cch WHERE cch.codusu = ent.codusu AND cch.competencia = ent.mes LIMIT 1)), 0)::float8 AS t FROM ent`;
    ok("CustoKyria bate com a conta feita de outro jeito (por apontamento)", perto(tot("CK"), esperadoKyria[0].t, 0.01), `${tot("CK").toFixed(2)} x ${esperadoKyria[0].t.toFixed(2)}`);
    const horas = tot("HK");
    ok("o custo médio por hora do Kyria é plausível (entre os extremos de custo-hora do mês)", horas > 0 && tot("CK") / horas > 0 && tot("CK") / horas < 1000, `${(tot("CK") / horas).toFixed(2)} por hora`);
    ok("avisa as horas que ficaram sem custo", r.avisos.some((a) => a.includes("fora do custo real")), r.avisos.find((a) => a.includes("custo real")));
    ok("validação aceita os novos campos do sistema", (await import("../src/domain/rentabilidade/indicadores")).validarIndicador({ codigo: "X", rotulo: "X", tipo: "sistema", formato: "moeda", fonte: "CustoReal" }, new Set()).ok === true);
  } finally {
    // Restaura o estado de partida.
    await prisma.consultorCustoHora.deleteMany({});
    if (antes.custos.length) await prisma.consultorCustoHora.createMany({ data: antes.custos.map((c) => ({ ...c, detalhe: (c.detalhe ?? undefined) as any })) });
    await prisma.consultorValorHoraManual.deleteMany({});
    for (const m of antes.manuais) await prisma.consultorValorHoraManual.create({ data: m });
    await prisma.custoContaFolha.deleteMany({});
    if (antes.contasFolha.length) await prisma.custoContaFolha.createMany({ data: antes.contasFolha });
    await prisma.custoParametro.deleteMany({});
    for (const p of antes.parametros) await prisma.custoParametro.create({ data: p });
    await prisma.consultorVinculo.deleteMany({});
    for (const v of antes.vinculos) await prisma.consultorVinculo.create({ data: v });
    await prisma.syncLog.deleteMany({ where: { jobName: "custo-hora-job", id: { gt: antes.ultimoLog } } });
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
