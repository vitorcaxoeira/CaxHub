// Verificação das funções puras do Painel de Eficiência (domain/eficienciaPropostas.ts), sem banco.
// Rodar: node_modules/.bin/ts-node scripts/verificar-eficiencia.ts   (nunca npx — trava no Windows)
// Os exemplos vêm da aba "Como calculamos" do Cockpit de Propostas do líder.
import {
  AlocacaoEntrada,
  ItemEntrada,
  PropostaEntrada,
  LIMIARES,
  calcularClientes,
  calcularConsultores,
  calcularProposta,
  modoEstouroValido,
  ehAtipica,
  faixaDaProposta,
  faixasDeConsumo,
  indexarAlocacoes,
  montarAlertas,
  ordenarAlertas,
  paretoDoEstouro,
  resumirCarteira,
} from "../src/domain/eficienciaPropostas";
import { financeiroDaProposta, financeiroPorCliente, resumirFinanceiro } from "../src/domain/eficienciaFinanceiro";
import { aplicarIgnorados, lerIgnoradosNaProposta, propostasComConsultorIgnorado, semIgnorados } from "../src/domain/eficienciaIgnorados";
import { MOTIVOS_EXCLUSAO, descontarExcluido, rotuloMotivoExclusao, validarExclusao } from "../src/domain/eficienciaExclusoes";
import {
  contarAcoes,
  dataIsoValida,
  estaAtrasada,
  filtroAcoesValido,
  hojeIso,
  passaFiltroAcao,
  rotuloStatusAcao,
  somarDiasUteis,
  validarEdicaoAcao,
  validarNovaAcao,
  validarStatus,
} from "../src/domain/eficienciaAcoes";

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
  return { codemp: 1, codpro: 100, codcli: 10, cliente: "Cliente", sitpro: 7, modpro: 1, depexe: 1, interna: false, itens, ...extra };
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

// 10b. Consultor ignorado pela pessoa: mesmo efeito de sair do recorte (vira "outros"), mas SÓ nas contas de equipe.
//      Vendido, executado, estouro e "sem alocação" da proposta não mudam; vale também sem recorte de time (admin).
{
  const it = item(200, 100);
  const al = [aloc(it, 1, 80, 40), aloc(it, 2, 80, 20)];
  const base = calc(proposta([it]), al);
  const ign = calcularProposta(proposta([it]), indexarAlocacoes(al), null, new Set([2]));
  confere("ignorado some das linhas da equipe", ign.itens[0].consultores.map((c) => c.codfor), [1]);
  confere("ignorado vira 'outros'", ign.itens[0].outros, { alocado: h(80), executado: h(20) });
  confere("executado da proposta inalterado", ign.executado, base.executado);
  confere("estouro da proposta inalterado", ign.acima, base.acima);
  confere("sem alocação inalterado", ign.semAlocacao, base.semAlocacao);
  confere("eficiência da proposta inalterada", ign.eficiencia, base.eficiencia);
  confere("equipe sem o ignorado", calcularConsultores([ign], h(120)).map((c) => c.codfor), [1]);
  const juntos = calcularProposta(proposta([it]), indexarAlocacoes(al), new Set([1, 2]), new Set([2]));
  confere("recorte de time + ignorado se somam (sai de quem falta nos dois)", juntos.itens[0].consultores.map((c) => c.codfor), [1]);
  confere("ignorado vazio = sem efeito", calcularProposta(proposta([it]), indexarAlocacoes(al), null, new Set()).itens[0].consultores.map((c) => c.codfor), [1, 2]);
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
  confere("alerta traz a ação sugerida para o Plano de ação", al[0].acaoSugerida, "Alinhar aditivo ou replanejamento da PS 77 com o cliente");
  confere("alerta de capacidade sugere redistribuir com o nome do consultor", montarAlertas([p], [{ ...cons[0], meses: 5 }], nomes).find((x) => x.rotulo === "Capacidade")?.acaoSugerida, "Redistribuir parte da carteira de Fulano");
  confere("ordenarAlertas: crítico primeiro, depois peso", ordenarAlertas([{ ...al[0], severidade: "warn", peso: 9 }, { ...al[0], severidade: "bad", peso: 1 }, { ...al[0], severidade: "warn", peso: 50 }]).map((x) => `${x.severidade}${x.peso}`), ["bad1", "warn50", "warn9"]);
}

