// Montagem de hierarquias do módulo Contábil (backend/src/routes/contabil.ts) — separado da
// rota porque é lógica de negócio (agregação em árvore), não parsing de request.
//
// Duas árvores hoje, montadas em cima do MESMO construtor genérico (`criarConstrutorArvore`):
// contas (`montarMatrizResultado`, Grupo→níveis reais do plano — sem bucket sintético desde
// 26/08/2026, ver comentário na função) e centro de custo (`montarMatrizCentroCusto`, direto
// pelos níveis de CC, sem grupo).
//
// A árvore de contas é montada A PARTIR DAS FOLHAS ("leaf-driven"), que é como o relatório de
// origem faz: a conta que recebeu o lançamento carrega o grupo gerencial (`despar`) e o grupo
// contábil (`defgru`), e os níveis acima saem de subir por `paiCtared` — independente de o
// ancestral ter `despar` próprio ou não. Cada nó soma apenas as folhas que estão sob ele DENTRO
// daquele grupo.
//
// Uma versão anterior fazia o contrário: só considerava contas que tinham `despar` e ligava-as
// entre si por prefixo de `clacta`. Isso causava dois defeitos:
//   1. Níveis intermediários desapareciam ("3 - RECEITAS", "301", "30101" não têm `despar`), e a
//      árvore pulava degraus — era o "falta um nível" percebido na comparação com o relatório.
//   2. Sintética com `despar` virava raiz de grupo indevidamente. O caso real:
//      `753 - CUSTOS OPERACIONAIS` (clacta 40201) tem despar=SERP em E045PLA, mas é ancestral de
//      TODOS os departamentos — aparecia como raiz do SERP. (O plano paralelo E043PCM, usado pelo
//      relatório de origem, nem marca essa conta; a divergência entre as duas fontes são só 2
//      contas sintéticas, ambas sem lançamento, então nenhum VALOR estava errado — só a estrutura.)
//
// Hierarquia de contas: Grupo (despar) → níveis reais da conta (o próprio nível 1 do plano —
// 173-RECEITAS/220-DESPESAS, anasin='S' — já cumpre o papel que era do bucket sintético).
// Hierarquia de CC: níveis do centro de custo direto (raiz = nível 1 de verdade do plano de CC).

export type TipoLinhaMatriz = "grupo" | "conta";

export interface LinhaMatrizResultado {
  chave: string;
  chavePai: string | null;
  nivel: number;
  rotulo: string;
  tipo: TipoLinhaMatriz;
  /** Nível do item no plano (NivCta/NivCcu); null em grupo/bucket. */
  nivelPlano: number | null;
  anasin: string | null;
  valores: number[];
  total: number;
  /**
   * `ctared`s das contas-folha que contribuíram pra este nó (só em `tipo: "conta"`; vazio em
   * "grupo" e em árvores que não passam `ctaredOrigem` pra `somarNoCaminho`, ver
   * `montarMatrizCentroCusto`). No caso comum (filtro de níveis padrão) tem 1 item — o próprio
   * `ctared` do nó; quando um nível intermediário é ocultado pelo filtro, um nó "folha visível"
   * pode herdar mais de um `ctared` real (descendentes que "subiram" pra ele, ver
   * `cadeiaVisivel` em `montarMatrizResultado`). É essa lista, não o `ctared` singular, que o
   * drilldown de lançamentos (routes/contabil.ts) precisa pra bater exatamente com o valor
   * exibido em qualquer configuração de filtro.
   */
  ctareds: number[];
}

interface NoEmConstrucao {
  chave: string;
  chavePai: string | null;
  nivel: number;
  rotulo: string;
  tipo: TipoLinhaMatriz;
  nivelPlano: number | null;
  anasin: string | null;
  /** Critério de ordenação entre irmãos (rótulo do grupo, ordem do bucket, clacta/claccu). */
  ordenacao: string;
  valores: number[];
  filhos: string[];
  ctareds: Set<number>;
}

