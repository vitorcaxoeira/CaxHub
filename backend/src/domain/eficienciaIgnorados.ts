// Só tipos de eficienciaDados: este arquivo é puro (sem banco) e dá pra testar sem Prisma.
import type { DadosEficiencia, ExecucaoDoConsultor } from "./eficienciaDados";

// "Ignorar" DENTRO de uma proposta (gaveta do Painel de Eficiência): a pessoa tira um ITEM, ou as horas de um CONSULTOR naquela
// proposta, da conta. É escolha pessoal (o navegador guarda e manda na consulta); nada é gravado no servidor.
//
// Diferente do check de consultor da aba Equipe (que só tira a pessoa dos indicadores de equipe e deixa as propostas como estão),
// aqui o efeito atinge a PROPOSTA: o item some do vendido/executado, ou as horas do consultor saem do executado dos itens.
// Como a transformação é feita nos dados já carregados, a lista, o resumo, a equipe, os clientes e a gaveta saem concordando.

export interface IgnoradosNaProposta {
  /** "codemp-codpro-seqite" */
  itens: Set<string>;
  /** "codemp-codpro-codfor" */
  consultores: Set<string>;
}

export const semIgnorados = (): IgnoradosNaProposta => ({ itens: new Set(), consultores: new Set() });
export const temIgnorados = (i: IgnoradosNaProposta) => i.itens.size > 0 || i.consultores.size > 0;

export const chaveItem = (codemp: number, codpro: number, seqite: number) => `${codemp}-${codpro}-${seqite}`;
export const chaveConsultorNaProposta = (codemp: number, codpro: number, codfor: number) => `${codemp}-${codpro}-${codfor}`;

const MAXIMO_POR_LISTA = 300;

// `ignorarItem=1:5937:6,1:5937:7` e `ignorarConsultorProposta=1:5937:280` (codemp:codpro:seqite / codemp:codpro:codfor).
// Lixo, repetido ou fora do formato é descartado sem erro.
export function lerIgnoradosNaProposta(q: { ignorarItem?: unknown; ignorarConsultorProposta?: unknown }): IgnoradosNaProposta {
  const ler = (bruto: unknown) => {
    const saida = new Set<string>();
    const texto = typeof bruto === "string" ? bruto : "";
    for (const parte of texto.split(",").slice(0, MAXIMO_POR_LISTA)) {
      const m = /^(\d+):(\d+):(\d+)$/.exec(parte.trim());
      if (m) saida.add(`${Number(m[1])}-${Number(m[2])}-${Number(m[3])}`);
    }
    return saida;
  };
  return { itens: ler(q.ignorarItem), consultores: ler(q.ignorarConsultorProposta) };
}

const partes = (k: string) => k.split("-").map(Number);
export const itensComoLista = (ign: IgnoradosNaProposta) => [...ign.itens].map(partes).map(([codemp, codpro, seqite]) => ({ codemp, codpro, seqite }));
export const consultoresComoLista = (ign: IgnoradosNaProposta) => [...ign.consultores].map(partes).map(([codemp, codpro, codfor]) => ({ codemp, codpro, codfor }));

// Propostas (codemp, codpro) das quais precisamos das horas por consultor: só as que têm consultor ignorado.
export function propostasComConsultorIgnorado(ign: IgnoradosNaProposta): { codemp: number; codpro: number }[] {
  const vistas = new Map<string, { codemp: number; codpro: number }>();
  for (const k of ign.consultores) {
    const [codemp, codpro] = k.split("-").map(Number);
    vistas.set(`${codemp}-${codpro}`, { codemp, codpro });
  }
  return [...vistas.values()];
}

export interface ResultadoIgnorados {
  dados: DadosEficiencia;
  /** Quantos dos marcados realmente existem nos dados (um item/consultor que sumiu do recorte não conta). */
  efetivos: { itens: number; consultores: number };
}

// Devolve uma CÓPIA dos dados sem os itens ignorados e sem as horas dos consultores ignorados. Não altera a entrada.
//  - item ignorado: sai da proposta (vendido, executado, estouro) e as alocações dele saem da equipe;
//  - consultor ignorado numa proposta: o que ele apontou sai do executado de cada item e a alocação dele naquela proposta sai da equipe.
// `execucao` = horas por (item, consultor) das propostas com consultor ignorado (ver carregarExecucaoPorConsultor).
export function aplicarIgnorados(dados: DadosEficiencia, ign: IgnoradosNaProposta, execucao: ExecucaoDoConsultor[]): ResultadoIgnorados {
  if (!temIgnorados(ign)) return { dados, efetivos: { itens: 0, consultores: 0 } };

  const minutosDoItem = new Map<string, number>();
  const consultoresComHoras = new Set<string>();
  for (const e of execucao) {
    const chaveConsultor = chaveConsultorNaProposta(e.codemp, e.codpro, e.codfor);
    if (!ign.consultores.has(chaveConsultor)) continue;
    consultoresComHoras.add(chaveConsultor);
    const k = chaveItem(e.codemp, e.codpro, e.seqite);
    minutosDoItem.set(k, (minutosDoItem.get(k) ?? 0) + e.minutos);
  }

  const itensEfetivos = new Set<string>();
  const consultoresEfetivos = new Set<string>(consultoresComHoras);
  const propostas = dados.propostas.map((p) => ({
    ...p,
    itens: p.itens
      .filter((i) => {
        const k = chaveItem(i.codemp, i.codpro, i.seqite);
        if (ign.itens.has(k)) {
          itensEfetivos.add(k);
          return false;
        }
        return true;
      })
      .map((i) => {
        const tirar = minutosDoItem.get(chaveItem(i.codemp, i.codpro, i.seqite)) ?? 0;
        return tirar > 0 ? { ...i, executado: Math.max(0, i.executado - tirar) } : i;
      }),
  }));

  const alocacoes = dados.alocacoes.filter((a) => {
    if (ign.itens.has(chaveItem(a.codemp, a.codpro, a.seqite))) return false;
    const k = chaveConsultorNaProposta(a.codemp, a.codpro, a.codfor);
    if (ign.consultores.has(k)) {
      consultoresEfetivos.add(k);
      return false;
    }
    return true;
  });

  return { dados: { ...dados, propostas, alocacoes }, efetivos: { itens: itensEfetivos.size, consultores: consultoresEfetivos.size } };
}
