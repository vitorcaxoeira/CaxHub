import assert from "node:assert/strict";
import { test } from "node:test";
import { AVISO_ESCRITA_DESLIGADA, AVISO_PORTA_NAO_PUBLICADA, ehAvisoDeEspera, portaDeSituacaoPublicada } from "./outboxSeniorProposta";

test("ehAvisoDeEspera: vazio e os avisos da própria fila são espera; erro de verdade não é", () => {
  assert.equal(ehAvisoDeEspera(null), true);
  assert.equal(ehAvisoDeEspera(undefined), true);
  assert.equal(ehAvisoDeEspera(""), true);
  assert.equal(ehAvisoDeEspera(AVISO_PORTA_NAO_PUBLICADA), true);
  assert.equal(ehAvisoDeEspera(AVISO_ESCRITA_DESLIGADA), true);
  assert.equal(ehAvisoDeEspera("Senior recusou a mudança de situação (statusProcesso=0): proposta bloqueada"), false);
});

test("ehAvisoDeEspera: a pendência criada antes da operação ser publicada (texto antigo) continua sendo espera, não falha", () => {
  const antigo = "Aguardando a publicação da operação alterarSituacaoProposta no Senior (SENIOR_PORTA_SITPRO desligada). A pendência segue na fila.";
  assert.equal(ehAvisoDeEspera(antigo), true);
});

test("o aviso de espera cita a operação publicada (ManterSituacaoProposta)", () => {
  assert.match(AVISO_PORTA_NAO_PUBLICADA, /ManterSituacaoProposta/);
});

test("portaDeSituacaoPublicada: só liga com SENIOR_PORTA_SITPRO=1", () => {
  const anterior = process.env.SENIOR_PORTA_SITPRO;
  try {
    delete process.env.SENIOR_PORTA_SITPRO;
    assert.equal(portaDeSituacaoPublicada(), false);
    process.env.SENIOR_PORTA_SITPRO = "true";
    assert.equal(portaDeSituacaoPublicada(), false);
    process.env.SENIOR_PORTA_SITPRO = "1";
    assert.equal(portaDeSituacaoPublicada(), true);
  } finally {
    if (anterior === undefined) delete process.env.SENIOR_PORTA_SITPRO;
    else process.env.SENIOR_PORTA_SITPRO = anterior;
  }
});