/**
 * Núcleo comum às duas árvores: registra nós (idempotente — a mesma chave só é criada uma vez),
 * acumula valores e devolve a lista achatada em pré-ordem (pai antes dos filhos), que é o que o
 * front espera pra resolver visibilidade numa passada só (ver MatrizContabil.tsx).
 */
function criarConstrutorArvore(numColunas: number) {
  const nos = new Map<string, NoEmConstrucao>();
  const raizes: string[] = [];

  function garantirNo(
    chave: string,
    chavePai: string | null,
    dados: Omit<NoEmConstrucao, "chave" | "chavePai" | "valores" | "filhos" | "ctareds">
  ): NoEmConstrucao {
    const existente = nos.get(chave);
    if (existente) return existente;
    const novo: NoEmConstrucao = {
      chave,
      chavePai,
      ...dados,
      valores: new Array(numColunas).fill(0),
      filhos: [],
      ctareds: new Set<number>(),
    };
    nos.set(chave, novo);
    if (chavePai === null) raizes.push(chave);
    else nos.get(chavePai)!.filhos.push(chave);
    return novo;
  }

  // `ctaredOrigem`: a conta-folha de onde `valores` está vindo, registrada em CADA nó do
  // caminho (não só na folha) — é o que permite ao drilldown de lançamentos saber exatamente
  // quais `ctared`s somar pra reconstruir o valor de qualquer nó exibido, mesmo quando o filtro
  // de níveis faz um nó "parecer" folha sem ser a conta real (ver LinhaMatrizResultado.ctareds).
  // Omitido = árvore que não precisa disso (montarMatrizCentroCusto).
  function somarNoCaminho(caminho: string[], valores: number[], ctaredOrigem?: number) {
    for (const chave of caminho) {
      const no = nos.get(chave)!;
      for (let i = 0; i < numColunas; i++) no.valores[i] += valores[i];
      if (ctaredOrigem !== undefined) no.ctareds.add(ctaredOrigem);
    }
  }

  function emitirTodos(): LinhaMatrizResultado[] {
    const linhas: LinhaMatrizResultado[] = [];
    const ordenarPorChave = (chaves: string[]) =>
      [...chaves].sort((a, b) => nos.get(a)!.ordenacao.localeCompare(nos.get(b)!.ordenacao, "pt-BR"));

    function emitir(chave: string) {
      const no = nos.get(chave)!;
      linhas.push({
        chave: no.chave,
        chavePai: no.chavePai,
        nivel: no.nivel,
        rotulo: no.rotulo,
        tipo: no.tipo,
        nivelPlano: no.nivelPlano,
        anasin: no.anasin,
        valores: no.valores,
        total: no.valores.reduce((a, b) => a + b, 0),
        ctareds: [...no.ctareds].sort((a, b) => a - b),
      });
      for (const filho of ordenarPorChave(no.filhos)) emitir(filho);
    }
    for (const raiz of ordenarPorChave(raizes)) emitir(raiz);
    return linhas;
  }

  return { garantirNo, somarNoCaminho, emitirTodos };
}

// Sobe a cadeia raiz→folha de um item começando nele mesmo, seguindo `pai(item)`. `codigo`
// extrai a chave de identidade (ctared/codccu) — não dá pra inferir genericamente porque o
// nome do campo difere entre conta e centro de custo. `visitados` protege contra ciclo em
// dado torto (não deveria existir, mas um laço aqui travaria a requisição inteira).
function cadeiaAteRaiz<T, K>(item: T, codigo: (item: T) => K, pai: (item: T) => T | undefined): T[] {
  const cadeia: T[] = [];
  const visitados = new Set<K>();
  let atual: T | undefined = item;
  while (atual && !visitados.has(codigo(atual))) {
    visitados.add(codigo(atual));
    cadeia.unshift(atual);
    atual = pai(atual);
  }
  return cadeia;
}

// ---------- Árvore de contas: Grupo → Receitas/Despesas → níveis do plano ----------

