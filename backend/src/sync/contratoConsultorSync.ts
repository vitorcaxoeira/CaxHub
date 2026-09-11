import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "contratos-consultores-sync";
export const CRON_EXPR = "20 3 * * *";
// Mesmo caso de USU_VBI00Cons: view sem coluna de data de geração/alteração — só dá pra
// sincronizar o job completo.
export const CAMPO_DATA: string | null = null;
// Só as colunas de chave (pra casar com Consultor por codemp+codusu/codfor) + as 4 novas —
// nomfor/sitfor/depexe/etc. da mesma view já vivem em Consultor, não duplicamos aqui.
export const QUERY =`SELECT codemp AS codemp, codusu AS codusu, codfor AS codfor, numctr AS numctr, codmot AS codmot, vlrhor AS vlrhor, vlrmin AS vlrmin FROM USU_VBI01CTRCS`;

interface ContratoConsultorRow {
  codemp: number;
  codusu: number;
  codfor?: number;
  numctr?: number;
  codmot?: number;
  vlrhor?: number;
  vlrmin?: number;
}

// schema.prisma (ContratoConsultor): vlrhor Decimal(15,5), vlrmin Decimal(15,8) — toFixed no
// número exato de casas do schema, mesmo cuidado do resto do projeto (nunca String() cru,
// que herdaria a representação de ponto flutuante do JS).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codusu", cast: "int" },
  { nome: "codfor", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "codmot", cast: "int" },
  { nome: "vlrhor", cast: "numeric" },
  { nome: "vlrmin", cast: "numeric" },
];

function linhaDe(row: ContratoConsultorRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codusu}`,
    valores: [
      String(row.codemp),
      String(row.codusu),
      row.codfor != null ? String(row.codfor) : null,
      row.numctr != null ? String(row.numctr) : null,
      row.codmot != null ? String(row.codmot) : null,
      row.vlrhor != null ? row.vlrhor.toFixed(5) : null,
      row.vlrmin != null ? row.vlrmin.toFixed(8) : null,
    ],
  };
}

// View sem registro em r998tbl (mesmo caso de USU_VBI00Cons, ver consultorSync.ts) — job
// escrito à mão, não pelo scaffold-table.ts. Só 117 linhas hoje (cadastro de consultores),
// não precisa de runSqlViaSoapPaginated.
export async function runContratoConsultorSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoap(query)) as ContratoConsultorRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "contratos_consultores",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codusu"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo, nunca só o schema). Continua
    // nascendo em "desligada" (default do model ConfiguracaoVarredura) — a ressalva de
    // 17/08/2026 (view só-leitura de BI, sem indício de uso urgente) só dizia respeito à
    // PROMOÇÃO de modo, que segue decisão manual pela tela, não à execução em si.
    const varredura = await executarVarreduraDoJob<Prisma.ContratoConsultorWhereInput>(prisma.contratoConsultor, {
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

// Cadastro/contrato muda raramente — roda 1x por dia às 3h20 (logo após consultores-sync, às 3h).
export function scheduleContratoConsultorSync(): void {
  cron.schedule(CRON_EXPR, runContratoConsultorSync);
}
