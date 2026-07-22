// Seletores puros do Cronograma (WBS) — nada aqui faz requisição nem toca estado de
// React; tudo é função de entrada -> saída, testável isoladamente. A árvore trafega
// achatada (parentId, mesma convenção do backend em EstruturaAtividade) e essas funções
// são a ÚNICA fonte de verdade pra achatar/filtrar/agregar/derivar status — a tela
// (etapa 4) só chama essas funções, nunca recalcula por conta própria.

export type NoTipo = "item" | "pasta" | "atividade";
export type StatusNo = "nao_iniciada" | "em_curso" | "bloqueada" | "concluida";

export interface NoCronograma {
  id: number;
  parentId: number | null;
  tipo: NoTipo;
  nome: string;
  ordem: number;
  // Minutos, mesma convenção de AtividadeConsultor.qtdhor — só tem valor próprio em
  // tipo="atividade"; pasta/item ignoram o próprio campo (a agregação de agregarHoras
  // que dá o total real dessas linhas).
  horasPrevistas: number | null;
  // Minutos — sempre 0 por enquanto (sem apontamento real de horas sincronizado do
  // Senior ainda; ver agregarHoras).
  horasRealizadas: number;
  responsavelCodfor: number | null;
  // Referência informativa a outra atividade da mesma árvore — sem motor de
  // recálculo de datas, só usada aqui pra derivar o status "bloqueada".
  predecessoraId: number | null;
  // Só setado manualmente em tipo="atividade" ("bloqueada" nunca é gravado aqui — é
  // sempre calculado por derivarStatus a partir da predecessora).
  statusManual: Exclude<StatusNo, "bloqueada"> | null;
}

export interface HorasAgregadas {
  horasPrevistas: number;
  horasRealizadas: number;
  // 0-1, com guarda contra divisão por zero (horasPrevistas=0 -> avanco=0).
  avanco: number;
}

function porPai<T extends NoCronograma>(nos: T[]): Map<number | null, T[]> {
  const mapa = new Map<number | null, T[]>();
  for (const no of nos) {
    if (!mapa.has(no.parentId)) mapa.set(no.parentId, []);
    mapa.get(no.parentId)!.push(no);
  }
  for (const filhos of mapa.values()) filhos.sort((a, b) => a.ordem - b.ordem);
  return mapa;
}

// Achata a árvore em ordem de exibição (pré-ordem, respeitando `ordem` entre irmãos),
// anotando a profundidade de cada nó — é isso que a grade usa pra indentar as linhas.
export function achatarArvore<T extends NoCronograma>(nos: T[]): (T & { profundidade: number })[] {
  const filhosDe = porPai(nos);
  const resultado: (T & { profundidade: number })[] = [];

  function visitar(no: T, profundidade: number) {
    resultado.push({ ...no, profundidade });
    for (const filho of filhosDe.get(no.id) ?? []) visitar(filho, profundidade + 1);
  }

  for (const raiz of filhosDe.get(null) ?? []) visitar(raiz, 0);
  return resultado;
}

// Retorna o conjunto de ids que devem ficar visíveis quando um filtro (busca de texto,
// status, responsável...) está ativo: os nós que batem no predicado MAIS todos os seus
// ancestrais (senão o match fica "órfão", escondido dentro de uma pasta recolhida).
export function filtrarPreservandoAncestrais(nos: NoCronograma[], predicado: (no: NoCronograma) => boolean): Set<number> {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const visiveis = new Set<number>();

  for (const no of nos) {
    if (!predicado(no)) continue;
    let atual: NoCronograma | undefined = no;
    while (atual && !visiveis.has(atual.id)) {
      visiveis.add(atual.id);
      atual = atual.parentId != null ? porId.get(atual.parentId) : undefined;
    }
  }
  return visiveis;
}

