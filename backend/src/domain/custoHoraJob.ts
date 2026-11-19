import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  calcularCustoClt,
  chaveConta,
  competenciaDia1,
  escolherCusto,
  mesSeguinte,
  precoEhMensal,
  valorManualEm,
  type LancamentoFolha,
  type OrigemCusto,
  type PeriodoMensal,
  type RegraContaFolha,
} from "./custoHora";
import { carregarPlano } from "./rentabilidade/calculo";
import { contasSelecionadas } from "./rentabilidade/indicadores";
import { contratoFixoDe, type ContratoFixo } from "./contratoFixo";
import { linhaDoTempoDoContrato, valorHoraEm, type VigenciaValorHora } from "./valorHoraConsultor";

// Job do CUSTO-HORA REAL por consultor e mês (bloco C da Rentabilidade, 18/11/2026). Lê só o que já está espelhado no CaxHub (contabilização da folha do HCM, contratos
// de compra do Senior, vínculos, valor manual e a configuração custo_*) e grava o resultado em consultor_custo_hora. Não escreve em nenhum sistema
// externo. A regra de qual fonte vale e a conta do CLT estão em custoHora.ts (puro, testado); aqui só o banco.

export const JOB_NAME = "custo-hora-job";
export const CRON_EXPR = "40 6 * * *";
/** Quantos meses (contando o atual) o job diário recalcula: a folha fecha depois do mês e o contrato pode ser reajustado com data retroativa. */
const MESES_RECALCULADOS_NO_AGENDAMENTO = 3;

export interface ResultadoRecalculo {
  competencias: string[];
  gravados: number;
  porOrigem: Record<OrigemCusto, number>;
  /** Consultores ativos sem custo definido em cada competência calculada (soma de pares consultor × mês). */
  semCusto: number;
  avisos: string[];
}

const ISO = (d: Date) => d.toISOString().slice(0, 10);

/** Os `quantos` últimos meses (dia 1), do mais antigo ao atual. */
export function ultimasCompetencias(quantos: number, hoje = new Date()): string[] {
  const saida: string[] = [];
  let ano = hoje.getUTCFullYear();
  let mes = hoje.getUTCMonth() + 1;
  for (let i = 0; i < quantos; i++) {
    saida.unshift(`${ano}-${String(mes).padStart(2, "0")}-01`);
    mes--;
    if (mes < 1) {
      mes = 12;
      ano--;
    }
  }
  return saida;
}

interface ConfigCusto {
  horasMes: number | null;
  /** Regras de quais contas do plano compõem o custo do CLT (custo_contas_folha). */
  regras: RegraContaFolha[];
}

export async function carregarConfigCusto(): Promise<ConfigCusto> {
  const [parametros, contas] = await Promise.all([prisma.custoParametro.findMany(), prisma.custoContaFolha.findMany()]);
  const p = new Map(parametros.map((x) => [x.chave, x.valor]));
  const horas = Number(p.get("horas_mes"));
  return {
    horasMes: p.has("horas_mes") && Number.isFinite(horas) && horas > 0 ? horas : null,
    regras: contas.map((c) => ({ codemp: c.codemp, ctared: c.ctared, acao: c.acao as "incluir" | "excluir" })),
  };
}

interface LancamentosDoMes {
  competencia: string;
  codemp: number;
  codusu: number;
  lancamento: LancamentoFolha;
}

/**
 * Contabilização da folha por consultor VINCULADO ao HCM e mês: só o que foi contabilizado a DÉBITO (decisão da diretoria, 19/11/2026), por conta e opção
 * (folha/provisões). Os créditos não entram no custo. A empresa da conta é a do HCM
 * (`numemp`), que na Soeltech é a mesma do plano do ERP. Só a linha original (perrat = 0) está no espelho.
 */