// 16. Caso real do cockpit (PS 8249, item 12 "Fechamento de custo", minutos no HTML): 3600 vendidos, 7617 executados.
{
  const it = item(0, 0, { vendido: 3600, executado: 7617, valhor: null });
  const p = calc(proposta([it]));
  confere("PS 8249 item 12: acima = 4017 min", p.itens[0].acima, 4017);
  perto("PS 8249 item 12: eficiência = 3600/7617", p.itens[0].dentro / p.itens[0].executado, 3600 / 7617);
  confere("sem valor-hora: impacto 0", p.impacto, 0);
}

// 17. Proposta atípica: consumo >= 300% E >= 200 h acima. Bordas inclusivas; sem vendido e com execução conta como acima do limite.
{
  const mk = (v: number, e: number, codpro = 1) => calc(proposta([item(v, e)], { codpro }));
  confere("consumo 300% e 200h acima = atípica", ehAtipica(mk(100, 300)), true); // acima = 200 h exatas
  confere("consumo 299% = não atípica", ehAtipica(mk(100, 299)), false);
  confere("consumo alto mas 199h59 acima = não atípica", ehAtipica(calc(proposta([item(0, 0, { vendido: 60, executado: 60 + 11999 })]))), false);
  confere("500% e 400h acima = atípica", ehAtipica(mk(100, 500)), true);
  confere("200% e 500h acima = não atípica (consumo baixo)", ehAtipica(mk(500, 1000)), false);
  confere("sem vendido e 300h executadas = atípica", ehAtipica(calc(proposta([item(0, 300)]))), true);
  confere("nada executado = não atípica", ehAtipica(mk(100, 0)), false);
  confere("filtra atípicas de uma lista preservando a ordem", [mk(100, 500, 1), mk(100, 120, 2), mk(100, 400, 3)].filter(ehAtipica).map((p) => p.codpro), [1, 3]);
  confere("limiares expostos", [LIMIARES.atipicaConsumo, LIMIARES.atipicaAcimaMin], [3, 12000]);
}

// 18. Exclusão de apontamento do cálculo: validação do corpo (motivo da lista fechada; "Outro" exige observação).
{
  const v = (corpo: unknown) => validarExclusao(corpo);
  confere("corpo vazio/ausente = recusa", [v(undefined).ok, v({}).ok, v(null).ok, v("x").ok], [false, false, false, false]);
  confere("motivo fora da lista = recusa", v({ motivo: "porque_sim" }).ok, false);
  const t = v({ motivo: "treinamento" });
  confere("treinamento sem observação = ok, observação nula", t.ok && t.observacao === null && t.motivo === "treinamento", true);
  confere("retrabalho e indevido sem observação = ok", [v({ motivo: "retrabalho" }).ok, v({ motivo: "indevido" }).ok], [true, true]);
  confere('"outro" sem observação ou só com espaços = recusa', [v({ motivo: "outro" }).ok, v({ motivo: "outro", observacao: "   " }).ok], [false, false]);
  const o = v({ motivo: "outro", observacao: "  conferido com o cliente  " });
  confere('"outro" com observação = ok e aparada', o.ok && o.observacao === "conferido com o cliente", true);
  confere("observação de 300 = ok, de 301 = recusa", [v({ motivo: "indevido", observacao: "x".repeat(300) }).ok, v({ motivo: "indevido", observacao: "x".repeat(301) }).ok], [true, false]);
  confere("observação que não é texto = recusa", v({ motivo: "indevido", observacao: 123 }).ok, false);
  confere("lista fechada tem os 4 motivos do cockpit", MOTIVOS_EXCLUSAO.map((m) => m.chave), ["treinamento", "retrabalho", "indevido", "outro"]);
  confere("rótulo do motivo; chave desconhecida volta como veio", [rotuloMotivoExclusao("retrabalho"), rotuloMotivoExclusao("zzz")], ["Retrabalho interno (não cobrar)", "zzz"]);
  // O realizado do consultor (compartilhado) não conhece a exclusão do painel: desconta-se depois, sem ficar negativo.
  confere("desconta o excluído do realizado", descontarExcluido(600, 120), 480);
  confere("excluído maior que o realizado não fica negativo", descontarExcluido(60, 120), 0);
  confere("excluído negativo é ignorado", descontarExcluido(600, -30), 600);
  confere("nada excluído = realizado intacto", descontarExcluido(600, 0), 600);
}

