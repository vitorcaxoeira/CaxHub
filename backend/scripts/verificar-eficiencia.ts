// Verificação das funções puras do Painel de Eficiência (domain/eficienciaPropostas.ts), sem banco.
// Rodar: node_modules/.bin/ts-node scripts/verificar-eficiencia.ts   (nunca npx — trava no Windows)
// Os exemplos vêm da aba "Como calculamos" do Cockpit de Propostas do líder.
import {
  AlocacaoEntrada,
  ItemEntrada,
  PropostaEntrada,
  calcularClientes,
  calcularConsultores,
  calcularProposta,
  faixaDaProposta,
  faixasDeConsumo,
  indexarAlocacoes,
  montarAlertas,
  paretoDoEstouro,
  resumirCarteira,
} from "../src/domain/eficienciaPropostas";

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
const perto = (nome: string, obtido: number | null, esperado: number, casas = 3) =>
  confere(nome, obtido == null ? null : Number(obtido.toFixed(casas)), Number(esperado.toFixed(casas)));

let seq = 0;
function item(vendidoH: number, executadoH: number, extra: Partial<ItemEntrada> = {}): ItemEntrada {
  return { codemp: 1, codpro: 100, seqite: ++seq, descricao: "i", servico: null, depexe: 1, fatser: "S", vendido: h(vendidoH), valhor: 100, executado: h(executadoH), ...extra };
}
function proposta(itens: ItemEntrada[], extra: Partial<PropostaEntrada> = {}): PropostaEntrada {
  return { codemp: 1, codpro: 100, codcli: 10, cliente: "Cliente", sitpro: 7, sispro: 1, depexe: 1, interna: false, itens, ...extra };
}
const aloc = (it: ItemEntrada, codfor: number, alocadoH: number, executadoH: number): AlocacaoEntrada => ({
  codemp: it.codemp, codpro: it.codpro, seqite: it.seqite, codfor, alocado: h(alocadoH), executado: h(executadoH),
});
const calc = (p: PropostaEntrada, al: AlocacaoEntrada[] = [], vis: Set<number> | null = null) => calcularProposta(p, indexarAlocacoes(al), vis);

// 1. Eficiência: 120 h num item de 100 h = 83%.
{
  const p = calc(proposta([item(100, 120)]));
  perto("eficiência 120h em 100h", p.eficiencia, 100 / 120);
  confere("estouro 20h", p.acima, h(20));
  confere("dentro 100h", p.dentro, h(100));
  confere("situação do item", p.itens[0].situacao, "bad");
  confere("impacto = 20h × R$100", p.impacto, 2000);
}

// 2. Eficiência é item a item: item folgado NÃO compensa o estourado.
{
  const p = calc(proposta([item(100, 120), item(100, 10)]));
  perto("eficiência item a item", p.eficiencia, (100 + 10) / (120 + 10));
  confere("saldo só do item com saldo", p.saldo, h(90));
}

// 3. Situação do item: não iniciado / no prazo / perto do limite / estourado.
{
  const p = calc(proposta([item(100, 0), item(100, 79), item(100, 80), item(100, 100), item(100, 101)]));
  confere("situações dos itens", p.itens.map((i) => i.situacao), ["off", "ok", "warn", "warn", "bad"]);
}

// 4. Situação da proposta: estouro só a partir de 1 h; menos que isso é Atenção.
{
  confere("59 min acima = atenção", calc(proposta([item(100, 100 + 59 / 60)])).situacao, "warn");
  confere("60 min acima = estouro", calc(proposta([item(100, 101)])).situacao, "bad");
  confere("nada executado = off", calc(proposta([item(100, 0)])).situacao, "off");
  confere("tudo folgado = ok", calc(proposta([item(100, 10)])).situacao, "ok");
  confere("item perto do limite = atenção", calc(proposta([item(100, 90)])).situacao, "warn");
}

