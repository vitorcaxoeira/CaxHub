import { Acumulacao, arredonda2, atingimento, atingimentoGeral, Consolidado, consolidar, distribuirPorPesos, LinhaMes } from "./calculo";

// Monta o painel da Gestão de Metas do Comercial a partir de linhas já carregadas (sem banco), para ser testável com os números da
// planilha. Empresa: meta anual × peso do mês (SOMA) ou posição-alvo constante (SALDO); realizado = soma das pessoas (incluindo a linha
// "Não atribuído") ou, para os indicadores de origem Senior, a série do Senior: Faturamento (NFs fechadas) e Mensalidade (foto
// mensal da carteira de contratos, relatório RVTR101).

export interface IndicadorDef {
  id: number;
  codigo: string;
  nome: string;
  unidade: string;
  acumulacao: Acumulacao;
  origem: string;
  ordem: number;
}

export interface ParticipanteDef {
  id: number;
  nome: string;
  funcao: string | null;
  naoAtribuido: boolean;
  ordem: number;
  indicadores: Array<{ indicadorId: number; rotulo: string | null; ordem: number }>;
}

export interface LancamentoDef {
  participanteId: number;
  indicadorId: number;
  mes: number;
  meta: number | null;
  realizado: number | null;
}

export interface EntradaPainel {
  ano: number;
  periodo: string;
  meses: number[];
  pesos: number[];
  indicadores: IndicadorDef[];
  /** indicadorId → meta anual da empresa. */
  metasEmpresa: Map<number, number>;
  participantes: ParticipanteDef[];
  lancamentos: LancamentoDef[];
  /** Realizado que vem do Senior, por origem do indicador (FATURAMENTO_SENIOR, CARTEIRA_SENIOR): 12 posições, null = sem valor. */
  realizadoSenior: Record<string, Array<number | null>>;
  /** Realizado do Senior POR PESSOA (origem -> participanteId -> 12 meses), para as origens que se dividem por pessoa (horas das
   * propostas, pelo representante de cada uma). Quando existe, substitui o lançamento digitado na linha da pessoa. */
  realizadoSeniorPessoa?: Record<string, Map<number, Array<number | null>>>;
}

export interface CelulaMes {
  mes: number;
  meta: number | null;
  realizado: number | null;
  atingimento: number | null;
}

export interface PontoSerie {
  mes: number;
  meta: number;
  /** Nulo nos meses depois do último com realizado. */
  realizado: number | null;
}

export interface IndicadorEmpresa {
  indicadorId: number;
  codigo: string;
  nome: string;
  unidade: string;
  acumulacao: Acumulacao;
  origem: string;
  metaAnual: number | null;
  consolidado: Consolidado;
  /** Soma das metas das pessoas no período (SOMA). Serve para conferir contra a meta da empresa. */
  metaDasPessoas: number | null;
  mensal: CelulaMes[];
  serie: PontoSerie[];
}

export interface IndicadorPessoa {
  indicadorId: number;
  nome: string;
  rotulo: string;
  unidade: string;
  acumulacao: Acumulacao;
  consolidado: Consolidado;
  mensal: CelulaMes[];
}

export interface PessoaPainel {
  participanteId: number;
  nome: string;
  funcao: string | null;
  naoAtribuido: boolean;
  atingimentoGeral: number | null;
  indicadores: IndicadorPessoa[];
}

export interface Painel {
  ano: number;
  periodo: string;
  meses: number[];
  atingimentoGeral: number | null;
  indicadores: IndicadorEmpresa[];
  pessoas: PessoaPainel[];
}

const celula = (mes: number, meta: number | null, realizado: number | null): CelulaMes => ({
  mes,
  meta,
  realizado,
  atingimento: meta != null && realizado != null ? atingimento(realizado, meta) : null,
});

