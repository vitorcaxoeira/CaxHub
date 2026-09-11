import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { varrerRemovidos } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "rat-item-sync";
export const CRON_EXPR = "30 4 * * *"; // depois de rat-sync (15 4 * * *) — RatItem.ratId depende de Rat já existir
export const CAMPO_DATA: string | null = "USU_DatReg";
export const BASE_QUERY =`SELECT USU_CODEMP AS codemp, USU_NUMPRJ AS numprj, USU_NUMRAT AS numrat, USU_SEQRAT AS seqrat, USU_CODSER AS codser, USU_DATATI AS datati, USU_HORINI AS horini, USU_HORFIM AS horfim, USU_DESATI AS desati, USU_CodPro AS codpro, USU_SeqIte AS seqite, USU_CodFas AS codfas, USU_DatReg AS datreg, USU_SeqAti AS seqati FROM USU_TE777IAT`;

// Fase 1 do plano de filtros na importação: acumulador de predicados
// (sync/consultaSenior.ts), não concatenação — lista vazia devolve BASE_QUERY intacta.
function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  // Pedido do Vitor (21/08/2026): se o admin já salvou um predicado explícito no campo de
  // data (Filtro(Alterados), inclusive com a variável "última sincronização"), ele substitui
  // a injeção automática por inteiro em vez de empilhar os dois — "editável de verdade".
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface RatItemRow {
  codemp: number;
  numprj?: number;
  numrat: number;
  seqrat: number;
  codser?: string;
  datati?: string;
  horini?: number;
  horfim?: number;
  desati?: string;
  codpro?: number;
  seqite?: number;
  codfas?: number;
  datreg?: string;
  seqati?: number;
}

// schema.prisma (RatItem): datati/datreg Date (nunca timestamp — String(...).slice(0,10),
// nunca `new Date(v)`, mesmo cuidado de rateioLancamentoSync.ts), seqati BigInt. `ratId` não
// vem da query — é resolvido por linha contra o `Rat` local (ver executarUpsert).
const COLUNAS: ColunaUpsert[] = [
  { nome: "ratId", cast: "int" },
  { nome: "codemp", cast: "int" },
  { nome: "numprj", cast: "int" },
  { nome: "numrat", cast: "int" },
  { nome: "seqrat", cast: "int" },
  { nome: "codser", cast: "text" },
  { nome: "datati", cast: "date" },
  { nome: "horini", cast: "int" },
  { nome: "horfim", cast: "int" },
  { nome: "desati", cast: "text" },
  { nome: "codpro", cast: "int" },
  { nome: "seqite", cast: "int" },
  { nome: "codfas", cast: "int" },
  { nome: "datreg", cast: "date" },
  { nome: "seqati", cast: "bigint" },
  // Sempre `false` nesta origem (mesmo valor que o upsert linha-a-linha de sempre gravava
  // incondicionalmente) — item nascido no CaxHub (origemCaxHub=true) nunca aparece nesta
  // consulta, então nunca colide com esta chave antes de ter seqrat confirmado.
  { nome: "origemCaxHub", cast: "boolean" },
];

