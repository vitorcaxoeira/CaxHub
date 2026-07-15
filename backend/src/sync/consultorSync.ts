import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "consultores-sync";
const QUERY = `SELECT codemp AS codemp, codusu AS codusu, codfor AS codfor, nomfor AS nomfor, sitfor AS sitfor, nomcom AS nomcom, conhab AS conhab, tipusurat AS tipusurat, depexe AS depexe, depexedes AS depexedes FROM USU_VBI00Cons`;

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
}

// A view USU_VBI00Cons não tem registro em r998tbl (sem PK/descrição cadastrada),
// então este job foi escrito manualmente em vez de gerado pelo scaffold-table.ts.
// Chave (codemp, codusu) inferida a partir dos dados reais (sem duplicatas).
export async function runConsultorSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoap(QUERY)) as ConsultorRow[];

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
      };
      await prisma.consultor.upsert({
        where: { codemp_codusu: { codemp: row.codemp, codusu: row.codusu } },
        update: data,
        create: data,
      });
    }

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

// Cadastro de consultores muda raramente — roda 1x por dia às 3h.
export function scheduleConsultorSync(): void {
  cron.schedule("0 3 * * *", runConsultorSync);
}
