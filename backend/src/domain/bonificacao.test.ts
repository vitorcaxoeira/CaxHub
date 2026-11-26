import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arredondar,
  ativoNoMes,
  calcularIndicador,
  formatarHorasMinutos,
  media,
  percentualDe,
  pontosDaFaixa,
  regraVigente,
  sextasDoMes,
  totalDoConsultor,
  validarFaixas,
  validarVigenciaDeRegra,
  vigenciaSobreposta,
  vigenteEm,
  type FaixaRegra,
} from "./bonificacao";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Réguas do processo "Bonificação Líderes Suporte" (planilha "Bonificação Líderes Suporte.xlsx").
const CAPACIDADE: FaixaRegra[] = [{ limite: 10, pontos: 1 }, { limite: 13, pontos: 0.6 }, { limite: 15, pontos: 0.3 }, { limite: null, pontos: 0 }];
const RNC_1S: FaixaRegra[] = [{ limite: 5, pontos: 1 }, { limite: 7, pontos: 0.5 }, { limite: null, pontos: 0 }];
const RNC_2S: FaixaRegra[] = [{ limite: 3, pontos: 1 }, { limite: 4, pontos: 0.5 }, { limite: null, pontos: 0 }];
const PLANEJAMENTO: FaixaRegra[] = [{ limite: 95, pontos: 1 }, { limite: 85, pontos: 0.5 }, { limite: null, pontos: 0 }];
const EFICIENCIA: FaixaRegra[] = [{ limite: 80, pontos: 1 }, { limite: 50, pontos: 0.5 }, { limite: null, pontos: 0 }];
const PDI: FaixaRegra[] = [{ limite: 8, pontos: 1 }, { limite: null, pontos: 0 }];

test("capacidade: reproduz os IF da planilha (<=10, <=13, <=15, demais)", () => {
  assert.equal(pontosDaFaixa(10, CAPACIDADE, "menor_melhor"), 1);
  assert.equal(pontosDaFaixa(10.25, CAPACIDADE, "menor_melhor"), 0.6);
  assert.equal(pontosDaFaixa(12, CAPACIDADE, "menor_melhor"), 0.6);
  assert.equal(pontosDaFaixa(13, CAPACIDADE, "menor_melhor"), 0.6);
  assert.equal(pontosDaFaixa(15, CAPACIDADE, "menor_melhor"), 0.3);
  assert.equal(pontosDaFaixa(16, CAPACIDADE, "menor_melhor"), 0);
});

test("RNC muda de régua no 2º semestre", () => {
  assert.equal(pontosDaFaixa(5, RNC_1S, "menor_melhor"), 1);
  assert.equal(pontosDaFaixa(5, RNC_2S, "menor_melhor"), 0); // 5 RNC no 2º semestre: demais casos
  assert.equal(pontosDaFaixa(4, RNC_2S, "menor_melhor"), 0.5);
  assert.equal(pontosDaFaixa(3, RNC_2S, "menor_melhor"), 1);
  assert.equal(pontosDaFaixa(7, RNC_1S, "menor_melhor"), 0.5);
  assert.equal(pontosDaFaixa(8, RNC_1S, "menor_melhor"), 0);
});

test("percentuais: limites inclusivos (>=95, >=85, >=80, >=50)", () => {
  assert.equal(pontosDaFaixa(95, PLANEJAMENTO, "maior_melhor"), 1);
  assert.equal(pontosDaFaixa(94.99, PLANEJAMENTO, "maior_melhor"), 0.5);
  assert.equal(pontosDaFaixa(85, PLANEJAMENTO, "maior_melhor"), 0.5);
  assert.equal(pontosDaFaixa(84.9, PLANEJAMENTO, "maior_melhor"), 0);
  assert.equal(pontosDaFaixa(80, EFICIENCIA, "maior_melhor"), 1);
  assert.equal(pontosDaFaixa(50, EFICIENCIA, "maior_melhor"), 0.5);
  assert.equal(pontosDaFaixa(49.99, EFICIENCIA, "maior_melhor"), 0);
});

