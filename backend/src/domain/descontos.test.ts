import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alocarNaCompetencia,
  gerarParcelas,
  numeroDoProcesso,
  saldoDevedor,
  statusDoProcesso,
  totalDescontado,
  validarProcesso,
  vencimentoDa,
  type DadosDoProcesso,
  type SituacaoParcela,
  type TipoParaValidar,
} from "./descontos";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

const tipoLivre: TipoParaValidar = { ativo: true, permiteParcelamento: true, maxParcelas: null, valorMinimo: null, valorMaximo: null, exigeObservacao: false };

test("número do processo: DESC-AAAA-000001", () => {
  assert.equal(numeroDoProcesso(2026, 1), "DESC-2026-000001");
  assert.equal(numeroDoProcesso(2026, 123456), "DESC-2026-123456");
});

test("mensal fixo: 29,99 em 3x = 89,97, todas iguais, vencimento dia 10 nas competências 11/2026, 12/2026 e 01/2027", () => {
  const r = gerarParcelas({ modo: "mensal_fixo", valorParcela: 29.99, qtdParcelas: 3, competenciaInicial: d("2026-11-01"), diaVencimento: 10 });
  assert.equal(r.valorTotal, 89.97);
  assert.equal(r.valorParcela, 29.99);
  assert.deepEqual(r.parcelas.map((p) => p.valor), [29.99, 29.99, 29.99]);
  assert.deepEqual(r.parcelas.map((p) => iso(p.competencia)), ["2026-11-01", "2026-12-01", "2027-01-01"]);
  assert.deepEqual(r.parcelas.map((p) => iso(p.vencimento)), ["2026-11-10", "2026-12-10", "2027-01-10"]);
});

test("mensal fixo: 12x de 29,99 (Uniodonto) = 359,88", () => {
  const r = gerarParcelas({ modo: "mensal_fixo", valorParcela: 29.99, qtdParcelas: 12, competenciaInicial: d("2026-11-01"), diaVencimento: 5 });
  assert.equal(r.valorTotal, 359.88);
  assert.equal(r.parcelas.length, 12);
  assert.ok(r.parcelas.every((p) => p.valor === 29.99));
});

test("total parcelado: 500,00 em 3x = 166,66 + 166,66 + 166,68 (a última absorve os centavos)", () => {
  const r = gerarParcelas({ modo: "total_parcelado", valorTotal: 500, qtdParcelas: 3, competenciaInicial: d("2026-11-01"), diaVencimento: 10 });
  assert.deepEqual(r.parcelas.map((p) => p.valor), [166.66, 166.66, 166.68]);
  assert.equal(r.valorTotal, 500);
  assert.equal(r.valorParcela, 166.66);
});

test("total parcelado exato não mexe na última parcela; 1 parcela é o total", () => {
  const exato = gerarParcelas({ modo: "total_parcelado", valorTotal: 600, qtdParcelas: 3, competenciaInicial: d("2026-01-01"), diaVencimento: 1 });
  assert.deepEqual(exato.parcelas.map((p) => p.valor), [200, 200, 200]);
  const uma = gerarParcelas({ modo: "total_parcelado", valorTotal: 0.1 + 0.2, qtdParcelas: 1, competenciaInicial: d("2026-01-01"), diaVencimento: 1 });
  assert.equal(uma.parcelas[0].valor, 0.3); // sem erro de ponto flutuante
});

test("vencimento: dia 31 em mês curto cai no último dia (fevereiro 28/29), sem pular de mês", () => {
  assert.equal(iso(vencimentoDa(d("2026-02-01"), 31)), "2026-02-28");
  assert.equal(iso(vencimentoDa(d("2028-02-01"), 31)), "2028-02-29");
  assert.equal(iso(vencimentoDa(d("2026-04-01"), 31)), "2026-04-30");
  assert.equal(iso(vencimentoDa(d("2026-05-01"), 31)), "2026-05-31");
});

const base: DadosDoProcesso = {
  modo: "total_parcelado",
  valorTotal: 500,
  qtdParcelas: 3,
  competenciaInicial: d("2026-11-01"),
  diaVencimento: 10,
  vigenciaInicio: d("2026-11-01"),
  vigenciaFim: d("2027-01-31"),
  observacao: null,
};

test("validação: lançamento correto devolve o parcelamento calculado", () => {
  const r = validarProcesso(base, tipoLivre);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.parcelamento.parcelas.length, 3);
});