// 5. Crítico: 40 h ou mais acima, ou consumo >= 125%.
{
  confere("40h acima = crítico", calc(proposta([item(1000, 1040)])).critico, true);
  confere("39h59 acima, consumo baixo = não crítico", calc(proposta([item(1000, 1000 + 39 + 59 / 60)])).critico, false);
  confere("consumo 125% = crítico", calc(proposta([item(80, 100)])).critico, true);
  confere("consumo 124% = não crítico", calc(proposta([item(100, 124)])).critico, false);
}

// 6. Carga pendente = min(alocado − executado do consultor, saldo do item); o resto é "a revisar".
{
  const it = item(100, 50);
  const p = calc(proposta([it]), [aloc(it, 7, 100, 30)]);
  const c = p.itens[0].consultores[0];
  confere("pendente = min(70, saldo 50)", c.pendente, h(50));
  confere("a revisar = 70 − 50", c.revisar, h(20));
}

// 7. Item sem saldo: toda a alocação restante é "a revisar".
{
  const it = item(100, 120);
  const c = calc(proposta([it]), [aloc(it, 7, 100, 90)]).itens[0].consultores[0];
  confere("sem saldo: pendente 0", c.pendente, 0);
  confere("sem saldo: revisar 10h", c.revisar, h(10));
}

// 8. Sem consultor alocado = executado do item − Σ executado dos alocados (nunca negativo).
{
  const it = item(200, 100);
  const p = calc(proposta([it]), [aloc(it, 1, 80, 40), aloc(it, 2, 80, 20)]);
  confere("sem alocação = 100 − 60", p.itens[0].semAlocacao, h(40));
  const it2 = item(200, 50);
  confere("alocados executaram mais que o item: 0", calc(proposta([it2]), [aloc(it2, 1, 80, 60)]).itens[0].semAlocacao, 0);
}

// 9. Várias alocações do mesmo consultor no item = uma linha, somada.
{
  const it = item(200, 100);
  const consultores = calc(proposta([it]), [aloc(it, 5, 40, 10), aloc(it, 5, 60, 30)]).itens[0].consultores;
  confere("uma linha por consultor", consultores.length, 1);
  confere("alocado somado", consultores[0].alocado, h(100));
  confere("executado somado", consultores[0].executado, h(40));
}

// 10. Time do gestor: quem está fora vira "outros" (sem nome) e não entra nas linhas nem na carga,
//     mas o "sem consultor alocado" continua contando TODAS as alocações.
{
  const it = item(200, 100);
  const p = calc(proposta([it]), [aloc(it, 1, 80, 40), aloc(it, 2, 80, 20)], new Set([1]));
  confere("só o consultor visível aparece", p.itens[0].consultores.map((c) => c.codfor), [1]);
  confere("o outro vira 'outros'", p.itens[0].outros, { alocado: h(80), executado: h(20) });
  confere("sem alocação inalterado pelo recorte", p.itens[0].semAlocacao, h(40));
  const cons = calcularConsultores([p], h(120));
  confere("equipe só com o time", cons.map((c) => c.codfor), [1]);
}

// 11. Eficiência do consultor = executado dentro da alocação ÷ executado; meses = pendente ÷ capacidade.
{
  const a = item(500, 100), b = item(500, 100);
  const p = calc(proposta([a, b]), [aloc(a, 9, 50, 70), aloc(b, 9, 200, 30)]);
  const [c] = calcularConsultores([p], h(120));
  perto("eficiência do consultor", c.eficiencia, (50 + 30) / (70 + 30));
  confere("pendente = 170 (b) + 0 (a)", c.pendente, h(170));
  perto("meses de carteira", c.meses, 170 / 120);
}

