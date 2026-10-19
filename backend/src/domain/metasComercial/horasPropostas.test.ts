import assert from "node:assert/strict";
import { test } from "node:test";
import { distribuirHoras } from "./horasPropostas";

const meses = (pares: Record<number, number>) => Array.from({ length: 12 }, (_, i) => pares[i + 1] ?? 0);

test("horas: a pessoa recebe as do seu representante e o resto vai para Não atribuído (planilha 2026, jun e set)", () => {
  const porRep = new Map<number, number[]>([
    [32, meses({ 6: 684.5, 9: 782.5 })], // TAIZA
    [20, meses({ 6: 838, 9: 516 })], // Jennifer: não é participante
  ]);
  const { porParticipante, total } = distribuirHoras(porRep, [
    { id: 1, codrep: 32, naoAtribuido: false, ativo: true },
    { id: 2, codrep: null, naoAtribuido: false, ativo: true }, // Cati: sem representante
    { id: 99, codrep: null, naoAtribuido: true, ativo: true },
  ]);
  assert.equal(porParticipante.get(1)![5], 684.5);
  assert.equal(porParticipante.get(99)![5], 838);
  assert.equal(porParticipante.get(99)![8], 516);
  assert.equal(porParticipante.has(2), false);
  assert.equal(total[5], 1522.5);
  assert.equal(total[8], 1298.5);
  assert.equal(total[0], null); // mês sem proposta fica vazio, não zero
});

test("horas: pessoa inativa não recebe; as horas dela caem em Não atribuído", () => {
  const porRep = new Map<number, number[]>([[32, meses({ 1: 10 })]]);
  const { porParticipante } = distribuirHoras(porRep, [
    { id: 1, codrep: 32, naoAtribuido: false, ativo: false },
    { id: 99, codrep: null, naoAtribuido: true, ativo: true },
  ]);
  assert.equal(porParticipante.has(1), false);
  assert.equal(porParticipante.get(99)![0], 10);
});
