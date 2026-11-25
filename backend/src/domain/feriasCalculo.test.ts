import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diasCorridosEntre,
  diasUteisDoMes,
  diasUteisDoPeriodo,
  diasUteisPadraoDoMes,
  feriadosNacionais,
  feriadosUteisDoMes,
  mediaPctTrabalhado,
  proximoDiaUtil,
  mesesDaMedia,
  saldoDoAquisitivo,
  saldoPorVencimento,
  valorDasFerias,
} from "./feriasCalculo";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

test("feriadosNacionais: fixos, Sexta-feira Santa e a Consciência Negra só a partir de 2024", () => {
  const f2023 = feriadosNacionais(2023);
  assert.ok(f2023.has("2023-04-07"), "Sexta-feira Santa 2023");
  assert.ok(f2023.has("2023-04-21") && f2023.has("2023-12-25"));
  assert.ok(!f2023.has("2023-11-20"), "ainda não era nacional");
  assert.ok(feriadosNacionais(2025).has("2025-11-20"));
  assert.ok(feriadosNacionais(2026).has("2026-04-03"), "Sexta-feira Santa 2026");
  assert.ok(!feriadosNacionais(2025).has("2025-06-19"), "Corpus Christi não é descontado (como na planilha)");
});

test("diasUteisDoMes: bate com a coluna de dias úteis da planilha", () => {
  assert.equal(diasUteisDoMes(2025, 11), 19);
  assert.equal(diasUteisDoMes(2025, 12), 22);
  assert.equal(diasUteisDoMes(2026, 1), 21);
  assert.equal(diasUteisDoMes(2026, 2), 20);
  assert.equal(diasUteisDoMes(2025, 6), 21);
  assert.equal(diasUteisDoMes(2023, 4), 18);
  assert.equal(diasUteisDoMes(2022, 11), 20);
});

test("diasUteisDoPeriodo e diasCorridosEntre: os gozos das abas do Willian", () => {
  // 13/07/2026 à 22/07/2026: "10 dias corridos, totalizando 8 dias trabalhados".
  assert.equal(diasCorridosEntre(d("2026-07-13"), d("2026-07-22")), 10);
  assert.equal(diasUteisDoPeriodo(d("2026-07-13"), d("2026-07-22")), 8);
  // 04/05 à 21/05/2026: "18 dias corridos, 14 dias trabalhados" (01/05 fica fora do período).
  assert.equal(diasCorridosEntre(d("2026-05-04"), d("2026-05-21")), 18);
  assert.equal(diasUteisDoPeriodo(d("2026-05-04"), d("2026-05-21")), 14);
  // 20/10 à 20/11: 30 dias corridos = 22 dias úteis (2025: 20/11 é feriado e o dia 12/10 cai fora).
  assert.equal(diasCorridosEntre(d("2025-10-20"), d("2025-11-18")), 30);
  assert.equal(diasUteisDoPeriodo(d("2025-10-20"), d("2025-11-18")), 22);
});

test("saldoDoAquisitivo: gozos cancelados não contam; folga descontada tira 1 dia cada (aba PJs ERP: Micael 20 - 8 - 5 = 7)", () => {
  const r = saldoDoAquisitivo(20, [{ diasCorridos: 8, situacao: "programada" }, { diasCorridos: 5, situacao: "programada" }, { diasCorridos: 9, situacao: "cancelada" }], 0);
  assert.deepEqual(r, { diasDireito: 20, diasGozados: 13, diasFolgaDescontada: 0, saldo: 7 });
  assert.equal(saldoDoAquisitivo(20, [{ diasCorridos: 8, situacao: "programada" }], 2).saldo, 10);
  assert.equal(saldoDoAquisitivo(10, [], 0).saldo, 10, "aba PJs HCM: Tirza 10 dias, nenhum gozo");
});

