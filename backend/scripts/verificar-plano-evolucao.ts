// Verificação do motor do Plano de Evolução Profissional e Eficiência (domain/planoEvolucao/*), sem banco.
// Rodar: node_modules/.bin/ts-node --transpile-only scripts/verificar-plano-evolucao.ts   (nunca npx — trava no Windows)
// Os casos vêm do regulamento v3.1: matriz do item 7.3 e cenários A, B, C e D do item 8, todos com Valor Hora Base de R$ 100,00.
import {
  calendarioDoCiclo,
  dataIsoValida,
  diasEntre,
  fimProrrogado,
  inicioDoPrimeiroCiclo,
  periodoDoSemestre,
  semestreDaData,
  sequenciaDeSemestres,
  somarDias,
} from "../src/domain/planoEvolucao/calendario";
import {
  EntradaApuracao,
  EstadoParticipante,
  aplicarPercentual,
  apurarCiclo,
  apurarSequencia,
  avaliacaoClientesCumprida,
  centavos,
  projetarCiclo,
} from "../src/domain/planoEvolucao/regras";
import { ItemNoCiclo, avaliarMeta, indiceDe, indicesDoCiclo } from "../src/domain/planoEvolucao/eficienciaItens";
import { apontamentoOnline, avaliarOnline, cumpreEficienciaIndividual, ehOnline } from "../src/domain/planoEvolucao/eficienciaIndividual";
import { INDICADORES_PADRAO, ParametrosDaPrevia, montarPrevia } from "../src/domain/planoEvolucao/previa";
import {
  pendenciasDePublicacao,
  validarCalendario,
  validarEdicaoCiclo,
  validarEncerramento,
  validarNovoCiclo,
  validarNovoParticipante,
  validarValorBase,
} from "../src/domain/planoEvolucao/validacao";

let falhas = 0;
let total = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.error(`FALHOU: ${nome}\n   obtido:   ${JSON.stringify(obtido)}\n   esperado: ${JSON.stringify(esperado)}`);
  }
}
const h = (n: number) => n * 60;

const tudo = (global: boolean): EntradaApuracao => ({
  contratoAtivoNoCiclo: true,
  cicloCompleto: true,
  competenciasPct: 90,
  certificacoes: true,
  avaliacaoClientes: true,
  caseTecnico: true,
  eficienciaIndividual: true,
  global,
});
const inicial = (base = 100): EstadoParticipante => ({ baseCentavos: centavos(base), consecutivos: 0 });
const valores = (r: { valorHoraCentavos: number }[]) => r.map((x) => x.valorHoraCentavos / 100);

// 1. Matriz completa do item 7.3 (base R$ 100,00): com e sem o requisito global, nos 10 ciclos.
{
  const comGlobal = apurarSequencia(inicial(), Array.from({ length: 10 }, () => tudo(true)));
  confere("matriz 7.3 com global (1º ao 10º)", valores(comGlobal.resultados), [105, 105.5, 106, 106.5, 107, 107.5, 108, 108.5, 109, 109.5]);
  confere("matriz 7.3 percentuais com global", comGlobal.resultados.map((r) => r.percentualBp / 100), [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5]);
  const semGlobal = apurarSequencia(inicial(), Array.from({ length: 10 }, () => tudo(false)));
  confere("matriz 7.3 sem global (1º ao 10º)", valores(semGlobal.resultados), [104, 104.5, 105, 105.5, 106, 106.5, 107, 107.5, 108, 108.5]);
  confere("reforçador cresce 0,5 p.p. por ciclo", comGlobal.resultados.map((r) => r.reforcadorBp / 100), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]);
  confere("só o 10º efetiva", comGlobal.resultados.map((r) => r.efetivou), [false, false, false, false, false, false, false, false, false, true]);
  confere("efetivação: nova base = valor do 10º ciclo e sequência recomeça", comGlobal.estadoFinal, { baseCentavos: 10950, consecutivos: 0 });
  confere("efetivação sem global: 8,5%", semGlobal.estadoFinal, { baseCentavos: 10850, consecutivos: 0 });
}

// 2. Cenário A — tudo em todos os ciclos.
{
  const r = apurarSequencia(inicial(), Array.from({ length: 5 }, () => tudo(true)));
  confere("cenário A", valores(r.resultados), [105, 105.5, 106, 106.5, 107]);
  confere("cenário A: pontuação é sempre 5%", r.resultados.map((x) => x.pontuacaoBp / 100), [5, 5, 5, 5, 5]);
}

