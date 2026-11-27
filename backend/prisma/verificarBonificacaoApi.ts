// Teste ponta a ponta da Gestão de Bonificação: sobe só o router /bonificacao num Express mínimo (sem os syncs agendados do server.ts), cria
// dados temporários (processo, usuários, apontamentos, fotos da fila) marcados com TAG e apaga TUDO por id no final. Nunca toca nos processos
// reais (semeados pela migration) nem apaga tabela inteira. Roda no banco local:
//   node_modules/.bin/ts-node --transpile-only prisma/verificarBonificacaoApi.ts
import "dotenv/config";
import assert from "assert";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/auth/jwt";
import { attachCorrelationId } from "../src/audit/correlationId";
import { bonificacaoRouter } from "../src/routes/bonificacao";
import { produtividadeDoMes } from "../src/domain/relatorioProdutividade";
import { bonificacoesNasCompetencias } from "../src/domain/bonificacaoNota";

const TAG = `ZZ-TESTE-BONIF-${Date.now()}`;
const COMP = "2026-10"; // mês já encerrado (hoje é fim de novembro/2026)
const SEXTAS_OUT = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"];

async function main() {
  const app = express();
  app.use(express.json());
  app.use(attachCorrelationId);
  app.use("/bonificacao", bonificacaoRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bonificacao`;

  const roleAdmin = await prisma.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin" } });
  const roleCons = await prisma.role.upsert({ where: { name: "consultoria" }, update: {}, create: { name: "consultoria" } });
  const admin = await prisma.user.create({ data: { email: `${TAG}-admin@teste.local`, nome: "Teste admin", roleId: roleAdmin.id, status: "ativo" } });
  const semAcesso = await prisma.user.create({ data: { email: `${TAG}-nada@teste.local`, nome: "Teste sem acesso", roleId: roleCons.id, status: "ativo" } });
  const T = { admin: signToken({ userId: admin.id, role: "admin" }), nada: signToken({ userId: semAcesso.id, role: "consultoria" }) };

  async function api(quem: keyof typeof T, metodo: string, rota: string, corpo?: unknown) {
    const r = await fetch(base + rota, {
      method: metodo,
      headers: { Authorization: `Bearer ${T[quem]}`, ...(corpo ? { "Content-Type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const ct = r.headers.get("content-type") ?? "";
    const dados = ct.includes("json") ? await r.json() : await r.text();
    return { status: r.status, dados: dados as any };
  }
  const ok = (r: { status: number; dados: any }, esperado: number, msg: string) => assert.strictEqual(r.status, esperado, `${msg}: ${r.status} ${JSON.stringify(r.dados)?.slice(0, 300)}`);

  let processoId: number | null = null;
  let descontoCriado = false;
  let processoId2: number | null = null;
  const entradasIds: string[] = [];
  const filaChaves: { data: string; teamId: string }[] = [];
  try {
    // ---------------------------------------------------------------- dados reais usados como cenário
    const times = await prisma.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM kyria_teams WHERE name IN ('SUPORTE HCM', 'SUPORTE GRS') ORDER BY name`;
    const timeHcm = times.find((t) => t.name === "SUPORTE HCM")!;
    const timeGrs = times.find((t) => t.name === "SUPORTE GRS")!;
    assert.ok(timeHcm && timeGrs, "times SUPORTE HCM/GRS não encontrados no banco local");
    const cand = (
      await prisma.$queryRaw<{ codfor: number; codemp: number; codusu: number; nome: string; memberId: string; numemp: number; tipcol: number; numcad: number }[]>`
        SELECT c.codfor, c.codemp, c.codusu, c.nomcom AS nome, km.id AS "memberId", v.hcm_numemp AS numemp, v.hcm_tipcol AS tipcol, v.hcm_numcad AS numcad
        FROM kyria_members km JOIN consultores c ON c.codusu = km.codusu
        JOIN consultor_vinculos v ON v.codemp = c.codemp AND v.codusu = c.codusu
        WHERE v.hcm_numcad IS NOT NULL AND c.codfor = 505`
    )[0];
    assert.ok(cand, "consultor candidato (Anna Paula) não encontrado");
    const ticket = (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM kyria_tickets WHERE team_id = ${timeHcm.id} LIMIT 1`)[0];

    // ---------------------------------------------------------------- 1. acesso
    let r = await api("admin", "GET", "/meu-acesso");
    ok(r, 200, "meu-acesso admin");
    assert.strictEqual(r.dados.administra, true);
    r = await api("nada", "GET", "/meu-acesso");
    assert.strictEqual(r.dados.visualiza, false);
    ok(await api("nada", "GET", "/processos"), 403, "sem acesso não lista processos");
    ok(await api("nada", "GET", "/fechamentos"), 403, "lista sem acesso: 403");
    ok(await api("nada", "POST", "/processos", { nome: "x" }), 403, "sem acesso não cria");

    // ---------------------------------------------------------------- 2. processos reais semeados pela migration
    r = await api("admin", "GET", "/processos");
    ok(r, 200, "lista processos");
    const semente = r.dados.processos.filter((p: any) => ["Bonificação Líderes Suporte", "Bonificação Atendentes"].includes(p.nome));
    assert.strictEqual(semente.length, 2, "os 2 processos semeados existem");
    assert.deepStrictEqual(semente.map((p: any) => p.indicadores).sort(), [3, 5]);
    const lideres = await api("admin", "GET", `/processos/${semente.find((p: any) => p.nome === "Bonificação Líderes Suporte").id}`);
    ok(lideres, 200, "detalhe líderes");
    const rnc = lideres.dados.processo.indicadores.find((i: any) => i.chave === "rnc_area");
    assert.strictEqual(rnc.regras.length, 2, "RNC tem 2 versões de regra");
    assert.deepStrictEqual(rnc.regras[1].faixas, [{ limite: 3, pontos: 1 }, { limite: 4, pontos: 0.5 }, { limite: null, pontos: 0 }]);

    // ---------------------------------------------------------------- 3. processo de teste
    ok(await api("admin", "POST", "/processos", { nome: "", vigenciaInicio: "2026-01-01" }), 400, "nome obrigatório");
    r = await api("admin", "POST", "/processos", { nome: TAG, descricao: "teste", vigenciaInicio: "2026-01-01" });
    ok(r, 201, "cria processo");
    processoId = r.dados.processo.id as number;
    ok(await api("admin", "POST", "/processos", { nome: TAG.toLowerCase(), vigenciaInicio: "2026-01-01" }), 409, "nome duplicado (sem distinguir caixa)");
    ok(await api("admin", "PUT", `/processos/${processoId}`, { nome: TAG, descricao: "teste 2", vigenciaInicio: "2026-01-01", vigenciaFim: "2025-01-01" }), 400, "fim antes do início");
    ok(await api("admin", "PUT", `/processos/${processoId}`, { nome: TAG, descricao: "teste 2", vigenciaInicio: "2026-01-01" }), 200, "altera processo");

    const novoIndicador = async (nome: string, fonte: string, unidade: string, sentido: string) => {
      const x = await api("admin", "POST", `/processos/${processoId}/indicadores`, { nome, fonte, unidade, sentido });
      ok(x, 201, `indicador ${nome}`);
      return x.dados.indicador.id as number;
    };
    ok(await api("admin", "POST", `/processos/${processoId}/indicadores`, { nome: "x", fonte: "inexistente", unidade: "horas", sentido: "menor_melhor" }), 400, "fonte inválida");
    const iCap = await novoIndicador("Capacidade", "kyria_capacidade", "quantidade", "menor_melhor");
    const iEfi = await novoIndicador("Eficiência", "kyria_eficiencia", "percentual", "maior_melhor");
    const iAnt = await novoIndicador("Chamados antigos", "kyria_chamados_antigos", "quantidade", "menor_melhor");
    const iPct = await novoIndicador("Pct ponto", "kyria_pct_ponto", "percentual", "maior_melhor");
    const iRnc = await novoIndicador("RNC", "manual", "quantidade", "menor_melhor");
    const iPdi = await novoIndicador("PDI", "manual", "horas", "maior_melhor");

    // regras: validações
    const regraCorpo = (faixas: unknown, extra: Record<string, unknown> = {}) => ({ vigenciaInicio: "2026-01-01", valorBase: 400, faixas, ...extra });
    const FAIXAS_MENOR = [{ limite: 10, pontos: 1 }, { limite: 13, pontos: 0.6 }, { limite: null, pontos: 0 }];
    ok(await api("admin", "POST", `/indicadores/${iCap}/regras`, regraCorpo([{ limite: 10, pontos: 1 }])), 400, "última faixa precisa ser 'demais casos'");
    ok(await api("admin", "POST", `/indicadores/${iCap}/regras`, regraCorpo([{ limite: 13, pontos: 1 }, { limite: 10, pontos: 0.5 }, { limite: null, pontos: 0 }])), 400, "limites crescentes");
    ok(await api("admin", "POST", `/indicadores/${iCap}/regras`, regraCorpo(FAIXAS_MENOR, { vigenciaInicio: "2026-01-15" })), 400, "vigência começa no dia 1");
    ok(await api("admin", "POST", `/indicadores/${iAnt}/regras`, regraCorpo([{ limite: 0, pontos: 1 }, { limite: null, pontos: 0 }])), 400, "chamados antigos exige idade em meses");
    ok(await api("admin", "POST", `/indicadores/${iCap}/regras`, regraCorpo(FAIXAS_MENOR)), 201, "regra capacidade");
    ok(await api("admin", "POST", `/indicadores/${iCap}/regras`, regraCorpo(FAIXAS_MENOR, { vigenciaInicio: "2026-06-01" })), 409, "vigência cruzada");
    ok(await api("admin", "POST", `/indicadores/${iEfi}/regras`, regraCorpo([{ limite: 80, pontos: 1 }, { limite: 50, pontos: 0.5 }, { limite: null, pontos: 0 }])), 201, "regra eficiência");
    ok(await api("admin", "POST", `/indicadores/${iAnt}/regras`, regraCorpo([{ limite: 0, pontos: 1 }, { limite: null, pontos: 0 }], { idadeMeses: 3 })), 201, "regra chamados antigos");
    ok(await api("admin", "POST", `/indicadores/${iPct}/regras`, regraCorpo([{ limite: 80, pontos: 1 }, { limite: null, pontos: 0 }], { valorBase: 200 })), 201, "regra pct ponto");
    // RNC: 2 versões (virada em julho), como o processo real
    ok(await api("admin", "POST", `/indicadores/${iRnc}/regras`, regraCorpo([{ limite: 5, pontos: 1 }, { limite: 7, pontos: 0.5 }, { limite: null, pontos: 0 }], { vigenciaFim: "2026-06-30" })), 201, "RNC 1º sem");
    ok(await api("admin", "POST", `/indicadores/${iRnc}/regras`, regraCorpo([{ limite: 3, pontos: 1 }, { limite: 4, pontos: 0.5 }, { limite: null, pontos: 0 }], { vigenciaInicio: "2026-07-01" })), 201, "RNC 2º sem");
    ok(await api("admin", "POST", `/indicadores/${iPdi}/regras`, regraCorpo([{ limite: 8, pontos: 1 }, { limite: null, pontos: 0 }])), 201, "regra PDI");

    // ---------------------------------------------------------------- 4. enquadramento
    const enq = (extra: Record<string, unknown> = {}) => ({ codfor: cand.codfor, vigenciaInicio: "2026-01-01", timesIds: [timeHcm.id, timeGrs.id], ...extra });
    ok(await api("admin", "POST", `/processos/${processoId}/enquadramentos`, { ...enq(), codfor: 999999 }), 404, "consultor inexistente");
    ok(await api("admin", "POST", `/processos/${processoId}/enquadramentos`, enq({ timesIds: ["nao-existe"] })), 400, "time inexistente");
    r = await api("admin", "POST", `/processos/${processoId}/enquadramentos`, enq());
    ok(r, 201, "enquadra consultor");
    const enqId = r.dados.enquadramento.id as number;
    ok(await api("admin", "POST", `/processos/${processoId}/enquadramentos`, enq({ vigenciaInicio: "2026-06-01" })), 409, "enquadramento cruzado");

    // ---------------------------------------------------------------- 5. dados do Kyria/HCM para a apuração de outubro/2026
    for (const d of SEXTAS_OUT.slice(0, 4)) {
      // 4 sextas fotografadas (a 5ª, 30/10, fica sem foto: a média é das sextas COM foto)
      const q = [12, 10, 14, 9][SEXTAS_OUT.indexOf(d)]; // total por sexta (somando os 2 times)
      await prisma.$executeRaw`INSERT INTO kyria_fila_semanal (data, team_id, em_fila, aguardando_retorno) VALUES (${d}::date, ${timeHcm.id}, ${q - 3}, 2)`;
      await prisma.$executeRaw`INSERT INTO kyria_fila_semanal (data, team_id, em_fila, aguardando_retorno) VALUES (${d}::date, ${timeGrs.id}, 0, 1)`;
      filaChaves.push({ data: d, teamId: timeHcm.id }, { data: d, teamId: timeGrs.id });
    }
    // O banco local pode já ter apontamentos REAIS do consultor em outubro (carga do feed): o total esperado é o real + os sintéticos abaixo.
    const [real] = await prisma.$queryRaw<{ min: number }[]>`
      SELECT COALESCE(sum(e.minutes), 0)::float8 AS min FROM kyria_time_entries e JOIN kyria_members m ON m.id = e.user_id
      WHERE m.codusu = ${cand.codusu} AND e.minutes IS NOT NULL
        AND (e.started_at AT TIME ZONE 'America/Sao_Paulo') >= '2026-10-01'::date AND (e.started_at AT TIME ZONE 'America/Sao_Paulo') < '2026-11-01'::date`;
    const esperadoKyria = Math.round((real.min + 1011) * 100) / 100;
    // apontamentos sintéticos do consultor em outubro (2 dentro do mês, 1 fora)
    const mk = async (suf: string, inicio: string, minutos: number) => {
      const id = `${TAG}-${suf}`;
      await prisma.$executeRaw`INSERT INTO kyria_time_entries (id, ticket_id, user_id, origem, is_open, started_at, ended_at, minutes, effective_at, criado_em_kyria, alterado_em_kyria, sincronizado_em)
        VALUES (${id}, ${ticket.id}, ${cand.memberId}, 'manual'::"KyriaOrigemApontamento", false, ${inicio}::timestamptz, ${inicio}::timestamptz, ${minutos}, ${inicio}::timestamptz, now(), now(), now())`;
      entradasIds.push(id);
    };
    await mk("a", "2026-10-05T12:00:00Z", 600);
    await mk("b", "2026-10-20T15:00:00Z", 300);
    await mk("fora", "2026-11-03T12:00:00Z", 999); // novembro: não conta
    await mk("limite", "2026-11-01T01:30:00Z", 111); // 31/10 22:30 em Brasília: CONTA em outubro

    // ---------------------------------------------------------------- 6. apuração
    ok(await api("admin", "POST", "/fechamentos/apurar", { processoId, competencia: "2027-12" }), 400, "competência futura");
    r = await api("admin", "POST", "/fechamentos/apurar", { processoId, competencia: COMP });
    ok(r, 200, "apura outubro");
    assert.strictEqual(r.dados.consultores, 1);
    assert.strictEqual(r.dados.resultados, 6);
    const fechamentoId = r.dados.fechamentoId as number;

    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    ok(r, 200, "detalhe do fechamento");
    const linha = r.dados.linhas[0];
    assert.strictEqual(linha.codfor, cand.codfor);
    const res = (id: number) => linha.resultados[id];

    // capacidade: totais das sextas 12, 10, 14 e 9 -> média 11,25 -> 0,6 -> R$ 240
    assert.strictEqual(res(iCap).valorApurado, 11.25, "capacidade = média das sextas com foto");
    assert.strictEqual(res(iCap).pontos, 0.6);
    assert.strictEqual(res(iCap).valor, 240);
    assert.strictEqual(res(iCap).detalhe.sextasComFoto, 4);

    // eficiência: confere com SQL direto
    const [efi] = await prisma.$queryRaw<{ abertos: number; fechados: number }[]>`
      SELECT count(*)::int abertos, count(*) FILTER (WHERE closed_at IS NOT NULL AND ((closed_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') < '2026-11-01'::date)::int fechados
      FROM kyria_tickets WHERE team_id = ANY(${[timeHcm.id, timeGrs.id]}::text[])
        AND ((opened_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') >= '2026-10-01'::date AND ((opened_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') < '2026-11-01'::date`;
    assert.ok(efi.abertos > 0, "há chamados abertos em outubro nos times");
    assert.strictEqual(res(iEfi).detalhe.abertos, efi.abertos);
    assert.strictEqual(res(iEfi).detalhe.fechados, efi.fechados);
    assert.strictEqual(res(iEfi).valorApurado, Math.round(((efi.fechados * 100) / efi.abertos) * 10000) / 10000);
    console.log(`  eficiência: ${efi.fechados}/${efi.abertos} = ${res(iEfi).valorApurado}% -> ${res(iEfi).pontos} pt`);

    // chamados antigos: confere com SQL direto
    const [ant] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM kyria_tickets t JOIN kyria_ticket_statuses s ON s.key = t.status_key
      WHERE t.team_id = ANY(${[timeHcm.id, timeGrs.id]}::text[])
        AND ((t.opened_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') < '2026-08-01'::date
        AND ((t.closed_at IS NULL AND s.category::text NOT IN ('done','cancelled')) OR (t.closed_at IS NOT NULL AND ((t.closed_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo') >= '2026-11-01'::date))`;
    assert.strictEqual(res(iAnt).valorApurado, ant.n, "chamados antigos bate com a consulta direta");
    assert.strictEqual(res(iAnt).pontos, ant.n === 0 ? 1 : 0, "1 chamado antigo derruba o item");
    console.log(`  chamados antigos: ${ant.n} -> ${res(iAnt).pontos} pt`);

    // % ponto: (600+300+111 min do Kyria) ÷ minutos de ponto HCM de outubro
    const [ponto] = await prisma.$queryRaw<{ min: number }[]>`
      SELECT COALESCE(sum(sp.qtdhor), 0)::float8 AS min FROM hcm_situacao_ponto sp JOIN hcm_situacoes st ON st.codsit = sp.codsit
      WHERE sp.numemp = ${cand.numemp} AND sp.tipcol = ${cand.tipcol} AND sp.numcad = ${cand.numcad} AND st.conabs = 2 AND sp.removido_em_senior IS NULL
        AND sp.datapu >= '2026-10-01'::date AND sp.datapu < '2026-11-01'::date`;
    assert.strictEqual(res(iPct).detalhe.minutosKyria, esperadoKyria, "só os apontamentos de outubro (inclui 31/10 22:30 em Brasília, exclui novembro)");
    assert.strictEqual(res(iPct).detalhe.minutosPonto, ponto.min);
    // Saldo do banco de horas no mês, conferido por uma consulta própria (créditos − débitos dos lançamentos datados no mês)
    const [banco] = await prisma.$queryRaw<{ credito: number; debito: number; n: number }[]>`
      SELECT COALESCE(sum(qtdhor) FILTER (WHERE btrim(sinlan) = '+'), 0)::float8 AS credito,
             COALESCE(sum(qtdhor) FILTER (WHERE btrim(sinlan) = '-'), 0)::float8 AS debito, count(*)::int AS n
      FROM hcm_lancamentos_bh
      WHERE numemp = ${cand.numemp} AND tipcol = ${cand.tipcol} AND numcad = ${cand.numcad} AND removido_em_senior IS NULL
        AND datlan >= '2026-10-01'::date AND datlan < '2026-11-01'::date`;
    const saldo = banco.credito - banco.debito;
    const extras = Math.max(saldo, 0);
    const totalMes = ponto.min + extras;
    assert.strictEqual(res(iPct).detalhe.saldoBancoMinutos, saldo, "saldo do banco no mês");
    assert.strictEqual(res(iPct).detalhe.minutosExtras, extras, "extras = saldo só quando positivo");
    assert.strictEqual(res(iPct).detalhe.minutosTotal, totalMes, "total = trabalhadas + extras");
    assert.strictEqual(res(iPct).detalhe.bancoDeHoras != null, saldo < 0, "aviso só com saldo negativo");
    if (totalMes > 0) assert.strictEqual(res(iPct).valorApurado, Math.round(((esperadoKyria * 100) / totalMes) * 10000) / 10000);
    console.log(`  % ponto: ${esperadoKyria} min (real ${real.min} + 1011 sintéticos) / total ${totalMes} min (ponto ${ponto.min} + extras ${extras}; saldo BH ${saldo}) = ${res(iPct).valorApurado}%`);

    // manuais: pendentes
    assert.strictEqual(res(iRnc).valor, null, "RNC (manual) pendente");
    assert.strictEqual(res(iPdi).valor, null, "PDI (manual) pendente");
    assert.ok(linha.pendentes >= 2);

    // ---------------------------------------------------------------- 7. fechar com pendência, informar, fechar
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/fechar`, {}), 409, "não fecha com indicador sem valor");
    ok(await api("admin", "PUT", `/resultados/${res(iRnc).id}`, { valorInformado: -1 }), 400, "valor negativo");
    r = await api("admin", "PUT", `/resultados/${res(iRnc).id}`, { valorInformado: 6, observacao: "6 RNC no mês" });
    ok(r, 200, "informa RNC");
    assert.strictEqual(r.dados.pontos, 0, "outubro usa a régua do 2º semestre: 6 RNC = demais casos = 0 ponto");
    r = await api("admin", "PUT", `/resultados/${res(iRnc).id}`, { valorInformado: 3 });
    assert.strictEqual(r.dados.pontos, 1, "3 RNC no 2º semestre = 1 ponto");
    assert.strictEqual(r.dados.valor, 400);
    ok(await api("admin", "PUT", `/resultados/${res(iPdi).id}`, { valorInformado: 8 }), 200, "informa PDI");

    // reapurar preserva o que foi informado
    r = await api("admin", "POST", "/fechamentos/apurar", { processoId, competencia: COMP });
    ok(r, 200, "reapura");
    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    assert.strictEqual(r.dados.linhas[0].resultados[iRnc].valorInformado, 3, "valor informado sobrevive à reapuração");
    assert.strictEqual(r.dados.linhas[0].resultados[iPdi].pontos, 1);

    // um valor informado também pode sobrepor um indicador automático (ex.: mês sem foto da fila)
    r = await api("admin", "PUT", `/resultados/${r.dados.linhas[0].resultados[iCap].id}`, { valorInformado: 9 });
    ok(r, 200, "ajusta capacidade manualmente");
    assert.strictEqual(r.dados.pontos, 1, "9 chamados = 1 ponto (<= 10)");
    r = await api("admin", "PUT", `/resultados/${(await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`)).dados.linhas[0].resultados[iCap].id}`, { valorInformado: "" });
    assert.strictEqual(r.dados.pontos, 0.6, "limpar o informado volta ao apurado (11,25 = 0,6)");

    // ---------------------------------------------------------------- 8. fechar
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/fechar`, {}), 200, "fecha outubro");
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/fechar`, {}), 409, "já fechado");
    ok(await api("admin", "POST", "/fechamentos/apurar", { processoId, competencia: COMP }), 409, "fechado não reapura");
    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    assert.strictEqual(r.dados.fechamento.situacao, "fechado");
    ok(await api("admin", "PUT", `/resultados/${r.dados.linhas[0].resultados[iRnc].id}`, { valorInformado: 1 }), 409, "fechado não altera resultado");
    // regra usada num fechamento fechado: não muda valor/faixas, nem exclui
    const detalhe = (await api("admin", "GET", `/processos/${processoId}`)).dados.processo;
    const regraCap = detalhe.indicadores.find((i: any) => i.id === iCap).regras[0];
    ok(await api("admin", "PUT", `/regras/${regraCap.id}`, { ...regraCap, valorBase: 500 }), 409, "regra usada em fechado não muda valor");
    ok(await api("admin", "PUT", `/regras/${regraCap.id}`, { ...regraCap, observacao: "ajuste de texto" }), 200, "mas aceita observação");
    ok(await api("admin", "DELETE", `/regras/${regraCap.id}`), 409, "regra usada em fechado não exclui");
    ok(await api("admin", "DELETE", `/indicadores/${iCap}`), 409, "indicador com resultado não exclui");
    ok(await api("admin", "DELETE", `/enquadramentos/${enqId}`), 409, "enquadramento com resultado não exclui");

    // lista / resumo / campos / csv de fechamentos e resultados
    r = await api("admin", "GET", `/fechamentos?processoId=${processoId}`);
    ok(r, 200, "lista fechamentos");
    assert.strictEqual(r.dados.itens.length, 1);
    assert.strictEqual(r.dados.itens[0].consultores, 1);
    const det = (await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`)).dados;
    assert.strictEqual(r.dados.itens[0].total, det.totais.valor, "total da lista = total do detalhe");
    ok(await api("admin", "GET", `/fechamentos/resumo?processoId=${processoId}`), 200, "resumo fechamentos");
    r = await api("admin", "GET", `/resultados?processoId=${processoId}&pageSize=50`);
    ok(r, 200, "lista resultados");
    assert.strictEqual(r.dados.itens.length, 6);
    ok(await api("admin", "GET", `/resultados/campos`), 200, "catálogo de campos");
    r = await api("admin", "GET", `/resultados/csv?processoId=${processoId}`);
    ok(r, 200, "csv resultados");
    assert.ok(String(r.dados).includes(cand.nome), "csv traz o nome do consultor");
    ok(await api("nada", "GET", `/resultados?processoId=${processoId}`), 403, "sem acesso não lê resultados");

    // relatório Horas Kyria x Trabalhadas
    r = await api("admin", "GET", `/relatorios/horas-kyria?competencia=${COMP}&processoId=${processoId}`);
    ok(r, 200, "relatório Horas Kyria x Trabalhadas");
    assert.strictEqual(r.dados.itens.length, 1, "uma linha por atendente enquadrado");
    const h = r.dados.itens[0];
    assert.strictEqual(h.minutosKyria, esperadoKyria);
    assert.strictEqual(h.minutosPonto, ponto.min);
    assert.strictEqual(h.saldoBanco ?? 0, saldo);
    assert.strictEqual(h.minutosExtras, extras);
    assert.strictEqual(h.minutosTotal, totalMes, "tela e apuração usam o mesmo total");
    if (totalMes > 0) {
      assert.strictEqual(h.percentual, res(iPct).valorApurado, "% da tela = % da apuração");
      assert.strictEqual(h.minutosOcioso, Math.round((totalMes - esperadoKyria) * 100) / 100, "ocioso = total − Kyria");
    }
    for (const t of h.porTime) assert.ok(Math.abs(t.porArea.reduce((s: number, a: any) => s + a.minutos, 0) - t.minutos) < 0.05, `as áreas somam o time ${t.time}`);
    r = await api("admin", "GET", `/relatorios/horas-kyria?competencia=${COMP}&processoId=${processoId}&o=${encodeURIComponent("minutosOcioso:desc")}&pageSize=25`);
    ok(r, 200, "ordena pelo ocioso");
    assert.strictEqual(h.pdiHoras, 8);
    assert.strictEqual(h.pdiConcluido, "Sim");
    assert.strictEqual(h.motivo, null);
    assert.ok(h.porTime.length >= 1 && Math.abs(h.porTime.reduce((s: number, t: any) => s + t.minutos, 0) - esperadoKyria) < 0.05, "o detalhe por time soma os minutos do Kyria");
    ok(await api("admin", "GET", `/relatorios/horas-kyria/resumo?competencia=${COMP}&processoId=${processoId}`), 200, "resumo da lista");
    r = await api("admin", "GET", `/relatorios/horas-kyria/csv?competencia=${COMP}&processoId=${processoId}`);
    ok(r, 200, "csv da lista");
    assert.ok(String(r.dados).includes(cand.nome), "csv traz o atendente");
    // CSV: coluna em minutos que a tela mostra como HH:MM vai em HORAS decimais (o Excel soma)
    r = await api("admin", "GET", `/relatorios/horas-kyria/csv?competencia=${COMP}&processoId=${processoId}&colunasCsv=consultor,minutosKyria&cabecalhos=${encodeURIComponent(JSON.stringify({ consultor: "Atendente", minutosKyria: "Horas Kyria" }))}`);
    assert.ok(String(r.dados).includes((esperadoKyria / 60).toFixed(2).replace(".", ",")), "csv em horas decimais");
    // Impressão: formato HH:MM nas colunas em minutos; times só das linhas que a tela tinha abertas (`detalhe`)
    const colsImp = "consultor,minutosPonto,minutosKyria,percentual";
    const colsNovas = "consultor,saldoBanco,minutosExtras,minutosTotal,minutosOcioso";
    r = await api("admin", "GET", `/relatorios/horas-kyria/impressao?competencia=${COMP}&processoId=${processoId}&colunasCsv=${colsNovas}`);
    ok(r, 200, "impressão das colunas novas");
    assert.deepStrictEqual(r.dados.colunas.map((c: any) => c.formato ?? null), [null, "horasMinutos", "horasMinutos", "horasMinutos", "horasMinutos"]);
    r = await api("admin", "GET", `/relatorios/horas-kyria/impressao?competencia=${COMP}&processoId=${processoId}&colunasCsv=${colsImp}`);
    ok(r, 200, "impressão sem detalhe");
    assert.deepStrictEqual(r.dados.colunas.map((c: any) => [c.nome, c.formato ?? null]), [["consultor", null], ["minutosPonto", "horasMinutos"], ["minutosKyria", "horasMinutos"], ["percentual", null]]);
    assert.ok(!r.dados.detalhes || r.dados.detalhes.every((d: unknown) => d == null), "contraída: sem times");
    r = await api("admin", "GET", `/relatorios/horas-kyria/impressao?competencia=${COMP}&processoId=${processoId}&colunasCsv=${colsImp}&detalhe=${processoId}-${cand.codfor}`);
    assert.ok(Array.isArray(r.dados.detalhes?.[0]) && r.dados.detalhes[0].length >= 1, "aberta: com os times");
    const sub = r.dados.detalhes[0];
    // Dois níveis na impressão: o time e, logo abaixo, as áreas dele (nome com "›"). Cada nível, sozinho, soma as horas Kyria.
    const somaDe = (areas: boolean) => sub.filter((x: any) => String(x.consultor).includes("›") === areas).reduce((s: number, x: any) => s + x.minutosKyria, 0);
    assert.ok(Math.abs(somaDe(false) - esperadoKyria) < 0.05, "os times somam as horas Kyria");
    assert.ok(Math.abs(somaDe(true) - esperadoKyria) < 0.05, "as áreas somam as horas Kyria");
    assert.ok(sub.every((x: any) => typeof x.consultor === "string" && x.percentual != null), "cada time com nome e %");
    r = await api("admin", "GET", `/relatorios/horas-kyria/impressao?competencia=${COMP}&processoId=${processoId}&colunasCsv=${colsImp}&detalhe=${processoId}-999999`);
    assert.ok(r.dados.detalhes.every((d: unknown) => d == null), "chave que não existe: sem times");
    r = await api("admin", "GET", `/relatorios/horas-kyria?competencia=${COMP}&processoId=${processoId}&codfor=999999`);
    assert.strictEqual(r.dados.itens.length, 0, "filtro por consultor");
    r = await api("admin", "GET", `/relatorios/horas-kyria?competencia=2026-09&processoId=${processoId}`);
    const [setReal] = await prisma.$queryRaw<{ min: number }[]>`
      SELECT COALESCE(sum(e.minutes), 0)::float8 AS min FROM kyria_time_entries e JOIN kyria_members m ON m.id = e.user_id
      WHERE m.codusu = ${cand.codusu} AND e.minutes IS NOT NULL
        AND (e.started_at AT TIME ZONE 'America/Sao_Paulo') >= '2026-09-01'::date AND (e.started_at AT TIME ZONE 'America/Sao_Paulo') < '2026-10-01'::date`;
    assert.strictEqual(r.dados.itens[0].minutosKyria ?? 0, Math.round(setReal.min * 100) / 100, "setembro: só os apontamentos reais, sem os sintéticos de outubro");
    assert.strictEqual(r.dados.itens[0].pdiHoras, null, "sem fechamento de setembro, sem PDI");
    ok(await api("nada", "GET", `/relatorios/horas-kyria?competencia=${COMP}`), 403, "sem acesso não vê o relatório");

    // ---------------------------------------------------------------- 9. reabrir
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/reabrir`, {}), 400, "reabrir exige justificativa");
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/reabrir`, { justificativa: "teste de reabertura" }), 200, "reabre");
    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    assert.strictEqual(r.dados.fechamento.situacao, "aberto");

    // ---------------------------------------------------------------- 9b. compõe a nota (flag do processo -> nota -> Home -> aviso de reabrir)
    const comp1 = new Date("2026-10-01T00:00:00.000Z");
    const somaResultados = async () => Number((await prisma.bonificacaoResultado.aggregate({ where: { fechamentoId }, _sum: { valor: true } }))._sum.valor ?? 0);
    const naNota = () => bonificacoesNasCompetencias(cand.codemp, cand.codfor, [comp1]);
    assert.strictEqual((await naNota()).total, 0, "aberta: nada na nota");
    assert.strictEqual((await api("admin", "GET", `/processos/${processoId}`)).dados.processo.compoeNota, false, "a flag nasce desligada");

    // flag DESLIGADA: fechar não compõe a nota
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/fechar`, {}), 200, "fecha com a flag desligada");
    assert.strictEqual((await naNota()).total, 0, "flag desligada: não entra na nota");
    // ligar a flag NÃO muda o fechamento que já fechou (a cópia foi feita ao fechar)
    ok(await api("admin", "PUT", `/processos/${processoId}`, { nome: TAG, descricao: "teste 2", vigenciaInicio: "2026-01-01", compoeNota: true }), 200, "liga a flag");
    assert.strictEqual((await api("admin", "GET", `/processos/${processoId}`)).dados.processo.compoeNota, true);
    assert.strictEqual((await naNota()).total, 0, "mudar a flag depois de fechado não mexe na nota passada");
    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    assert.strictEqual(r.dados.compoeNota, false, "fechamento fechado mostra a flag copiada (desligada)");

    // reabrir e fechar de novo copia a flag ligada
    r = await api("admin", "POST", `/fechamentos/${fechamentoId}/reabrir`, { justificativa: "religar a flag" });
    ok(r, 200, "reabre");
    assert.strictEqual(r.dados.descontosJaFechados, 0);
    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    assert.strictEqual(r.dados.compoeNota, true, "aberto mostra a flag do processo (a que será copiada)");
    ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/fechar`, {}), 200, "fecha com a flag ligada");
    const total = Math.round((await somaResultados()) * 100) / 100;
    assert.ok(total > 0, "o consultor de teste tem bonificação");
    let nota = await naNota();
    assert.strictEqual(nota.total, total, "fechado com a flag: a soma dos resultados entra na nota");
    assert.strictEqual(nota.itens.length, 6, "um item por indicador");
    assert.ok(nota.itens.every((i) => i.processo === TAG && i.competencia === "2026-10-01" && i.valor >= 0));
    assert.strictEqual(nota.itens[0].indicador, "Capacidade", "ordem dos indicadores");

    // a nota do Relatório de Produtividade soma a bonificação (e a base do desconto, que usa valorNota)
    const prod = await produtividadeDoMes(cand.codemp, cand.codfor, 2026, 10, 100);
    assert.strictEqual(prod.totais.valorBonificacao, total);
    assert.strictEqual(
      Math.round((prod.totais.valorNota! - prod.totais.valorTrabalhadas! - prod.totais.valorDeslocamento! - prod.totais.valorFerias) * 100) / 100,
      total,
      "valorNota = trabalhadas + deslocamento + férias + bonificação"
    );
    console.log(`  nota: bonificação R$ ${total.toFixed(2)} somada ao Valor Nota (R$ ${prod.totais.valorNota!.toFixed(2)})`);
    // outra competência não leva a bonificação de outubro
    assert.strictEqual((await produtividadeDoMes(cand.codemp, cand.codfor, 2026, 9, 100)).totais.valorBonificacao, 0);

    // Indicação "vai para a nota": o consultor de teste (Anna Paula) NÃO tem contrato Fixo/Hora vigente, então o valor dele não incide na nota mesmo com a flag ligada
    r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
    assert.strictEqual(r.dados.compoeNota, true);
    const linhaSemContrato = r.dados.linhas.find((l: any) => l.codfor === cand.codfor);
    assert.deepStrictEqual([linhaSemContrato.vaiParaNota, linhaSemContrato.contrato], [false, null], "sem contrato: não vai para a nota");
    assert.match(linhaSemContrato.motivoNota, /contrato/i);
    assert.strictEqual(r.dados.totais.naNota, 0, "ninguém com contrato: nada vai para a nota");
    // e a Home/detalhe não somam nem listam a bonificação de quem não tem contrato
    r = await api("admin", "GET", `/competencias?codfor=${cand.codfor}&competencias=2026-10`);
    ok(r, 200, "detalhe da Home sem contrato");
    assert.deepStrictEqual(r.dados.competencias, [], "sem contrato: nada a detalhar");
    ok(await api("nada", "GET", `/competencias?codfor=${cand.codfor}&competencias=2026-10`), 403, "sem acesso não vê o detalhe");

    // consultor COM contrato (Fixo/Hora): processo próprio, com a flag ligada, fechado -> vai para a nota e aparece no detalhe da Home
    const comContrato = (await prisma.contratoConsultor.findMany({ where: { vlrhor: { not: null } }, select: { codemp: true, codfor: true }, distinct: ["codemp", "codfor"], take: 300 }))
      .map((c) => c)
      .filter((c) => c.codfor != null);
    let alvo: { codemp: number; codfor: number } | null = null;
    for (const c of comContrato) {
      if (c.codfor === cand.codfor) continue;
      const existe = await prisma.consultor.findFirst({ where: { codemp: c.codemp, codfor: c.codfor }, select: { codfor: true } });
      if (existe) {
        alvo = { codemp: c.codemp, codfor: c.codfor! };
        break;
      }
    }
    assert.ok(alvo, "há um consultor com contrato de valor no banco local");
    r = await api("admin", "POST", "/processos", { nome: `${TAG}-contrato`, vigenciaInicio: "2026-01-01", compoeNota: true });
    ok(r, 201, "processo 2");
    processoId2 = r.dados.processo.id as number;
    r = await api("admin", "POST", `/processos/${processoId2}/indicadores`, { nome: "RNC", fonte: "manual", unidade: "quantidade", sentido: "menor_melhor" });
    ok(r, 201, "indicador do processo 2");
    const ind2 = r.dados.indicador.id as number;
    ok(await api("admin", "POST", `/indicadores/${ind2}/regras`, regraCorpo([{ limite: 5, pontos: 1 }, { limite: 7, pontos: 0.5 }, { limite: null, pontos: 0 }])), 201, "regra do processo 2");
    ok(await api("admin", "POST", `/processos/${processoId2}/enquadramentos`, { codfor: alvo!.codfor, vigenciaInicio: "2026-01-01", timesIds: [] }), 201, "enquadra quem tem contrato");
    r = await api("admin", "POST", "/fechamentos/apurar", { processoId: processoId2, competencia: COMP });
    ok(r, 200, "apura o processo 2");
    const fech2 = r.dados.fechamentoId as number;
    r = await api("admin", "GET", `/fechamentos/${processoId2}/${COMP}`);
    const celula2 = r.dados.linhas[0].resultados[ind2];
    ok(await api("admin", "PUT", `/resultados/${celula2.id}`, { valorInformado: 3 }), 200, "lança o RNC");
    ok(await api("admin", "POST", `/fechamentos/${fech2}/fechar`, {}), 200, "fecha o processo 2");
    r = await api("admin", "GET", `/fechamentos/${processoId2}/${COMP}`);
    const linhaContrato = r.dados.linhas[0];
    assert.strictEqual(linhaContrato.vaiParaNota, true, "com contrato e a flag ligada: vai para a nota");
    assert.ok(["fixo", "hora"].includes(linhaContrato.contrato), "contrato Fixo ou Hora");
    assert.match(linhaContrato.contratoRotulo, /^Contrato (Fixo|Hora)$/);
    assert.strictEqual(linhaContrato.motivoNota, null);
    assert.strictEqual(r.dados.totais.naNota, 400, "1 ponto x R$ 400 vai para a nota");
    console.log(`  nota: ${linhaContrato.contratoRotulo} -> vai para a nota (R$ ${r.dados.totais.naNota.toFixed(2)})`);
    // Home: detalhe por competência do consultor com contrato
    r = await api("admin", "GET", `/competencias?codfor=${alvo!.codfor}&competencias=2026-10,2026-11`);
    ok(r, 200, "detalhe da Home com contrato");
    assert.strictEqual(r.dados.competencias.length, 2);
    assert.strictEqual(r.dados.competencias[0].total, 400);
    assert.strictEqual(r.dados.competencias[0].itens.length, 1);
    assert.strictEqual(r.dados.competencias[0].itens[0].indicador, "RNC");
    assert.deepStrictEqual([r.dados.competencias[1].total, r.dados.competencias[1].itens.length], [0, 0]);
    // processo SEM a flag: mesmo com contrato não vai para a nota
    ok(await api("admin", "POST", `/fechamentos/${fech2}/reabrir`, { justificativa: "testar sem flag" }), 200, "reabre o 2");
    ok(await api("admin", "PUT", `/processos/${processoId2}`, { nome: `${TAG}-contrato`, vigenciaInicio: "2026-01-01", compoeNota: false }), 200, "desliga a flag do 2");
    r = await api("admin", "GET", `/fechamentos/${processoId2}/${COMP}`);
    assert.strictEqual(r.dados.linhas[0].vaiParaNota, false);
    assert.match(r.dados.linhas[0].motivoNota, /não compõe/i);

    // aviso de reabrir: o desconto da competência já fechou DEPOIS da bonificação (a base já a inclui) e não é refeito
    const chaveDesc = { competencia_codemp_codfor: { competencia: comp1, codemp: cand.codemp, codfor: cand.codfor } };
    const descExistia = !!(await prisma.descontoFechamento.findUnique({ where: chaveDesc }));
    if (!descExistia) {
      await prisma.descontoFechamento.create({ data: { competencia: comp1, codemp: cand.codemp, codfor: cand.codfor, valorNota: 1, totalPrevisto: 0, totalDescontado: 0, saldoTransportado: 0, origem: "manual" } });
      descontoCriado = true;
      r = await api("admin", "GET", `/fechamentos/${processoId}/${COMP}`);
      assert.strictEqual(r.dados.descontosJaFechados, 1, "o detalhe avisa quantos descontos já fecharam com esta bonificação");
      r = await api("admin", "POST", `/fechamentos/${fechamentoId}/reabrir`, { justificativa: "teste do aviso" });
      ok(r, 200, "reabre mesmo com o desconto fechado (permitido, com aviso)");
      assert.deepStrictEqual([r.dados.compunhaNota, r.dados.descontosJaFechados], [true, 1]);
    } else {
      ok(await api("admin", "POST", `/fechamentos/${fechamentoId}/reabrir`, { justificativa: "teste do aviso" }), 200, "reabre");
    }
    assert.strictEqual((await naNota()).total, 0, "reaberta: a bonificação SAI da nota até fechar de novo");
    assert.strictEqual((await produtividadeDoMes(cand.codemp, cand.codfor, 2026, 10, 100)).totais.valorBonificacao, 0);
    r = await api("admin", "GET", `/competencias?codfor=${cand.codfor}&competencias=2026-10`);
    assert.deepStrictEqual(r.dados.competencias, [], "reaberta (e sem contrato): nada a detalhar");

    // ---------------------------------------------------------------- 10. foto da fila (captura manual) e auditoria
    r = await api("admin", "POST", "/fila-semanal/capturar");
    ok(r, 200, "captura a fila de hoje");
    assert.ok(r.dados.times > 0);
    filaChaves.push(...(await prisma.kyriaFilaSemanal.findMany({ where: { data: new Date(`${r.dados.data}T00:00:00.000Z`) }, select: { teamId: true } })).map((t) => ({ data: r.dados.data as string, teamId: t.teamId })));
    const eventos = await prisma.auditEvento.findMany({ where: { usuarioId: admin.id }, select: { eventoTipo: true } });
    for (const tipo of ["BONIFICACAO_PROCESSO_CRIADO", "BONIFICACAO_REGRA_CRIADA", "BONIFICACAO_ENQUADRAMENTO_CRIADO", "BONIFICACAO_FECHAMENTO_APURADO", "BONIFICACAO_RESULTADO_ALTERADO", "BONIFICACAO_FECHAMENTO_FECHADO", "BONIFICACAO_FECHAMENTO_REABERTO"]) {
      assert.ok(eventos.some((e) => e.eventoTipo === tipo), `auditoria registrou ${tipo}`);
    }
  } catch (e) {
    console.error("FALHOU:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    // ---------------------------------------------------------------- limpeza (só o que eu criei, por id/chave)
    try {
      if (entradasIds.length) await prisma.kyriaTimeEntry.deleteMany({ where: { id: { in: entradasIds } } });
      for (const f of filaChaves) await prisma.kyriaFilaSemanal.deleteMany({ where: { data: new Date(`${f.data}T00:00:00.000Z`), teamId: f.teamId } });
      if (descontoCriado) await prisma.descontoFechamento.deleteMany({ where: { competencia: new Date("2026-10-01T00:00:00.000Z"), codfor: 505, valorNota: 1, origem: "manual" } });
      if (processoId2 != null) {
        const fechs2 = await prisma.bonificacaoFechamento.findMany({ where: { processoId: processoId2 }, select: { id: true } });
        await prisma.bonificacaoResultado.deleteMany({ where: { fechamentoId: { in: fechs2.map((f) => f.id) } } });
        await prisma.bonificacaoProcesso.delete({ where: { id: processoId2 } });
      }
      if (processoId != null) {
        const fechs = await prisma.bonificacaoFechamento.findMany({ where: { processoId }, select: { id: true } });
        await prisma.bonificacaoResultado.deleteMany({ where: { fechamentoId: { in: fechs.map((f) => f.id) } } });
        await prisma.bonificacaoProcesso.delete({ where: { id: processoId } });
      }
      await prisma.auditEvento.deleteMany({ where: { usuarioId: { in: [admin.id, semAcesso.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, semAcesso.id] } } });
    } catch (e) {
      console.error("Falha na limpeza:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
    server.close();
    await prisma.$disconnect();
  }
  if (!process.exitCode) console.log("OK: bonificação — todas as verificações passaram");
}

main();
