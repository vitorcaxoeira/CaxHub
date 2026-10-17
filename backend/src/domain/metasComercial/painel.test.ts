import assert from "node:assert/strict";
import { test } from "node:test";
import { PESOS_PADRAO } from "./calculo";
import { IndicadorDef, montarPainel } from "./painel";

// Cenário pequeno com números da planilha META 2026.xlsx: Taíza (Incremento/Licenças) e a linha "Não atribuído" com os +14.493,21 avulsos.
const IND: IndicadorDef[] = [
  { id: 1, codigo: "MENSALIDADE", nome: "Mensalidade", unidade: "BRL", acumulacao: "SALDO", origem: "MANUAL", ordem: 1 },
  { id: 2, codigo: "INCREMENTO_MENSAL", nome: "Incremento Mensal", unidade: "BRL", acumulacao: "SOMA", origem: "MANUAL", ordem: 2 },
  { id: 5, codigo: "FATURAMENTO", nome: "Faturamento", unidade: "BRL", acumulacao: "SOMA", origem: "FATURAMENTO_SENIOR", ordem: 5 },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

const base = {
  ano: 2026,
  pesos: PESOS_PADRAO,
  indicadores: IND,
  metasEmpresa: new Map([[1, 1000000], [2, 200000], [5, 13844948.52]]),
  participantes: [
    { id: 10, nome: "TAIZA", funcao: "Vendas", naoAtribuido: false, ordem: 1, indicadores: [{ indicadorId: 2, rotulo: "Mensalidade", ordem: 1 }] },
    { id: 99, nome: "Não atribuído", funcao: null, naoAtribuido: true, ordem: 99, indicadores: [{ indicadorId: 2, rotulo: null, ordem: 1 }, { indicadorId: 1, rotulo: null, ordem: 2 }] },
  ],
  lancamentos: [
    { participanteId: 10, indicadorId: 2, mes: 1, meta: 6560, realizado: 8376.31 },
    { participanteId: 10, indicadorId: 2, mes: 2, meta: 6560, realizado: 46367.63 },
    { participanteId: 99, indicadorId: 2, mes: 3, meta: null, realizado: 14493.21 },
    { participanteId: 99, indicadorId: 1, mes: 3, meta: null, realizado: 948672.34 },
  ],
  faturamentoMensal: [915689.9, 960818.85, 1346286.42, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

test("painel do ano: realizado da empresa soma as pessoas e a linha Não atribuído", () => {
  const p = montarPainel({ ...base, periodo: "ano", meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  const inc = p.indicadores.find((i) => i.codigo === "INCREMENTO_MENSAL")!;
  assert.equal(inc.metaAnual, 200000);
  assert.equal(inc.consolidado.meta, 200000);
  assert.equal(inc.consolidado.realizado, r2(8376.31 + 46367.63 + 14493.21));
  assert.equal(inc.mensal[0].meta, 13333.33);
  assert.equal(inc.metaDasPessoas, 13120);
});

test("SALDO: carteira de mensalidade usa o último mês lançado e a meta é a posição-alvo", () => {
  const p = montarPainel({ ...base, periodo: "ano", meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  const m = p.indicadores.find((i) => i.codigo === "MENSALIDADE")!;
  assert.equal(m.consolidado.realizado, 948672.34);
  assert.equal(m.consolidado.meta, 1000000);
  assert.ok(Math.abs(m.consolidado.atingimento! - 0.9486723) < 1e-6);
  assert.equal(m.metaDasPessoas, null);
});

test("Faturamento vem do Senior e as pessoas não têm realizado nele", () => {
  const p = montarPainel({ ...base, periodo: "t1", meses: [1, 2, 3] });
  const f = p.indicadores.find((i) => i.codigo === "FATURAMENTO")!;
  assert.equal(f.consolidado.realizado, r2(915689.9 + 960818.85 + 1346286.42));
  assert.equal(f.serie[2].realizado, f.consolidado.realizado);
  assert.equal(f.serie[3].realizado, null);
});

test("pessoa mostra o rótulo próprio e o 'Não atribuído' vai por último", () => {
  const p = montarPainel({ ...base, periodo: "ano", meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  assert.equal(p.pessoas[0].nome, "TAIZA");
  assert.equal(p.pessoas[0].indicadores[0].rotulo, "Mensalidade");
  assert.equal(p.pessoas[0].indicadores[0].nome, "Incremento Mensal");
  assert.equal(p.pessoas[1].naoAtribuido, true);
  assert.equal(p.pessoas[0].indicadores[0].consolidado.meta, 13120);
});

test("período recorta metas e realizado: só o 1º trimestre", () => {
  const p = montarPainel({ ...base, periodo: "t1", meses: [1, 2, 3] });
  const inc = p.indicadores.find((i) => i.codigo === "INCREMENTO_MENSAL")!;
  assert.equal(inc.consolidado.meta, 39999.99); // 3 × 13.333,33: cada mês em centavos, o resíduo fica em dezembro
  assert.ok(p.atingimentoGeral != null);
});