// 3. Cenário B — a área oscila na meta global (atinge nos ciclos 1, 3 e 4; não atinge nos 2 e 5).
{
  const r = apurarSequencia(inicial(), [tudo(true), tudo(false), tudo(true), tudo(true), tudo(false)]);
  confere("cenário B", valores(r.resultados), [105, 104.5, 106, 106.5, 106]);
  confere("cenário B: o valor hora CAI no 2º ciclo (105,00 → 104,50) e isso é o funcionamento normal", valores(r.resultados)[1] < valores(r.resultados)[0], true);
  confere("cenário B: o global não atingido NÃO quebra a sequência", r.estadoFinal.consecutivos, 5);
  confere("cenário B: o 5º ciclo já supera o 1º mesmo sem o global", valores(r.resultados)[4] > valores(r.resultados)[0], true);
}

// 4. Cenário C — falha o Case Técnico no 6º ciclo: volta à base e o plano recomeça.
{
  const falhou: EntradaApuracao = { ...tudo(true), caseTecnico: false };
  const r = apurarSequencia(inicial(), [...Array.from({ length: 5 }, () => tudo(true)), falhou, tudo(true), tudo(true)]);
  confere("cenário C", valores(r.resultados), [105, 105.5, 106, 106.5, 107, 100, 105, 105.5]);
  confere("cenário C: descumprido zera pontuação e reforçador", [r.resultados[5].status, r.resultados[5].pontuacaoBp, r.resultados[5].reforcadorBp], ["descumprido", 0, 0]);
  confere("cenário C: motivo do descumprimento", r.resultados[5].motivos, ["caseTecnico"]);
  confere("cenário C: o ciclo seguinte é um novo 1º ciclo (reforçador 0)", r.resultados[6].reforcadorBp, 0);
}

// 5. Cenário D — 10 ciclos: efetivação e recomeço sobre a nova base.
{
  const r = apurarSequencia(inicial(), Array.from({ length: 20 }, () => tudo(true)));
  confere("cenário D: 10º ciclo efetiva R$ 109,50", valores(r.resultados)[9], 109.5);
  confere("cenário D: 11º ciclo (novo 1º) fatura R$ 114,98 sobre a base de R$ 109,50", valores(r.resultados)[10], 114.98);
  confere("cenário D: 12º ciclo (novo 2º) fatura R$ 115,52", valores(r.resultados)[11], 115.52);
  confere("cenário D: 20º ciclo (novo 10º) efetiva R$ 119,90", valores(r.resultados)[19], 119.9);
  confere("cenário D: nova efetivação sobre R$ 109,50", r.estadoFinal, { baseCentavos: 11990, consecutivos: 0 });
  // Efetivado é irreversível: perder um ciclo depois volta para a base EFETIVADA, não para a original.
  const depois = apurarSequencia(inicial(), [...Array.from({ length: 10 }, () => tudo(true)), { ...tudo(true), eficienciaIndividual: false }]);
  confere("descumprir depois de efetivar volta à base efetivada (R$ 109,50), nunca a R$ 100,00", valores(depois.resultados)[10], 109.5);
}

// 6. Aritmética de dinheiro em centavos exatos (sem ponto flutuante).
{
  confere("114,975 arredonda para 114,98", aplicarPercentual(10950, 500), 11498);
  confere("115,5225 arredonda para 115,52", aplicarPercentual(10950, 550), 11552);
  confere("119,9025 arredonda para 119,90", aplicarPercentual(10950, 950), 11990);
  confere("percentual zero devolve a base", aplicarPercentual(12345, 0), 12345);
}