test("mesesDaMedia: sempre os 12 meses fechados antes do mês do gozo (mesmo para consultor recém-admitido)", () => {
  // Gozo em 13/07/2026 (caso do Gabriel): de 07/2025 a 06/2026.
  const gabriel = mesesDaMedia(d("2026-07-13"));
  assert.equal(gabriel.length, 12);
  assert.deepEqual(gabriel[0], { ano: 2025, mes: 7 });
  assert.deepEqual(gabriel[11], { ano: 2026, mes: 6 });
  // Gozo em 25/03/2026 (aba do Willian): 03/2025 a 02/2026.
  const willian = mesesDaMedia(d("2026-03-25"));
  assert.deepEqual(willian[0], { ano: 2025, mes: 3 });
  assert.deepEqual(willian[11], { ano: 2026, mes: 2 });
  // Virada de ano: gozo em 10/01/2026 -> 01/2025 a 12/2025.
  assert.deepEqual(mesesDaMedia(d("2026-01-10"))[0], { ano: 2025, mes: 1 });
  assert.deepEqual(mesesDaMedia(d("2026-01-10"))[11], { ano: 2025, mes: 12 });
});

test("diasUteisPadraoDoMes: 0 antes do primeiro mês com horas; depois, os dias úteis do mês", () => {
  const primeiro = { ano: 2026, mes: 2 };
  assert.equal(diasUteisPadraoDoMes(2026, 1, primeiro), 0, "janeiro: consultor ainda não trabalhava");
  assert.equal(diasUteisPadraoDoMes(2026, 2, primeiro), 20, "fevereiro: 20 dias úteis (Carnaval não desconta)");
  assert.equal(diasUteisPadraoDoMes(2026, 6, primeiro), diasUteisDoMes(2026, 6));
  assert.equal(diasUteisPadraoDoMes(2026, 2, null), 0, "sem nenhuma hora: 0");
});

test("feriadosUteisDoMes: só os feriados de seg a sex, com nome", () => {
  // Abril/2026: Sexta-feira Santa (03/04) e Tiradentes (terça 21/04).
  assert.deepEqual(feriadosUteisDoMes(2026, 4), [
    { data: "2026-04-03", nome: "Sexta-feira Santa" },
    { data: "2026-04-21", nome: "Tiradentes" },
  ]);
  // Dezembro/2025: Natal cai numa quinta.
  assert.deepEqual(feriadosUteisDoMes(2025, 12), [{ data: "2025-12-25", nome: "Natal" }]);
});

test("mediaPctTrabalhado: média simples do % de cada mês; sem histórico vale 100%", () => {
  // Mês cheio (21 dias úteis x 8,5 = 178,5 h) com 178,5 h trabalhadas = 100%; 89,25 h = 50%.
  const r = mediaPctTrabalhado([
    { minutos: 178.5 * 60, diasUteis: 21 },
    { minutos: 89.25 * 60, diasUteis: 21 },
  ]);
  assert.ok(Math.abs(r - 0.75) < 1e-9);
  // Meses com 0 dias (antes da admissão) não puxam a média para baixo.
  const comZeros = mediaPctTrabalhado([
    { minutos: 0, diasUteis: 0 },
    { minutos: 0, diasUteis: 0 },
    { minutos: 178.5 * 60, diasUteis: 21 },
  ]);
  assert.ok(Math.abs(comZeros - 1) < 1e-9);
  // Ajustar os dias de um mês muda o %: 85 h em 10 dias x 8,5 h = 100%.
  assert.ok(Math.abs(mediaPctTrabalhado([{ minutos: 85 * 60, diasUteis: 10 }]) - 1) < 1e-9);
  assert.equal(mediaPctTrabalhado([]), 1);
  assert.equal(mediaPctTrabalhado([{ minutos: 0, diasUteis: 0 }]), 1, "nenhum mês com dias: 100%");
  // Aba do Willian: Mai/2025 = 178,19 h sobre 21 x 8,5 = 0,99826...
  const mai = mediaPctTrabalhado([{ minutos: 178.19 * 60, diasUteis: 21 }]);
  assert.ok(Math.abs(mai - 0.9982633) < 1e-6);
});

