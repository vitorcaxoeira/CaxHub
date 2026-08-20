import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

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
const QUERY = "SELECT codemp AS codemp, nomemp AS nomemp, sigemp AS sigemp, codmpc AS codmpc, codmpu AS codmpu FROM e070emp";

interface EmpresaRow {
  codemp: number;
  nomemp: string;
  sigemp: string;
  codmpc?: number;
  codmpu?: number;
}

export async function runEmpresaSync(): Promise<void> {
  const inicio = new Date();
  try {
    const rows = (await runSqlViaSoap(QUERY)) as EmpresaRow[];

    for (const row of rows) {
      const data = { nomemp: row.nomemp, sigemp: row.sigemp, codmpc: row.codmpc, codmpu: row.codmpu };
      await prisma.empresa.upsert({
        where: { codemp: row.codemp },
        update: data,
        create: { codemp: row.codemp, ...data },
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "success", duracaoMs: Date.now() - inicio.getTime() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Dados cadastrais de empresa mudam raramente — roda 1x por dia às 3h.
export function scheduleEmpresaSync(): void {
  cron.schedule(CRON_EXPR, runEmpresaSync);
}