test("validação: valores, quantidade e dia precisam ser positivos e válidos", () => {
  const erro = (dados: Partial<DadosDoProcesso>, tipo = tipoLivre) => {
    const r = validarProcesso({ ...base, ...dados }, tipo);
    return r.ok ? null : r.erro;
  };
  assert.match(erro({ valorTotal: 0 }) ?? "", /valor total/i);
  assert.match(erro({ valorTotal: -10 }) ?? "", /valor total/i);
  assert.match(erro({ modo: "mensal_fixo", valorParcela: 0 }) ?? "", /valor mensal/i);
  assert.match(erro({ qtdParcelas: 0 }) ?? "", /quantidade de parcelas/i);
  assert.match(erro({ qtdParcelas: 1.5 }) ?? "", /quantidade de parcelas/i);
  assert.match(erro({ qtdParcelas: 121 }) ?? "", /120/);
  assert.match(erro({ diaVencimento: 0 }) ?? "", /dia de vencimento/i);
  assert.match(erro({ diaVencimento: 32 }) ?? "", /dia de vencimento/i);
});

test("validação: vigência — fim >= início, competência inicial dentro dela e cobrindo a última parcela", () => {
  const erro = (dados: Partial<DadosDoProcesso>) => {
    const r = validarProcesso({ ...base, ...dados }, tipoLivre);
    return r.ok ? null : r.erro;
  };
  assert.match(erro({ vigenciaFim: d("2026-10-31") }) ?? "", /igual ou posterior/i);
  assert.match(erro({ competenciaInicial: d("2026-10-01") }) ?? "", /dentro do período/i);
  assert.match(erro({ competenciaInicial: d("2027-02-01") }) ?? "", /dentro do período/i);
  // última parcela vence em 10/01/2027: vigência até 05/01/2027 não cobre
  assert.match(erro({ vigenciaFim: d("2027-01-05") }) ?? "", /cobrir todas as parcelas/i);
  assert.equal(erro({ vigenciaFim: d("2027-01-10") }), null);
});

test("validação: regras do tipo (inativo, parcelamento, máximo, mínimo/máximo de valor, observação)", () => {
  const erro = (dados: Partial<DadosDoProcesso>, tipo: Partial<TipoParaValidar>) => {
    const r = validarProcesso({ ...base, ...dados }, { ...tipoLivre, ...tipo });
    return r.ok ? null : r.erro;
  };
  assert.match(erro({}, { ativo: false }) ?? "", /inativo/i);
  assert.match(erro({}, { permiteParcelamento: false }) ?? "", /não permite parcelamento/i);
  assert.equal(erro({ qtdParcelas: 1, vigenciaFim: d("2026-11-30") }, { permiteParcelamento: false }), null);
  assert.match(erro({}, { maxParcelas: 2 }) ?? "", /no máximo 2/i);
  assert.match(erro({}, { valorMinimo: 600 }) ?? "", /mínimo/i);
  assert.match(erro({}, { valorMaximo: 400 }) ?? "", /máximo/i);
  assert.match(erro({ observacao: "  " }, { exigeObservacao: true }) ?? "", /observação/i);
  assert.equal(erro({ observacao: "Camisa polo" }, { exigeObservacao: true }), null);
});

test("validação: valor mínimo/máximo vale para o total do processo, inclusive no modo mensal fixo", () => {
  const r = validarProcesso({ ...base, modo: "mensal_fixo", valorParcela: 29.99, qtdParcelas: 3, valorTotal: null }, { ...tipoLivre, valorMaximo: 89.96 });
  assert.equal(r.ok, false);
  const ok = validarProcesso({ ...base, modo: "mensal_fixo", valorParcela: 29.99, qtdParcelas: 3, valorTotal: null }, { ...tipoLivre, valorMaximo: 89.97 });
  assert.equal(ok.ok, true);
});

const sit = (...s: SituacaoParcela[]) => s.map((situacao) => ({ situacao }));
const FIM = d("2027-01-31");

