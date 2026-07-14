import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "representantes-sync";
const QUERY = `SELECT codrep AS codrep, nomrep AS nomrep, aperep AS aperep, tiprep AS tiprep, cgccpf AS cgccpf, sitrep AS sitrep, cidrep AS cidrep, sigufs AS sigufs FROM e090rep`;

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

export async function runRepresentanteSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codrep"])) as RepresentanteRow[];

    for (const row of rows) {
      const data = { codrep: row.codrep, nomrep: row.nomrep, aperep: row.aperep, tiprep: row.tiprep, cgccpf: row.cgccpf != null ? BigInt(row.cgccpf) : null, sitrep: row.sitrep, cidrep: row.cidrep, sigufs: row.sigufs };
      await prisma.representante.upsert({
        where: { codrep: row.codrep },
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
export function scheduleRepresentanteSync(): void {
  cron.schedule("0 4 * * *", runRepresentanteSync);
}
