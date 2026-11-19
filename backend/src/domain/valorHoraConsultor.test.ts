import { test } from "node:test";
import assert from "node:assert/strict";
import { linhaDoTempoDoContrato, montarLinhaDoTempo, valorHoraEm, vigenciaEm, type ReajusteContrato } from "./valorHoraConsultor";

// Contrato 1232 do dado real (jul/2026): 6 reajustes, o primeiro em 2019-06 (R$ 1,99 → 61,99).
const REAL: ReajusteContrato[] = [
  { ultrea: "2019-06-01", vlrrea: 1.99, vlratu: 61.99, perrea: 3.31 },
  { ultrea: "2022-06-01", vlrrea: 8.93, vlratu: 80.55, perrea: 12.47 },
  { ultrea: "2023-06-01", vlrrea: 3.09, vlratu: 83.64, perrea: 3.83 },
  { ultrea: "2024-06-01", vlrrea: 2.7, vlratu: 86.34, perrea: 3.23 },
  { ultrea: "2025-06-01", vlrrea: 4.59, vlratu: 90.93, perrea: 5.32 },
  { ultrea: "2026-06-01", vlrrea: 4.46, vlratu: 105.39, perrea: 4.42 },
];

test("sem reajuste, o preço atual é o único valor conhecido", () => {
  const r = montarLinhaDoTempo([], 103);
  assert.deepEqual(r.vigencias, [{ desde: null, valor: 103, origem: "preco_atual", percentual: null }]);
  assert.equal(r.divergencia, null);
});

test("sem reajuste e sem preço, não há linha do tempo", () => {
  assert.deepEqual(montarLinhaDoTempo([], null).vigencias, []);
});

test("o valor original é o do 1º reajuste menos o que ele subiu", () => {
  const r = montarLinhaDoTempo(REAL, 105.39186);
  assert.deepEqual(r.vigencias[0], { desde: null, valor: 60, origem: "inicial", percentual: null });
  assert.equal(r.vigencias.length, 7);
  assert.equal(r.vigencias[1].valor, 61.99);
  assert.equal(r.vigencias[6].valor, 105.39);
});

test("preço atual com fração de centavo não é divergência", () => {
  assert.equal(montarLinhaDoTempo(REAL, 105.39186).divergencia, null);
});

test("preço atual que destoa do histórico vira aviso, sem ponto inventado", () => {
  const r = montarLinhaDoTempo(REAL, 110);
  assert.deepEqual(r.divergencia, { precoAtual: 110, ultimoValorDoHistorico: 105.39 });
  assert.equal(r.vigencias.length, 7);
});

test("entrada fora de ordem é ordenada por data", () => {
  const r = montarLinhaDoTempo([REAL[2], REAL[0], REAL[1]], null);
  assert.deepEqual(r.vigencias.map((v) => v.desde), [null, "2019-06-01", "2022-06-01", "2023-06-01"]);
});

test("reajuste sem valor ou com data vazia do Senior é ignorado", () => {
  const r = montarLinhaDoTempo([{ ultrea: "1900-12-31", vlrrea: 1, vlratu: 50 }, { ultrea: "2024-01-01", vlrrea: 1, vlratu: null }, REAL[0]], null);
  assert.deepEqual(r.vigencias.map((v) => v.valor), [60, 61.99]);
});

test("sem o quanto subiu, não dá pra saber o valor original: a linha começa no 1º reajuste", () => {
  const r = montarLinhaDoTempo([{ ultrea: "2020-01-01", vlrrea: null, vlratu: 70 }], null);
  assert.deepEqual(r.vigencias, [{ desde: "2020-01-01", valor: 70, origem: "reajuste", percentual: null }]);
});