export interface ContaParaMatriz {
  ctared: number;
  clacta: string;
  descta: string;
  anasin: string;
  /** Grupo gerencial ("Conta Paralela"). Só é lido da conta que teve movimento. */
  despar: string;
  /** Domínio LGruCta — vira o nível Receitas/Despesas. */
  defgru: string | null;
  /** E045PLA.NivCta. Null cai no fallback da posição na cadeia de ancestrais. */
  nivcta: number | null;
  paiCtared: number | null;
}

/**
 * @param contas Metadados de TODAS as contas do recorte — folhas e ancestrais. Os ancestrais
 *   precisam estar aqui mesmo sem `despar`, senão a cadeia de `paiCtared` não fecha.
 * @param valoresPorCtared Vetor de valores por `ctared` que teve movimento no período. Só
 *   estas contas geram linhas: conta sem movimento no período não aparece (é o comportamento
 *   do relatório de origem, e evita centenas de linhas zeradas).
 * @param numColunas Tamanho do vetor de valores — uma posição por combinação ano×mês
 *   selecionada (ver montagem de `colunas` em routes/contabil.ts).
 * @param niveisVisiveis Níveis do plano (`nivcta`) que devem aparecer na coluna Conta. Null =
 *   todos. Omitir um nível intermediário não esconde valor nenhum: os descendentes sobem pro
 *   ancestral visível mais próximo, igual ao seletor de campos do relatório de origem.
 */
export function montarMatrizResultado(
  contas: ContaParaMatriz[],
  valoresPorCtared: Map<number, number[]>,
  numColunas: number,
  niveisVisiveis?: Set<number> | null,
  // "clacta" (default) = Classificação da Conta oficial do Senior, mesmo campo que já define a
  // hierarquia pai/filho — é o critério fiel ao plano de contas de origem, validado célula a
  // célula em 12/08/2026. "ctared" ordena pelo código reduzido/técnico mostrado no rótulo da
  // linha (`${ctared} - ${descta}`) — mais fácil de conferir a olho, mas não é a classificação
  // oficial (pedido explícito do Vitor, 26/08/2026, depois de comparar as duas ordens contra
  // dado real).
  criterioOrdenacao: "clacta" | "ctared" = "clacta"
): { linhas: LinhaMatrizResultado[]; totalGeral: number[] } {
  const porCtared = new Map(contas.map((c) => [c.ctared, c]));
  const arvore = criarConstrutorArvore(numColunas);
  const totalGeral = new Array<number>(numColunas).fill(0);

  for (const conta of contas) {
    const valores = valoresPorCtared.get(conta.ctared);
    if (!valores) continue; // sem movimento no período

    const cadeia = cadeiaAteRaiz(
      conta,
      (c) => c.ctared,
      (c) => (c.paiCtared != null ? porCtared.get(c.paiCtared) : undefined)
    );

    // Nível do plano: o do Senior quando existe; senão a posição na cadeia (linha nunca
    // ressincronizada depois de 13/08/2026).
    const nivelDoPlano = (c: ContaParaMatriz, indice: number) => c.nivcta ?? indice + 1;
    const cadeiaVisivel = cadeia.filter((c, i) => niveisVisiveis == null || niveisVisiveis.has(nivelDoPlano(c, i)));

    const chaveGrupo = `g:${conta.despar}`;
    arvore.garantirNo(chaveGrupo, null, {
      nivel: 0,
      rotulo: conta.despar,
      tipo: "grupo",
      nivelPlano: null,
      anasin: null,
      ordenacao: conta.despar,
    });

    // Sem nível sintético Receitas/Despesas (removido em 26/08/2026): os próprios nós reais de
    // nível 1 do plano (173-RECEITAS, 220-DESPESAS, anasin='S') já cumprem esse papel — o bucket
    // sintético só duplicava o total deles com outro rótulo. O caminho carrega o grupo, então a
    // MESMA conta aparece em grupos diferentes como nós distintos — é o que faz "4 - DESPESAS"
    // existir dentro de ADM, COM, SERP… cada um com o valor do seu próprio grupo.
    const caminho = [chaveGrupo];
    cadeiaVisivel.forEach((c, i) => {
      const chavePai = caminho[caminho.length - 1];
      const chave = `${chavePai}|c:${c.ctared}`;
      arvore.garantirNo(chave, chavePai, {
        nivel: 1 + i,
        rotulo: `${c.ctared} - ${c.descta}`,
        tipo: "conta",
        nivelPlano: c.nivcta ?? null,
        anasin: c.anasin,
        // zero-pad: ordenacao é string (localeCompare em emitirTodos) — sem padding, "9" ficaria
        // depois de "10" na comparação lexicográfica. 10 dígitos é folgado pro tamanho real de
        // ctared.
        ordenacao: criterioOrdenacao === "ctared" ? String(c.ctared).padStart(10, "0") : c.clacta,
      });
      caminho.push(chave);
    });

    arvore.somarNoCaminho(caminho, valores, conta.ctared);
    for (let i = 0; i < numColunas; i++) totalGeral[i] += valores[i];
  }

  return { linhas: arvore.emitirTodos(), totalGeral };
}

