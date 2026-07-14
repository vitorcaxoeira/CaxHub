import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "movimentos_conta-sync";
const QUERY = `SELECT codemp AS codemp, numcco AS numcco, datmov AS datmov, seqmov AS seqmov, codfil AS codfil, vlrmov AS vlrmov, debcre AS debcre, hismov AS hismov, sitmcc AS sitmcc, filmcr AS filmcr, nummcr AS nummcr, tptmcr AS tptmcr, seqmcr AS seqmcr, codpor AS codpor FROM e600mcc`;

interface MovimentoContaRow {
  codemp: number;
  numcco: string;
  datmov: string;
  seqmov: number;
  codfil?: number;
  vlrmov: number;
  debcre: string;
  hismov?: string;
  sitmcc?: string;
  filmcr?: number;
  nummcr?: string;
  tptmcr?: string;
  seqmcr?: number;
  codpor?: string;
}

export async function runMovimentoContaSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "numcco", "datmov", "seqmov"])) as MovimentoContaRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, numcco: row.numcco, datmov: new Date(row.datmov), seqmov: row.seqmov, codfil: row.codfil, vlrmov: row.vlrmov, debcre: row.debcre, hismov: row.hismov, sitmcc: row.sitmcc, filmcr: row.filmcr, nummcr: row.nummcr, tptmcr: row.tptmcr, seqmcr: row.seqmcr, codpor: row.codpor };
      await prisma.movimentoConta.upsert({
        where: { codemp_numcco_datmov_seqmov: { codemp: row.codemp, numcco: row.numcco, datmov: new Date(row.datmov), seqmov: row.seqmov } },
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
export function scheduleMovimentoContaSync(): void {
  cron.schedule("0 4 * * *", runMovimentoContaSync);
}
