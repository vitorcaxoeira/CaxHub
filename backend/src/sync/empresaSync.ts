import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "empresa-sync";
export const CRON_EXPR = "0 3 * * *";
// Único campo de data em e070emp é "DatPal" (data de alteração pro Palmtop, um recurso
// específico não relacionado a alteração geral do registro) — sem campo de geração/
// alteração real, não dá pra sincronizar só os alterados.
export const CAMPO_DATA: string | null = null;
// codmpc/codmpu acrescentados em 12/08/2026 (junto do Resultado Analítico contábil) —
// modelo de plano de contas/centro de custo que a empresa usa no Senior. Ficaram de fora
// da query original por descuido: a coluna já existia no schema desde 11/08, só não
// estava sendo trazida — por isso `empresa.codmpc/codmpu` estavam NULL até agora.
export const QUERY ="SELECT codemp AS codemp, nomemp AS nomemp, sigemp AS sigemp, codmpc AS codmpc, codmpu AS codmpu FROM e070emp";

interface EmpresaRow {
  codemp: number;
  nomemp: string;
  sigemp: string;
  codmpc?: number;
  codmpu?: number;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "nomemp", cast: "text" },
  { nome: "sigemp", cast: "text" },
  { nome: "codmpc", cast: "int" },
  { nome: "codmpu", cast: "int" },
];

function linhaDe(row: EmpresaRow): LinhaUpsert {
  return {
    chave: String(row.codemp),
    valores: [
      String(row.codemp),
      row.nomemp,
      row.sigemp,
      row.codmpc != null ? String(row.codmpc) : null,
      row.codmpu != null ? String(row.codmpu) : null,
    ],
  };
}

export async function runEmpresaSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoap(query)) as EmpresaRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "empresa",
      colunas: COLUNAS,
      colunasPk: ["codemp"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.EmpresaWhereInput>(prisma.empresa, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
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

// Dados cadastrais de empresa mudam raramente — roda 1x por dia às 3h.
export function scheduleEmpresaSync(): void {
  cron.schedule(CRON_EXPR, runEmpresaSync);
}