// 12. Faixas de consumo (fronteiras inclusivas no limite superior) e proposta sem vendido.
{
  const mk = (v: number, e: number) => calc(proposta([item(v, e)]));
  confere("0% = não iniciada", faixaDaProposta(mk(100, 0)), "naoini");
  confere("50% = b1", faixaDaProposta(mk(100, 50)), "b1");
  confere("80% = b2", faixaDaProposta(mk(100, 80)), "b2");
  confere("100% = b3", faixaDaProposta(mk(100, 100)), "b3");
  confere("150% = b4", faixaDaProposta(mk(100, 150)), "b4");
  confere("151% = b5", faixaDaProposta(mk(100, 151)), "b5");
  confere("vendido 0 com execução = b5", faixaDaProposta(mk(0, 10)), "b5");
  const f = faixasDeConsumo([mk(100, 0), mk(100, 100), mk(100, 200)]);
  confere("contagem por faixa", f.map((x) => x.propostas), [1, 0, 0, 1, 0, 1]);
}

// 13. Pareto: acumulado e concentração do top 3.
{
  const ps = [
    calc(proposta([item(100, 200)], { codpro: 1 })), // +100
    calc(proposta([item(100, 150)], { codpro: 2 })), // +50
    calc(proposta([item(100, 130)], { codpro: 3 })), // +30
    calc(proposta([item(100, 120)], { codpro: 4 })), // +20
  ];
  const { linhas, top3 } = paretoDoEstouro(ps);
  confere("ordem do pareto", linhas.map((l) => l.codpro), [1, 2, 3, 4]);
  perto("acumulado 1ª", linhas[0].acumulado, 100 / 200);
  perto("acumulado 3ª", linhas[2].acumulado, 180 / 200);
  perto("concentração top 3", top3, 180 / 200);
}

// 14. Clientes: agrega propostas do mesmo codcli.
{
  const ps = [
    calc(proposta([item(100, 150)], { codpro: 1, codcli: 10 })),
    calc(proposta([item(100, 10)], { codpro: 2, codcli: 10 })),
    calc(proposta([item(100, 50)], { codpro: 3, codcli: 20 })),
  ];
  const cl = calcularClientes(ps).sort((a, b) => a.codcli - b.codcli);
  confere("2 clientes", cl.length, 2);
  confere("cliente 10: 2 propostas, 1 com estouro", [cl[0].propostas, cl[0].propostasComEstouro], [2, 1]);
  confere("cliente 10: vendido 200h, executado 160h", [cl[0].vendido, cl[0].executado], [h(200), h(160)]);
  perto("cliente 10: eficiência = (100+10)/160", cl[0].eficiencia, 110 / 160);
}

// 15. Resumo e alertas: estouro crítico e capacidade aparecem, ordenados por impacto.
{
  const it = item(1000, 1100);
  const p = calc(proposta([it], { codpro: 77 }), [aloc(it, 3, 2000, 1100)]); // a alocação explica toda a execução
  const cons = calcularConsultores([p], h(120));
  const r = resumirCarteira([p]);
  confere("resumo: estouro 100h", r.acima, h(100));
  const nomes = new Map([[3, "Fulano"]]);
  const al = montarAlertas([p], cons, nomes);
  confere("alerta crítico primeiro", [al[0].rotulo, al[0].severidade], ["Crítico", "bad"]);
  confere("alerta aponta a proposta", al[0].alvo, { tipo: "proposta", codemp: 1, codpro: 77 });
}

// 16. Caso real do cockpit (PS 8249, item 12 "Fechamento de custo", minutos no HTML): 3600 vendidos, 7617 executados.
{
  const it = item(0, 0, { vendido: 3600, executado: 7617, valhor: null });
  const p = calc(proposta([it]));
  confere("PS 8249 item 12: acima = 4017 min", p.itens[0].acima, 4017);
  perto("PS 8249 item 12: eficiência = 3600/7617", p.itens[0].dentro / p.itens[0].executado, 3600 / 7617);
  confere("sem valor-hora: impacto 0", p.impacto, 0);
}

console.log(`${total - falhas}/${total} asserções ok`);
if (falhas > 0) process.exit(1);
