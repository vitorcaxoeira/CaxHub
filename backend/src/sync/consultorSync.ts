import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "consultores-sync";
export const CRON_EXPR = "0 3 * * *";
// USU_VBI00Cons é uma view sem coluna de data de geração/alteração — não dá pra
// sincronizar só os alterados, só o job completo.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codemp AS codemp, codusu AS codusu, codfor AS codfor, nomfor AS nomfor, sitfor AS sitfor, nomcom AS nomcom, conhab AS conhab, tipusurat AS tipusurat, depexe AS depexe, depexedes AS depexedes, email AS email FROM USU_VBI00Cons`;

interface ConsultorRow {
  codemp: number;
  codusu: number;
  codfor?: number;
  nomfor?: string;
  sitfor?: string;
  nomcom?: string;
  conhab?: number;
  tipusurat?: number;
  depexe?: number;
  depexedes?: string;
  email?: string;
}

// Todos os campos exceto a PK são opcionais no schema (Consultor) — omitidos pelo Senior
// viram NULL.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codusu", cast: "int" },
  { nome: "codfor", cast: "int" },
  { nome: "nomfor", cast: "text" },
  { nome: "sitfor", cast: "text" },
  { nome: "nomcom", cast: "text" },
  { nome: "conhab", cast: "int" },
  { nome: "tipusurat", cast: "int" },
  { nome: "depexe", cast: "int" },
  { nome: "depexedes", cast: "text" },
  { nome: "email", cast: "text" },
];

function linhaDe(row: ConsultorRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codusu}`,
    valores: [
      String(row.codemp),
      String(row.codusu),
      row.codfor != null ? String(row.codfor) : null,
      row.nomfor != null ? row.nomfor : null,
      row.sitfor != null ? row.sitfor : null,
      row.nomcom != null ? row.nomcom : null,
      row.conhab != null ? String(row.conhab) : null,
      row.tipusurat != null ? String(row.tipusurat) : null,
      row.depexe != null ? String(row.depexe) : null,
      row.depexedes != null ? row.depexedes : null,
      row.email != null ? row.email : null,
    ],
  };
}

// A view USU_VBI00Cons não tem registro em r998tbl (sem PK/descrição cadastrada),
// então este job foi escrito manualmente em vez de gerado pelo scaffold-table.ts.
// Chave (codemp, codusu) inferida a partir dos dados reais (sem duplicatas).
export async function runConsultorSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoap(query)) as ConsultorRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "consultores",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codusu"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.ConsultorWhereInput>(prisma.consultor, {
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

// Cadastro de consultores muda raramente — roda 1x por dia às 3h.
export function scheduleConsultorSync(): void {
  cron.schedule(CRON_EXPR, runConsultorSync);
}