export function montarPainel(e: EntradaPainel): Painel {
  const porPessoaIndicador = new Map<string, LancamentoDef[]>();
  for (const l of e.lancamentos) {
    const k = `${l.participanteId}:${l.indicadorId}`;
    const lista = porPessoaIndicador.get(k);
    if (lista) lista.push(l);
    else porPessoaIndicador.set(k, [l]);
  }
  const lancDe = (pid: number, iid: number) => porPessoaIndicador.get(`${pid}:${iid}`) ?? [];

  const usados = new Set<number>([...e.metasEmpresa.keys()]);
  for (const p of e.participantes) for (const pi of p.indicadores) usados.add(pi.indicadorId);
  const defs = e.indicadores.filter((i) => usados.has(i.id)).sort((a, b) => a.ordem - b.ordem || a.id - b.id);

  const indicadores: IndicadorEmpresa[] = defs.map((ind) => {
    const metaAnual = e.metasEmpresa.get(ind.id) ?? null;
    const metasMes = metaAnual == null ? null : ind.acumulacao === "SALDO" ? new Array<number>(12).fill(metaAnual) : distribuirPorPesos(metaAnual, e.pesos);
    const linhas: LinhaMes[] = [];
    const mensal: CelulaMes[] = [];
    for (let mes = 1; mes <= 12; mes++) {
      let realizado: number | null = null;
      if (ind.origem !== "MANUAL") {
        const v = e.realizadoSenior[ind.origem]?.[mes - 1];
        realizado = v == null ? null : arredonda2(v);
      } else {
        for (const p of e.participantes) {
          const l = lancDe(p.id, ind.id).find((x) => x.mes === mes);
          if (l?.realizado != null) realizado = (realizado ?? 0) + l.realizado;
        }
        if (realizado != null) realizado = arredonda2(realizado);
      }
      const meta = metasMes ? metasMes[mes - 1] : null;
      linhas.push({ mes, meta, realizado });
      mensal.push(celula(mes, meta, realizado));
    }
    const consolidado = consolidar(linhas, ind.acumulacao, e.meses);

    let metaDasPessoas: number | null = null;
    if (ind.acumulacao === "SOMA") {
      const quem = e.participantes.filter((p) => p.indicadores.some((pi) => pi.indicadorId === ind.id));
      if (quem.length > 0) metaDasPessoas = arredonda2(quem.reduce((a, p) => a + consolidar(lancDe(p.id, ind.id), "SOMA", e.meses).meta, 0));
    }

    // Série acumulada do ano inteiro (gráfico meta × realizado). SALDO não acumula: é a posição de cada mês.
    const ultimoComRealizado = Math.max(0, ...linhas.filter((l) => l.realizado != null).map((l) => l.mes));
    let metaAcum = 0;
    let realAcum = 0;
    const serie: PontoSerie[] = linhas.map((l) => {
      if (ind.acumulacao === "SALDO") return { mes: l.mes, meta: l.meta ?? 0, realizado: l.realizado };
      metaAcum += l.meta ?? 0;
      realAcum += l.realizado ?? 0;
      return { mes: l.mes, meta: arredonda2(metaAcum), realizado: l.mes <= ultimoComRealizado ? arredonda2(realAcum) : null };
    });

    return { indicadorId: ind.id, codigo: ind.codigo, nome: ind.nome, unidade: ind.unidade, acumulacao: ind.acumulacao, origem: ind.origem, metaAnual, consolidado, metaDasPessoas, mensal, serie };
  });

  const pessoas: PessoaPainel[] = [...e.participantes]
    .sort((a, b) => Number(a.naoAtribuido) - Number(b.naoAtribuido) || a.ordem - b.ordem || a.id - b.id)
    .map((p) => {
      const itens: IndicadorPessoa[] = [...p.indicadores]
        .sort((a, b) => a.ordem - b.ordem)
        .map((pi) => {
          const ind = e.indicadores.find((i) => i.id === pi.indicadorId);
          if (!ind) return null;
          const lancs = lancDe(p.id, ind.id);
          const linhas: LinhaMes[] = Array.from({ length: 12 }, (_, i) => {
            const l = lancs.find((x) => x.mes === i + 1);
            const seriePessoa = ind.origem !== "MANUAL" ? e.realizadoSeniorPessoa?.[ind.origem] : undefined;
            const realizado = seriePessoa ? (seriePessoa.get(p.id)?.[i] ?? null) : (l?.realizado ?? null);
            return { mes: i + 1, meta: l?.meta ?? null, realizado };
          });
          return {
            indicadorId: ind.id,
            nome: ind.nome,
            rotulo: pi.rotulo?.trim() || ind.nome,
            unidade: ind.unidade,
            acumulacao: ind.acumulacao,
            consolidado: consolidar(linhas, ind.acumulacao, e.meses),
            mensal: linhas.map((l) => celula(l.mes, l.meta, l.realizado)),
          };
        })
        .filter((x): x is IndicadorPessoa => x != null);
      return { participanteId: p.id, nome: p.nome, funcao: p.funcao, naoAtribuido: p.naoAtribuido, atingimentoGeral: atingimentoGeral(itens.map((i) => i.consolidado.atingimento)), indicadores: itens };
    });

  return {
    ano: e.ano,
    periodo: e.periodo,
    meses: e.meses,
    atingimentoGeral: atingimentoGeral(indicadores.map((i) => i.consolidado.atingimento)),
    indicadores,
    pessoas,
  };
}