test("status: ativo, quitado, cancelado, parcialmente cancelado e vigência encerrada", () => {
  assert.equal(statusDoProcesso(sit("pendente", "pendente"), FIM, d("2026-11-10")), "ativo");
  assert.equal(statusDoProcesso(sit("descontada", "pendente"), FIM, d("2026-11-10")), "ativo");
  assert.equal(statusDoProcesso(sit("descontada", "descontada", "descontada"), FIM, d("2027-02-10")), "quitado");
  assert.equal(statusDoProcesso(sit("descontada", "quitada_antecipadamente"), FIM, d("2026-12-10")), "quitado");
  assert.equal(statusDoProcesso(sit("cancelada", "cancelada"), FIM, d("2026-11-10")), "cancelado");
  assert.equal(statusDoProcesso(sit("cancelada", "estornada"), FIM, d("2026-11-10")), "cancelado");
  assert.equal(statusDoProcesso(sit("cancelada", "pendente"), FIM, d("2026-11-10")), "parcialmente_cancelado");
  // cancelou o que faltava depois de já ter descontado parte: terminou antes da quitação total
  assert.equal(statusDoProcesso(sit("descontada", "cancelada", "cancelada"), FIM, d("2026-12-10")), "cancelado");
  assert.equal(statusDoProcesso(sit("descontada", "pendente"), FIM, d("2027-03-01")), "vigencia_encerrada");
});

test("status: parcela parcial já foi resolvida (o restante é outra parcela pendente); sem pendente o processo está quitado", () => {
  assert.equal(statusDoProcesso(sit("descontada", "parcial", "pendente"), FIM, d("2026-12-10")), "ativo");
  assert.equal(statusDoProcesso(sit("descontada", "parcial", "descontada"), FIM, d("2027-01-10")), "quitado");
});

const parc = (id: number, processoId: number, numero: number, venc: string, valor: number) => ({ id, processoId, numero, vencimento: d(venc), valor });

test("alocação: nota cobre tudo — todas descontadas", () => {
  const r = alocarNaCompetencia(6000, [parc(1, 1, 1, "2026-11-10", 466.67)]);
  assert.deepEqual(r, [{ id: 1, acao: "descontada", valorDescontado: 466.67, restante: 0 }]);
});

test("alocação: nota insuficiente — desconta o que cabe, o restante segue (não cancela, não perde)", () => {
  const r = alocarNaCompetencia(100, [parc(1, 1, 1, "2026-11-05", 60), parc(2, 2, 1, "2026-11-10", 60), parc(3, 3, 1, "2026-11-15", 60)]);
  assert.deepEqual(r, [
    { id: 1, acao: "descontada", valorDescontado: 60, restante: 0 },
    { id: 2, acao: "parcial", valorDescontado: 40, restante: 20 },
    { id: 3, acao: "transportada", valorDescontado: 0, restante: 60 },
  ]);
  const total = r.reduce((s, x) => s + x.valorDescontado + x.restante, 0);
  assert.equal(Math.round(total * 100), 18000); // nada se perdeu: 60 + 60 + 60
});

test("alocação: ordem por vencimento, depois processo e número; nota zero ou negativa transporta tudo", () => {
  const ordem = alocarNaCompetencia(50, [parc(9, 2, 1, "2026-11-10", 40), parc(8, 1, 2, "2026-11-10", 40), parc(7, 1, 1, "2026-11-03", 40)]);
  assert.deepEqual(ordem.map((x) => x.id), [7, 8, 9]);
  assert.deepEqual(ordem.map((x) => x.acao), ["descontada", "parcial", "transportada"]);
  assert.ok(alocarNaCompetencia(0, [parc(1, 1, 1, "2026-11-10", 10)]).every((x) => x.acao === "transportada"));
  assert.ok(alocarNaCompetencia(-5, [parc(1, 1, 1, "2026-11-10", 10)]).every((x) => x.acao === "transportada"));
});

test("alocação: centavos exatos (0,1 + 0,2 não vira 0,30000000000000004)", () => {
  const r = alocarNaCompetencia(0.3, [parc(1, 1, 1, "2026-11-10", 0.1), parc(2, 1, 2, "2026-11-10", 0.2)]);
  assert.ok(r.every((x) => x.acao === "descontada"));
});

test("saldo devedor soma só as pendentes; total descontado inclui o pedaço das parciais", () => {
  const parcelas = [
    { situacao: "descontada" as const, valor: 100, valorDescontado: 100 },
    { situacao: "parcial" as const, valor: 100, valorDescontado: 40 },
    { situacao: "pendente" as const, valor: 60, valorDescontado: 0 },
    { situacao: "pendente" as const, valor: 100, valorDescontado: 0 },
    { situacao: "cancelada" as const, valor: 100, valorDescontado: 0 },
  ];
  assert.equal(saldoDevedor(parcelas), 160);
  assert.equal(totalDescontado(parcelas), 140);
});