// 7. Portões e requisitos (itens 4 e 5).
{
  confere("competências 79% descumpre", apurarCiclo(inicial(), { ...tudo(true), competenciasPct: 79 }).resultado.motivos, ["competencias"]);
  confere("competências 80% passa", apurarCiclo(inicial(), { ...tudo(true), competenciasPct: 80 }).resultado.status, "cumprido");
  const tres: EntradaApuracao = { ...tudo(true), avaliacaoClientes: false };
  const r3 = apurarCiclo({ baseCentavos: 10000, consecutivos: 4 }, tres);
  confere("cumprir 3 dos 4 individuais dá 0%, não 3%", [r3.resultado.status, r3.resultado.percentualBp, r3.resultado.valorHoraCentavos], ["descumprido", 0, 10000]);
  confere("descumprir zera a sequência", r3.proximo, { baseCentavos: 10000, consecutivos: 0 });
  confere("vários motivos de uma vez", apurarCiclo(inicial(), { ...tudo(true), certificacoes: false, caseTecnico: false }).resultado.motivos, ["certificacoes", "caseTecnico"]);
  const semGlobal = apurarCiclo({ baseCentavos: 10000, consecutivos: 3 }, tudo(false));
  confere("sem o global: 4% + reforçador, e a sequência segue", [semGlobal.resultado.percentualBp, semGlobal.proximo.consecutivos], [550, 4]);
  // Não apurado
  const inativo = apurarCiclo({ baseCentavos: 10000, consecutivos: 3 }, { ...tudo(true), contratoAtivoNoCiclo: false });
  confere("contrato inativo: não apurado, sem percentual", [inativo.resultado.status, inativo.resultado.percentualBp, inativo.resultado.motivos], ["nao_apurado", 0, ["contrato"]]);
  confere("não apurado NÃO quebra a sequência por padrão", inativo.proximo.consecutivos, 3);
  confere("não apurado quebra a sequência se o parâmetro mandar", apurarCiclo({ baseCentavos: 10000, consecutivos: 3 }, { ...tudo(true), cicloCompleto: false }, { naoApuradoQuebraSequencia: true }).proximo.consecutivos, 0);
  // Projeção com requisitos em aberto
  const parcial: EntradaApuracao = { ...tudo(true), certificacoes: null, competenciasPct: null, global: null };
  const proj = apurarCiclo({ baseCentavos: 10000, consecutivos: 2 }, parcial).resultado;
  confere("com pendentes é projeção (assume cumprido) e lista o que falta", [proj.projetado, proj.pendentes], [true, ["competencias", "certificacoes", "global"]]);
  confere("falha conhecida descumpre mesmo com outros pendentes", apurarCiclo(inicial(), { ...parcial, caseTecnico: false }).resultado.status, "descumprido");
  confere("tudo definido não é projeção", apurarCiclo(inicial(), tudo(true)).resultado.projetado, false);
  const dois = projetarCiclo({ baseCentavos: 10000, consecutivos: 4 }, parcial);
  confere("projeção dos dois desfechos do global (reforçador 2,0)", [dois.comGlobal.valorHoraCentavos, dois.semGlobal.valorHoraCentavos], [10700, 10600]);
}

// 8. Avaliação de Clientes (item 6.2.2).
{
  confere("menos de 3 respostas = cumprido", [avaliacaoClientesCumprida(null, 0), avaliacaoClientesCumprida(5, 2)], [true, true]);
  confere("3 respostas com média 7,9 = não cumprido", avaliacaoClientesCumprida(7.9, 3), false);
  confere("3 respostas com média 8,0 = cumprido", avaliacaoClientesCumprida(8, 3), true);
}

// 9. Calendário (item 3).
{
  confere("semestres", [periodoDoSemestre(2027, 1), periodoDoSemestre(2027, 2)], [
    { inicio: "2027-01-01", fim: "2027-06-30" },
    { inicio: "2027-07-01", fim: "2027-12-31" },
  ]);
  confere("1º ciclo: datas do regulamento (corte 31/05, apuração e devolutiva 20/06, contestação 25/06)", calendarioDoCiclo("2027-01-01", "2027-06-30"), {
    abertura: "2027-01-01",
    corteEvidencias: "2027-05-31",
    apuracaoAte: "2027-06-20",
    devolutivaEm: "2027-06-20",
    contestacaoAte: "2027-06-25",
    encerramento: "2027-06-30",
  });
  const seq = sequenciaDeSemestres(2027, 1, 10);
  confere("o 10º ciclo termina em 31/12/2031", [seq[9].ciclo, seq[9].fim, seq[4].inicio], [10, "2031-12-31", "2029-01-01"]);
  confere("adesão antes da vigência começa em 01/01/2027", inicioDoPrimeiroCiclo("2026-12-15"), "2027-01-01");
  confere("adesão em 01/01/2027 começa nesse dia", inicioDoPrimeiroCiclo("2027-01-01"), "2027-01-01");
  confere("adesão em 10/03/2027 começa em 01/07/2027", inicioDoPrimeiroCiclo("2027-03-10"), "2027-07-01");
  confere("adesão em 01/07/2027 começa nesse dia", inicioDoPrimeiroCiclo("2027-07-01"), "2027-07-01");
  confere("adesão em 31/12/2027 começa em 01/01/2028", inicioDoPrimeiroCiclo("2027-12-31"), "2028-01-01");
  confere("prorrogação: até 30 dias não muda; 45 dias prorroga 45", [fimProrrogado("2027-06-30", 30), fimProrrogado("2027-06-30", 45)], ["2027-06-30", "2027-08-14"]);
  confere("datas ISO", [dataIsoValida("2027-02-29"), dataIsoValida("2028-02-29"), dataIsoValida("27-01-01")], [false, true, false]);
  confere("aritmética de dias", [somarDias("2027-01-01", 180), diasEntre("2027-01-01", "2027-06-30"), semestreDaData("2027-07-01")], ["2027-06-30", 180, { ano: 2027, semestre: 2 }]);
}

