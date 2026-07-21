import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "representantes-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatAtu";
const BASE_QUERY = `SELECT codrep AS codrep, nomrep AS nomrep, aperep AS aperep, tiprep AS tiprep, cgccpf AS cgccpf, sitrep AS sitrep, cidrep AS cidrep, sigufs AS sigufs FROM e090rep`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface RepresentanteRow {
  codrep: number;
  nomrep: string;
  aperep: string;
  tiprep: string;
  cgccpf?: number;
  sitrep: string;
  cidrep?: string;
  sigufs?: string;
}

export async function runRepresentanteSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codrep"])) as RepresentanteRow[];

    for (const row of rows) {
      const data = { codrep: row.codrep, nomrep: row.nomrep, aperep: row.aperep, tiprep: row.tiprep, cgccpf: row.cgccpf != null ? BigInt(row.cgccpf) : null, sitrep: row.sitrep, cidrep: row.cidrep, sigufs: row.sigufs };
      await prisma.representante.upsert({
        where: { codrep: row.codrep },
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
export function scheduleRepresentanteSync(): void {
  cron.schedule(CRON_EXPR, () => runRepresentanteSync());
}
