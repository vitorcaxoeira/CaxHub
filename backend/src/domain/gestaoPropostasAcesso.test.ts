import assert from "node:assert/strict";
import { test } from "node:test";
import { acessoGestaoPropostas } from "./gestaoPropostasAcesso";

test("admin: todos os departamentos e todas as ações", () => {
  assert.deepEqual(acessoGestaoPropostas("admin", []), { departamentos: null, podeMudarSituacao: true });
});

test("papel comercial: todos os departamentos, só Sinc. ERP", () => {
  assert.deepEqual(acessoGestaoPropostas("comercial", []), { departamentos: null, podeMudarSituacao: false });
});

test("papel comercial que também lidera outro departamento continua vendo todos", () => {
  assert.deepEqual(acessoGestaoPropostas("comercial", [8]), { departamentos: null, podeMudarSituacao: false });
});

test("líder do Comercial (depexe 2) sem papel comercial: todos os departamentos, só Sinc. ERP", () => {
  assert.deepEqual(acessoGestaoPropostas("consultoria", [2]), { departamentos: null, podeMudarSituacao: false });
});

test("outro líder: só os departamentos que gerencia, só Sinc. ERP", () => {
  assert.deepEqual(acessoGestaoPropostas("consultoria", [3, 8]), { departamentos: [3, 8], podeMudarSituacao: false });
});

test("sem papel admin/comercial e sem liderança: sem acesso", () => {
  assert.equal(acessoGestaoPropostas("consultoria", []), null);
  assert.equal(acessoGestaoPropostas("suporte", []), null);
});
