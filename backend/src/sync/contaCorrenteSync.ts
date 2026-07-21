import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "contas_correntes-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
const BASE_QUERY = `SELECT CodEmp AS codemp, NumCco AS numcco, DesCco AS descco, AbrCco AS abrcco, SitCco AS sitcco FROM E600CCO`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface ContaCorrenteRow {
  codemp: number;
  numcco: string;
  descco: string;
  abrcco: string;
  sitcco: string;
}

export async function runContaCorrenteSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numcco"])) as ContaCorrenteRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, numcco: row.numcco, descco: row.descco, abrcco: row.abrcco, sitcco: row.sitcco };
      await prisma.contaCorrente.upsert({
        where: { codemp_numcco: { codemp: row.codemp, numcco: row.numcco } },
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
export function scheduleContaCorrenteSync(): void {
  cron.schedule(CRON_EXPR, () => runContaCorrenteSync());
}