test("exemplo real do documento: 12 chamados, 6-7 RNC, >=95%, 50-80% fechados, 8h de PDI = 3,6 pontos e R$ 1.440", () => {
  const itens = [
    calcularIndicador(12, { valorBase: 400, faixas: CAPACIDADE }, "menor_melhor"),
    calcularIndicador(6, { valorBase: 400, faixas: RNC_1S }, "menor_melhor"),
    calcularIndicador(96, { valorBase: 400, faixas: PLANEJAMENTO }, "maior_melhor"),
    calcularIndicador(65, { valorBase: 400, faixas: EFICIENCIA }, "maior_melhor"),
    calcularIndicador(8, { valorBase: 400, faixas: PDI }, "maior_melhor"),
  ];
  assert.deepEqual(itens.map((i) => i.centavos), [24000, 20000, 40000, 20000, 40000]);
  const total = totalDoConsultor(itens.map((i) => ({ pontos: i.pontos, valor: i.centavos / 100 })));
  assert.equal(total.pontos, 3.6); // 0,6 + 0,5 + 1 + 0,5 + 1
  assert.equal(total.centavos, 144000);
  assert.equal(total.pendentes, 0);
});

test("planilha, aba Lara, fevereiro: 800 reais", () => {
  const sextas = [31, 28, 34, 30];
  const capacidade = media(sextas)!;
  assert.equal(capacidade, 30.75);
  const eficiencia = percentualDe(347, 486)!;
  assert.equal(arredondar(eficiencia, 2), 71.4);
  const itens = [
    calcularIndicador(capacidade, { valorBase: 400, faixas: CAPACIDADE }, "menor_melhor"), // 0
    calcularIndicador(0, { valorBase: 400, faixas: RNC_1S }, "menor_melhor"), // 400
    calcularIndicador(85, { valorBase: 400, faixas: PLANEJAMENTO }, "maior_melhor"), // 200
    calcularIndicador(eficiencia, { valorBase: 400, faixas: EFICIENCIA }, "maior_melhor"), // 200
    calcularIndicador(3.55, { valorBase: 400, faixas: PDI }, "maior_melhor"), // 0
  ];
  assert.equal(itens.reduce((a, i) => a + i.centavos, 0), 80000);
});

test("atendentes: 80% do ponto, PDI e chamados antigos da equipe", () => {
  const pct = percentualDe(96 * 60, 120 * 60)!;
  assert.equal(pct, 80);
  assert.equal(calcularIndicador(79.9999, { valorBase: 200, faixas: [{ limite: 80, pontos: 1 }, { limite: null, pontos: 0 }] }, "maior_melhor").centavos, 0);
  assert.equal(calcularIndicador(pct, { valorBase: 200, faixas: [{ limite: 80, pontos: 1 }, { limite: null, pontos: 0 }] }, "maior_melhor").centavos, 20000);
  const antigos: FaixaRegra[] = [{ limite: 0, pontos: 1 }, { limite: null, pontos: 0 }];
  assert.equal(calcularIndicador(0, { valorBase: 100, faixas: antigos }, "menor_melhor").centavos, 10000);
  assert.equal(calcularIndicador(1, { valorBase: 100, faixas: antigos }, "menor_melhor").centavos, 0);
  assert.equal(calcularIndicador(7.9, { valorBase: 100, faixas: PDI }, "maior_melhor").centavos, 0);
  assert.equal(calcularIndicador(8, { valorBase: 100, faixas: PDI }, "maior_melhor").centavos, 10000);
});

test("validarFaixas: ordem dos limites, última sem limite, pontos", () => {
  assert.equal(validarFaixas(CAPACIDADE, "menor_melhor"), null);
  assert.equal(validarFaixas(PLANEJAMENTO, "maior_melhor"), null);
  assert.match(validarFaixas([], "menor_melhor")!, /ao menos uma faixa/);
  assert.match(validarFaixas([{ limite: 10, pontos: 1 }], "menor_melhor")!, /demais casos/);
  assert.match(validarFaixas([{ limite: 13, pontos: 1 }, { limite: 10, pontos: 0.5 }, { limite: null, pontos: 0 }], "menor_melhor")!, /crescentes/);
  assert.match(validarFaixas([{ limite: 80, pontos: 1 }, { limite: 90, pontos: 0.5 }, { limite: null, pontos: 0 }], "maior_melhor")!, /decrescentes/);
  assert.match(validarFaixas([{ limite: null, pontos: 1 }, { limite: null, pontos: 0 }], "menor_melhor")!, /precisa de um limite/);
  assert.match(validarFaixas([{ limite: 5, pontos: -1 }, { limite: null, pontos: 0 }], "menor_melhor")!, /pontos/);
});

