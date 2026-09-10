import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, executarVarreduraDoJob } from "./varrerRemovidos";

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

// A view USU_VBI00Cons não tem registro em r998tbl (sem PK/descrição cadastrada),
// então este job foi escrito manualmente em vez de gerado pelo scaffold-table.ts.
// Chave (codemp, codusu) inferida a partir dos dados reais (sem duplicatas).
export async function runConsultorSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve QUERY intacta.
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const rows = (await runSqlViaSoap(query)) as ConsultorRow[];

    for (const row of rows) {
      const data = {
        codemp: row.codemp,
        codusu: row.codusu,
        codfor: row.codfor,
        nomfor: row.nomfor,
        sitfor: row.sitfor,
        nomcom: row.nomcom,
        conhab: row.conhab,
        tipusurat: row.tipusurat,
        depexe: row.depexe,
        depexedes: row.depexedes,
        email: row.email,
        ...carimbo(inicio),
      };
      await prisma.consultor.upsert({
        where: { codemp_codusu: { codemp: row.codemp, codusu: row.codusu } },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // Escopo `{}`: espelho só-leitura, sem registro "nascido no CaxHub" pra excluir do
    // escopo. Começa em "desligada" (default do model ConfiguracaoVarredura) — promoção pela
    // tela é decisão manual, não desta leva.
    const varredura = await executarVarreduraDoJob<Prisma.ConsultorWhereInput>(prisma.consultor, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: rows.length,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: varredura ? varredura.resumo : undefined,
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
