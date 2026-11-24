import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "transacoes-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
export const BASE_QUERY =`SELECT codemp AS codemp, codtns AS codtns, destns AS destns, rectpb AS rectpb FROM e001tns`;

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

interface TransacaoRow {
  codemp: number;
  codtns: string;
  destns: string;
  rectpb?: string;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codtns", cast: "text" },
  { nome: "destns", cast: "text" },
  { nome: "rectpb", cast: "text" },
];

function linhaDe(row: TransacaoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codtns}`,
    valores: [String(row.codemp), row.codtns, row.destns, row.rectpb != null ? row.rectpb : null],
  };
}

export async function runTransacaoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codtns"])) as TransacaoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "transacoes",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codtns"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.TransacaoWhereInput>(prisma.transacao, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(BASE_QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
      desde,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)` +
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

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleTransacaoSync(): void {
  cron.schedule(CRON_EXPR, () => runTransacaoSync());
}