// 19. Plano de ação: "hoje" em São Paulo, datas, validações, atraso e contagens.
{
  // O servidor pode estar em UTC: 01:00 UTC ainda é a noite do dia anterior em São Paulo.
  confere("hoje em SP: 01:00 UTC é o dia anterior", hojeIso(new Date("2026-10-14T01:00:00Z")), "2026-10-13");
  confere("hoje em SP: meio-dia UTC é o mesmo dia", hojeIso(new Date("2026-10-14T12:00:00Z")), "2026-10-14");
  confere("data válida / inválida", [dataIsoValida("2026-02-28"), dataIsoValida("2026-02-31"), dataIsoValida("26-01-01"), dataIsoValida("1999-12-31"), dataIsoValida("2101-01-01"), dataIsoValida(null), dataIsoValida("2024-02-29")], [true, false, false, false, false, false, true]);
  // 2026-10-14 é quarta-feira.
  confere("5 dias úteis a partir da quarta = quarta seguinte", somarDiasUteis("2026-10-14", 5), "2026-10-21");
  confere("sexta + 1 dia útil = segunda", somarDiasUteis("2026-10-16", 1), "2026-10-19");
  confere("sábado + 1 dia útil = segunda", somarDiasUteis("2026-10-17", 1), "2026-10-19");

  const HOJE = "2026-10-14";
  const ok = { titulo: "  Redistribuir carga  ", responsavelCodfor: 7, prazo: "2026-10-20" };
  const a = validarNovaAcao(ok, HOJE);
  confere("ação válida: título aparado, opcionais nulos", a.ok && a.dados.titulo === "Redistribuir carga" && a.dados.observacao === null && a.dados.codemp === null && a.dados.origemAlerta === null, true);
  confere("sem título / título em branco = recusa", [validarNovaAcao({ ...ok, titulo: undefined }, HOJE).ok, validarNovaAcao({ ...ok, titulo: "   " }, HOJE).ok], [false, false]);
  confere("título de 200 = ok, de 201 = recusa", [validarNovaAcao({ ...ok, titulo: "x".repeat(200) }, HOJE).ok, validarNovaAcao({ ...ok, titulo: "x".repeat(201) }, HOJE).ok], [true, false]);
  confere("sem responsável / responsável inválido = recusa", [validarNovaAcao({ ...ok, responsavelCodfor: undefined }, HOJE).ok, validarNovaAcao({ ...ok, responsavelCodfor: -3 }, HOJE).ok, validarNovaAcao({ ...ok, responsavelCodfor: 1.5 }, HOJE).ok], [false, false, false]);
  confere("prazo ausente / inválido / no passado = recusa", [validarNovaAcao({ ...ok, prazo: undefined }, HOJE).ok, validarNovaAcao({ ...ok, prazo: "2026-02-31" }, HOJE).ok, validarNovaAcao({ ...ok, prazo: "2026-10-13" }, HOJE).ok], [false, false, false]);
  confere("prazo hoje = ok", validarNovaAcao({ ...ok, prazo: HOJE }, HOJE).ok, true);
  confere("proposta só com metade do par = recusa; par completo = ok", [validarNovaAcao({ ...ok, codemp: 1 }, HOJE).ok, validarNovaAcao({ ...ok, codemp: 1, codpro: 8000 }, HOJE).ok], [false, true]);
  confere("observação de 1000 = ok, de 1001 = recusa", [validarNovaAcao({ ...ok, observacao: "x".repeat(1000) }, HOJE).ok, validarNovaAcao({ ...ok, observacao: "x".repeat(1001) }, HOJE).ok], [true, false]);

  const e1 = validarEdicaoAcao({});
  const e2 = validarEdicaoAcao({ observacao: null });
  const e3 = validarEdicaoAcao({ prazo: "2026-13-01" });
  confere("edição vazia = recusa; limpar observação = ok; prazo inválido = recusa", [e1.ok, e2.ok && e2.dados.observacao === null, e3.ok], [false, true, false]);
  confere("edição aceita só o que veio", (() => { const e = validarEdicaoAcao({ titulo: "Novo", prazo: "2026-11-01" }); return e.ok && Object.keys(e.dados).sort().join() === "prazo,titulo"; })(), true);
  confere("status: válidos e inválido", [validarStatus({ status: "andamento" }).ok, validarStatus({ status: "concluida" }).ok, validarStatus({ status: "feito" }).ok, validarStatus(null).ok], [true, true, false, false]);

  // Atraso e contagens (hoje = 2026-10-14; limite de 5 dias úteis = 2026-10-21).
  const acoes = [
    { status: "aberta", prazo: "2026-10-13" }, // atrasada
    { status: "andamento", prazo: "2026-10-01" }, // atrasada
    { status: "aberta", prazo: "2026-10-14" }, // vence hoje: não está atrasada
    { status: "aberta", prazo: "2026-10-21" }, // último dia da janela
    { status: "aberta", prazo: "2026-10-22" }, // fora da janela
    { status: "concluida", prazo: "2026-09-01" }, // concluída antiga: nunca atrasada
  ];
  confere("atraso: vence hoje não é atraso; concluída nunca é", [estaAtrasada(acoes[2], HOJE), estaAtrasada(acoes[0], HOJE), estaAtrasada(acoes[5], HOJE)], [false, true, false]);
  confere("contagens", contarAcoes(acoes, HOJE), { abertas: 5, atrasadas: 2, concluidas: 1, todas: 6, vencemEm5DiasUteis: 2 });
  confere("filtros", (["abertas", "atrasadas", "concluidas", "todas"] as const).map((f) => acoes.filter((x) => passaFiltroAcao(x, f, HOJE)).length), [5, 2, 1, 6]);
  confere("filtro desconhecido volta a 'abertas'", [filtroAcoesValido("xyz"), filtroAcoesValido(undefined), filtroAcoesValido("atrasadas")], ["abertas", "abertas", "atrasadas"]);
  confere("rótulos de status", [rotuloStatusAcao("aberta"), rotuloStatusAcao("andamento"), rotuloStatusAcao("concluida")], ["Aberta", "Em andamento", "Concluída"]);
}