// 10. Eficiência pelo ITEM da proposta: cada hora do ciclo é "dentro" ou "acima" do orçado, em ordem, contando o que o item já tinha executado antes.
{
  const item: ItemNoCiclo = {
    codemp: 1, codpro: 100, seqite: 1, vendido: h(100), executadoAntes: h(80),
    horas: [
      { id: 1, codfor: 7, minutos: h(30) }, // 80 → 110: 20 h dentro, 10 h acima
      { id: 2, codfor: 8, minutos: h(30) }, // 110 → 140: tudo acima
    ],
  };
  const r = indicesDoCiclo([item]);
  confere("global do item: 20 h dentro e 40 h acima", [r.global.executado, r.global.dentro, r.global.acima, r.global.itens], [h(60), h(20), h(40), 1]);
  confere("consultor 7 (apontou antes do estouro)", r.porConsultor.get(7), { executado: h(30), dentro: h(20), acima: h(10), itens: 1 });
  confere("consultor 8 (apontou depois de estourar) leva o estouro todo", r.porConsultor.get(8), { executado: h(30), dentro: 0, acima: h(30), itens: 1 });
  confere("índice global 33,3% e individuais", [Math.round(indiceDe(r.global)! * 10) / 10, Math.round(indiceDe(r.porConsultor.get(7)!)! * 10) / 10, indiceDe(r.porConsultor.get(8)!)], [33.3, 66.7, 0]);

  // Dois itens: o saldo de um NÃO compensa o estouro do outro (cada item tem o seu orçado).
  const itemFolgado: ItemNoCiclo = { codemp: 1, codpro: 100, seqite: 2, vendido: h(500), executadoAntes: 0, horas: [{ id: 3, codfor: 7, minutos: h(50) }] };
  const dois = indicesDoCiclo([item, itemFolgado]);
  confere("itens independentes: o folgado entra 100% dentro, o estourado segue estourado", [dois.global.dentro, dois.global.acima, dois.global.itens], [h(70), h(40), 2]);
  confere("consultor 7 nos dois itens soma os dois", dois.porConsultor.get(7), { executado: h(80), dentro: h(70), acima: h(10), itens: 2 });

  // Bordas
  const semVendido: ItemNoCiclo = { codemp: 1, codpro: 1, seqite: 1, vendido: 0, executadoAntes: 0, horas: [{ id: 1, codfor: 9, minutos: h(5) }] };
  confere("item sem vendido: tudo é acima", indicesDoCiclo([semVendido]).global, { executado: h(5), dentro: 0, acima: h(5), itens: 1 });
  const jaEstourado: ItemNoCiclo = { codemp: 1, codpro: 1, seqite: 1, vendido: h(10), executadoAntes: h(50), horas: [{ id: 1, codfor: 9, minutos: h(5) }] };
  confere("item que já tinha estourado antes do ciclo: a hora do ciclo é toda acima", indicesDoCiclo([jaEstourado]).global.dentro, 0);
  const semConsultor: ItemNoCiclo = { codemp: 1, codpro: 1, seqite: 1, vendido: h(10), executadoAntes: 0, horas: [{ id: 1, codfor: null, minutos: h(5) }] };
  const sc = indicesDoCiclo([semConsultor]);
  confere("hora sem consultor conta no global e em nenhum individual", [sc.global.executado, sc.porConsultor.size], [h(5), 0]);
  confere("item sem hora no ciclo não conta", indicesDoCiclo([{ ...item, horas: [] }]).global.itens, 0);
  confere("minutos zero ou negativos são ignorados", indicesDoCiclo([{ ...item, horas: [{ id: 1, codfor: 7, minutos: 0 }, { id: 2, codfor: 7, minutos: -5 }] }]).global.executado, 0);
}