// ---------- Árvore de centro de custo: níveis nativos (CcuPai já vem do Senior) ----------

export interface CentroCustoParaMatriz {
  codccu: string;
  desccu: string;
  claccu: string;
  anasin: string | null;
  /** E044CCU.NivCcu. Null cai no fallback da posição na cadeia de ancestrais. */
  nivccu: number | null;
  /** E044CCU.CcuPai — pai NATIVO (diferente de conta, aqui não precisa derivar nada). Vem " "
   *  (espaço) do Senior pra raiz, não NULL — normalizar pra null antes de passar aqui. */
  ccupai: string | null;
}

/**
 * Mesmo espírito de `montarMatrizResultado`, mas sem grupo/bucket: o centro de custo já tem
 * hierarquia própria e completa via `ccupai` nativo, sem precisar de uma dimensão gerencial por
 * cima. Raiz = centro de custo sem pai (nível 1 de verdade do plano de CC — hoje "10 - CENTRO DE
 * CUSTOS" e "320 - SUMIR").
 */
export function montarMatrizCentroCusto(
  centros: CentroCustoParaMatriz[],
  valoresPorCodccu: Map<string, number[]>,
  numColunas: number,
  niveisVisiveis?: Set<number> | null
): { linhas: LinhaMatrizResultado[]; totalGeral: number[] } {
  const porCodigo = new Map(centros.map((c) => [c.codccu, c]));
  const arvore = criarConstrutorArvore(numColunas);
  const totalGeral = new Array<number>(numColunas).fill(0);

  for (const centro of centros) {
    const valores = valoresPorCodccu.get(centro.codccu);
    if (!valores) continue;

    const cadeia = cadeiaAteRaiz(
      centro,
      (c) => c.codccu,
      (c) => (c.ccupai != null ? porCodigo.get(c.ccupai) : undefined)
    );

    const nivelDoPlano = (c: CentroCustoParaMatriz, indice: number) => c.nivccu ?? indice + 1;
    const cadeiaVisivel = cadeia.filter((c, i) => niveisVisiveis == null || niveisVisiveis.has(nivelDoPlano(c, i)));

    const caminho: string[] = [];
    cadeiaVisivel.forEach((c, i) => {
      const chavePai = caminho.length > 0 ? caminho[caminho.length - 1] : null;
      const chave = chavePai != null ? `${chavePai}|cc:${c.codccu}` : `cc:${c.codccu}`;
      arvore.garantirNo(chave, chavePai, {
        nivel: i,
        rotulo: `${c.codccu} - ${c.desccu}`,
        tipo: "conta",
        nivelPlano: c.nivccu ?? null,
        anasin: c.anasin,
        ordenacao: c.claccu,
      });
      caminho.push(chave);
    });

    arvore.somarNoCaminho(caminho, valores);
    for (let i = 0; i < numColunas; i++) totalGeral[i] += valores[i];
  }

  return { linhas: arvore.emitirTodos(), totalGeral };
}