async function lancamentosDaFolha(competencias: string[]): Promise<LancamentosDoMes[]> {
  const min = competencias[0];
  const max = mesSeguinte(competencias[competencias.length - 1]);
  const linhas = await prisma.$queryRaw<{ competencia: Date; codemp: number; codusu: number; numemp: number; ctared: number; opcctb: number | null; valor: number }[]>`
    SELECT date_trunc('month', c.datlan)::date AS competencia, cv.codemp, cv.codusu, c.numemp, c.ctared, c.opcctb,
           SUM(c.vallan)::float8 AS valor
    FROM hcm_contabilizacao_folha c
    JOIN consultor_vinculos cv ON cv.hcm_numemp = c.numemp AND cv.hcm_tipcol = c.tipcol AND cv.hcm_numcad = c.numcad
    WHERE c.debcre = 'D' AND c.ctared IS NOT NULL AND c.datlan >= ${min}::date AND c.datlan < ${max}::date
    GROUP BY 1, 2, 3, 4, 5, 6`;
  return linhas.map((l) => ({ competencia: ISO(l.competencia), codemp: l.codemp, codusu: l.codusu, lancamento: { conta: chaveConta(l.numemp, l.ctared), opcctb: l.opcctb, valor: l.valor } }));
}

interface ContratoPj {
  vigencias: VigenciaValorHora[];
  /** Primeiro mês (dia 1) em que o contrato vale (emissão) e último (cancelamento), quando existem. */
  desde: string | null;
  ate: string | null;
  /** O preço do item é mensal (escolha por consultor, com período): nesses meses o custo-hora é o preço ÷ horas da escala. Não vale para contrato fixo. */
  mensal: PeriodoMensal;
  /**
   * Contrato de VALOR FIXO (codmot 12 + quantidade, como na Home): o valor-hora é o `vlrhor` da view (nota = vlrhor × qtdctr) e não o histórico de
   * reajuste, que nesses contratos mistura valor por hora e total do mês (ver `linhaDoTempoDoContrato`).
   */
  fixo: ContratoFixo | null;
}

async function contratosPj(mensais: Map<string, PeriodoMensal>): Promise<Map<string, ContratoPj>> {
  const contratos = await prisma.contratoConsultor.findMany({ where: { removidoEmSenior: null, numctr: { not: null } } });
  const numctrs = contratos.map((c) => c.numctr as number);
  if (numctrs.length === 0) return new Map();
  const [itens, reajustes, cabecalhos] = await Promise.all([
    prisma.contratoCompraServico.findMany({ where: { numctr: { in: numctrs }, removidoEmSenior: null } }),
    prisma.contratoCompraReajuste.findMany({ where: { numctr: { in: numctrs }, removidoEmSenior: null } }),
    prisma.contratoCompra.findMany({ where: { numctr: { in: numctrs }, removidoEmSenior: null }, select: { codemp: true, numctr: true, datemi: true, datcan: true } }),
  ]);
  const saida = new Map<string, ContratoPj>();
  for (const c of contratos) {
    const doContrato = itens.filter((i) => i.codemp === c.codemp && i.numctr === c.numctr && i.sitccs === "A").sort((a, b) => a.seqccs - b.seqccs);
    const item = doContrato[0];
    const precoAtual = item ? Number(item.preuni) : c.vlrhor != null ? Number(c.vlrhor) : null;
    const doItem = item ? reajustes.filter((r) => r.codemp === c.codemp && r.numctr === c.numctr && r.seqccs === item.seqccs) : [];
    const vlrhorDaView = c.vlrhor == null ? null : Number(c.vlrhor);
    const fixo = vlrhorDaView == null ? null : contratoFixoDe({ codmot: c.codmot, vlrhor: vlrhorDaView, qtdctr: c.qtdctr == null ? null : Number(c.qtdctr) });
    const { vigencias } = linhaDoTempoDoContrato({
      fixo: !!fixo,
      vlrhorDaView,
      reajustes: doItem.map((r) => ({ ultrea: ISO(r.ultrea), vlrrea: r.vlrrea == null ? null : Number(r.vlrrea), vlratu: r.vlratu == null ? null : Number(r.vlratu) })),
      precoAtualDoItem: precoAtual,
    });
    const cab = cabecalhos.find((h) => h.codemp === c.codemp && h.numctr === c.numctr);
    saida.set(`${c.codemp}-${c.codusu}`, {
      vigencias,
      desde: cab?.datemi ? `${ISO(cab.datemi).slice(0, 7)}-01` : null,
      ate: cab?.datcan ? `${ISO(cab.datcan).slice(0, 7)}-01` : null,
      mensal: mensais.get(`${c.codemp}-${c.codusu}`) ?? { mensal: false, desde: null, ate: null },
      fixo,
    });
  }
  return saida;
}

