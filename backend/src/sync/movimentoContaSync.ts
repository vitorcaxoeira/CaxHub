import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "movimentos_conta-sync";
export const CRON_EXPR = "0 4 * * *";
export const CAMPO_DATA: string | null = "DatGer";
const BASE_QUERY = `SELECT codemp AS codemp, numcco AS numcco, datmov AS datmov, seqmov AS seqmov, codfil AS codfil, vlrmov AS vlrmov, debcre AS debcre, hismov AS hismov, sitmcc AS sitmcc, filmcr AS filmcr, nummcr AS nummcr, tptmcr AS tptmcr, seqmcr AS seqmcr, codpor AS codpor FROM e600mcc`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

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

export async function runMovimentoContaSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numcco", "datmov", "seqmov"])) as MovimentoContaRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, numcco: row.numcco, datmov: new Date(row.datmov), seqmov: row.seqmov, codfil: row.codfil, vlrmov: row.vlrmov, debcre: row.debcre, hismov: row.hismov, sitmcc: row.sitmcc, filmcr: row.filmcr, nummcr: row.nummcr, tptmcr: row.tptmcr, seqmcr: row.seqmcr, codpor: row.codpor };
      await prisma.movimentoConta.upsert({
        where: { codemp_numcco_datmov_seqmov: { codemp: row.codemp, numcco: row.numcco, datmov: new Date(row.datmov), seqmov: row.seqmov } },
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
export function scheduleMovimentoContaSync(): void {
  cron.schedule(CRON_EXPR, () => runMovimentoContaSync());
}