// 20. Ignorar DENTRO da proposta (gaveta): item sai da proposta; consultor tem as horas dele tiradas do executado dos itens e a alocação
//     dele naquela proposta sai da equipe. A função não altera a entrada.
{
  const a = item(100, 150), b = item(200, 60);
  a.seqite = 1;
  b.seqite = 2;
  const prop = proposta([a, b]);
  const al = [aloc(a, 1, 100, 90), aloc(a, 2, 60, 60), aloc(b, 1, 100, 60)];
  const dados = { propostas: [prop], alocacoes: al, nomes: new Map(), departamentos: new Map() };
  const calcDados = (d: typeof dados, vis: Set<number> | null = null) => calcularProposta(d.propostas[0], indexarAlocacoes(d.alocacoes), vis);

  const lido = lerIgnoradosNaProposta({ ignorarItem: "1:100:2,1:100:2,abc,1:100,1:100:x", ignorarConsultorProposta: "1:100:1, 1:100:9:9 ,9:9:9" });
  confere("leitura: repetido/lixo descartado", [[...lido.itens], [...lido.consultores]], [["1-100-2"], ["1-100-1", "9-9-9"]]);
  confere("propostas com consultor ignorado", propostasComConsultorIgnorado(lido), [{ codemp: 1, codpro: 100 }, { codemp: 9, codpro: 9 }]);
  confere("sem nada ignorado devolve os mesmos dados", aplicarIgnorados(dados, semIgnorados(), []).dados === dados, true);

  // item ignorado
  const ignItem = { itens: new Set(["1-100-2"]), consultores: new Set<string>() };
  const r1 = aplicarIgnorados(dados, ignItem, []);
  const p1 = calcDados(r1.dados);
  confere("item ignorado: vendido sai", p1.vendido, h(100));
  confere("item ignorado: executado sai", p1.executado, h(150));
  confere("item ignorado: só o item que sobrou", p1.itens.map((i) => i.seqite), [1]);
  confere("item ignorado: alocação dele sai da equipe", r1.dados.alocacoes.length, 2);
  confere("item ignorado: contagem efetiva", r1.efetivos, { itens: 1, consultores: 0 });
  confere("entrada intacta (itens)", dados.propostas[0].itens.length, 2);
  confere("entrada intacta (alocações)", dados.alocacoes.length, 3);

  // consultor ignorado: 1 apontou 90 h no item 1 e 60 h no item 2
  const exec = [
    { codemp: 1, codpro: 100, seqite: 1, codfor: 1, minutos: h(90) },
    { codemp: 1, codpro: 100, seqite: 2, codfor: 1, minutos: h(60) },
    { codemp: 1, codpro: 100, seqite: 1, codfor: 2, minutos: h(60) },
  ];
  const ignCons = { itens: new Set<string>(), consultores: new Set(["1-100-1"]) };
  const r2 = aplicarIgnorados(dados, ignCons, exec);
  const p2 = calcDados(r2.dados);
  confere("consultor ignorado: executado dos itens perde as horas dele", p2.itens.map((i) => i.executado), [h(60), 0]);
  confere("consultor ignorado: executado da proposta", p2.executado, h(60));
  confere("consultor ignorado: vendido não muda", p2.vendido, h(300));
  confere("consultor ignorado: estouro some (item 1 passou a 60h dentro de 100h)", p2.acima, 0);
  confere("consultor ignorado: a alocação dele sai da equipe", r2.dados.alocacoes.map((x) => x.codfor), [2]);
  confere("consultor ignorado: não vira 'sem alocação' (o executado dele saiu junto)", p2.semAlocacao, 0);
  confere("consultor ignorado: contagem efetiva", r2.efetivos, { itens: 0, consultores: 1 });
  confere("consultor sem horas nem alocação não conta como efetivo", aplicarIgnorados(dados, { itens: new Set(), consultores: new Set(["1-100-77"]) }, exec).efetivos.consultores, 0);
  confere("entrada intacta (executado do item)", dados.propostas[0].itens[0].executado, h(150));

  // os dois juntos: item 2 ignorado + consultor 1 ignorado => só sobra o item 1 sem as horas do consultor 1
  const r3 = aplicarIgnorados(dados, { itens: new Set(["1-100-2"]), consultores: new Set(["1-100-1"]) }, exec);
  const p3 = calcDados(r3.dados);
  confere("item e consultor ignorados juntos", [p3.vendido, p3.executado, r3.dados.alocacoes.map((x) => x.codfor)], [h(100), h(60), [2]]);
  // arredondamento: nunca fica negativo
  const r4 = aplicarIgnorados(dados, ignCons, [{ codemp: 1, codpro: 100, seqite: 2, codfor: 1, minutos: h(999) }]);
  confere("executado nunca fica negativo", calcDados(r4.dados).itens[1].executado, 0);
  // com recorte de time (visiveis) continua valendo
  confere("recorte de time + consultor ignorado", calcDados(r2.dados, new Set([2])).itens[0].consultores.map((c) => c.codfor), [2]);
}