/**
 * Recalcula o custo-hora das competências (dia 1) informadas: apaga o que havia nelas e grava de novo, na mesma transação. Consultor que não tem
 * nenhuma fonte no mês simplesmente não tem linha (e entra em `semCusto`). Consultores removidos do Senior ficam de fora; inativos entram (o
 * histórico deles ainda é custo de meses passados).
 */
export async function recalcularCustoHora(competenciasBrutas: string[]): Promise<ResultadoRecalculo> {
  const competencias = [...new Set(competenciasBrutas.map((c) => competenciaDia1(c)).filter((c): c is string => !!c))].sort();
  const avisos: string[] = [];
  const porOrigem: Record<OrigemCusto, number> = { clt_folha: 0, pj_contrato: 0, manual: 0 };
  if (competencias.length === 0) return { competencias, gravados: 0, porOrigem, semCusto: 0, avisos: ["Nenhuma competência válida informada."] };

  const config = await carregarConfigCusto();
  const contasEscolhidas = config.regras.length > 0 ? contasSelecionadas(config.regras, await carregarPlano()) : new Set<string>();
  const folhaConfigurada = config.horasMes != null && contasEscolhidas.size > 0;
  if (!folhaConfigurada) {
    const faltas = [config.horasMes == null ? "horas da escala" : null, config.regras.length === 0 ? "contas da folha" : contasEscolhidas.size === 0 ? "contas da folha (nenhuma conta analítica selecionada)" : null].filter(Boolean);
    avisos.push(`O custo do CLT (contabilização da folha) não foi calculado: falta configurar ${faltas.join(" e ")} em Administração › Custo-hora real.`);
  } else if ((await prisma.hcmContabilizacaoFolha.count()) === 0) {
    avisos.push("A contabilização da folha (R048CTB) ainda não foi importada do HCM: sincronize \"Contabilização da Folha (HCM)\" em Importados do HCM.");
  }

  const [consultores, folha, pj, manuais] = await Promise.all([
    prisma.consultor.findMany({ where: { removidoEmSenior: null }, select: { codemp: true, codusu: true, sitfor: true, vinculo: { select: { hcmNumcad: true, contratoMensal: true } } } }),
    folhaConfigurada ? lancamentosDaFolha(competencias) : Promise.resolve([] as LancamentosDoMes[]),
    prisma.consultorVinculo
      .findMany({ where: { contratoMensal: true }, select: { codemp: true, codusu: true, mensalDesde: true, mensalAte: true } })
      .then((v) => contratosPj(new Map(v.map((x) => [`${x.codemp}-${x.codusu}`, { mensal: true, desde: x.mensalDesde ? ISO(x.mensalDesde) : null, ate: x.mensalAte ? ISO(x.mensalAte) : null }])))),
    prisma.consultorValorHoraManual.findMany(),
  ]);
  if (config.horasMes == null && [...pj.values()].some((c) => c.mensal.mensal && !c.fixo)) {
    avisos.push("Há contrato PJ marcado como MENSAL, mas faltam as horas da escala: o custo-hora desses consultores não foi calculado.");
  }

  const folhaPor = new Map<string, LancamentoFolha[]>();
  for (const f of folha) {
    const chave = `${f.competencia}|${f.codemp}-${f.codusu}`;
    folhaPor.set(chave, [...(folhaPor.get(chave) ?? []), f.lancamento]);
  }
  const manualPor = new Map<string, { vigenciaInicio: string; valor: number }[]>();
  for (const m of manuais) {
    const k = `${m.codemp}-${m.codusu}`;
    manualPor.set(k, [...(manualPor.get(k) ?? []), { vigenciaInicio: ISO(m.vigenciaInicio), valor: Number(m.valor) }]);
  }

  const linhas: Prisma.ConsultorCustoHoraCreateManyInput[] = [];
  let semCusto = 0;
  for (const c of consultores) {
    const chave = `${c.codemp}-${c.codusu}`;
    for (const competencia of competencias) {
      let clt: number | null = null;
      let detalheClt: object | null = null;
      const doMes = folhaPor.get(`${competencia}|${chave}`);
      if (folhaConfigurada && doMes) {
        const r = calcularCustoClt({ lancamentos: doMes, contas: contasEscolhidas, horasMes: config.horasMes as number });
        if (r) {
          clt = r.custoHora;
          detalheClt = r.detalhe;
        }
      }
      const contrato = pj.get(chave);
      const dentroDoContrato = !!contrato && (!contrato.desde || competencia >= contrato.desde) && (!contrato.ate || competencia <= contrato.ate);
      const precoNoMes = contrato && dentroDoContrato ? valorHoraEm(contrato.vigencias, competencia) : null;
      // Contrato mensal: o preço é o valor do mês, então o custo-hora é preço ÷ horas da escala (sem as horas, não há como calcular).
      // Contrato fixo: o valor já é por hora (vlrhor da view) — a marca de "preço mensal" não se aplica.
      const mensalNoMes = !!contrato && !contrato.fixo && precoEhMensal(contrato.mensal, competencia);
      const valorPj = precoNoMes == null ? null : mensalNoMes ? (config.horasMes ? Math.round((precoNoMes / config.horasMes) * 10000) / 10000 : null) : precoNoMes;
      const valorManual = valorManualEm(manualPor.get(chave) ?? [], competencia);

      const escolhido = escolherCusto({ clt, pj: valorPj, manual: valorManual });
      if (!escolhido) {
        if (c.sitfor === "A") semCusto++;
        continue;
      }
      porOrigem[escolhido.origem]++;
      linhas.push({
        codemp: c.codemp,
        codusu: c.codusu,
        competencia: new Date(`${competencia}T00:00:00Z`),
        origem: escolhido.origem,
        custoHora: escolhido.custoHora,
        detalhe:
          escolhido.origem === "clt_folha"
            ? (detalheClt as Prisma.InputJsonValue)
            : escolhido.origem === "pj_contrato"
              ? ({ precoContrato: precoNoMes, mensal: mensalNoMes, horasMes: mensalNoMes ? config.horasMes : null, fixo: contrato?.fixo ? { qtd: contrato.fixo.qtd, valorMensal: contrato.fixo.valorMensal } : null } as Prisma.InputJsonValue)
              : undefined,
      });
    }
  }

  await prisma.$transaction([
    prisma.consultorCustoHora.deleteMany({ where: { competencia: { in: competencias.map((c) => new Date(`${c}T00:00:00Z`)) } } }),
    prisma.consultorCustoHora.createMany({ data: linhas }),
  ]);
  return { competencias, gravados: linhas.length, porOrigem, semCusto, avisos };
}

