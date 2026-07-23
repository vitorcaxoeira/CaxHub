import { describe, expect, it } from "vitest";
import {
  achatarArvore,
  agregarHoras,
  calcularOrcamentoItem,
  derivarStatus,
  descreverSaldoDistribuicao,
  estadoAlertaItem,
  filtrarPreservandoAncestrais,
  formatHorasCompacto,
  larguraHorasProposta,
  NoCronograma,
  orcamentoDeTotais,
  projetarSaldo,
  somarDistribuidas,
  somarOrcamentos,
  somarRealizadas,
} from "./cronograma";

function no(parcial: Partial<NoCronograma> & Pick<NoCronograma, "id" | "tipo" | "nome">): NoCronograma {
  return {
    parentId: null,
    ordem: 0,
    horasPrevistas: null,
    horasRealizadas: 0,
    responsavelCodfor: null,
    predecessoraId: null,
    statusManual: null,
    ...parcial,
  };
}

// Mesma estrutura da imagem do legado, simplificada:
// Item 1
// ├─ Pasta 2 "Levantamento"
// │  └─ Atividade 3 "Mapeamento" (8h, concluída)
// └─ Pasta 4 "Cadastros"
//    ├─ Atividade 5 "Cadastro Clientes" (4h, em curso)
//    └─ Atividade 6 "Cadastro Fornecedores" (3h, não iniciada, predecessora = 5)
function arvoreExemplo(): NoCronograma[] {
  return [
    no({ id: 1, tipo: "item", nome: "Item", ordem: 0 }),
    no({ id: 2, tipo: "pasta", nome: "Levantamento", parentId: 1, ordem: 0 }),
    no({ id: 3, tipo: "atividade", nome: "Mapeamento", parentId: 2, ordem: 0, horasPrevistas: 480, statusManual: "concluida" }),
    no({ id: 4, tipo: "pasta", nome: "Cadastros", parentId: 1, ordem: 1 }),
    no({ id: 5, tipo: "atividade", nome: "Cadastro Clientes", parentId: 4, ordem: 0, horasPrevistas: 240, statusManual: "em_curso" }),
    no({
      id: 6,
      tipo: "atividade",
      nome: "Cadastro Fornecedores",
      parentId: 4,
      ordem: 1,
      horasPrevistas: 180,
      statusManual: "nao_iniciada",
      predecessoraId: 5,
    }),
  ];
}

describe("achatarArvore", () => {
  it("percorre em pré-ordem respeitando `ordem` entre irmãos, com a profundidade certa", () => {
    const achatada = achatarArvore(arvoreExemplo());
    expect(achatada.map((n) => [n.id, n.profundidade])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 1],
      [5, 2],
      [6, 2],
    ]);
  });

  it("retorna lista vazia pra árvore vazia", () => {
    expect(achatarArvore([])).toEqual([]);
  });
});

describe("filtrarPreservandoAncestrais", () => {
  it("mantém visíveis os ancestrais de um nó que bateu no predicado", () => {
    const visiveis = filtrarPreservandoAncestrais(arvoreExemplo(), (n) => n.nome === "Cadastro Clientes");
    expect(visiveis).toEqual(new Set([1, 4, 5]));
  });

  it("some com ramos que não têm nenhum match", () => {
    const visiveis = filtrarPreservandoAncestrais(arvoreExemplo(), (n) => n.nome === "Mapeamento");
    expect(visiveis.has(4)).toBe(false);
    expect(visiveis.has(5)).toBe(false);
    expect(visiveis.has(6)).toBe(false);
  });

  it("sem nenhum match, não mostra nada", () => {
    const visiveis = filtrarPreservandoAncestrais(arvoreExemplo(), () => false);
    expect(visiveis.size).toBe(0);
  });
});

describe("agregarHoras", () => {
  it("soma recursivamente as horas das atividades descendentes em pasta/item", () => {
    const agregados = agregarHoras(arvoreExemplo());
    expect(agregados.get(1)?.horasPrevistas).toBe(480 + 240 + 180);
    expect(agregados.get(2)?.horasPrevistas).toBe(480);
    expect(agregados.get(4)?.horasPrevistas).toBe(240 + 180);
  });

  it("atividade agrega o próprio valor (tratando null como 0)", () => {
    const nos = [no({ id: 1, tipo: "atividade", nome: "Sem duração", horasPrevistas: null })];
    expect(agregarHoras(nos).get(1)).toEqual({ horasPrevistas: 0, horasRealizadas: 0, avanco: 0 });
  });

  it("guarda contra divisão por zero quando horasPrevistas agregadas é 0", () => {
    const nos = [no({ id: 1, tipo: "pasta", nome: "Pasta vazia" })];
    expect(agregarHoras(nos).get(1)).toEqual({ horasPrevistas: 0, horasRealizadas: 0, avanco: 0 });
  });
});