// 21. Modo de estouro: "item" soma o estouro de cada item; "proposta" olha só o total (o saldo de um item compensa o estouro de outro).
{
  const a = item(100, 180), b = item(100, 50);
  const prop = proposta([a, b]);
  const calcM = (p: PropostaEntrada, modo: "item" | "proposta") => calcularProposta(p, indexarAlocacoes([]), null, null, modo);
  const pi = calcM(prop, "item");
  const pg = calcM(prop, "proposta");
  confere("por item: estouro = soma dos itens (80h)", [pi.acima, pi.dentro, pi.saldo], [h(80), h(100) + h(50), h(50)]);
  confere("pela proposta: estouro = executado − vendido (30h)", [pg.acima, pg.dentro, pg.saldo], [h(30), h(200), 0]);
  confere("vendido e executado não mudam de modo", [pg.vendido, pg.executado], [pi.vendido, pi.executado]);
  confere("os dois estouros ficam sempre disponíveis", [pi.acimaPorItem, pi.acimaGlobal, pg.acimaPorItem, pg.acimaGlobal], [h(80), h(30), h(80), h(30)]);
  confere("impacto por item (80h × R$100) e pela proposta (30h × valor-hora médio R$100)", [pi.impacto, pg.impacto], [8000, 3000]);
  perto("eficiência por item (150/230) e pela proposta (200/230)", pi.eficiencia, 150 / 230);
  perto("eficiência pela proposta", pg.eficiencia, 200 / 230);
  confere("os itens seguem estourados nos dois modos (por item não muda)", [pi.itens[0].acima, pg.itens[0].acima], [h(80), h(80)]);

  // item estourado COMPENSADO pelo saldo de outro: pela proposta não é estouro (Atenção), por item é
  const c1 = item(100, 120), c2 = item(100, 40);
  const comp = proposta([c1, c2]);
  confere("compensado, por item: Estouro", calcM(comp, "item").situacao, "bad");
  confere("compensado, pela proposta: Atenção (item estourado, mas a proposta tem saldo)", [calcM(comp, "proposta").situacao, calcM(comp, "proposta").acima, calcM(comp, "proposta").critico], ["warn", 0, false]);

  // valor-hora médio ponderado pelas horas vendidas
  const d1 = item(100, 150, { valhor: 100 }), d2 = item(100, 100, { valhor: 300 });
  const medio = calcM(proposta([d1, d2]), "proposta");
  confere("impacto pela proposta usa o valor-hora MÉDIO (R$200): 50h × 200", [medio.acimaGlobal, medio.impacto], [h(50), 10000]);
  confere("sem valor-hora nenhum, o impacto pela proposta é zero (e fica em Qualidade)", calcM(proposta([item(100, 150, { valhor: null })]), "proposta").impacto, 0);
  confere("sem vendido e com execução: tudo é estouro nos dois modos", [calcM(proposta([item(0, 10)]), "item").acima, calcM(proposta([item(0, 10)]), "proposta").acima], [h(10), h(10)]);
  confere("modo desconhecido volta a 'item'", [modoEstouroValido("xyz"), modoEstouroValido(undefined), modoEstouroValido("proposta")], ["item", "item", "proposta"]);
  confere("carteira herda o modo (soma das propostas)", [resumirCarteira([pi]).acima, resumirCarteira([pg]).acima], [h(80), h(30)]);
  confere("cliente herda o modo", [calcularClientes([pi])[0].acima, calcularClientes([pg])[0].acima], [h(80), h(30)]);
}

