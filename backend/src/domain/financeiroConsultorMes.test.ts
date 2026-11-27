import assert from "node:assert/strict";
import { test } from "node:test";
import { ganhoDoMes, liquidoDaNota, mesAnteriorDe, valoresDoMes, type EntradaValoresDoMes } from "./financeiroConsultorMes";

const BASE: EntradaValoresDoMes = {
  vlrhor: 100,
  fixo: null,
  minutosAteHoje: 600, // 10 h em 5 dias úteis
  diasUteisPassados: 5,
  diasUteisTotais: 20,
  deslocamentoAteHojeMinutos: 60,
  deslocamentoMinutos: 120,
  ferias: 0,
  mesIniciado: true,
  bonificacao: 0,
  descontos: 0,
};

test("ganho: horas até hoje + deslocamento a 50%; projeção extrapola a média por dia útil, sem extrapolar o deslocamento", () => {
  const g = ganhoDoMes(BASE);
  assert.equal(g.projecaoMinutos, 2400); // 120 min/dia x 20 dias
  assert.equal(g.ganho, 100 * 10 + 50 * 1);
  assert.equal(g.projecao, 100 * 40 + 50 * 2);
});

test("mês sem dia útil passado (futuro ou só férias): sem média, a projeção fica só com o deslocamento lançado", () => {
  const g = ganhoDoMes({ ...BASE, diasUteisPassados: 0, minutosAteHoje: 0, deslocamentoAteHojeMinutos: 0 });
  assert.equal(g.projecaoMinutos, 0);
  assert.equal(g.ganho, 0);
  assert.equal(g.projecao, 100);
});

test("contrato por hora: líquido = bruto + férias + bonificação − descontos", () => {
  const v = valoresDoMes({ ...BASE, ferias: 300, bonificacao: 200, descontos: 150 });
  assert.equal(v.realizado, 1050);
  assert.equal(v.projecao, 4100);
  assert.equal(v.deslocamentoValor, 100);
  assert.equal(v.liquidoAteAgora, 1050 + 300 + 200 - 150);
  assert.equal(v.liquidoProjetado, 4100 + 300 + 200 - 150);
});

test("contrato fixo: realizado e projeção são o fixo do mês + deslocamento, sem depender das horas", () => {
  const v = valoresDoMes({ ...BASE, fixo: { qtd: 160, valorMensal: 16000 }, minutosAteHoje: 0 });
  assert.equal(v.realizado, 16100);
  assert.equal(v.projecao, 16100);
  assert.equal(v.liquidoProjetado, 16100);
});

test("mês ainda não iniciado: as férias entram só no projetado", () => {
  const v = valoresDoMes({ ...BASE, mesIniciado: false, ferias: 500 });
  assert.equal(v.feriasAteAgora, 0);
  assert.equal(v.liquidoAteAgora, v.realizado);
  assert.equal(v.liquidoProjetado, v.projecao + 500);
});

test("líquido nunca fica negativo (o desconto que não cabe segue para o mês seguinte) e fecha em centavos", () => {
  assert.equal(liquidoDaNota(100, 0, 250), 0);
  assert.equal(liquidoDaNota(0.1, 0.2, 0), 0.3);
});

test("mês anterior: dentro do ano e na virada de janeiro", () => {
  assert.deepEqual(mesAnteriorDe(2026, 11), { ano: 2026, mes: 10 });
  assert.deepEqual(mesAnteriorDe(2027, 1), { ano: 2026, mes: 12 });
});
