import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diasCorridosEntre,
  diasUteisDoMes,
  diasUteisDoPeriodo,
  feriadosNacionais,
  mediaPctTrabalhado,
  proximoDiaUtil,
  mesesDaMedia,
  saldoDoAquisitivo,
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

test("mesesDaMedia: até 12 meses antes do mês do gozo, nunca antes do primeiro mês com horas", () => {
  // Gozo em 25/03/2026, consultor começou em 05/2025: de 05/2025 a 02/2026 (10 meses), como na aba do Willian.
  const meses = mesesDaMedia(d("2026-03-25"), { ano: 2025, mes: 5 });
  assert.equal(meses.length, 10);
  assert.deepEqual(meses[0], { ano: 2025, mes: 5 });
  assert.deepEqual(meses[9], { ano: 2026, mes: 2 });
  // Histórico longo: só os 12 últimos.
  const longo = mesesDaMedia(d("2026-03-25"), { ano: 2022, mes: 1 });
  assert.equal(longo.length, 12);
  assert.deepEqual(longo[0], { ano: 2025, mes: 3 });
  assert.deepEqual(longo[11], { ano: 2026, mes: 2 });
  assert.deepEqual(mesesDaMedia(d("2026-03-25"), null), []);
  assert.deepEqual(mesesDaMedia(d("2025-05-10"), { ano: 2025, mes: 5 }), [], "gozo no primeiro mês: sem histórico");
});

test("mediaPctTrabalhado: média simples do % de cada mês; sem histórico vale 100%", () => {
  // Mês cheio (21 dias úteis x 8,5 = 178,5 h) com 178,5 h trabalhadas = 100%; 89,25 h = 50%.
  const r = mediaPctTrabalhado([
    { ano: 2026, mes: 1, minutos: 178.5 * 60 },
    { ano: 2026, mes: 1, minutos: 89.25 * 60 },
  ]);
  assert.ok(Math.abs(r - 0.75) < 1e-9);
  assert.equal(mediaPctTrabalhado([]), 1);
  // Aba do Willian: Mai/2025 = 178,19 h sobre 21 x 8,5 = 0,99826...
  const mai = mediaPctTrabalhado([{ ano: 2025, mes: 5, minutos: 178.19 * 60 }]);
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