test("valorHoraEm: antes do 1º reajuste vale o original; o dia do reajuste já vale o novo", () => {
  const v = montarLinhaDoTempo(REAL, null).vigencias;
  assert.equal(valorHoraEm(v, "2018-01-01"), 60);
  assert.equal(valorHoraEm(v, "2019-05-31"), 60);
  assert.equal(valorHoraEm(v, "2019-06-01"), 61.99);
  assert.equal(valorHoraEm(v, "2021-12-31"), 61.99);
  assert.equal(valorHoraEm(v, "2026-07-15"), 105.39);
  assert.equal(valorHoraEm(v, "2030-01-01"), 105.39);
});

test("valorHoraEm: sem vigência não há valor", () => {
  assert.equal(valorHoraEm([], "2026-07-01"), null);
});

test("valorHoraEm: começando no 1º reajuste, antes dele não há valor", () => {
  const v = montarLinhaDoTempo([{ ultrea: "2020-01-01", vlrrea: null, vlratu: 70 }], null).vigencias;
  assert.equal(valorHoraEm(v, "2019-12-31"), null);
  assert.equal(valorHoraEm(v, "2020-01-01"), 70);
});

// Contrato de VALOR FIXO do dado real (Davi Lemes Franz, contrato 1464): vlrhor 93,897 × 150 h = 14.084,55 por mês. O histórico da E460REA mistura o valor
// por hora (33,18 em 2024) com o total do mês (14.084,55 em 08/2026) — ler a linha do tempo daria hora de R$ 14 mil.
const HISTORICO_FIXO: ReajusteContrato[] = [
  { ultrea: "2024-08-01", vlrrea: 1.18, vlratu: 33.18, perrea: 3.7 },
  { ultrea: "2026-08-01", vlrrea: 584.55, vlratu: 14084.55, perrea: 4.33 },
];

test("contrato fixo: o valor-hora é o vlrhor da view (como na Home), não o histórico de reajuste", () => {
  const r = linhaDoTempoDoContrato({ fixo: true, vlrhorDaView: 93.897, reajustes: HISTORICO_FIXO, precoAtualDoItem: 93.897 });
  assert.deepEqual(r.vigencias, [{ desde: null, valor: 93.897, origem: "preco_atual", percentual: null }]);
  assert.equal(r.divergencia, null);
  assert.equal(valorHoraEm(r.vigencias, "2025-01-01"), 93.897);
  assert.equal(valorHoraEm(r.vigencias, "2026-10-01"), 93.897);
});

test("contrato fixo: mantém a precisão do vlrhor (108,33333), sem arredondar a centavos", () => {
  assert.equal(linhaDoTempoDoContrato({ fixo: true, vlrhorDaView: 108.33333, reajustes: [], precoAtualDoItem: null }).vigencias[0].valor, 108.33333);
});

test("contrato fixo sem vlrhor na view: sem linha do tempo", () => {
  assert.deepEqual(linhaDoTempoDoContrato({ fixo: true, vlrhorDaView: null, reajustes: HISTORICO_FIXO, precoAtualDoItem: 93.897 }).vigencias, []);
});

test("contrato por hora continua lendo o histórico de reajuste", () => {
  const r = linhaDoTempoDoContrato({ fixo: false, vlrhorDaView: 105.39, reajustes: REAL, precoAtualDoItem: 105.39186 });
  assert.equal(r.vigencias.length, 7);
  assert.equal(r.vigencias[0].valor, 60);
});

test("contrato por hora sem preço do item usa o vlrhor da view como preço atual", () => {
  assert.deepEqual(linhaDoTempoDoContrato({ fixo: false, vlrhorDaView: 70, reajustes: [], precoAtualDoItem: null }).vigencias, [{ desde: null, valor: 70, origem: "preco_atual", percentual: null }]);
});

test("vigenciaEm: devolve a vigência inteira que valeu na data (para mostrar de onde veio o valor)", () => {
  const v = montarLinhaDoTempo(REAL, null).vigencias;
  assert.deepEqual(vigenciaEm(v, "2023-08-15"), { desde: "2023-06-01", valor: 83.64, origem: "reajuste", percentual: 3.83 });
  assert.equal(vigenciaEm(v, "2018-01-01")?.origem, "inicial");
  assert.equal(vigenciaEm([], "2026-01-01"), null);
});