// 11. Meta e amostra mínima ("sem base", nunca um 0% falso).
{
  const a = { executado: h(100), dentro: h(92), acima: h(8), itens: 4 };
  confere("atinge meta de 90%", avaliarMeta(a, 90, h(10)), { indice: 92, atingiu: true, semBase: false });
  confere("não atinge meta de 95%", avaliarMeta(a, 95, h(10)).atingiu, false);
  confere("exatamente na meta atinge", avaliarMeta({ executado: h(100), dentro: h(90), acima: h(10), itens: 1 }, 90, h(10)).atingiu, true);
  confere("amostra abaixo do mínimo = sem base, não reprova", avaliarMeta({ executado: h(5), dentro: 0, acima: h(5), itens: 1 }, 90, h(10)), { indice: 0, atingiu: null, semBase: true });
  confere("sem horas = sem base", avaliarMeta({ executado: 0, dentro: 0, acima: 0, itens: 0 }, 90, 0).semBase, true);
  confere("sem meta publicada = não conclui", avaliarMeta(a, null, h(10)).atingiu, null);
}

// 12. Requisito 6.4 (eficiência individual): pesos dos indicadores, nota mínima e indicador sem base.
{
  const ind = (chave: string, peso: number, atingiu: boolean | null) => ({ chave, peso, atingiu });
  confere("todos atingidos cumpre", cumpreEficienciaIndividual([ind("a", 60, true), ind("b", 40, true)]).cumpriu, true);
  confere("um falho com nota mínima 100 não cumpre (nota 60)", cumpreEficienciaIndividual([ind("a", 60, true), ind("b", 40, false)]), { cumpriu: false, pontos: 60, base: 100, nota: 60, semBase: [] });
  confere("nota mínima 60 aceita o mesmo caso", cumpreEficienciaIndividual([ind("a", 60, true), ind("b", 40, false)], 60).cumpriu, true);
  const sem = cumpreEficienciaIndividual([ind("a", 50, true), ind("b", 50, null)]);
  confere("indicador sem base não reprova nem entra na conta", [sem.cumpriu, sem.base, sem.semBase], [true, 50, ["b"]]);
  confere("nenhum indicador com base = não conclui", cumpreEficienciaIndividual([ind("a", 50, null)]).cumpriu, null);
  confere("indicador de peso zero é ignorado", cumpreEficienciaIndividual([ind("a", 100, true), ind("z", 0, false)]).cumpriu, true);
}

// 13. Apontamento online (definições A e B, medidas na Fase 0).
{
  const horas = [
    { minutos: h(40), origem: "ao_vivo" as const, atrasoDias: null },
    { minutos: h(10), origem: "solicitacao" as const, atrasoDias: null },
    { minutos: h(10), origem: "sessao_tardia" as const, atrasoDias: null },
    { minutos: h(20), origem: "senior" as const, atrasoDias: 0 },
    { minutos: h(20), origem: "senior" as const, atrasoDias: 6 },
  ];
  confere("definição A: só o ao vivo (40 de 100 h)", apontamentoOnline(horas, "A"), { totalMin: h(100), onlineMin: h(40), pct: 40 });
  confere("definição B: soma o Senior registrado no mesmo dia (60 de 100 h)", apontamentoOnline(horas, "B").pct, 60);
  confere("Senior sem data de registro nunca é online", ehOnline({ minutos: 60, origem: "senior", atrasoDias: null }, "B"), false);
  confere("solicitação aprovada é retroativo explícito, nunca online", [ehOnline(horas[1], "A"), ehOnline(horas[1], "B")], [false, false]);
  confere("sem horas = sem percentual", apontamentoOnline([], "A").pct, null);
  confere("amostra mínima e meta", [avaliarOnline(apontamentoOnline(horas, "A"), 50, h(10)).atingiu, avaliarOnline(apontamentoOnline(horas, "B"), 50, h(10)).atingiu, avaliarOnline(apontamentoOnline(horas.slice(0, 1), "A"), 50, h(100)).semBase], [false, true, true]);
}

