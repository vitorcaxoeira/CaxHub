// Montagem da hierarquia do Resultado Analítico (backend/src/routes/contabil.ts) — separado
// da rota porque é lógica de negócio (agregação em árvore), não parsing de request.
//
// A árvore não segue o prefixo de `clacta` "cru": segue o prefixo SÓ ENTRE contas do MESMO
// grupo (`despar`). Ex.: "3" (RECEITAS) é ancestral de "30201010001" (211 - Descontos Obtidos)
// em `clacta`, mas "3" tem despar vazio e "30201010001" tem despar=ADM — logo, dentro do grupo
// ADM, a conta 211 não tem pai (fica no topo do grupo). Isso é deliberado (ver plano): contas
// "guarda-chuva" como "GASTOS COM PESSOAL - (ADM)" É QUE carregam o despar do grupo, e por
// coincidência do plano de contas do Senior isso reproduz exatamente o agrupamento do relatório
// de origem sem precisar inventar nó sintético nenhum.

import { NIVEIS_CLACTA } from "./contabilDominio";

export interface ContaParaMatriz {
  ctared: number;
  clacta: string;
  descta: string;
  anasin: string;
  despar: string; // já não-vazio neste ponto (filtro aplicado antes de chamar montarMatrizResultado)
}

export interface LinhaMatrizResultado {
  chave: string;
  chavePai: string | null;
  nivel: number;
  rotulo: string;
  ehGrupo: boolean;
  anasin: string | null;
  valores: number[];
  total: number;
}

function somaVetores(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i]);
}

// Acha, dentro do mesmo grupo, a conta com o prefixo de `clacta` mais longo (o pai mais
// próximo). Pode "pular" nível se o intermediário não pertencer a este grupo — é esperado.
function encontrarPaiNoGrupo(conta: ContaParaMatriz, contasDoGrupoPorClacta: Map<string, ContaParaMatriz>): ContaParaMatriz | null {
  const larguras = NIVEIS_CLACTA.filter((largura) => largura < conta.clacta.length).sort((a, b) => b - a);
  for (const largura of larguras) {
    const pai = contasDoGrupoPorClacta.get(conta.clacta.slice(0, largura));
    if (pai) return pai;
  }
  return null;
}

/**
 * @param contas Metadados de TODAS as contas relevantes (já filtradas por grupo/incluirSemGrupo) —
 *   inclui tanto folhas quanto os nós "guarda-chuva" que carregam despar, mesmo sem movimento no
 *   período (é preciso pra árvore não ficar com buracos).
 * @param valoresPorCtared Vetor de N meses por `ctared` que teve movimento no período; ctared
 *   sem entrada aqui não tem lançamento próprio (só herda de filhos, se tiver).
 * @param numMeses Tamanho do vetor de valores (12 pro ano completo).
 */
export function montarMatrizResultado(
  contas: ContaParaMatriz[],
  valoresPorCtared: Map<number, number[]>,
  numMeses: number,
): { linhas: LinhaMatrizResultado[]; totalGeral: number[] } {
  const porGrupo = new Map<string, ContaParaMatriz[]>();
  for (const conta of contas) {
    const lista = porGrupo.get(conta.despar) ?? [];
    lista.push(conta);
    porGrupo.set(conta.despar, lista);
  }

  const linhas: LinhaMatrizResultado[] = [];
  const totalGeral = new Array<number>(numMeses).fill(0);
  const gruposOrdenados = [...porGrupo.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));

  for (const grupo of gruposOrdenados) {
    const contasDoGrupo = porGrupo.get(grupo)!;
    const contasDoGrupoPorClacta = new Map(contasDoGrupo.map((c) => [c.clacta, c]));

    // ctared do pai (dentro do grupo) de cada conta; null = topo do grupo.
    const paiPorCtared = new Map<number, number | null>();
    for (const conta of contasDoGrupo) {
      paiPorCtared.set(conta.ctared, encontrarPaiNoGrupo(conta, contasDoGrupoPorClacta)?.ctared ?? null);
    }
    const filhosPorPai = new Map<number, ContaParaMatriz[]>(); // chave -1 = topo do grupo
    for (const conta of contasDoGrupo) {
      const chavePai = paiPorCtared.get(conta.ctared) ?? -1;
      const lista = filhosPorPai.get(chavePai) ?? [];
      lista.push(conta);
      filhosPorPai.set(chavePai, lista);
    }

    const zeros = new Array<number>(numMeses).fill(0);
    const valoresAgregadosPorCtared = new Map<number, number[]>();
    function valoresAgregadosDe(ctared: number): number[] {
      const memo = valoresAgregadosPorCtared.get(ctared);
      if (memo) return memo;
      let soma = valoresPorCtared.get(ctared) ?? zeros;
      for (const filho of filhosPorPai.get(ctared) ?? []) {
        soma = somaVetores(soma, valoresAgregadosDe(filho.ctared));
      }
      valoresAgregadosPorCtared.set(ctared, soma);
      return soma;
    }

    const contasDoTopo = [...(filhosPorPai.get(-1) ?? [])].sort((a, b) => a.clacta.localeCompare(b.clacta));
    let valoresGrupo = zeros;
    for (const conta of contasDoTopo) valoresGrupo = somaVetores(valoresGrupo, valoresAgregadosDe(conta.ctared));

    const chaveGrupo = `grupo:${grupo}`;
    linhas.push({
      chave: chaveGrupo,
      chavePai: null,
      nivel: 0,
      rotulo: grupo,
      ehGrupo: true,
      anasin: null,
      valores: valoresGrupo,
      total: valoresGrupo.reduce((a, b) => a + b, 0),
    });
    totalGeral.forEach((_, i) => (totalGeral[i] += valoresGrupo[i]));

    const achatar = (conta: ContaParaMatriz, nivel: number, chavePai: string): void => {
      const valores = valoresAgregadosDe(conta.ctared);
      const chave = `conta:${conta.ctared}`;
      linhas.push({
        chave,
        chavePai,
        nivel,
        rotulo: `${conta.ctared} - ${conta.descta}`,
        ehGrupo: false,
        anasin: conta.anasin,
        valores,
        total: valores.reduce((a, b) => a + b, 0),
      });
      const filhos = [...(filhosPorPai.get(conta.ctared) ?? [])].sort((a, b) => a.clacta.localeCompare(b.clacta));
      for (const filho of filhos) achatar(filho, nivel + 1, chave);
    };
    for (const conta of contasDoTopo) achatar(conta, 1, chaveGrupo);
  }

  return { linhas, totalGeral };
}
