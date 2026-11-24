import assert from "node:assert/strict";
import { test } from "node:test";
import { diasDoPeriodo, diasUteisLiquidos, metaBaseDoDia, metaDoDia, type JornadaDia } from "./calendarioTrabalho";

// 08:00–12:00 e 13:30–18:00 = 8h30 (510 min), a jornada da planilha de férias.
const JORNADA: JornadaDia = { manhaInicio: 480, manhaFim: 720, tardeInicio: 810, tardeFim: 1080 };
const LIVRE = { ferias: false, ausencias: [] };

test("metaBaseDoDia: soma manhã e tarde; período incompleto, invertido ou dia sem jornada não conta", () => {
  assert.equal(metaBaseDoDia(JORNADA), 510);
  assert.equal(metaBaseDoDia({ ...JORNADA, tardeInicio: null, tardeFim: null }), 240, "só manhã");
  assert.equal(metaBaseDoDia({ manhaInicio: 480, manhaFim: null, tardeInicio: 810, tardeFim: 1080 }), 270, "manhã sem fim não entra");
  assert.equal(metaBaseDoDia({ manhaInicio: 720, manhaFim: 480, tardeInicio: null, tardeFim: null }), 0, "fim antes do início");
  assert.equal(metaBaseDoDia(undefined), 0);
});

test("metaDoDia: sem abono a meta é a da jornada", () => {
  assert.deepEqual(metaDoDia(JORNADA, LIVRE), { baseMinutos: 510, metaMinutos: 510, abonadoFeriasMinutos: 0, abonadoFolgaMinutos: 0, diaInteiroAbonado: false });
});

test("metaDoDia: férias zeram a meta e contam como abono de férias (mesmo com folga no mesmo dia)", () => {
  const r = metaDoDia(JORNADA, { ferias: true, ausencias: [{ diaInteiro: true, inicioMin: null, fimMin: null }] });
  assert.deepEqual(r, { baseMinutos: 510, metaMinutos: 0, abonadoFeriasMinutos: 510, abonadoFolgaMinutos: 0, diaInteiroAbonado: true });
});

test("metaDoDia: folga de dia inteiro zera a meta; num dia sem jornada nada é abonado", () => {
  const dia = { ferias: false, ausencias: [{ diaInteiro: true, inicioMin: null, fimMin: null }] };
  assert.deepEqual(metaDoDia(JORNADA, dia), { baseMinutos: 510, metaMinutos: 0, abonadoFeriasMinutos: 0, abonadoFolgaMinutos: 510, diaInteiroAbonado: true });
  assert.equal(metaDoDia(undefined, dia).abonadoFolgaMinutos, 0, "sábado sem jornada: não há o que abonar");
});

test("metaDoDia: folga parcial tira só o trecho dentro da jornada", () => {
  // 14:00–16:00 cai todo na tarde: 120 min.
  assert.equal(metaDoDia(JORNADA, { ferias: false, ausencias: [{ diaInteiro: false, inicioMin: 840, fimMin: 960 }] }).metaMinutos, 390);
  // 11:00–14:00 pega 60 min da manhã (11–12), 0 do almoço e 30 da tarde (13:30–14:00).
  const atravessa = metaDoDia(JORNADA, { ferias: false, ausencias: [{ diaInteiro: false, inicioMin: 660, fimMin: 840 }] });
  assert.equal(atravessa.abonadoFolgaMinutos, 90);
  assert.equal(atravessa.metaMinutos, 420);
  assert.equal(atravessa.diaInteiroAbonado, false);
  // Folga no horário de almoço ou fora do expediente não muda a meta.
  assert.equal(metaDoDia(JORNADA, { ferias: false, ausencias: [{ diaInteiro: false, inicioMin: 725, fimMin: 800 }] }).metaMinutos, 510);
  assert.equal(metaDoDia(JORNADA, { ferias: false, ausencias: [{ diaInteiro: false, inicioMin: 1100, fimMin: 1200 }] }).metaMinutos, 510);
});

test("metaDoDia: folgas parciais que se sobrepõem não contam duas vezes; intervalo inválido é ignorado", () => {
  const r = metaDoDia(JORNADA, {
    ferias: false,
    ausencias: [
      { diaInteiro: false, inicioMin: 840, fimMin: 960 }, // 14:00–16:00
      { diaInteiro: false, inicioMin: 900, fimMin: 1020 }, // 15:00–17:00 (sobrepõe 1h)
      { diaInteiro: false, inicioMin: 600, fimMin: 600 }, // vazio
      { diaInteiro: false, inicioMin: null, fimMin: null }, // sem horário
    ],
  });
  assert.equal(r.abonadoFolgaMinutos, 180, "14:00–17:00");
  assert.equal(r.metaMinutos, 330);
});

test("diasDoPeriodo e diasUteisLiquidos: inclusive nos extremos, sem fim de semana e sem dias inteiros abonados", () => {
  // 02/11/2026 é segunda-feira.
  const de = new Date("2026-11-02T00:00:00Z");
  const ate = new Date("2026-11-08T00:00:00Z");
  assert.equal(diasDoPeriodo(de, ate).length, 7);
  assert.equal(diasUteisLiquidos(de, ate), 5);
  assert.equal(diasUteisLiquidos(de, ate, new Set(["2026-11-03", "2026-11-04"])), 3);
  assert.equal(diasUteisLiquidos(de, ate, new Set(["2026-11-07"])), 5, "abono em sábado não muda");
});

test("lerAusencia: dia inteiro, parcial válida e os erros em português", async () => {
  const { lerAusencia, lerDia } = await import("./calendarioTrabalho");
  assert.equal(lerDia("2026-02-30"), null, "data que não existe");
  assert.equal(lerDia("20/11/2026"), null);
  assert.ok(lerDia("2026-11-20"));

  const inteira = lerAusencia({ data: "2026-11-20", motivo: "  Consulta  " });
  assert.ok(inteira.ok);
  assert.deepEqual({ ...inteira.valor, data: undefined }, { data: undefined, diaInteiro: true, inicioMin: null, fimMin: null, motivo: "Consulta", descontaFerias: false });

  const parcial = lerAusencia({ data: "2026-11-20", diaInteiro: false, inicioMin: 840, fimMin: 960, descontaFerias: false });
  assert.ok(parcial.ok && parcial.valor.inicioMin === 840 && parcial.valor.fimMin === 960);

  assert.equal(lerAusencia({ data: "2026-11-20", diaInteiro: false, inicioMin: 960, fimMin: 840 }).ok, false, "início depois do fim");
  assert.equal(lerAusencia({ data: "2026-11-20", diaInteiro: false, inicioMin: 840 }).ok, false, "sem fim");
  assert.equal(lerAusencia({ data: "2026-11-20", diaInteiro: false, inicioMin: 840, fimMin: 1500 }).ok, false, "passa do dia");
  assert.equal(lerAusencia({ data: "2026-11-20", diaInteiro: false, inicioMin: 840, fimMin: 960, descontaFerias: true }).ok, false, "parcial não desconta saldo");
  assert.equal(lerAusencia({ data: "2026-11-20", descontaFerias: true }).ok, true, "dia inteiro pode descontar");
  assert.equal(lerAusencia({ data: "ontem" }).ok, false);
  assert.equal(lerAusencia({ data: "2026-11-20", motivo: "x".repeat(201) }).ok, false);
  assert.equal(lerAusencia(null).ok, false);
});
