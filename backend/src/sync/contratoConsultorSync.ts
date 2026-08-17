import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { carimbo } from "./varrerRemovidos";

export const JOB_NAME = "contratos-consultores-sync";
export const CRON_EXPR = "20 3 * * *";
// Mesmo caso de USU_VBI00Cons: view sem coluna de data de geração/alteração — só dá pra
// sincronizar o job completo.
export const CAMPO_DATA: string | null = null;
// Só as colunas de chave (pra casar com Consultor por codemp+codusu/codfor) + as 4 novas —
// nomfor/sitfor/depexe/etc. da mesma view já vivem em Consultor, não duplicamos aqui.
const QUERY = `SELECT codemp AS codemp, codusu AS codusu, codfor AS codfor, numctr AS numctr, codmot AS codmot, vlrhor AS vlrhor, vlrmin AS vlrmin FROM USU_VBI01CTRCS`;

interface ContratoConsultorRow {
  codemp: number;
  codusu: number;
  codfor?: number;
  numctr?: number;
  codmot?: number;
  vlrhor?: number;
  vlrmin?: number;
}

// View sem registro em r998tbl (mesmo caso de USU_VBI00Cons, ver consultorSync.ts) — job
// escrito à mão, não pelo scaffold-table.ts. Só 117 linhas hoje (cadastro de consultores),
// não precisa de runSqlViaSoapPaginated.
export async function runContratoConsultorSync(): Promise<void> {
  const inicio = new Date();
  try {
    const rows = (await runSqlViaSoap(QUERY)) as ContratoConsultorRow[];

    for (const row of rows) {
      const data = {
        codemp: row.codemp,
        codusu: row.codusu,
        codfor: row.codfor,
        numctr: row.numctr,
        codmot: row.codmot,
        vlrhor: row.vlrhor,
        vlrmin: row.vlrmin,
        ...carimbo(inicio),
      };
      await prisma.contratoConsultor.upsert({
        where: { codemp_codusu: { codemp: row.codemp, codusu: row.codusu } },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR — nasce desligada de propósito (decisão do usuário,
    // 17/08/2026): é uma view só-leitura de BI, sem indício de uso urgente pra saber quando
    // um contrato sai do ar. Pra ligar depois (modo "simular" primeiro, nunca "marcar" direto),
    // ver o mesmo bloco-modelo em orcamentoContabilSync.ts.
    //
    // const varredura = await varrerRemovidos<Prisma.ContratoConsultorWhereInput>(prisma.contratoConsultor, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM USU_VBI01CTRCS`,
    // });

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Cadastro/contrato muda raramente — roda 1x por dia às 3h20 (logo após consultores-sync, às 3h).
export function scheduleContratoConsultorSync(): void {
  cron.schedule(CRON_EXPR, runContratoConsultorSync);
}