test("vigência: regra de RNC vira na virada de junho para julho", () => {
  const regras = [
    { id: 1, vigenciaInicio: d("2026-01-01"), vigenciaFim: d("2026-06-30") },
    { id: 2, vigenciaInicio: d("2026-07-01"), vigenciaFim: null },
  ];
  assert.equal(regraVigente(regras, d("2026-06-01"))?.id, 1);
  assert.equal(regraVigente(regras, d("2026-07-01"))?.id, 2);
  assert.equal(regraVigente(regras, d("2026-12-01"))?.id, 2);
  assert.equal(regraVigente(regras, d("2025-12-01")), null);
});

test("vigência de regra: começa no dia 1 e termina no último dia do mês", () => {
  assert.equal(validarVigenciaDeRegra(d("2026-07-01"), null), null);
  assert.equal(validarVigenciaDeRegra(d("2026-01-01"), d("2026-06-30")), null);
  assert.match(validarVigenciaDeRegra(d("2026-07-15"), null)!, /dia 1/);
  assert.match(validarVigenciaDeRegra(d("2026-01-01"), d("2026-06-15"))!, /último dia/);
  assert.match(validarVigenciaDeRegra(d("2026-07-01"), d("2026-02-28"))!, /anterior/);
});

test("vigenciaSobreposta: detecta cruzamento e ignora a própria", () => {
  const existentes = [
    { id: 1, inicio: d("2026-01-01"), fim: d("2026-06-30") },
    { id: 2, inicio: d("2026-07-01"), fim: null },
  ];
  assert.equal(vigenciaSobreposta(existentes, { inicio: d("2026-06-01"), fim: d("2026-06-30") })?.id, 1);
  assert.equal(vigenciaSobreposta(existentes, { inicio: d("2027-01-01"), fim: null })?.id, 2);
  assert.equal(vigenciaSobreposta(existentes, { id: 2, inicio: d("2026-07-01"), fim: d("2026-12-31") }), null);
  assert.equal(vigenciaSobreposta([existentes[0]], { inicio: d("2026-07-01"), fim: null }), null);
});

test("enquadramento: ativo no mês se a vigência toca qualquer dia dele", () => {
  assert.equal(ativoNoMes({ inicio: d("2026-09-15"), fim: null }, d("2026-09-01")), true);
  assert.equal(ativoNoMes({ inicio: d("2026-09-15"), fim: null }, d("2026-08-01")), false);
  assert.equal(ativoNoMes({ inicio: d("2026-01-01"), fim: d("2026-09-10") }, d("2026-09-01")), true);
  assert.equal(ativoNoMes({ inicio: d("2026-01-01"), fim: d("2026-08-31") }, d("2026-09-01")), false);
  assert.equal(vigenteEm({ inicio: d("2026-09-15"), fim: null }, d("2026-09-01")), false);
});

test("sextas do mês: 4 em fevereiro/2026, 5 em maio/2026", () => {
  assert.deepEqual(sextasDoMes(d("2026-02-01")).map((x) => x.toISOString().slice(0, 10)), ["2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27"]);
  assert.equal(sextasDoMes(d("2026-05-01")).length, 5);
});

test("percentualDe e formatarHorasMinutos", () => {
  assert.equal(arredondar(percentualDe(3052, 8698)!, 2), 35.09);
  assert.equal(percentualDe(10, 0), null);
  assert.equal(formatarHorasMinutos(8698), "144:58");
  assert.equal(media([]), null);
});

test("totalDoConsultor: indicador sem valor conta como pendente", () => {
  const t = totalDoConsultor([{ pontos: 1, valor: 400 }, { pontos: null, valor: null }, { pontos: 0.5, valor: 200 }]);
  assert.deepEqual(t, { pontos: 1.5, centavos: 60000, pendentes: 1 });
});
