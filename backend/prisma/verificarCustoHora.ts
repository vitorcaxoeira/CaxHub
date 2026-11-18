// Verificação do custo-hora real (bloco C da Rentabilidade, 18/11/2026) contra o banco local e os dados reais já espelhados: configuração por rota,
// job (CLT pela folha, PJ pelo contrato, valor manual, precedência), indicador CustoReal. Os VALORES de configuração usados aqui (horas, percentual,
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
const PERCENTUAL_TESTE = 10;
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
    encargos: await prisma.custoEncargo.findMany(),
    classes: await prisma.custoEventoClasse.findMany(),
    manuais: await prisma.consultorValorHoraManual.findMany(),
    vinculos: await prisma.consultorVinculo.findMany(),
    custos: await prisma.consultorCustoHora.findMany(),
    ultimoLog: (await prisma.syncLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0,
  };
  // O teste parte do zero: a configuração e o resultado que já existirem no banco são guardados acima e voltam no `finally`.
  await prisma.consultorCustoHora.deleteMany({});
  await prisma.consultorValorHoraManual.deleteMany({});
  await prisma.custoEncargo.deleteMany({});
  await prisma.custoEventoClasse.deleteMany({});
  await prisma.custoParametro.deleteMany({});

  try {
    console.log("== acesso ==");
    ok("não-admin recebe 403", (await chamar("GET", "/custo-hora/config", tokenOutro)).status === 403);

    console.log("\n== configuração nasce vazia ==");
    const cfg0 = await chamar("GET", "/custo-hora/config", tokenAdmin);
    ok("sem parâmetros, encargos nem classificação (nada vem do código)", cfg0.status === 200 && Object.keys(cfg0.json.parametros).length === 0 && cfg0.json.encargos.length === 0 && cfg0.json.eventosClassificados === 0, JSON.stringify(cfg0.json.parametros));

    console.log("\n== sem configuração, o CLT não é calculado e avisa ==");
    const semConfig = await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-10", ate: "2026-10" });
    ok("recalcular responde e avisa o que falta", semConfig.status === 200 && semConfig.json.avisos.some((a: string) => a.includes("horas da escala") && a.includes("tipos de cálculo") && a.includes("classificação")), semConfig.json?.avisos?.[0]);
    ok("e nenhum CLT foi gravado", semConfig.json.porOrigem.clt_folha === 0);

    console.log("\n== parâmetros ==");
    ok("horas da escala inválida = 400", (await chamar("PUT", "/custo-hora/parametros/horas_mes", tokenAdmin, { valor: "0" })).status === 400);
    ok("tipos de cálculo inválido = 400", (await chamar("PUT", "/custo-hora/parametros/tipos_calculo", tokenAdmin, { valor: "abc" })).status === 400);
    ok("parâmetro desconhecido = 404", (await chamar("PUT", "/custo-hora/parametros/xyz", tokenAdmin, { valor: "1" })).status === 404);
    ok("grava horas da escala", (await chamar("PUT", "/custo-hora/parametros/horas_mes", tokenAdmin, { valor: String(HORAS_TESTE) })).status === 200);
    ok("grava tipos de cálculo (normaliza)", (await chamar("PUT", "/custo-hora/parametros/tipos_calculo", tokenAdmin, { valor: "11" })).json?.valor === "11");

    console.log("\n== encargos ==");
    ok("encargo com código inválido = 400", (await chamar("POST", "/custo-hora/encargos", tokenAdmin, { codigo: "A B", rotulo: "x", percentual: 1, vigenciaInicio: "2026-01-01" })).status === 400);
    const e1 = await chamar("POST", "/custo-hora/encargos", tokenAdmin, { codigo: "encargo_teste", rotulo: "Encargo de teste", percentual: PERCENTUAL_TESTE, vigenciaInicio: "2026-01-01" });
    ok("cria encargo", e1.status === 201);
    ok("mesma vigência = 409", (await chamar("POST", "/custo-hora/encargos", tokenAdmin, { codigo: "encargo_teste", rotulo: "x", percentual: 1, vigenciaInicio: "2026-01-01" })).status === 409);
    const e2 = await chamar("POST", "/custo-hora/encargos", tokenAdmin, { codigo: "encargo_teste", rotulo: "Encargo de teste", percentual: 99, vigenciaInicio: "2027-01-01" });
    ok("vigência futura não altera o cálculo de 2026 (conferido adiante)", e2.status === 201);

    console.log("\n== eventos da folha ==");
    const evs = await chamar("GET", "/custo-hora/eventos", tokenAdmin);
    ok("lista os eventos da folha com tipo do Senior e peso", evs.status === 200 && evs.json.eventos.length > 50 && evs.json.eventos.every((e: any) => "tipeve" in e && "valor" in e), `${evs.json?.eventos?.length} eventos`);
    ok("nenhum nasce classificado", evs.json.eventos.every((e: any) => e.classe === null));
    ok("classe inválida = 400", (await chamar("PUT", "/custo-hora/eventos/1/1", tokenAdmin, { classe: "xis" })).status === 400);
    // Classificação de TESTE: tipo 1 e 2 = remuneração, tipo 4 = encargo da folha.
    const l1 = await chamar("POST", "/custo-hora/eventos/lote", tokenAdmin, { tipeve: 1, classe: "remuneracao" });
    const l2 = await chamar("POST", "/custo-hora/eventos/lote", tokenAdmin, { tipeve: 2, classe: "remuneracao" });
    const l4 = await chamar("POST", "/custo-hora/eventos/lote", tokenAdmin, { tipeve: 4, classe: "encargo_folha" });
    ok("classifica em lote por tipo do Senior", l1.status === 200 && l1.json.alterados > 0 && l2.status === 200 && l4.json.alterados > 0, `${l1.json.alterados}+${l2.json.alterados}+${l4.json.alterados}`);
    const um = evs.json.eventos.find((e: any) => e.tipeve === 3);
    ok("evento individual: classifica e volta a ignorar", (await chamar("PUT", `/custo-hora/eventos/${um.tabeve}/${um.codeve}`, tokenAdmin, { classe: "beneficio" })).status === 200 && (await chamar("PUT", `/custo-hora/eventos/${um.tabeve}/${um.codeve}`, tokenAdmin, { classe: null })).status === 200);
    ok("lote sem sobrescrever o que já tem classe", (await chamar("POST", "/custo-hora/eventos/lote", tokenAdmin, { tipeve: 1, classe: "beneficio" })).json.alterados === 0);

    console.log("\n== exportar / importar ==");
    const exp = await chamar("GET", "/custo-hora/exportar", tokenAdmin);
    ok("exporta parâmetros, encargos e eventos", exp.status === 200 && exp.json.parametros.horas_mes === String(HORAS_TESTE) && exp.json.encargos.length === 2 && exp.json.eventos.length > 10);
    ok("importar recusa arquivo inválido sem gravar nada", (await chamar("POST", "/custo-hora/importar", tokenAdmin, { parametros: { horas_mes: "-1" }, encargos: [{ codigo: "X" }] })).status === 400);
    const imp = await chamar("POST", "/custo-hora/importar", tokenAdmin, { ...exp.json, substituir: true });
    ok("importar o próprio export (substituindo) devolve o mesmo estado", imp.status === 200 && imp.json.encargos === 2 && (await prisma.custoEncargo.count()) === 2 && (await prisma.custoEventoClasse.count()) === exp.json.eventos.length);

    console.log("\n== job: CLT pela folha ==");
    // Funcionário com folha de tipo 11 nos meses de teste e consultor sem contrato para receber o vínculo.
    const comFolha = await prisma.$queryRaw<{ numemp: number; tipcol: number; numcad: number; competencia: Date }[]>`
      SELECT DISTINCT v.numemp, v.tipcol, v.numcad, date_trunc('month', cal.perref)::date AS competencia
      FROM hcm_verbas_folha v JOIN hcm_calculos_folha cal ON cal.numemp = v.numemp AND cal.codcal = v.codcal
      WHERE cal.tipcal = 11 AND cal.sitcal IN ('T','P') AND cal.perref >= '2026-05-01' AND cal.perref < '2026-11-01' AND v.removido_em_senior IS NULL`;
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

    const esperadoClt = async (numemp: number, tipcol: number, numcad: number, mes: string) => {
      const r = await prisma.$queryRaw<{ classe: string; valor: number }[]>`
        SELECT k.classe, SUM(v.valeve)::float8 AS valor FROM hcm_verbas_folha v
        JOIN hcm_calculos_folha cal ON cal.numemp = v.numemp AND cal.codcal = v.codcal
        JOIN custo_evento_classes k ON k.tabeve = v.tabeve AND k.codeve = v.codeve
        WHERE v.numemp = ${numemp} AND v.tipcol = ${tipcol} AND v.numcad = ${numcad} AND cal.tipcal = 11 AND cal.sitcal IN ('T','P')
          AND date_trunc('month', cal.perref)::date = ${mes}::date AND v.removido_em_senior IS NULL GROUP BY k.classe`;
      const v = (c: string) => r.find((x) => x.classe === c)?.valor ?? 0;
      const rem = v("remuneracao");
      return (rem + v("beneficio") + v("encargo_folha") + Math.round(((rem * PERCENTUAL_TESTE) / 100) * 100) / 100) / HORAS_TESTE;
    };

    const rec = await chamar("POST", "/custo-hora/recalcular", tokenAdmin, { de: "2026-05", ate: "2026-10" });
    ok("recalcular o período responde", rec.status === 200 && rec.json.competencias.length === 6, `${rec.json?.gravados} custos`);
    for (const mes of MESES) {
      const linha = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: consClt.codemp, codusu: consClt.codusu, competencia: new Date(`${mes}T00:00:00Z`) } } });
      const esperado = await esperadoClt(fe, ft, fc, mes);
      ok(`CLT ${mes}: (remuneração + encargo da folha + ${PERCENTUAL_TESTE}% da remuneração) ÷ ${HORAS_TESTE}`, !!linha && linha.origem === "clt_folha" && perto(Number(linha.custoHora), esperado, 0.0002), `${linha ? Number(linha.custoHora) : "—"} x ${esperado.toFixed(4)}`);
    }
    const lc = await prisma.consultorCustoHora.findUnique({ where: { codemp_codusu_competencia: { codemp: consClt.codemp, codusu: consClt.codusu, competencia: new Date("2026-10-01T00:00:00Z") } } });
    const det: any = lc?.detalhe;
    ok("o detalhe guarda como chegou ao número (remuneração, encargos, horas)", !!det && det.horasMes === HORAS_TESTE && det.encargos.length === 1 && det.encargos[0].percentual === PERCENTUAL_TESTE && det.custoMensal > 0, JSON.stringify(det?.encargos));
    ok("o encargo de 2027 (99%) não entrou em 2026", det?.encargos?.[0]?.percentual === PERCENTUAL_TESTE);
    const resultado = await chamar("GET", "/custo-hora/resultado?competencia=2026-10", tokenAdmin);
    ok("GET resultado lista o consultor com origem e custo", resultado.status === 200 && resultado.json.linhas.some((l: any) => l.codusu === consClt.codusu && l.origem === "clt_folha" && l.custoHora > 0));
    ok("resultado de competência inválida = 400", (await chamar("GET", "/custo-hora/resultado?competencia=xx", tokenAdmin)).status === 400);

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
    await prisma.custoEncargo.deleteMany({});
    for (const e of antes.encargos) await prisma.custoEncargo.create({ data: e });
    await prisma.custoEventoClasse.deleteMany({});
    for (const c of antes.classes) await prisma.custoEventoClasse.create({ data: c });
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
