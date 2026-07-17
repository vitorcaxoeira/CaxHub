import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "departamentos_gestores-sync";
const QUERY = `SELECT USU_DepExe AS depexe, USU_CodEmp AS codemp, USU_UsuGes AS usuges FROM USU_TDepExeCfg`;

interface DepartamentoGestorRow {
  depexe: number;
  codemp: number;
  usuges: number;
}

export async function runDepartamentoGestorSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "depexe"])) as DepartamentoGestorRow[];

    for (const row of rows) {
      const data = { depexe: row.depexe, codemp: row.codemp, usuges: BigInt(row.usuges) };
      await prisma.departamentoGestor.upsert({
        where: { codemp_depexe: { codemp: row.codemp, depexe: row.depexe } },
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

// Ajustar o horário conforme a necessidade real de atualização desta tabela.
export function scheduleDepartamentoGestorSync(): void {
  cron.schedule("0 4 * * *", runDepartamentoGestorSync);
}
