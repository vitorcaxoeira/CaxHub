import { AtividadeConsultor, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

// Hierarquia de datas do Cronograma: pasta raiz → item da proposta → pasta/subpasta → atividade
// (→ alocação do consultor, que copia as datas da atividade). Cada nível tem período (início e/ou
// fim) opcional, e o filho precisa caber no período do ANCESTRAL MAIS PRÓXIMO que tem data — cada
// lado (início/fim) é resolvido separadamente, e um pai sem data não restringe ninguém.
//
// Tudo aqui trabalha com data como texto "AAAA-MM-DD" (a coluna é @db.Date): comparar texto dessa
// forma ordena certo e foge de qualquer fuso. A conversão pra Date só acontece ao gravar.

/** "n:<id>" para um nó de EstruturaAtividade (pasta raiz, pasta ou atividade); "i:<seqite>" para o item. */
export type ChaveNo = string;
export const chaveNo = (id: number): ChaveNo => `n:${id}`;
export const chaveItem = (seqite: number): ChaveNo => `i:${seqite}`;

export interface NoDatas {
  chave: ChaveNo;
  tipo: "item" | "pasta" | "atividade";
  id: number | null;
  seqite: number | null;
  nome: string;
  pai: ChaveNo | null;
  inicio: string | null;
  fim: string | null;
}

export interface ArvoreDatas {
  nos: Map<ChaveNo, NoDatas>;
  filhos: Map<ChaveNo, ChaveNo[]>;
}

export interface Faixa {
  inicio: string | null;
  fim: string | null;
  /** Nome do ancestral de onde vem cada limite (pra mensagem de erro). */
  origemInicio: string | null;
  origemFim: string | null;
}

export interface ImpactoData {
  chave: ChaveNo;
  id: number | null;
  seqite: number | null;
  tipo: "item" | "pasta" | "atividade";
  nome: string;
  /** Pastas/item acima, da raiz até o pai — só pra o usuário se situar na lista. */
  caminho: string;
  inicio: string | null;
  fim: string | null;
  novoInicio: string | null;
  novoFim: string | null;
  /** true = é o próprio nó que está sendo alterado/movido (e não um descendente dele). */
  proprio: boolean;
}

export interface PlanoAlteracao {
  erro: string | null;
  impactos: ImpactoData[];
  /** Datas finais do próprio nó (já encaixadas, se ele foi movido pra fora do período do novo pai). */
  inicioFinal: string | null;
  fimFinal: string | null;
}

export function paraIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function paraBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/** Normaliza o que veio no body ("2026-10-01", ISO completo ou vazio) para "AAAA-MM-DD" | null. */
export function normalizarDataEntrada(valor: unknown): string | null {
  if (valor == null || valor === "") return null;
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(valor)) return null;
  const iso = valor.slice(0, 10);
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function paraDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

export async function carregarArvoreDatas(codemp: number, codpro: number, client: typeof prisma = prisma): Promise<ArvoreDatas> {
  const [itens, nosDb, posicoes, planejamentos] = await Promise.all([
    client.propostaItem.findMany({ where: { codemp, codpro, removidoEmSenior: null }, select: { seqite: true, despro: true, codser: true } }),
    client.estruturaAtividade.findMany({
      where: { codemp, codpro },
      select: { id: true, seqite: true, parentId: true, tipo: true, nome: true, dataPrevistaInicio: true, dataPrevistaFim: true },
    }),
    client.propostaItemPosicao.findMany({ where: { codemp, codpro } }),
    client.propostaItemPlanejamento.findMany({ where: { codemp, codpro } }),
  ]);

  const nos = new Map<ChaveNo, NoDatas>();
  const seqitesVivos = new Set(itens.map((i) => i.seqite));
  const posicaoPorSeqite = new Map(posicoes.map((p) => [p.seqite, p.parentId]));
  const planejamentoPorSeqite = new Map(planejamentos.map((p) => [p.seqite, p]));

  for (const i of itens) {
    const plan = planejamentoPorSeqite.get(i.seqite);
    const pai = posicaoPorSeqite.get(i.seqite);
    nos.set(chaveItem(i.seqite), {
      chave: chaveItem(i.seqite),
      tipo: "item",
      id: null,
      seqite: i.seqite,
      nome: i.despro ?? i.codser,
      pai: pai != null ? chaveNo(pai) : null,
      inicio: paraIso(plan?.dataPrevistaInicio),
      fim: paraIso(plan?.dataPrevistaFim),
    });
  }
  for (const n of nosDb) {
    // Nó de item que sumiu do Senior fica fora da árvore (o Cronograma também esconde).
    if (n.seqite != null && !seqitesVivos.has(n.seqite)) continue;
    nos.set(chaveNo(n.id), {
      chave: chaveNo(n.id),
      tipo: n.tipo === "atividade" ? "atividade" : "pasta",
      id: n.id,
      seqite: n.seqite,
      nome: n.nome,
      pai: n.parentId != null ? chaveNo(n.parentId) : n.seqite != null ? chaveItem(n.seqite) : null,
      inicio: paraIso(n.dataPrevistaInicio),
      fim: paraIso(n.dataPrevistaFim),
    });
  }

  const filhos = new Map<ChaveNo, ChaveNo[]>();
  for (const no of nos.values()) {
    if (no.pai == null || !nos.has(no.pai)) continue;
    if (!filhos.has(no.pai)) filhos.set(no.pai, []);
    filhos.get(no.pai)!.push(no.chave);
  }
  return { nos, filhos };
}

/**
 * Limite de datas imposto por `chaveInicial` e seus ancestrais: o primeiro que tem início dá o
 * limite inferior, o primeiro que tem fim dá o superior (cada lado separado). `chaveInicial` é
 * considerado — pra validar um nó, passe o PAI dele; pra validar uma alocação, a própria atividade.
 */
export function limitesHerdados(arv: ArvoreDatas, chaveInicial: ChaveNo | null): Faixa {
  const faixa: Faixa = { inicio: null, fim: null, origemInicio: null, origemFim: null };
  let atual = chaveInicial != null ? arv.nos.get(chaveInicial) : undefined;
  // Guarda contra ciclo de dado corrompido — a árvore real tem poucos níveis.
  for (let passos = 0; atual && passos < 64; passos++) {
    if (faixa.inicio == null && atual.inicio != null) {
      faixa.inicio = atual.inicio;
      faixa.origemInicio = atual.nome;
    }
    if (faixa.fim == null && atual.fim != null) {
      faixa.fim = atual.fim;
      faixa.origemFim = atual.nome;
    }
    if (faixa.inicio != null && faixa.fim != null) break;
    atual = atual.pai != null ? arv.nos.get(atual.pai) : undefined;
  }
  return faixa;
}

export function validarNaFaixa(faixa: Faixa, inicio: string | null, fim: string | null): string | null {
  const erros: string[] = [];
  const checar = (valor: string | null, rotulo: string) => {
    if (valor == null) return;
    if (faixa.inicio != null && valor < faixa.inicio) {
      erros.push(`A data de ${rotulo} (${paraBr(valor)}) fica antes do início de "${faixa.origemInicio}" (${paraBr(faixa.inicio)}).`);
    } else if (faixa.fim != null && valor > faixa.fim) {
      erros.push(`A data de ${rotulo} (${paraBr(valor)}) fica depois do fim de "${faixa.origemFim}" (${paraBr(faixa.fim)}).`);
    }
  };
  checar(inicio, "início");
  checar(fim, "fim");
  return erros.length > 0 ? erros.join(" ") : null;
}

function encaixar(valor: string | null, faixa: { inicio: string | null; fim: string | null }): string | null {
  if (valor == null) return null;
  if (faixa.inicio != null && valor < faixa.inicio) return faixa.inicio;
  if (faixa.fim != null && valor > faixa.fim) return faixa.fim;
  return valor;
}

function descendentes(arv: ArvoreDatas, chave: ChaveNo): NoDatas[] {
  const saida: NoDatas[] = [];
  const pilha = [...(arv.filhos.get(chave) ?? [])].reverse();
  while (pilha.length > 0) {
    const atual = arv.nos.get(pilha.pop()!);
    if (!atual) continue;
    saida.push(atual);
    pilha.push(...[...(arv.filhos.get(atual.chave) ?? [])].reverse());
  }
  return saida;
}

function caminhoDe(arv: ArvoreDatas, no: NoDatas): string {
  const partes: string[] = [];
  let atual = no.pai != null ? arv.nos.get(no.pai) : undefined;
  for (let passos = 0; atual && passos < 64; passos++) {
    partes.unshift(atual.nome);
    atual = atual.pai != null ? arv.nos.get(atual.pai) : undefined;
  }
  return partes.join(" › ");
}

function impactoDe(arv: ArvoreDatas, no: NoDatas, novoInicio: string | null, novoFim: string | null, proprio: boolean): ImpactoData {
  return {
    chave: no.chave,
    id: no.id,
    seqite: no.seqite,
    tipo: no.tipo,
    nome: no.nome,
    caminho: caminhoDe(arv, no),
    inicio: no.inicio,
    fim: no.fim,
    novoInicio,
    novoFim,
    proprio,
  };
}

/**
 * Valida e planeja uma alteração de datas e/ou de pai de um nó:
 *  - `datasEditadas`: o usuário digitou datas pro nó — se não couberem no pai, é erro (ele corrige);
 *  - sem datas editadas (só mudou de pai), o nó é encaixado no período do novo pai e listado como
 *    impacto `proprio`;
 *  - em qualquer caso, os descendentes que ficam fora do período do nó viram impactos.
 * Quem chama decide se pede confirmação ao usuário (409) ou aplica o ajuste.
 */
export function planejarAlteracao(
  arv: ArvoreDatas,
  chave: ChaveNo,
  opts: { paiDestino: ChaveNo | null; inicio: string | null; fim: string | null; datasEditadas: boolean }
): PlanoAlteracao {
  const no = arv.nos.get(chave);
  const faixaPai = limitesHerdados(arv, opts.paiDestino);
  const impactos: ImpactoData[] = [];
  let inicioFinal = opts.inicio;
  let fimFinal = opts.fim;

  if (opts.datasEditadas) {
    const erro = validarNaFaixa(faixaPai, opts.inicio, opts.fim);
    if (erro) return { erro, impactos: [], inicioFinal, fimFinal };
  } else if (no) {
    inicioFinal = encaixar(opts.inicio, faixaPai);
    fimFinal = encaixar(opts.fim, faixaPai);
    if (inicioFinal !== opts.inicio || fimFinal !== opts.fim) impactos.push(impactoDe(arv, no, inicioFinal, fimFinal, true));
  }

  // Descendentes cabem no período do próprio nó; o lado que ele não define herda do pai.
  const faixaSub = { inicio: inicioFinal ?? faixaPai.inicio, fim: fimFinal ?? faixaPai.fim };
  for (const d of descendentes(arv, chave)) {
    const novoInicio = encaixar(d.inicio, faixaSub);
    const novoFim = encaixar(d.fim, faixaSub);
    if (novoInicio !== d.inicio || novoFim !== d.fim) impactos.push(impactoDe(arv, d, novoInicio, novoFim, false));
  }
  return { erro: null, impactos, inicioFinal, fimFinal };
}

export interface AlocacaoReajustada {
  antes: AtividadeConsultor;
  inicio: Date | null;
  fim: Date | null;
}

/**
 * Operações que gravam as datas ajustadas (nós, planejamento de item e alocações vinculadas às
 * atividades). Devolve também as alocações que mudaram — quem chama as audita e as reenvia ao Senior
 * DEPOIS do commit. Roda tudo numa transação do chamador (`prisma.$transaction([...operacoes, ...])`).
 */
export async function montarOperacoesAjuste(
  codemp: number,
  codpro: number,
  impactos: ImpactoData[],
  atualizadoPor: number | null
): Promise<{ operacoes: Prisma.PrismaPromise<unknown>[]; alocacoes: AlocacaoReajustada[] }> {
  const operacoes: Prisma.PrismaPromise<unknown>[] = [];
  const idsAtividades: number[] = [];

  for (const i of impactos) {
    if (i.tipo === "item" && i.seqite != null) {
      operacoes.push(
        prisma.propostaItemPlanejamento.upsert({
          where: { codemp_codpro_seqite: { codemp, codpro, seqite: i.seqite } },
          create: { codemp, codpro, seqite: i.seqite, dataPrevistaInicio: paraDate(i.novoInicio), dataPrevistaFim: paraDate(i.novoFim), atualizadoPor },
          update: { dataPrevistaInicio: paraDate(i.novoInicio), dataPrevistaFim: paraDate(i.novoFim), atualizadoPor },
        })
      );
    } else if (i.id != null) {
      operacoes.push(
        prisma.estruturaAtividade.update({
          where: { id: i.id },
          data: { dataPrevistaInicio: paraDate(i.novoInicio), dataPrevistaFim: paraDate(i.novoFim) },
        })
      );
      if (i.tipo === "atividade") idsAtividades.push(i.id);
    }
  }

  const alocacoes: AlocacaoReajustada[] = [];
  if (idsAtividades.length > 0) {
    const vinculadas = await prisma.atividadeConsultor.findMany({ where: { estruturaAtividadeId: { in: idsAtividades }, sitreg: "A" } });
    const novoPorId = new Map(impactos.filter((i) => i.id != null).map((i) => [i.id!, i]));
    for (const a of vinculadas) {
      const impacto = novoPorId.get(a.estruturaAtividadeId!);
      if (!impacto) continue;
      const inicio = paraDate(impacto.novoInicio);
      const fim = paraDate(impacto.novoFim);
      if (paraIso(a.dataPrevistaInicio) === impacto.novoInicio && paraIso(a.dataPrevistaFim) === impacto.novoFim) continue;
      operacoes.push(prisma.atividadeConsultor.update({ where: { id: a.id }, data: { dataPrevistaInicio: inicio, dataPrevistaFim: fim } }));
      alocacoes.push({ antes: a, inicio, fim });
    }
  }
  return { operacoes, alocacoes };
}