// 14. Validação das entradas (ciclo, participante, valor base).
{
  const erroDe = (v: { ok: boolean; erro?: string }) => (v.ok ? null : v.erro);
  confere("novo ciclo válido", validarNovoCiclo({ ano: 2027, semestre: 2 }), { ok: true, dados: { ano: 2027, semestre: 2 } });
  confere("novo ciclo: ano e semestre inválidos", [erroDe(validarNovoCiclo({ ano: 2020, semestre: 1 })) != null, erroDe(validarNovoCiclo({ ano: 2027, semestre: 3 })) != null], [true, true]);
  const ed = validarEdicaoCiclo({ metaEficienciaGlobal: "85,5", departamentosArea: [9, 8, 9], amostraMinimaHoras: 12, definicaoOnline: "B", indicadores: [{ chave: "produtividade", peso: 50, meta: "90", ativo: true }, { chave: "retrabalho", peso: 10, meta: 77 }] });
  confere("edição aceita vírgula decimal, ordena e deduplica a área", ed.ok && [ed.dados.metaEficienciaGlobal, ed.dados.departamentosArea, ed.dados.amostraMinimaHoras, ed.dados.definicaoOnline], [85.5, [8, 9], 12, "B"]);
  confere("meta de indicador MANUAL é descartada (só automático tem meta)", ed.ok && ed.dados.indicadores?.find((i) => i.chave === "retrabalho")?.meta, null);
  confere("indicador sem 'ativo' fica ativo por padrão", ed.ok && ed.dados.indicadores?.find((i) => i.chave === "retrabalho")?.ativo, true);
  confere("só o que veio no corpo entra na edição", validarEdicaoCiclo({ amostraMinimaHoras: 3 }), { ok: true, dados: { amostraMinimaHoras: 3 } });
  confere("meta nula limpa a meta global", validarEdicaoCiclo({ metaEficienciaGlobal: null }), { ok: true, dados: { metaEficienciaGlobal: null } });
  const ruins: [string, unknown][] = [
    ["meta > 100", { metaEficienciaGlobal: 101 }],
    ["meta 0", { metaEficienciaGlobal: 0 }],
    ["meta texto", { metaEficienciaGlobal: "abc" }],
    ["departamento inexistente", { departamentosArea: [99] }],
    ["área vazia", { departamentosArea: [] }],
    ["online Z", { definicaoOnline: "Z" }],
    ["nota 0", { notaMinimaEficienciaIndividual: 0 }],
    ["booleano inválido", { naoApuradoQuebraSequencia: "sim" }],
    ["data impossível", { corteEvidencias: "2027-02-30" }],
    ["indicador desconhecido", { indicadores: [{ chave: "x", peso: 1 }] }],
    ["indicador repetido", { indicadores: [{ chave: "produtividade", peso: 1 }, { chave: "produtividade", peso: 2 }] }],
    ["peso 101", { indicadores: [{ chave: "produtividade", peso: 101 }] }],
    ["texto longo", { certificacoesExigidas: "x".repeat(1001) }],
  ];
  for (const [nome, corpo] of ruins) confere(`edição inválida: ${nome}`, validarEdicaoCiclo(corpo).ok, false);

  const cal = { inicio: "2027-01-01", fim: "2027-06-30", corteEvidencias: "2027-05-31", apuracaoAte: "2027-06-20", devolutivaEm: "2027-06-20", contestacaoAte: "2027-06-25" };
  confere("calendário em ordem", validarCalendario(cal), null);
  confere("calendário fora de ordem", validarCalendario({ ...cal, contestacaoAte: "2027-06-10" }) != null, true);
  confere("calendário com corte antes do início", validarCalendario({ ...cal, corteEvidencias: "2026-12-31" }) != null, true);

  const base = { metaEficienciaGlobal: 80, departamentosArea: [8, 9], indicadores: INDICADORES_PADRAO.map((i) => ({ ...i, meta: i.tipo === "automatico" ? 70 : null })) };
  confere("pode publicar com meta, pesos somando 100 e metas dos automáticos", pendenciasDePublicacao(base), []);
  confere("sem meta global: pendência", pendenciasDePublicacao({ ...base, metaEficienciaGlobal: null }).length, 1);
  confere("pesos que não somam 100", pendenciasDePublicacao({ ...base, indicadores: base.indicadores.map((i) => (i.chave === "produtividade" ? { ...i, peso: 60 } : i)) })[0].includes("somam 110"), true);
  confere("automático ativo sem meta", pendenciasDePublicacao({ ...base, indicadores: base.indicadores.map((i) => (i.chave === "apontamento_online" ? { ...i, meta: null } : i)) })[0].includes("Apontamento online"), true);
  confere("indicador desativado não conta no peso nem exige meta", pendenciasDePublicacao({ ...base, indicadores: base.indicadores.map((i) => (i.chave === "retrabalho" ? { ...i, ativo: false } : i.chave === "produtividade" ? { ...i, peso: 60 } : i)) }), []);
  confere("nenhum indicador ativo", pendenciasDePublicacao({ ...base, indicadores: base.indicadores.map((i) => ({ ...i, ativo: false })) }).length, 1);

  confere("participante válido (vírgula decimal e arredondamento)", validarNovoParticipante({ codfor: "280", dataAdesao: "2026-12-15", valorHoraBase: "150,505", ciclosConsecutivosAntes: "3" }), { ok: true, dados: { codfor: 280, dataAdesao: "2026-12-15", valorHoraBase: 150.51, ciclosConsecutivosAntes: 3 } });
  confere("consecutivos padrão é 0", (validarNovoParticipante({ codfor: 1, dataAdesao: "2027-01-01", valorHoraBase: 100 }) as { dados: { ciclosConsecutivosAntes: number } }).dados.ciclosConsecutivosAntes, 0);
  for (const [nome, corpo] of [
    ["sem consultor", { dataAdesao: "2027-01-01", valorHoraBase: 100 }],
    ["data inválida", { codfor: 1, dataAdesao: "2027-02-30", valorHoraBase: 100 }],
    ["valor zero", { codfor: 1, dataAdesao: "2027-01-01", valorHoraBase: 0 }],
    ["valor absurdo", { codfor: 1, dataAdesao: "2027-01-01", valorHoraBase: 100000 }],
    ["consecutivos 10", { codfor: 1, dataAdesao: "2027-01-01", valorHoraBase: 100, ciclosConsecutivosAntes: 10 }],
  ] as [string, unknown][]) confere(`participante inválido: ${nome}`, validarNovoParticipante(corpo).ok, false);

  confere("valor base válido", validarValorBase({ valorHoraBase: 120, desde: "2027-07-01", motivo: "efetivacao", observacao: " ok " }), { ok: true, dados: { valorHoraBase: 120, desde: "2027-07-01", motivo: "efetivacao", observacao: "ok" } });
  confere("valor base: motivo 'adesao' não é lançável por aqui", validarValorBase({ valorHoraBase: 120, desde: "2027-07-01", motivo: "adesao" }).ok, false);
  confere("encerramento exige motivo", [validarEncerramento({}).ok, validarEncerramento({ motivo: "  " }).ok, validarEncerramento({ motivo: "saiu" }).ok], [false, false, true]);
}