// 22. Eficiência financeira: base = valor-hora de venda do item (R$), não faturamento nem custo.
{
  const a = item(100, 150, { valhor: 100 }), b = item(100, 50, { valhor: 300 });
  const prop = proposta([a, b]);
  const pi = calcularProposta(prop, indexarAlocacoes([]), null, null, "item");
  const f = financeiroDaProposta(pi);
  confere("valor vendido/executado ao valor-hora do item", [f.valorVendido, f.valorExecutado], [40000, 30000]);
  confere("valor acima = impacto (50h × R$100) e dentro = executado − acima", [f.valorAcima, f.valorDentro], [5000, 25000]);
  confere("dentro + acima = executado", f.valorDentro + f.valorAcima, f.valorExecutado);
  perto("eficiência financeira = dentro ÷ executado", f.eficiencia, 25000 / 30000);
  perto("eficiência em HORAS é outra (150/200): item caro pesa diferente", pi.eficiencia, 150 / 200);
  confere("a financeira difere da de horas", Math.abs((f.eficiencia ?? 0) - (pi.eficiencia ?? 0)) > 0.05, true);
  perto("consumo financeiro", f.consumo, 30000 / 40000);
  confere("saldo em R$ (50h do item de R$300)", f.valorSaldo, 15000);
  confere("receita por hora executada (25000 ÷ 200h) e valor-hora vendido (40000 ÷ 200h)", [f.receitaPorHora, f.valorHoraVendido], [125, 200]);
  // pela proposta: 200h executadas = 200h vendidas -> nada acima
  const pg = calcularProposta(prop, indexarAlocacoes([]), null, null, "proposta");
  const fg = financeiroDaProposta(pg);
  confere("pela proposta: sem estouro global, eficiência financeira 100%", [fg.valorAcima, fg.valorDentro, fg.eficiencia], [0, 30000, 1]);
  confere("pela proposta: saldo em R$ = vendido − executado", fg.valorSaldo, 10000);
  // itens sem faturamento entram no valor, mas são apontados à parte
  const semFat = proposta([item(10, 5, { valhor: 100, fatser: "N" }), item(10, 5, { valhor: 100, fatser: "A" })]);
  confere("valor vendido em itens sem faturamento (N) separado; Antecipado conta como faturável", [calcularProposta(semFat, indexarAlocacoes([]), null).valorSemFaturamento, calcularProposta(semFat, indexarAlocacoes([]), null).valorVendido], [1000, 2000]);
  // item sem valor-hora: valor zero, não quebra
  const sv = financeiroDaProposta(calcularProposta(proposta([item(10, 20, { valhor: null })]), indexarAlocacoes([]), null));
  confere("item sem valor-hora: valores zerados, eficiência indefinida", [sv.valorVendido, sv.valorExecutado, sv.eficiencia], [0, 0, null]);
  // nada executado
  const nada = financeiroDaProposta(calcularProposta(proposta([item(10, 0, { valhor: 100 })]), indexarAlocacoes([]), null));
  confere("nada executado: eficiência null, consumo 0, receita/h null", [nada.eficiencia, nada.consumo, nada.receitaPorHora], [null, 0, null]);
  // carteira e clientes somam as propostas
  const p2 = calcularProposta(proposta([item(100, 100, { valhor: 200 })], { codpro: 101, codcli: 10 }), indexarAlocacoes([]), null);
  const r = resumirFinanceiro([pi, p2]);
  confere("carteira soma o valor das propostas", [r.valorVendido, r.valorExecutado], [40000 + 20000, 30000 + 20000]);
  const cli = financeiroPorCliente([pi, p2]);
  confere("clientes: uma linha por cliente, com a soma", [cli.length, cli[0].propostas, cli[0].valorVendido], [1, 2, 60000]);
}

console.log(`${total - falhas}/${total} asserções ok`);
if (falhas > 0) process.exit(1);