describe("derivarStatus", () => {
  it("atividade sem predecessora usa o status manual", () => {
    const status = derivarStatus(arvoreExemplo());
    expect(status.get(3)).toBe("concluida");
    expect(status.get(5)).toBe("em_curso");
  });

  it("atividade com predecessora não concluída vira bloqueada, mesmo com outro status manual", () => {
    const status = derivarStatus(arvoreExemplo());
    expect(status.get(6)).toBe("bloqueada");
  });

  it("pasta com todas as atividades concluídas é concluída", () => {
    const status = derivarStatus(arvoreExemplo());
    expect(status.get(2)).toBe("concluida");
  });

  it("pasta com alguma atividade em curso é em curso, mesmo tendo outra bloqueada", () => {
    const status = derivarStatus(arvoreExemplo());
    expect(status.get(4)).toBe("em_curso");
  });

  it("item agrega recursivamente através das subpastas (não conta a subpasta duas vezes)", () => {
    const status = derivarStatus(arvoreExemplo());
    expect(status.get(1)).toBe("em_curso");
  });

  it("pasta sem nenhuma atividade descendente é não iniciada", () => {
    const nos = [no({ id: 1, tipo: "pasta", nome: "Vazia" })];
    expect(derivarStatus(nos).get(1)).toBe("nao_iniciada");
  });

  it("não trava em ciclo de predecessoras (guarda defensiva)", () => {
    const nos = [
      no({ id: 1, tipo: "atividade", nome: "A", predecessoraId: 2 }),
      no({ id: 2, tipo: "atividade", nome: "B", predecessoraId: 1 }),
    ];
    expect(() => derivarStatus(nos)).not.toThrow();
  });
});

// Pasta raiz da proposta (fora do escopo de qualquer item — ver EstruturaAtividade.seqite
// null) agrupando dois itens entre si:
// Pasta raiz 100
// ├─ Item 1 (subárvore de arvoreExemplo — em_curso)
// └─ Item 200 "Item 2"
//    └─ Atividade 201 "Only" (2h, concluída)
function arvoreComPastaRaiz(): NoCronograma[] {
  return [
    no({ id: 100, tipo: "pasta", nome: "Grupo", parentId: null, ordem: 0 }),
    ...arvoreExemplo().map((n) => (n.id === 1 ? { ...n, parentId: 100 } : n)),
    no({ id: 200, tipo: "item", nome: "Item 2", parentId: 100, ordem: 1 }),
    no({ id: 201, tipo: "atividade", nome: "Only", parentId: 200, ordem: 0, horasPrevistas: 120, statusManual: "concluida" }),
  ];
}

describe("pasta raiz agrupando itens (seletores genéricos por parentId)", () => {
  it("achatarArvore percorre pasta raiz -> itens -> subárvores normalmente", () => {
    const achatada = achatarArvore(arvoreComPastaRaiz());
    expect(achatada.map((n) => n.id)).toEqual([100, 1, 2, 3, 4, 5, 6, 200, 201]);
    expect(achatada.find((n) => n.id === 1)?.profundidade).toBe(1);
  });

  it("agregarHoras soma através dos dois itens dentro da mesma pasta raiz", () => {
    const agregados = agregarHoras(arvoreComPastaRaiz());
    expect(agregados.get(100)?.horasPrevistas).toBe(480 + 240 + 180 + 120);
  });

  it("derivarStatus da pasta raiz considera as atividades dos dois itens", () => {
    const status = derivarStatus(arvoreComPastaRaiz());
    // Item 1 tem uma atividade em_curso (id 5) -> grupo vira em_curso mesmo com item 2 concluído.
    expect(status.get(100)).toBe("em_curso");
    expect(status.get(200)).toBe("concluida");
  });
});