test("valorDasFerias: reproduz as contas da planilha (Willian)", () => {
  // 2 dias úteis x 8,5 h x média 1,0137344 x R$ 38/h = 17,23 h = R$ 654,87.
  assert.deepEqual(valorDasFerias({ diasUteis: 2, horasDia: 8.5, mediaPct: 1.0137344205083738, valorHora: 38 }), { horasFerias: 17.23, valorFerias: 654.87 });
  // 14 dias úteis, média 1,0149652: 120,78 h = R$ 4.589,67.
  assert.deepEqual(valorDasFerias({ diasUteis: 14, horasDia: 8.5, mediaPct: 1.0149651756687696, valorHora: 38 }), { horasFerias: 120.78, valorFerias: 4589.67 });
  assert.deepEqual(valorDasFerias({ diasUteis: 0, horasDia: 8.5, mediaPct: 1, valorHora: 38 }), { horasFerias: 0, valorFerias: 0 });
});

test("proximoDiaUtil: pula fim de semana e feriado nacional", () => {
  // Férias terminam na sexta 20/11/2026 (Consciência Negra, feriado): o retorno é a segunda 23/11.
  assert.equal(proximoDiaUtil(d("2026-11-19")).toISOString().slice(0, 10), "2026-11-23");
  assert.equal(proximoDiaUtil(d("2026-11-25")).toISOString().slice(0, 10), "2026-11-26", "quarta -> quinta");
  assert.equal(proximoDiaUtil(d("2026-11-27")).toISOString().slice(0, 10), "2026-11-30", "sexta -> segunda");
  assert.equal(proximoDiaUtil(d("2026-04-02")).toISOString().slice(0, 10), "2026-04-06", "quinta antes da Sexta-feira Santa -> segunda");
});

test("saldoPorVencimento: vencido, fração em formação e total (caso da Jéssica: 20 + ~6,4 = total 40)", () => {
  const periodos = [
    { inicio: "2025-08-01", fim: "2026-08-01", diasDireito: 20, diasGozados: 0, diasFolgaDescontada: 0, saldo: 20 },
    { inicio: "2026-08-01", fim: "2027-08-01", diasDireito: 20, diasGozados: 0, diasFolgaDescontada: 0, saldo: 20 },
  ];
  const r = saldoPorVencimento(periodos, "2026-11-25");
  assert.equal(r.vencido, 20);
  assert.equal(r.total, 40);
  assert.equal(r.periodosEmFormacao.length, 1);
  assert.equal(r.periodosEmFormacao[0].diasDecorridos, 116);
  assert.equal(r.periodosEmFormacao[0].diasDoPeriodo, 365);
  assert.ok(Math.abs(r.emFormacao - (20 * 116) / 365) < 1e-9);
  // No último dia do período o direito inteiro vale como vencido (fim <= hoje) e nada fica em formação.
  const fechado = saldoPorVencimento(periodos, "2027-08-01");
  assert.equal(fechado.vencido, 40);
  assert.equal(fechado.emFormacao, 0);
  // Período que ainda não começou só entra no total.
  const futuro = saldoPorVencimento(periodos, "2026-07-31");
  assert.equal(futuro.vencido, 0);
  assert.ok(futuro.emFormacao > 19.9 && futuro.emFormacao < 20);
  assert.equal(saldoPorVencimento(periodos, "2025-07-01").emFormacao, 0);
  assert.equal(saldoPorVencimento(periodos, "2025-07-01").total, 40);
});

test("saldoPorVencimento: férias já lançadas no período em curso consomem a fração; saldo negativo não conta", () => {
  const r = saldoPorVencimento(
    [
      { inicio: "2026-08-01", fim: "2027-08-01", diasDireito: 20, diasGozados: 5, diasFolgaDescontada: 0, saldo: 15 },
      { inicio: "2025-08-01", fim: "2026-08-01", diasDireito: 20, diasGozados: 25, diasFolgaDescontada: 0, saldo: -5 },
    ],
    "2026-11-25",
  );
  assert.equal(r.vencido, 0, "saldo negativo vale 0");
  assert.ok(Math.abs(r.emFormacao - Math.max(0, (20 * 116) / 365 - 5)) < 1e-9);
  assert.equal(r.total, 15);
});
