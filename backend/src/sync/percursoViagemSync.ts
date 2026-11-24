import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "percursos_viagem-sync";
export const CRON_EXPR = "30 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela.
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT USU_ID AS id, USU_PERORI AS perori, USU_PERDES AS perdes, USU_DESPER AS desper, USU_KMTPER AS kmtper, USU_HORPER AS horper, USU_MODTRA AS modtra, USU_HORPAG AS horpag FROM USU_TRDVPER`;

interface PercursoViagemRow {
  id: number;
  perori?: string;
  perdes?: string;
  desper?: string;
  kmtper?: number;
  horper?: number;
  modtra?: string;
  horpag?: number;
}

// schema.prisma (PercursoViagem): kmtper Decimal(10,2) — toFixed(2), nunca number cru.
const COLUNAS: ColunaUpsert[] = [
  { nome: "id", cast: "int" },
  { nome: "perori", cast: "text" },
  { nome: "perdes", cast: "text" },
  { nome: "desper", cast: "text" },
  { nome: "kmtper", cast: "numeric" },
  { nome: "horper", cast: "int" },
  { nome: "modtra", cast: "text" },
  { nome: "horpag", cast: "int" },
];

function linhaDe(row: PercursoViagemRow): LinhaUpsert {
  return {
    chave: String(row.id),
    valores: [
      String(row.id),
      row.perori != null ? row.perori : null,
      row.perdes != null ? row.perdes : null,
      row.desper != null ? row.desper : null,
      row.kmtper != null ? row.kmtper.toFixed(2) : null,
      row.horper != null ? String(row.horper) : null,
      row.modtra != null ? row.modtra : null,
      row.horpag != null ? String(row.horpag) : null,
    ],
  };
}

// Trecho (origem/destino) reutilizável entre rotas — 143 linhas em 13/08/2026, catálogo
// quase estático.
export async function runPercursoViagemSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["id"])) as PercursoViagemRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "percursos_viagem",
      colunas: COLUNAS,
      colunasPk: ["id"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.PercursoViagemWhereInput>(prisma.percursoViagem, {
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

// Catálogo muda pouco — roda 1x por dia às 5h30.
export function schedulePercursoViagemSync(): void {
  cron.schedule(CRON_EXPR, runPercursoViagemSync);
}
