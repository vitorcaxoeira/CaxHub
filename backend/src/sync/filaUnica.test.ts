import test from "node:test";
import assert from "node:assert/strict";
import { criarFilaUnica } from "./filaUnica";

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("duas tarefas disparadas juntas nunca se sobrepõem e saem na ordem pedida", async () => {
  const emFila = criarFilaUnica();
  let emExecucao = 0;
  let maximoSimultaneo = 0;
  const ordem: string[] = [];

  const tarefa = (nome: string, ms: number) => async () => {
    emExecucao++;
    maximoSimultaneo = Math.max(maximoSimultaneo, emExecucao);
    await esperar(ms);
    ordem.push(nome);
    emExecucao--;
    return nome;
  };

  const resultados = await Promise.all([emFila(tarefa("a", 30)), emFila(tarefa("b", 5)), emFila(tarefa("c", 1))]);

  assert.equal(maximoSimultaneo, 1);
  assert.deepEqual(ordem, ["a", "b", "c"]);
  assert.deepEqual(resultados, ["a", "b", "c"]);
});

test("falha numa tarefa chega só a quem a pediu e não trava as seguintes", async () => {
  const emFila = criarFilaUnica();
  const falha = emFila(async () => {
    throw new Error("caiu");
  });
  const seguinte = emFila(async () => "ok");

  await assert.rejects(falha, /caiu/);
  assert.equal(await seguinte, "ok");
});

test("filas criadas separadas não esperam uma pela outra", async () => {
  const filaA = criarFilaUnica();
  const filaB = criarFilaUnica();
  const ordem: string[] = [];

  const lenta = filaA(async () => {
    await esperar(40);
    ordem.push("lenta");
  });
  const rapida = filaB(async () => {
    ordem.push("rapida");
  });

  await Promise.all([lenta, rapida]);
  assert.deepEqual(ordem, ["rapida", "lenta"]);
});
