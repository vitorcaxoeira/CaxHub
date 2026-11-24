import test from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { condicoesColaborador, lerFiltro, primeiroDiaDoMes, somarMeses } from "./filtros";
import { pct, suprimir } from "./comum";
import { iniciativaDaCausa } from "./dominios";

const req = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

test("filtro: período padrão são os 12 meses até hoje e datas inválidas são ignoradas", () => {
  const f = lerFiltro(req({ ate: "2026-10-09" }));
  assert.equal(f.ate, "2026-10-09");
  assert.equal(f.de, "2025-11-01");
  const ruim = lerFiltro(req({ de: "2026-02-30", ate: "ontem" }));
  assert.match(ruim.ate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(ruim.de <= ruim.ate);
});

test("filtro: início depois do fim é corrigido e recortes inválidos nunca viram SQL", () => {
  const f = lerFiltro(req({ de: "2026-12-01", ate: "2026-01-31", empresa: "1; DROP TABLE x", ccu: "A'B", cargo: "1:a b", local: "3" }));
  assert.equal(f.de, "2026-01-31");
  assert.equal(f.empresa, undefined);
  assert.equal(f.ccu, undefined);
  assert.equal(f.cargo, undefined);
  assert.equal(f.local, 3);
});

test("filtro: tipo de colaborador explícito vence o padrão da tela; sem ele, o padrão marca implícito", () => {
  const explicito = lerFiltro(req({ tipcol: "2,3" }), [1]);
  assert.deepEqual(explicito.tipcol, [2, 3]);
  assert.equal(explicito.tipcolImplicito, undefined);
  const implicito = lerFiltro(req({}), [1]);
  assert.deepEqual(implicito.tipcol, [1]);
  assert.equal(implicito.tipcolImplicito, true);
  assert.equal(lerFiltro(req({})).tipcol, undefined);
});

test("filtro: as condições de cadastro são parametrizadas", () => {
  const f = lerFiltro(req({ empresa: "1", tipcol: "1", ccu: "77205", cargo: "1:ANA" }));
  const sql = condicoesColaborador(f);
  assert.equal(typeof sql.sql, "string");
  assert.equal(sql.values.length, 5);
  assert.doesNotMatch(sql.sql, /77205|ANA/);
});

test("datas: somar meses e primeiro dia do mês", () => {
  assert.equal(somarMeses("2026-03-31", -1), "2026-03-03"); // 31/03 - 1 mês cai em 03/03 (JS: 31/02 -> 03/03)
  assert.equal(somarMeses("2026-10-09", -11), "2025-11-09");
  assert.equal(primeiroDiaDoMes("2026-10-09"), "2026-10-01");
});

test("privacidade: grupos com menos de 3 pessoas viram 'Demais' sem valores, e o papel rh vê tudo", () => {
  const linhas = [
    { rotulo: "A", qtd: 8, valor: 100 },
    { rotulo: "B", qtd: 2, valor: 50 },
    { rotulo: "C", qtd: 1, valor: 30 },
  ];
  const agregado = suprimir(linhas, false, ["valor"]);
  assert.deepEqual(agregado.map((g) => g.rotulo), ["A", "Demais (grupos com menos de 3)"]);
  assert.equal(agregado[1].qtd, 3);
  assert.equal(agregado[1].valor, null);
  assert.equal(suprimir(linhas, true, ["valor"]).length, 3);
  // se a soma dos pequenos também for < 3, nem o "Demais" aparece (senão ele seria um indivíduo)
  assert.deepEqual(suprimir([{ rotulo: "A", qtd: 8 }, { rotulo: "B", qtd: 1 }], false).map((g) => g.rotulo), ["A"]);
});

test("percentual: sem base devolve null, não zero", () => {
  assert.equal(pct(1, 0), null);
  assert.equal(pct(1, 3, 1), 33.3);
});

test("causas de demissão: iniciativa", () => {
  assert.equal(iniciativaDaCausa(2), "empresa");
  assert.equal(iniciativaDaCausa(4), "empregado");
  assert.equal(iniciativaDaCausa(11), "empregado");
  assert.equal(iniciativaDaCausa(12), "contrato");
  assert.equal(iniciativaDaCausa(26), "acordo");
  assert.equal(iniciativaDaCausa(8), "outros");
  assert.equal(iniciativaDaCausa(null), "outros");
});