// Soma recursiva de horas: pasta/item = soma das atividades descendentes (direto ou
// dentro de subpastas); atividade = seu próprio valor. Sempre calculado aqui, nunca em
// mais de um lugar (nem no backend duplicando essa conta, nem em cada componente).
export function agregarHoras(nos: NoCronograma[]): Map<number, HorasAgregadas> {
  const filhosDe = porPai(nos);
  const resultado = new Map<number, HorasAgregadas>();

  function calcular(no: NoCronograma): HorasAgregadas {
    const existente = resultado.get(no.id);
    if (existente) return existente;

    let horasPrevistas: number;
    let horasRealizadas: number;
    if (no.tipo === "atividade") {
      horasPrevistas = no.horasPrevistas ?? 0;
      horasRealizadas = no.horasRealizadas;
    } else {
      horasPrevistas = 0;
      horasRealizadas = 0;
      for (const filho of filhosDe.get(no.id) ?? []) {
        const agregadoFilho = calcular(filho);
        horasPrevistas += agregadoFilho.horasPrevistas;
        horasRealizadas += agregadoFilho.horasRealizadas;
      }
    }
    const avanco = horasPrevistas > 0 ? horasRealizadas / horasPrevistas : 0;
    const agregado: HorasAgregadas = { horasPrevistas, horasRealizadas, avanco };
    resultado.set(no.id, agregado);
    return agregado;
  }

  for (const no of nos) calcular(no);
  return resultado;
}

// Status efetivo de cada nó:
// - atividade: "bloqueada" se a predecessora existir e seu status efetivo não for
//   "concluida" (sobrepõe o status manual); senão, o próprio status manual
//   ("nao_iniciada" quando não definido).
// - pasta/item: derivado das atividades descendentes — todas concluídas -> concluída;
//   alguma em curso -> em curso; alguma bloqueada (e nenhuma em curso) -> bloqueada;
//   sem descendentes ou nenhuma das condições acima -> não iniciada.
export function derivarStatus(nos: NoCronograma[]): Map<number, StatusNo> {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const filhosDe = porPai(nos);
  const resultado = new Map<number, StatusNo>();
  const resolvendo = new Set<number>();

  function statusAtividade(no: NoCronograma): StatusNo {
    const existente = resultado.get(no.id);
    if (existente) return existente;
    // Guarda contra ciclo de predecessoras (não deveria acontecer — o backend valida —
    // mas uma função pura não pode confiar nisso e travar em recursão infinita).
    if (resolvendo.has(no.id)) return no.statusManual ?? "nao_iniciada";
    resolvendo.add(no.id);

    let efetivo: StatusNo = no.statusManual ?? "nao_iniciada";
    if (no.predecessoraId != null) {
      const predecessora = porId.get(no.predecessoraId);
      if (predecessora && predecessora.tipo === "atividade") {
        const statusPredecessora = statusAtividade(predecessora);
        if (statusPredecessora !== "concluida") efetivo = "bloqueada";
      }
    }

    resolvendo.delete(no.id);
    resultado.set(no.id, efetivo);
    return efetivo;
  }

  function statusGrupo(no: NoCronograma): StatusNo {
    const existente = resultado.get(no.id);
    if (existente) return existente;

    // Só entram atividades-folha na conta — o status de uma subpasta é ele mesmo
    // derivado das atividades dela, então incluí-lo aqui contaria a mesma informação
    // duas vezes (e uma subpasta vazia injetaria um "não iniciada" espúrio).
    const descendentesAtividade: StatusNo[] = [];
    function coletar(filhosDoNo: NoCronograma[]) {
      for (const filho of filhosDoNo) {
        if (filho.tipo === "atividade") {
          descendentesAtividade.push(statusAtividade(filho));
        } else {
          coletar(filhosDe.get(filho.id) ?? []);
        }
      }
    }
    coletar(filhosDe.get(no.id) ?? []);

    let efetivo: StatusNo;
    if (descendentesAtividade.length === 0) {
      efetivo = "nao_iniciada";
    } else if (descendentesAtividade.every((s) => s === "concluida")) {
      efetivo = "concluida";
    } else if (descendentesAtividade.some((s) => s === "em_curso")) {
      efetivo = "em_curso";
    } else if (descendentesAtividade.some((s) => s === "bloqueada")) {
      efetivo = "bloqueada";
    } else {
      efetivo = "nao_iniciada";
    }
    resultado.set(no.id, efetivo);
    return efetivo;
  }

  for (const no of nos) {
    if (no.tipo === "atividade") statusAtividade(no);
    else statusGrupo(no);
  }
  return resultado;
}