// 15. Montagem da prévia (junta eficiência por item, online, requisitos pendentes e projeção do valor hora).
{
  const params: ParametrosDaPrevia = {
    metaEficienciaGlobal: 60,
    amostraMinimaHoras: 10,
    definicaoOnline: "A",
    notaMinimaEficienciaIndividual: 100,
    naoApuradoQuebraSequencia: false,
    indicadores: [
      { chave: "produtividade", tipo: "automatico", peso: 60, meta: 80, ativo: true },
      { chave: "apontamento_online", tipo: "automatico", peso: 40, meta: 50, ativo: true },
      { chave: "retrabalho", tipo: "manual", peso: 0, meta: null, ativo: true },
    ],
  };
  // Item de 100 h que já tinha 80 h; consultor 1 aponta 30 h (20 dentro, 10 acima), consultor 2 aponta 30 h (todas acima); consultor 3 só 5 h num item folgado.
  const itens: ItemNoCiclo[] = [
    { codemp: 1, codpro: 1, seqite: 1, vendido: h(100), executadoAntes: h(80), horas: [{ id: 1, codfor: 1, minutos: h(30) }, { id: 2, codfor: 2, minutos: h(30) }] },
    { codemp: 1, codpro: 2, seqite: 1, vendido: h(500), executadoAntes: 0, horas: [{ id: 3, codfor: 1, minutos: h(30) }, { id: 4, codfor: 3, minutos: h(5) }] },
  ];
  const online = new Map([
    [1, [{ minutos: h(60), origem: "ao_vivo" as const, atrasoDias: null }]],
    [2, [{ minutos: h(30), origem: "senior" as const, atrasoDias: 5 }]],
    [3, [{ minutos: h(5), origem: "ao_vivo" as const, atrasoDias: null }]],
  ]);
  const part = (id: number, base: number | null, consecutivos = 0) => ({ id, codfor: id, nome: `Consultor ${id}`, baseCentavos: base, consecutivosAntes: consecutivos });
  const r = montarPrevia(params, [part(1, 10000), part(2, 10000, 4), part(3, null)], itens, online);

  confere("global da área: 55 h dentro de 95 h (57,9%) abaixo da meta de 60%", [r.global.executadoMin, r.global.dentroMin, r.global.atingiu], [h(95), h(55), false]);
  const c1 = r.consultores[0], c2 = r.consultores[1], c3 = r.consultores[2];
  confere("consultor 1: 60 h, 50 h dentro (83,3%), meta 80% atingida", [c1.produtividade.horasMin, c1.produtividade.dentroMin, c1.produtividade.atingiu], [h(60), h(50), true]);
  confere("consultor 1: online 100% (60 de 60 h), meta 50% atingida", [c1.online.indice, c1.online.atingiu], [100, true]);
  confere("consultor 1: eficiência individual cumprida (todos os automáticos com base atingidos)", c1.eficienciaIndividual.cumpriu, true);
  confere("consultor 1 projeta 5% com global e 4% sem (base R$ 100,00, sem histórico)", [c1.projecao!.comGlobal.valorHoraCentavos, c1.projecao!.semGlobal.valorHoraCentavos], [10500, 10400]);
  confere("consultor 2 (todas as horas acima do orçado): produtividade 0%, meta não atingida, online 0%", [c2.produtividade.indice, c2.produtividade.atingiu, c2.online.indice], [0, false, 0]);
  confere("consultor 2 descumpre: o ciclo projeta zero e volta à base", [c2.projecao!.comGlobal.status, c2.projecao!.comGlobal.percentualBp, c2.projecao!.comGlobal.valorHoraCentavos], ["descumprido", 0, 10000]);
  confere("consultor 2 descumpriu: motivo é a eficiência individual", c2.projecao!.comGlobal.motivos, ["eficienciaIndividual"]);
  confere("consultor 3: amostra pequena (5 h) = sem base, não reprova", [c3.produtividade.semBase, c3.produtividade.atingiu, c3.online.semBase, c3.eficienciaIndividual.cumpriu], [true, null, true, null]);
  confere("consultor 3 sem Valor Hora Base: sem projeção em R$", c3.projecao, null);
  confere("requisitos do gestor ficam pendentes", c1.pendentes.slice(0, 4), ["competencias", "certificacoes", "avaliacaoClientes", "caseTecnico"]);

  // Meta global atingida muda só o 5º ponto, nunca derruba o ciclo.
  const ating = montarPrevia({ ...params, metaEficienciaGlobal: 50 }, [part(1, 10000, 2)], itens, online);
  confere("global atingido: o resultado 'com global' é o mesmo cenário pontuado", [ating.global.atingiu, ating.consultores[0].projecao!.comGlobal.percentualBp, ating.consultores[0].projecao!.semGlobal.percentualBp], [true, 600, 500]);
  confere("meta global ausente: não conclui, e o ciclo segue projetável", [montarPrevia({ ...params, metaEficienciaGlobal: null }, [part(1, 10000)], itens, online).global.atingiu], [null]);
  // Sem nenhum participante o global da ÁREA continua calculado.
  confere("sem participantes o global da área existe", montarPrevia(params, [], itens, online).global.executadoMin, h(95));
}

console.log(`${total - falhas}/${total} asserções ok`);
if (falhas > 0) process.exit(1);
