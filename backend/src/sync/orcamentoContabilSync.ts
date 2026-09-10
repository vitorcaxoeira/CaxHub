import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "orcamentos_contabeis-sync";
// Só tem DatGer no dicionário do Senior pra esta tabela — mesma lógica conservadora do
// comentário sobre DatPal em empresaSync.ts: não dá pra confiar nele como "alterado desde".
export const CRON_EXPR = "10 5 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codemp AS codemp, codfil AS codfil, mesano AS mesano, ctared AS ctared, codccu AS codccu, ctafin AS ctafin, vlrrat AS vlrrat FROM e650rto`;

interface OrcamentoContabilRow {
  codemp: number;
  codfil: number;
  mesano: string;
  ctared: number;
  codccu: string;
  ctafin: number;
  vlrrat: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (OrcamentoContabil): vlrrat Decimal(17,2), codccu VarChar(9) (por isso
// ::text, nunca ::varchar(9) — trunca em silêncio).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "mesano", cast: "date" },
  { nome: "ctared", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "ctafin", cast: "int" },
  { nome: "vlrrat", cast: "numeric" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)` — "2025-03-14" é UTC mas
// "2025-03-14T00:00:00" é local, e em America/Sao_Paulo isso desloca o dia (mesano já vem
// 100% alinhado no dia 1, então o recorte é seguro). `vlrrat.toFixed(2)` nunca number cru.
function linhaDe(row: OrcamentoContabilRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.mesano}-${row.ctared}-${row.codccu}-${row.ctafin}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.mesano).slice(0, 10),
      String(row.ctared),
      row.codccu,
      String(row.ctafin),
      row.vlrrat.toFixed(2),
    ],
  };
}

export async function runOrcamentoContabilSync(): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "mesano",
      "ctared",
      "codccu",
      "ctafin",
    ])) as OrcamentoContabilRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "orcamentos_contabeis",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "mesano", "ctared", "codccu", "ctafin"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo, nunca só o schema). Escopo
    // `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do escopo.
    // Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela tela é
    // decisão manual, não desta leva. Sem `desde`: este job não suporta "Alterados"
    // (CAMPO_DATA null), sempre roda completo.
    const varredura = await executarVarreduraDoJob<Prisma.OrcamentoContabilWhereInput>(prisma.orcamentoContabil, {
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

// Roda 1x por dia às 5h10, independente das outras tabelas contábeis. Sem CAMPO_DATA — só
// sincroniza no modo completo.
export function scheduleOrcamentoContabilSync(): void {
  cron.schedule(CRON_EXPR, () => runOrcamentoContabilSync());
}