// Horas em minutos -> "HH:MM", sempre com no mínimo `largura` dígitos de hora (zero à
// esquerda), mesmo quando o valor é só minutos — ex.: 00:35, 01:00 (nunca embrulha tipo
// relógio de 24h, `largura` só estabelece um MÍNIMO, um valor de 125h vira "125:00" ainda
// que `largura` seja 2). Único formatador de hora da tela de Cronograma — árvore, drawer,
// orçamento do item e rodapé chamam sempre esta função, sempre com a mesma `largura`
// (ver larguraHorasProposta) pra que os dígitos de hora fiquem alinhados entre item,
// pasta e atividade independente do valor de cada linha.
export function formatHorasCompacto(minutos: number, largura: number = 2): string {
  const totalMinutos = Math.round(minutos);
  const horas = Math.trunc(totalMinutos / 60);
  const min = Math.abs(totalMinutos % 60);
  const sinal = horas < 0 ? "-" : "";
  return `${sinal}${String(Math.abs(horas)).padStart(largura, "0")}:${String(min).padStart(2, "0")}`;
}

// Orçamento de um item: três grandezas que convivem na árvore (ver tabela do prompt) —
// contratado vem da proposta (join, nunca cópia — mora em item.horasPrevistas, ver
// useCronograma), distribuído é a soma recursiva de horasPrevistas das atividades
// descendentes, realizado é a soma recursiva de horasRealizadas (sempre 0 por enquanto,
// sem apontamento sincronizado — ver decisão registrada nesta etapa). O confronto com o
// teto só existe no nível do item; pasta nunca tem "contratado" próprio.
export interface OrcamentoItem {
  horasContratadas: number;
  horasDistribuidas: number;
  horasRealizadas: number;
  // contratadas - distribuídas; negativo = estouro de planejamento.
  saldoDistribuicao: number;
  // contratadas - realizadas; negativo = estouro real.
  saldoReal: number;
  // 0-1 (pode passar de 1 em estouro), com guarda contra divisão por zero.
  consumoDistribuido: number;
  consumoReal: number;
  estouroDistribuicao: boolean;
  estouroRealizado: boolean;
  // realizado > distribuído mas ambos dentro do contratado — sinal de replanejamento,
  // não é estouro (só reflete que o planejado ficou pra trás do que já foi feito).
  realAcimaDoPrevisto: boolean;
}

// Acessores finos sobre o mapa que agregarHoras já calculou pra árvore inteira — não
// recalculam nada, só leem o valor do nó pedido. Existem como funções nomeadas (em vez
// de `agregados.get(no.id)?.horasPrevistas` espalhado pela UI) pra manter a leitura de
// "distribuído" vs "realizado" explícita em quem os chama.
export function somarDistribuidas(no: NoCronograma, agregados: Map<number, HorasAgregadas>): number {
  return agregados.get(no.id)?.horasPrevistas ?? 0;
}

export function somarRealizadas(no: NoCronograma, agregados: Map<number, HorasAgregadas>): number {
  return agregados.get(no.id)?.horasRealizadas ?? 0;
}

// Deriva os campos calculados (saldos, consumos, estouros) a partir das três grandezas
// brutas — compartilhado entre calcularOrcamentoItem (um item) e somarOrcamentos (vários
// itens somados, ver rodapé de totais), pra não duplicar a mesma conta duas vezes.
function derivarOrcamento(horasContratadas: number, horasDistribuidas: number, horasRealizadas: number): OrcamentoItem {
  const saldoDistribuicao = horasContratadas - horasDistribuidas;
  const saldoReal = horasContratadas - horasRealizadas;
  const consumoDistribuido = horasContratadas > 0 ? horasDistribuidas / horasContratadas : 0;
  const consumoReal = horasContratadas > 0 ? horasRealizadas / horasContratadas : 0;
  return {
    horasContratadas,
    horasDistribuidas,
    horasRealizadas,
    saldoDistribuicao,
    saldoReal,
    consumoDistribuido,
    consumoReal,
    estouroDistribuicao: horasDistribuidas > horasContratadas,
    estouroRealizado: horasRealizadas > horasContratadas,
    realAcimaDoPrevisto: horasRealizadas > horasDistribuidas,
  };
}

// Só faz sentido pra nó tipo="item" (é o único nível com horasContratadas próprio —
// pasta nunca tem teto, só soma). O chamador decide quando chamar; a função não valida
// o tipo pra não duplicar a checagem que já existe em quem monta a árvore.
export function calcularOrcamentoItem(item: NoCronograma, agregados: Map<number, HorasAgregadas>): OrcamentoItem {
  return derivarOrcamento(item.horasPrevistas ?? 0, somarDistribuidas(item, agregados), somarRealizadas(item, agregados));
}