describe("calcularOrcamentoItem", () => {
  it("soma distribuídas e realizadas em múltiplos níveis, incluindo pasta dentro de pasta", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 600 }),
      no({ id: 2, tipo: "pasta", nome: "Pasta A", parentId: 1 }),
      no({ id: 3, tipo: "pasta", nome: "Sub-pasta", parentId: 2 }),
      no({ id: 4, tipo: "atividade", nome: "Ativ 1", parentId: 3, horasPrevistas: 120, horasRealizadas: 60 }),
      no({ id: 5, tipo: "atividade", nome: "Ativ 2", parentId: 2, horasPrevistas: 180, horasRealizadas: 90 }),
    ];
    const agregados = agregarHoras(nos);
    const orcamento = calcularOrcamentoItem(nos[0], agregados);
    expect(orcamento.horasContratadas).toBe(600);
    expect(orcamento.horasDistribuidas).toBe(300);
    expect(orcamento.horasRealizadas).toBe(150);
    expect(orcamento.saldoDistribuicao).toBe(300);
    expect(orcamento.saldoReal).toBe(450);
  });

  it("pasta vazia soma 0 tanto distribuído quanto realizado", () => {
    const nos = [no({ id: 1, tipo: "pasta", nome: "Vazia" })];
    const agregados = agregarHoras(nos);
    expect(somarDistribuidas(nos[0], agregados)).toBe(0);
    expect(somarRealizadas(nos[0], agregados)).toBe(0);
  });

  it("item sem atividades preserva o contratado mas zera o resto", () => {
    const nos = [no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 480 })];
    const agregados = agregarHoras(nos);
    const orcamento = calcularOrcamentoItem(nos[0], agregados);
    expect(orcamento.horasContratadas).toBe(480);
    expect(orcamento.horasDistribuidas).toBe(0);
    expect(orcamento.saldoDistribuicao).toBe(480);
    expect(orcamento.consumoDistribuido).toBe(0);
  });
});

describe("orcamentoDeTotais", () => {
  it("calcula o mesmo orçamento que calcularOrcamentoItem a partir de totais prontos (sem árvore)", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 600 }),
      no({ id: 2, tipo: "atividade", nome: "Ativ 1", parentId: 1, horasPrevistas: 300, horasRealizadas: 150 }),
    ];
    const esperado = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    const orcamento = orcamentoDeTotais(600, 300, 150);
    expect(orcamento).toEqual(esperado);
  });
});

describe("estadoAlertaItem — precedência entre os três estados", () => {
  it("estouro realizado tem prioridade sobre estouro de distribuição (os dois presentes)", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 100 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 200, horasRealizadas: 150 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(orcamento.estouroDistribuicao).toBe(true);
    expect(orcamento.estouroRealizado).toBe(true);
    expect(estadoAlertaItem(orcamento)).toBe("estouro_realizado");
  });

  it("estouro só de distribuição quando o realizado ainda está dentro do contratado", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 100 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 150, horasRealizadas: 50 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(orcamento.estouroDistribuicao).toBe(true);
    expect(orcamento.estouroRealizado).toBe(false);
    expect(estadoAlertaItem(orcamento)).toBe("estouro_distribuicao");
  });

  it("real acima do previsto quando os dois estão dentro do contratado mas o realizado passou o distribuído", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 100 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 40, horasRealizadas: 60 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(orcamento.estouroDistribuicao).toBe(false);
    expect(orcamento.estouroRealizado).toBe(false);
    expect(orcamento.realAcimaDoPrevisto).toBe(true);
    expect(estadoAlertaItem(orcamento)).toBe("real_acima_previsto");
  });

  it("sem alerta quando tudo dentro do contratado e realizado não passou o distribuído", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 100 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 60, horasRealizadas: 30 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(estadoAlertaItem(orcamento)).toBe("ok");
  });

  it("saldo real fica negativo quando o realizado estoura o contratado", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 100 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 200, horasRealizadas: 150 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(orcamento.saldoReal).toBe(-50);
  });
});

describe("somarOrcamentos", () => {
  it("soma o orçamento de vários itens da proposta (rodapé de totais)", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item A", horasPrevistas: 480 }),
      no({ id: 2, tipo: "atividade", nome: "A1", parentId: 1, horasPrevistas: 300, horasRealizadas: 100 }),
      no({ id: 10, tipo: "item", nome: "Item B", horasPrevistas: 240 }),
      no({ id: 11, tipo: "atividade", nome: "B1", parentId: 10, horasPrevistas: 300, horasRealizadas: 50 }),
    ];
    const agregados = agregarHoras(nos);
    const total = somarOrcamentos(
      nos.filter((n) => n.tipo === "item"),
      agregados
    );
    expect(total.horasContratadas).toBe(720);
    expect(total.horasDistribuidas).toBe(600);
    expect(total.horasRealizadas).toBe(150);
    expect(total.saldoDistribuicao).toBe(120);
    expect(total.saldoReal).toBe(570);
    // Item B sozinho já estoura (distribuiu 300 num contratado de 240), mas o TOTAL da
    // proposta ainda fica dentro (600 < 720) — o rodapé não substitui o alerta por item,
    // só soma; por isso o chip de alerta (etapa 5) precisa olhar item a item, não o total.
    expect(total.estouroDistribuicao).toBe(false);
  });
});

