import test from "node:test";
import assert from "node:assert/strict";
import {
  destinoDaPendenciaInterrompida,
  escolherAncoraRat,
  linhaTemOsValores,
  motivoBloqueioAlterarSemSeqAti,
  motivoBloqueioAntesDeAlterarApontamento,
  motivoDivergenciaAposAlterarApontamento,
  motivoSeqAtiDeOutraAlocacao,
  type LinhaIatSenior,
} from "./regrasFilaSenior";

test("RAT local com número: manda esse número, sem olhar o Senior", () => {
  assert.deepEqual(escolherAncoraRat(851299, []), { numRat: 851299, deSenior: false, ambigua: false });
  assert.deepEqual(escolherAncoraRat(851299, [1, 2]), { numRat: 851299, deSenior: false, ambigua: false });
});

test("RAT local sem número e nada no Senior: pede RAT nova", () => {
  assert.deepEqual(escolherAncoraRat(null, []), { gerRat: "S" });
});

test("RAT local sem número, Senior já abriu uma pra ela: anexa nessa em vez de abrir outra", () => {
  assert.deepEqual(escolherAncoraRat(null, [851299]), { numRat: 851299, deSenior: true, ambigua: false });
});

test("mais de uma RAT do mesmo cabeçalho no Senior: fica com a menor e sinaliza ambiguidade", () => {
  assert.deepEqual(escolherAncoraRat(null, [851301, 851299, 851301]), { numRat: 851299, deSenior: true, ambigua: true });
});

test("número inválido vindo do Senior é ignorado", () => {
  assert.deepEqual(escolherAncoraRat(null, [NaN, 0, -3]), { gerRat: "S" });
});

test("após reinício: apontamento, fechamento e remoção voltam pra fila", () => {
  for (const tipo of ["criar_apontamento", "fechar_rat", "remover_atividade"]) {
    assert.equal(destinoDaPendenciaInterrompida(tipo, null), "pendente", tipo);
  }
});

test("após reinício: criar/editar alocação só volta pra fila se a alocação já tem seqAti válido", () => {
  for (const tipo of ["criar_atividade", "editar_atividade"]) {
    assert.equal(destinoDaPendenciaInterrompida(tipo, 14242n), "pendente", tipo);
    assert.equal(destinoDaPendenciaInterrompida(tipo, null), "bloqueado", tipo);
    assert.equal(destinoDaPendenciaInterrompida(tipo, 0n), "bloqueado", tipo);
  }
});

test("Alterar sem seqAti: libera quando o consultor não tem outra alocação confirmada no item", () => {
  assert.equal(motivoBloqueioAlterarSemSeqAti([]), null);
  assert.equal(motivoBloqueioAlterarSemSeqAti([null, 0n]), null);
});

test("Alterar sem seqAti: bloqueia quando já existe irmã confirmada e cita os seqAti dela", () => {
  const motivo = motivoBloqueioAlterarSemSeqAti([14176n, null, 6474n, 6474n]);
  assert.ok(motivo);
  assert.match(motivo, /seqAti 6474, 14176\)/);
});

test("seqAti devolvido de outra alocação: motivo cita a dona, o nó e se ela está inativa", () => {
  assert.match(
    motivoSeqAtiDeOutraAlocacao(6474, { id: 47518, estruturaAtividadeId: 2189, sitreg: "A" }),
    /seqAti 6474, que já pertence à alocação 47518 \(Est\. 2189\): /
  );
  const inativa = motivoSeqAtiDeOutraAlocacao(9, { id: 1, estruturaAtividadeId: null, sitreg: "I" });
  assert.match(inativa, /alocação 1, hoje inativa no CaxHub:/);
});

// ---- Edição de apontamento (tipEve A) --------------------------------------------------------------

const linha = (seqrat: number, extra: Partial<LinhaIatSenior> = {}): LinhaIatSenior => ({
  seqrat,
  datati: "2026-11-05",
  horini: 540,
  horfim: 720,
  desati: `Item ${seqrat}`,
  ...extra,
});
const novo = { datati: "2026-11-05", horini: 600, horfim: 780, desati: "Texto novo" };

test("editar apontamento: após reinício a pendência volta pra fila (repetir o A grava os mesmos valores)", () => {
  assert.equal(destinoDaPendenciaInterrompida("editar_apontamento", null), "pendente");
});

test("editar apontamento: linhaTemOsValores ignora espaços repetidos e a hora do datati", () => {
  assert.equal(linhaTemOsValores(linha(3, { ...novo, datati: "2026-11-05T00:00:00", desati: " Texto   novo " }), novo), true);
  assert.equal(linhaTemOsValores(linha(3, { ...novo, horfim: 781 }), novo), false);
});

test("editar apontamento: antes do envio — linha ausente, ambígua ou RAT não Digitada bloqueiam", () => {
  assert.match(motivoBloqueioAntesDeAlterarApontamento([linha(1)], 9, 2, 500)!, /não existe mais no Senior/);
  assert.match(motivoBloqueioAntesDeAlterarApontamento([linha(2), linha(2)], 9, 2, 500)!, /mais de uma vez/);
  assert.match(motivoBloqueioAntesDeAlterarApontamento([linha(2)], 6, 2, 500)!, /não está mais Digitada \(situação 6\)/);
  assert.match(motivoBloqueioAntesDeAlterarApontamento([linha(2)], null, 2, 500)!, /desconhecida/);
  assert.equal(motivoBloqueioAntesDeAlterarApontamento([linha(1), linha(2)], 9, 2, 500), null);
});

test("editar apontamento: depois do envio — tudo certo quando só a nossa linha mudou", () => {
  const antes = [linha(1), linha(2), linha(3)];
  const depois = [linha(1), linha(2), linha(3, novo)];
  assert.equal(motivoDivergenciaAposAlterarApontamento(antes, depois, 3, 500, novo), null);
});

test("editar apontamento: depois do envio — nossa linha sem os valores enviados", () => {
  const antes = [linha(1), linha(3)];
  assert.match(motivoDivergenciaAposAlterarApontamento(antes, antes, 3, 500, novo)!, /não ficou com os valores enviados/);
});

test("editar apontamento: depois do envio — irmã alterada ou removida é divergência e cita o seqrat", () => {
  const antes = [linha(1), linha(3)];
  const irmaAlterada = [linha(1, { horfim: 999 }), linha(3, novo)];
  assert.match(motivoDivergenciaAposAlterarApontamento(antes, irmaAlterada, 3, 500, novo)!, /alterou também a linha 500\/1/);
  const irmaSumiu = [linha(3, novo)];
  assert.match(motivoDivergenciaAposAlterarApontamento(antes, irmaSumiu, 3, 500, novo)!, /linha 500\/1/);
});