function linhaDe(row: RatItemRow, ratId: number): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numrat}-${row.seqrat}`,
    valores: [
      String(ratId),
      String(row.codemp),
      row.numprj != null ? String(row.numprj) : null,
      String(row.numrat),
      String(row.seqrat),
      row.codser != null ? row.codser : null,
      row.datati != null ? String(row.datati).slice(0, 10) : null,
      row.horini != null ? String(row.horini) : null,
      row.horfim != null ? String(row.horfim) : null,
      row.desati != null ? row.desati : null,
      row.codpro != null ? String(row.codpro) : null,
      row.seqite != null ? String(row.seqite) : null,
      row.codfas != null ? String(row.codfas) : null,
      row.datreg != null ? String(row.datreg).slice(0, 10) : null,
      row.seqati != null ? String(row.seqati) : null,
      "false",
    ],
  };
}

// Linha de apontamento (IAT) — espelho parcial de USU_TE777IAT (ver comentário do model
// RatItem no schema.prisma). Roda sempre DEPOIS de rat-sync (ver CRON_EXPR): cada linha
// precisa achar o `Rat` local correspondente antes de poder ser gravada.
//
// `numrat` sozinho NÃO identifica uma RAT com segurança — confirmado com dado real do
// Senior (existem RATs de propostas diferentes reaproveitando o mesmo numrat sob o mesmo
// codemp). `codpro` (presente nos dois lados) desempata em todos os casos encontrados,
// por isso o casamento usa (codemp, numrat, codpro) em vez da chave natural "oficial"
// (que exigiria numprj/codfpj, não disponíveis nesta tabela).
// Devolve os `seqrat` que a origem trouxe. Quem chama por RAT específica usa isso pra
// descobrir o que NÃO voltou — item apagado no Senior simplesmente não vem na consulta,
// e é assim que a desvinculação em POST /rats/:id/sincronizar identifica o que reintegrar.
// `inicio` tem default pra não quebrar runRatItemSyncPorNumrat abaixo (que não roda
// varredura — escopo de 1 RAT só marcaria a tabela inteira como suspeita) — o carimbo em si
// é seguro em qualquer chamada, só documenta quando a linha foi vista.
interface ResultadoExecutarUpsert {
  seqratsVistos: number[];
  // Linhas que vieram da origem mas NÃO foram carimbadas (Rat ainda não sincronizado) —
  // repassado como `puladas` pra varrerRemovidos.ts: sem isso, um item que já existia
  // localmente (de um sync anterior) e ficou órfão só NESTA rodada teria o carimbo antigo
  // preservado e seria acusado de removido na próxima varredura, por motivo técnico, não
  // por ter sumido de verdade do Senior.
  puladas: number;
  linhasProcessadas: number;
  lotes: number;
  msFetch: number;
  msEscrita: number;
}

async function executarUpsert(query: string, inicio: Date = new Date()): Promise<ResultadoExecutarUpsert> {
  const inicioFetch = Date.now();
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat", "seqrat"])) as RatItemRow[];
  const msFetch = Date.now() - inicioFetch;

  // Resolve o `Rat` local de TODAS as linhas de uma vez (achado real do plano de filtros,
  // 21/08/2026: "rat-item-sync tem N+1 query, não é só trocar o upsert") — um único
  // `findMany` por `codemp` em vez de um `findFirst` por linha dentro do loop.
  const codemps = [...new Set(rows.map((r) => r.codemp))];
  const rats = codemps.length > 0 ? await prisma.rat.findMany({ where: { codemp: { in: codemps } }, select: { id: true, codemp: true, numrat: true, codpro: true } }) : [];
  const ratPorChave = new Map(rats.map((r) => [`${r.codemp}-${r.numrat}-${r.codpro ?? "null"}`, r.id]));

  const seqratsVistos: number[] = [];
  const linhas: LinhaUpsert[] = [];
  let puladas = 0;

  for (const row of rows) {
    seqratsVistos.push(row.seqrat);
    const chave = `${row.codemp}-${row.numrat}-${row.codpro ?? "null"}`;
    const ratId = ratPorChave.get(chave);
    if (ratId == null) {
      console.warn(`[${JOB_NAME}] RatItem órfão (codemp=${row.codemp}, numrat=${row.numrat}, codpro=${row.codpro}) — Rat correspondente ainda não sincronizado, linha ignorada`);
      puladas++;
      continue;
    }
    linhas.push(linhaDe(row, ratId));
  }

  const inicioEscrita = Date.now();
  const resultado = await upsertEmLote(linhas, {
    tabela: "rat_itens",
    colunas: COLUNAS,
    colunasPk: ["codemp", "numrat", "seqrat"],
    carimbo: inicio,
    tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
  });
  const msEscrita = Date.now() - inicioEscrita;

  return { seqratsVistos, puladas, linhasProcessadas: resultado.linhasProcessadas, lotes: resultado.lotes, msFetch, msEscrita };
}

export async function runRatItemSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const { seqratsVistos, puladas, linhasProcessadas, lotes, msFetch, msEscrita } = await executarUpsert(query, inicio);

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // MÃO DUPLA: chamada MANUAL (não `executarVarreduraDoJob`) porque o escopo aqui SEMPRE
    // precisa excluir `origemCaxHub: true` (apontamento criado no CaxHub, ainda sem seqrat
    // confirmado no Senior) além do filtro salvo, se houver. `puladas` (RatItem órfão, Rat
    // ainda não sincronizado) aborta a varredura inteira nesta rodada — ver ResultadoExecutarUpsert.
    const filtro = filtroDoJob(JOB_NAME, "todos");
    const filtroNaoEscopavel = filtro.predicadosSql.length > 0 && filtro.escopoLocal === null;
    const varredura =
      desde || filtroNaoEscopavel
        ? null
        : await varrerRemovidos<Prisma.RatItemWhereInput>(prisma.ratItem, {
            jobName: JOB_NAME,
            inicio,
            linhasProcessadas: seqratsVistos.length,
            escopo: { origemCaxHub: false, ...(filtro.escopoLocal ?? {}) } as Prisma.RatItemWhereInput,
            queryContagemOrigem: montarQuerySenior(`SELECT COUNT(*) AS total FROM USU_TE777IAT`, filtro.predicadosSql),
            puladas,
          });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${lotes} lotes)` +
          (varredura ? ` — ${varredura.resumo}` : ""),
        varreduraModo: varredura?.modo ?? null,
        varreduraDetectados: varredura?.candidatos ?? null,
        varreduraInicio: varredura ? inicio : null,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Sincroniza só os itens da RAT com esse numrat — usado pela ação manual "Sinc. ERP" em
// "Meus Apontamentos" (ver POST /rats/:id/sincronizar), sempre depois de
// runRatSyncPorNumrat (RatItem.ratId depende do Rat já existir). Propaga erro pro
// chamador, diferente de runRatItemSync — ver comentário equivalente em ratSync.ts.
// Devolve os `seqrat` que existem no Senior pra essa RAT — o chamador usa pra desvincular
// localmente o que foi apagado lá (ver POST /rats/:id/sincronizar).
export async function runRatItemSyncPorNumrat(codemp: number, numrat: number): Promise<number[]> {
  const query = `${BASE_QUERY} WHERE USU_CODEMP = ${codemp} AND USU_NUMRAT = ${numrat}`;
  const { seqratsVistos } = await executarUpsert(query);
  await prisma.syncLog.create({
    data: { jobName: JOB_NAME, query, status: "success", message: `${seqratsVistos.length} item(ns) no Senior` },
  });
  return seqratsVistos;
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental só é
// usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleRatItemSync(): void {
  cron.schedule(CRON_EXPR, () => runRatItemSync());
}