// Soma o orçamento de vários itens num só (rodapé de totais da proposta) — mesma forma
// de OrcamentoItem, então descreverSaldoDistribuicao/estadoAlertaItem funcionam igual
// pra um item ou pro total inteiro, sem lógica de cor/texto duplicada pro rodapé.
export function somarOrcamentos(itens: NoCronograma[], agregados: Map<number, HorasAgregadas>): OrcamentoItem {
  let horasContratadas = 0;
  let horasDistribuidas = 0;
  let horasRealizadas = 0;
  for (const item of itens) {
    horasContratadas += item.horasPrevistas ?? 0;
    horasDistribuidas += somarDistribuidas(item, agregados);
    horasRealizadas += somarRealizadas(item, agregados);
  }
  return derivarOrcamento(horasContratadas, horasDistribuidas, horasRealizadas);
}

export type EstadoAlertaItem = "estouro_realizado" | "estouro_distribuicao" | "real_acima_previsto" | "ok";

// Precedência dos alertas do item — só o mais grave presente é aplicado (nunca mais de
// um ao mesmo tempo): realizado estourando o contratado é sempre pior que só o
// planejamento estourar, que por sua vez é pior que só o realizado ter passado do
// planejado (ambos ainda dentro do contratado).
export function estadoAlertaItem(orcamento: OrcamentoItem): EstadoAlertaItem {
  if (orcamento.estouroRealizado) return "estouro_realizado";
  if (orcamento.estouroDistribuicao) return "estouro_distribuicao";
  if (orcamento.realAcimaDoPrevisto) return "real_acima_previsto";
  return "ok";
}

export type TomSaldo = "success" | "muted" | "destructive";

// Texto + tom do saldo de distribuição exibido ao lado do bloco de orçamento do item:
// sobrou horas -> "{saldo} livres" em success; bateu certinho -> "100%" em muted;
// estourou -> percentual consumido em destructive (não mostra "livres" negativo, que
// leria mal — mostra quanto já foi consumido do contratado).
export function descreverSaldoDistribuicao(orcamento: OrcamentoItem, largura: number = 2): { texto: string; tom: TomSaldo } {
  if (orcamento.saldoDistribuicao > 0) {
    return { texto: `${formatHorasCompacto(orcamento.saldoDistribuicao, largura)} livres`, tom: "success" };
  }
  if (orcamento.saldoDistribuicao === 0) {
    return { texto: "100%", tom: "muted" };
  }
  return { texto: `${Math.round(orcamento.consumoDistribuido * 100)}%`, tom: "destructive" };
}

// Quantidade mínima de dígitos de hora que TODA formatação de hora da proposta deve usar
// (ver formatHorasCompacto) — calculada a partir do total da proposta (mesmo valor do
// rodapé, ver somarOrcamentos), nunca de um item/pasta/atividade isolado. Como contratado/
// distribuído/realizado do total são somas de valores não-negativos, o total é sempre >=
// qualquer valor individual dentro da árvore — não precisa andar a árvore de novo pra
// achar o "maior número", o total já É o maior número. Mínimo de 2 dígitos (padrão
// "00:35") mesmo quando a proposta inteira cabe em 1 dígito de hora.
export function larguraHorasProposta(orcamentoTotal: OrcamentoItem): number {
  const maiorMinutos = Math.max(orcamentoTotal.horasContratadas, orcamentoTotal.horasDistribuidas, orcamentoTotal.horasRealizadas);
  const horas = Math.trunc(Math.round(maiorMinutos) / 60);
  return Math.max(2, String(horas).length);
}

// Saldo de distribuição do item COMO FICARIA se a atividade `atividadeId` passasse a
// valer `novoValorMinutos` — pro feedback em tempo real do input (roda a cada tecla).
// Deliberadamente O(1): não re-anda a árvore, só ajusta a soma já agregada pela
// diferença entre o valor atual da atividade e o novo valor digitado.
export function projetarSaldo(
  item: NoCronograma,
  atividadeId: number,
  novoValorMinutos: number,
  porId: Map<number, NoCronograma>,
  agregados: Map<number, HorasAgregadas>
): number {
  const atividadeAtual = porId.get(atividadeId);
  const valorAtual = atividadeAtual?.horasPrevistas ?? 0;
  const distribuidasAtuais = somarDistribuidas(item, agregados);
  const distribuidasProjetadas = distribuidasAtuais - valorAtual + novoValorMinutos;
  const horasContratadas = item.horasPrevistas ?? 0;
  return horasContratadas - distribuidasProjetadas;
}
