import assert from "node:assert/strict";
import { test } from "node:test";
import { AVISO_ESCRITA_DESLIGADA, ehAvisoDeEspera, envioDeSituacaoLigado } from "./outboxSeniorProposta";

test("ehAvisoDeEspera: vazio e o aviso de escrita desligada são espera; erro de verdade não é", () => {
  assert.equal(ehAvisoDeEspera(null), true);
  assert.equal(ehAvisoDeEspera(undefined), true);
  assert.equal(ehAvisoDeEspera(""), true);
  assert.equal(ehAvisoDeEspera(AVISO_ESCRITA_DESLIGADA), true);
  assert.equal(ehAvisoDeEspera("Senior recusou a mudança de situação (statusProcesso=0): proposta bloqueada"), false);
});

test("ehAvisoDeEspera: pendências criadas no tempo do interruptor SENIOR_PORTA_SITPRO (textos antigos) continuam sendo espera, não falha", () => {
  const antigo = "Aguardando a publicação da operação alterarSituacaoProposta no Senior (SENIOR_PORTA_SITPRO desligada). A pendência segue na fila.";
  const antigo2 =
    "Aguardando: o envio da situação ao Senior (operação ManterSituacaoProposta) está desligado neste ambiente (SENIOR_PORTA_SITPRO). A pendência segue na fila.";
  assert.equal(ehAvisoDeEspera(antigo), true);
  assert.equal(ehAvisoDeEspera(antigo2), true);
});

test("envioDeSituacaoLigado: só depende da trava geral SENIOR_SOMENTE_LEITURA (SENIOR_PORTA_SITPRO não vale mais)", () => {
  const somente = process.env.SENIOR_SOMENTE_LEITURA;
  const porta = process.env.SENIOR_PORTA_SITPRO;
  try {
    delete process.env.SENIOR_SOMENTE_LEITURA;
    delete process.env.SENIOR_PORTA_SITPRO;
    assert.equal(envioDeSituacaoLigado(), true, "sem nenhuma variável, envia");
    process.env.SENIOR_PORTA_SITPRO = "0";
    assert.equal(envioDeSituacaoLigado(), true, "SENIOR_PORTA_SITPRO é ignorada");
    process.env.SENIOR_SOMENTE_LEITURA = "true";
    assert.equal(envioDeSituacaoLigado(), false, "somente leitura segura o envio");
  } finally {
    if (somente === undefined) delete process.env.SENIOR_SOMENTE_LEITURA;
    else process.env.SENIOR_SOMENTE_LEITURA = somente;
    if (porta === undefined) delete process.env.SENIOR_PORTA_SITPRO;
    else process.env.SENIOR_PORTA_SITPRO = porta;
  }
});
