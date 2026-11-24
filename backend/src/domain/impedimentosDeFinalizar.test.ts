import assert from "node:assert/strict";
import { test } from "node:test";
import { haImpedimentos, mensagemDosImpedimentos, resumoDeNomes, type ImpedimentosDeFinalizar, type SessaoQueImpede } from "./impedimentosDeFinalizar";

const sessao = (id: number, consultor: string, fim: Date | null = null): SessaoQueImpede => ({
  id,
  atividadeId: id * 10,
  codfor: id,
  consultor,
  inicio: new Date("2026-11-10T10:00:00Z"),
  fim,
});
const vazio: ImpedimentosDeFinalizar = { rats: [], sessoesEmCurso: [], sessoesPendentes: [] };

test("sem impedimento: nenhuma mensagem", () => {
  assert.equal(haImpedimentos(vazio), false);
  assert.equal(mensagemDosImpedimentos(vazio), null);
});

test("só RAT Digitada/Fechada: mensagem com os números e o que fazer", () => {
  const m = mensagemDosImpedimentos({ ...vazio, rats: [{ id: 1, numrat: 993855, sitrat: 1 }] });
  assert.match(m!, /Não é possível finalizar a proposta/);
  assert.match(m!, /1 RAT\(s\) em situação Digitada ou Fechada \(RAT 993855\)/);
  assert.match(m!, /feche\/resolva as RATs/);
  assert.doesNotMatch(m!, /sessão/);
});

test("rascunho do CaxHub (sem numrat) aparece como 'local <id>'", () => {
  const m = mensagemDosImpedimentos({ ...vazio, rats: [{ id: 77, numrat: null, sitrat: 9 }] });
  assert.match(m!, /RAT local 77/);
});

test("só sessão em curso: diz quem está com o cronômetro aberto", () => {
  const m = mensagemDosImpedimentos({ ...vazio, sessoesEmCurso: [sessao(1, "Ana Lima"), sessao(2, "Bruno Reis")] });
  assert.match(m!, /2 sessão\(ões\) em curso, com o cronômetro aberto \(Ana Lima, Bruno Reis\)/);
  assert.match(m!, /encerre as sessões em curso/);
  assert.doesNotMatch(m!, /RAT\(s\)/);
});

test("só sessão pendente de RAT: diz que falta confirmar em Meus Apontamentos", () => {
  const fim = new Date("2026-11-10T12:00:00Z");
  const m = mensagemDosImpedimentos({ ...vazio, sessoesPendentes: [sessao(3, "Carla Dias", fim)] });
  assert.match(m!, /1 sessão\(ões\) encerrada\(s\) e ainda pendente\(s\) de confirmação em RAT \(Carla Dias\)/);
  assert.match(m!, /confirme as sessões pendentes em Meus Apontamentos/);
});

test("várias causas juntas: uma linha por causa e uma instrução só", () => {
  const m = mensagemDosImpedimentos({
    rats: [{ id: 1, numrat: 100, sitrat: 9 }],
    sessoesEmCurso: [sessao(1, "Ana")],
    sessoesPendentes: [sessao(2, "Bruno", new Date())],
  })!;
  assert.equal(m.split("\n").filter((l) => l.startsWith("•")).length, 3);
  assert.match(m, /Para finalizar, feche\/resolva as RATs; encerre as sessões em curso; confirme as sessões pendentes em Meus Apontamentos e tente de novo\./);
});

test("resumoDeNomes: tira repetidos e limita, dizendo quantos ficaram de fora", () => {
  assert.equal(resumoDeNomes(["Ana", "Ana", "Bruno"]), "Ana, Bruno");
  assert.equal(resumoDeNomes(["A", "B", "C", "D", "E", "F", "G"]), "A, B, C, D, E e mais 2");
  assert.equal(resumoDeNomes([]), "");
});

test("mais de 10 RATs: a mensagem avisa e corta a lista", () => {
  const rats = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, numrat: 1000 + i, sitrat: 9 }));
  const m = mensagemDosImpedimentos({ ...vazio, rats })!;
  assert.match(m, /Mais de 10 RAT\(s\)/);
  assert.match(m, /1009, \.\.\.\)/);
  assert.doesNotMatch(m, /1010/);
});