describe("descreverSaldoDistribuicao", () => {
  it("saldo positivo mostra horas livres em success", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 480 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 180 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(descreverSaldoDistribuicao(orcamento)).toEqual({ texto: "05:00 livres", tom: "success" });
  });

  it("saldo exatamente zero mostra 100% em muted", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 480 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 480 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(descreverSaldoDistribuicao(orcamento)).toEqual({ texto: "100%", tom: "muted" });
  });

  it("saldo negativo mostra percentual consumido em destructive", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 100 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 125 }),
    ];
    const orcamento = calcularOrcamentoItem(nos[0], agregarHoras(nos));
    expect(descreverSaldoDistribuicao(orcamento)).toEqual({ texto: "125%", tom: "destructive" });
  });
});

describe("projetarSaldo", () => {
  it("projeta o saldo do item ao editar o valor de uma atividade existente, sem re-andar a árvore", () => {
    const nos = [
      no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 480 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 120 }),
      no({ id: 3, tipo: "atividade", nome: "B", parentId: 1, horasPrevistas: 60 }),
    ];
    const porId = new Map(nos.map((n) => [n.id, n]));
    const agregados = agregarHoras(nos);
    // distribuídas atuais = 180; editando "A" de 120 pra 300 -> distribuídas projetadas = 360
    expect(projetarSaldo(nos[0], 2, 300, porId, agregados)).toBe(480 - 360);
  });

  it("projeta corretamente quando uma atividade muda de item (recalcula origem e destino)", () => {
    // Cada chamada de agregarHoras/calcularOrcamentoItem é pura e independente — "mover"
    // é só recalcular com a árvore já refletindo o novo parentId; não existe hoje um
    // caminho de UI que reparente atividade entre itens (ela fica presa ao seqite do
    // item), mas o seletor em si precisa ficar correto pra qualquer árvore válida.
    const antes = [
      no({ id: 1, tipo: "item", nome: "Item A", horasPrevistas: 480 }),
      no({ id: 10, tipo: "item", nome: "Item B", horasPrevistas: 240 }),
      no({ id: 2, tipo: "atividade", nome: "A", parentId: 1, horasPrevistas: 120 }),
    ];
    const agregadosAntes = agregarHoras(antes);
    expect(calcularOrcamentoItem(antes[0], agregadosAntes).horasDistribuidas).toBe(120);
    expect(calcularOrcamentoItem(antes[1], agregadosAntes).horasDistribuidas).toBe(0);

    const depois = antes.map((n) => (n.id === 2 ? { ...n, parentId: 10 } : n));
    const agregadosDepois = agregarHoras(depois);
    expect(calcularOrcamentoItem(depois[0], agregadosDepois).horasDistribuidas).toBe(0);
    expect(calcularOrcamentoItem(depois[1], agregadosDepois).horasDistribuidas).toBe(120);
  });
});

describe("formatHorasCompacto", () => {
  it("formata hora redonda como HH:MM, com zero à esquerda por padrão", () => {
    expect(formatHorasCompacto(480)).toBe("08:00");
  });

  it("formata minutos quebrados com zero à esquerda", () => {
    expect(formatHorasCompacto(270)).toBe("04:30");
  });

  it("passa de 100 horas sem embrulhar (nunca vira relógio de 24h)", () => {
    expect(formatHorasCompacto(100 * 60 + 15)).toBe("100:15");
  });

  it("zero minutos vira 00:00", () => {
    expect(formatHorasCompacto(0)).toBe("00:00");
  });

  it("largura explícita além do mínimo de 2 preenche com zero à esquerda", () => {
    expect(formatHorasCompacto(480, 3)).toBe("008:00");
  });

  it("largura não trunca valores que já passam dela", () => {
    expect(formatHorasCompacto(100 * 60 + 15, 2)).toBe("100:15");
  });

  it("preserva o sinal de negativo sem quebrar o preenchimento de zeros", () => {
    expect(formatHorasCompacto(-125, 3)).toBe("-002:05");
  });
});

describe("larguraHorasProposta", () => {
  it("mínimo de 2 dígitos mesmo quando a proposta inteira cabe em 1 dígito de hora", () => {
    const nos = [no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 300 })]; // 5h
    const total = somarOrcamentos(nos, agregarHoras(nos));
    expect(larguraHorasProposta(total)).toBe(2);
  });

  it("cresce pra 3 dígitos quando o total da proposta passa de 99h", () => {
    const nos = [no({ id: 1, tipo: "item", nome: "Item", horasPrevistas: 125 * 60 })]; // 125h
    const total = somarOrcamentos(nos, agregarHoras(nos));
    expect(larguraHorasProposta(total)).toBe(3);
  });
});
