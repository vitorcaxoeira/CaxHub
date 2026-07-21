import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "departamento_time-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "USU_DatGer";
const BASE_QUERY = `SELECT USU_DepExe AS depexe, USU_CodEmp AS codemp, USU_CodUsu AS codusu, USU_UsuGer AS usuger, USU_DatGer AS datger, USU_HorGer AS horger, USU_SitReg AS sitreg FROM USU_TDepExeTim`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface DepartamentoTimeRow {
  depexe: number;
  codemp: number;
  codusu: number;
  usuger?: number;
  datger?: string;
  horger?: number;
  sitreg: string;
}

export async function runDepartamentoTimeSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "depexe", "codusu"])) as DepartamentoTimeRow[];

    for (const row of rows) {
      const data = { depexe: row.depexe, codemp: row.codemp, codusu: BigInt(row.codusu), usuger: row.usuger != null ? BigInt(row.usuger) : null, datger: row.datger != null ? new Date(row.datger) : null, horger: row.horger, sitreg: row.sitreg };
      await prisma.departamentoTime.upsert({
        where: { codemp_depexe_codusu: { codemp: row.codemp, depexe: row.depexe, codusu: BigInt(row.codusu) } },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleDepartamentoTimeSync(): void {
  cron.schedule(CRON_EXPR, () => runDepartamentoTimeSync());
}