/** Roda e registra em sync_log (o painel de Sincronização mostra o último resultado). Nunca lança. */
export async function executarJobCustoHora(competencias?: string[]): Promise<ResultadoRecalculo | null> {
  const inicio = Date.now();
  try {
    const r = await recalcularCustoHora(competencias ?? ultimasCompetencias(MESES_RECALCULADOS_NO_AGENDAMENTO));
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: "(cálculo interno — folha do HCM, contratos de compra, vínculos e valor manual)",
        status: "success",
        message:
          `${r.gravados} custos-hora gravados em ${r.competencias.length} competência(s): ${r.porOrigem.clt_folha} CLT, ${r.porOrigem.pj_contrato} PJ, ${r.porOrigem.manual} manual; ` +
          `${r.semCusto} consultor(es) ativo(s) sem custo` +
          (r.avisos.length ? ` — ${r.avisos.join(" ")}` : ""),
        duracaoMs: Date.now() - inicio,
      },
    });
    return r;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({ data: { jobName: JOB_NAME, query: "(cálculo interno)", status: "error", message, duracaoMs: Date.now() - inicio } });
    console.error(`[${JOB_NAME}] falhou:`, message);
    return null;
  }
}

// Depois de todas as syncs da madrugada (HCM e contratos do Senior): 6h40.
export function scheduleCustoHoraJob(): void {
  cron.schedule(CRON_EXPR, () => void executarJobCustoHora());
}

