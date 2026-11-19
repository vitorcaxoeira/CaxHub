import { runSqlViaSoap, runSqlViaSoapPaginated } from "../../soap/client";
import { prisma } from "../../db/prisma";
import { tabelaSenior } from "../../config/sistemaSenior";

// Espelho da R048CTB do HCM ("Contabilização - Nova"): o que a folha contabiliza por colaborador, nas contas do plano do ERP (19/11/2026). É a base do custo
// do CLT (domain/custoHoraJob.ts): traz salários, INSS patronal/RAT/terceiros, FGTS, provisões de 13º e férias, indenização, horas extras... já prontos,
// no lugar de classificar os eventos da folha e aplicar encargos em %.
//
// Escrito à mão (e não por definirSyncHcm/tabelasHcm.ts) porque o motor genérico exige chave primária para o upsert, e a R048CTB não tem nenhuma. A
// regravação é por MÊS: apaga as linhas do mês e insere as que o Senior tem hoje — assim lançamento estornado/recontabilizado também some daqui.
//
// SÓ as linhas originais (`perrat = 0`): a tabela repete cada lançamento numa cópia do rateio por CC (`perrat = 100`); no dado real nunca há rateio parcial,
// e em alguns lançamentos a cópia falta (colaborador 38, out/2026, conta 705), então a original é a completa.

export const JOB_NAME = "hcm-contabilizacao-folha-sync";
export const DISPLAY_NAME = "Contabilização da Folha (HCM)";
export const TABELA_LOCAL = "hcm_contabilizacao_folha";
const SISTEMA = "hcm" as const;

/** Quantos meses (contando o atual) a sync diária regrava. A folha é recontabilizada só em casos raros; 3 cobre o fechamento e uma correção. */
export const MESES_RECENTES = 3;
/** Tamanho do INSERT em lote do Prisma (createMany). */
const LOTE = 1000;

const COLUNAS_SENIOR = ["numemp", "tipcol", "numcad", "codcal", "codlot", "datlan", "opcctb", "orictb", "codclc", "cplhis", "debcre", "reddeb", "redcre", "codccu", "codfil", "vallan"] as const;

// Colunas que fecham a ORDEM da paginação: a tabela não tem chave única, então ordenamos por tudo que distingue as linhas (um mês cabe numa página só — ~3 mil
// linhas contra 10 mil por página —, a ordem total é a garantia extra).
const ORDEM = ["numemp", "tipcol", "numcad", "codcal", "codlot", "codclc", "debcre", "reddeb", "redcre", "codccu", "vallan", "cplhis"];

export interface LinhaR048 {
  numemp: number;
  tipcol: number;
  numcad: number;
  codcal?: number | null;
  codlot?: number | null;
  datlan: string;
  opcctb?: number | null;
  orictb?: string | null;
  codclc?: number | null;
  cplhis?: string | null;
  debcre: string;
  reddeb?: number | null;
  redcre?: number | null;
  codccu?: string | null;
  codfil?: number | null;
  vallan: number;
}

/** Query base do job (com o prefixo do banco do HCM, se houver) — também é a que o catálogo da tela de importação lê. */
export function queryBase(): string {
  return `SELECT ${COLUNAS_SENIOR.map((c) => `${c} AS ${c}`).join(", ")} FROM ${tabelaSenior("r048ctb", SISTEMA)}`;
}

export const QUERY = queryBase();

const textoOuNulo = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const t = String(v).replace(/\u0000/g, "").trim();
  return t === "" ? null : t;
};

/** Conta do plano que recebe o lançamento: a de débito no débito, a de crédito no crédito (0 = sem conta). */
export function contaDoLancamento(l: Pick<LinhaR048, "debcre" | "reddeb" | "redcre">): number | null {
  const c = l.debcre === "D" ? l.reddeb : l.redcre;
  return c ? Number(c) : null;
}

