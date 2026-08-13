import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "registros_despesa_viagem-sync";
export const CRON_EXPR = "20 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela — só sincroniza no modo
// completo (mesma lógica conservadora do DatPal em empresaSync.ts).
export const CAMPO_DATA: string | null = null;
const BASE_QUERY = `SELECT USU_CODEMP AS codemp, USU_NUMRAT AS numrat, USU_SEQRDV AS seqrdv, USU_DATEMI AS datemi, USU_DESRDV AS desrdv, USU_TIPDES AS tipdes, USU_MODDES AS moddes, USU_QTDRDV AS qtdrdv, USU_VLRUNT AS vlrunt, USU_VLRTOT AS vlrtot, USU_FATRDV AS fatrdv, USU_REERDV AS reerdv, USU_ROTID AS rotid, USU_HORDES AS hordes, USU_NIDPSO AS nidpso FROM USU_TE777RDV`;

interface RegistroDespesaViagemRow {
  codemp: number;
  numrat: number;
  seqrdv: number;
  datemi?: string;
  desrdv?: string;
  tipdes?: number;
  moddes?: string;
  qtdrdv?: number;
  vlrunt?: number;
  vlrtot?: number;
  fatrdv?: string;
  reerdv?: string;
  rotid?: number;
  hordes?: number;
  nidpso?: number;
}

// Despesa de viagem lançada numa RAT — 15.034 linhas em 13/08/2026 (paginado por segurança,
// mesmo abaixo do limite de ~30 mil onde o Senior costuma truncar a resposta).
export async function runRegistroDespesaViagemSync(): Promise<void> {
  try {
    const rows = (await runSqlViaSoapPaginated(BASE_QUERY, ["codemp", "numrat", "seqrdv"])) as RegistroDespesaViagemRow[];

    for (const row of rows) {
      const data = {
        codemp: row.codemp,
        numrat: row.numrat,
        seqrdv: row.seqrdv,
        datemi: row.datemi ? new Date(row.datemi) : null,
        desrdv: row.desrdv,
        tipdes: row.tipdes,
        moddes: row.moddes,
        qtdrdv: row.qtdrdv,
        vlrunt: row.vlrunt,
        vlrtot: row.vlrtot,
        fatrdv: row.fatrdv,
        reerdv: row.reerdv,
        rotid: row.rotid,
        hordes: row.hordes,
        nidpso: row.nidpso,
      };
      // Casa pela chave natural DO SENIOR (@@unique), não pela PK local `id` — mesma lógica
      // de ratItemSync. Despesa criada no CaxHub tem seqrdv nulo, então nunca entra neste
      // upsert: é isso que a impede de ser sobrescrita por uma despesa do ERP que tenha
      // calhado de receber o mesmo número.
      await prisma.registroDespesaViagem.upsert({
        where: { codemp_numrat_seqrdv: { codemp: row.codemp, numrat: row.numrat, seqrdv: row.seqrdv } },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: BASE_QUERY, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: BASE_QUERY, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Despesa de viagem muda pouco depois de lançada — roda 1x por dia às 5h20.
export function scheduleRegistroDespesaViagemSync(): void {
  cron.schedule(CRON_EXPR, runRegistroDespesaViagemSync);
}