export function paraBanco(l: LinhaR048) {
  return {
    numemp: Number(l.numemp),
    tipcol: Number(l.tipcol),
    numcad: Number(l.numcad),
    codcal: l.codcal ?? null,
    codlot: l.codlot ?? null,
    datlan: new Date(`${String(l.datlan).slice(0, 10)}T00:00:00Z`),
    opcctb: l.opcctb ?? null,
    orictb: textoOuNulo(l.orictb),
    codclc: l.codclc ?? null,
    cplhis: textoOuNulo(l.cplhis),
    debcre: String(l.debcre).trim().toUpperCase(),
    reddeb: l.reddeb || null,
    redcre: l.redcre || null,
    ctared: contaDoLancamento(l),
    codccu: textoOuNulo(l.codccu),
    codfil: l.codfil ?? null,
    vallan: l.vallan,
  };
}

/** Primeiro dia (AAAA-MM-DD) de cada mês de `de` a `ate`, inclusive. */
export function mesesEntre(de: string, ate: string): string[] {
  const saida: string[] = [];
  let [ano, mes] = de.slice(0, 7).split("-").map(Number);
  const [anoFim, mesFim] = ate.slice(0, 7).split("-").map(Number);
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    saida.push(`${ano}-${String(mes).padStart(2, "0")}-01`);
    mes++;
    if (mes > 12) {
      mes = 1;
      ano++;
    }
  }
  return saida;
}

export function proximoMes(primeiroDia: string): string {
  const [ano, mes] = primeiroDia.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}

/** Os `quantos` últimos meses (dia 1), o atual incluso. */
export function ultimosMeses(quantos: number, hoje = new Date()): string[] {
  const fim = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}-01`;
  let [ano, mes] = fim.split("-").map(Number);
  mes -= quantos - 1;
  while (mes < 1) {
    mes += 12;
    ano--;
  }
  return mesesEntre(`${ano}-${String(mes).padStart(2, "0")}-01`, fim);
}

async function buscarMes(primeiroDia: string): Promise<LinhaR048[]> {
  const query = `${queryBase()} WHERE perrat = 0 AND datlan >= '${primeiroDia}' AND datlan < '${proximoMes(primeiroDia)}'`;
  return (await runSqlViaSoapPaginated(query, ORDEM, undefined, SISTEMA)) as LinhaR048[];
}

async function gravarMes(primeiroDia: string, linhas: LinhaR048[]): Promise<void> {
  const ini = new Date(`${primeiroDia}T00:00:00Z`);
  const fim = new Date(`${proximoMes(primeiroDia)}T00:00:00Z`);
  const dados = linhas.map(paraBanco);
  await prisma.$transaction(async (tx) => {
    await tx.hcmContabilizacaoFolha.deleteMany({ where: { datlan: { gte: ini, lt: fim } } });
    for (let i = 0; i < dados.length; i += LOTE) await tx.hcmContabilizacaoFolha.createMany({ data: dados.slice(i, i + LOTE) });
  });
}

/** Meses a regravar: tabela vazia = a história inteira, do 1º lançamento do HCM até o mês atual; senão só os últimos meses. */
async function mesesAGravar(): Promise<string[]> {
  const hoje = ultimosMeses(1)[0];
  if ((await prisma.hcmContabilizacaoFolha.count()) > 0) return ultimosMeses(MESES_RECENTES);
  const r = (await runSqlViaSoap(`SELECT MIN(datlan) AS ini FROM ${tabelaSenior("r048ctb", SISTEMA)} WHERE perrat = 0`, { sistema: SISTEMA })) as { ini: string | null }[];
  const primeiro = r[0]?.ini ? String(r[0].ini).slice(0, 10) : null;
  return primeiro ? mesesEntre(primeiro, hoje) : [hoje];
}

export async function runContabilizacaoFolhaSync(): Promise<void> {
  const inicio = new Date();
  const query = QUERY;
  try {
    const meses = await mesesAGravar();
    let linhas = 0;
    const inicioFetch = Date.now();
    for (const mes of meses) {
      const doMes = await buscarMes(mes);
      await gravarMes(mes, doMes);
      linhas += doMes.length;
    }
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: `${linhas} linhas em ${meses.length} mês(es) (${meses[0].slice(0, 7)} a ${meses[meses.length - 1].slice(0, 7)}) em ${((Date.now() - inicioFetch) / 1000).toFixed(1)}s — só lançamentos originais (perrat = 0), mês regravado por inteiro`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({ data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() } });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

