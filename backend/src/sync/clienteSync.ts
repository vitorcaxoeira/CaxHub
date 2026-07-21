import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "cliente-sync";
export const CRON_EXPR = "20 3 * * *";
export const CAMPO_DATA: string | null = "DatAtu";
const BASE_QUERY = `SELECT
  codcli AS codcli, nomcli AS nomcli, apecli AS apecli, sencli AS sencli,
  tipcli AS tipcli, tipmer AS tipmer, tipemc AS tipemc, codram AS codram,
  insest AS insest, cgccpf AS cgccpf, endcli AS endcli, cplend AS cplend,
  cepcli AS cepcli, baicli AS baicli, cidcli AS cidcli, sigufs AS sigufs,
  codpai AS codpai
FROM e085cli`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface ClienteRow {
  codcli: number;
  nomcli: string;
  apecli: string;
  sencli: string;
  tipcli: string;
  tipmer: string;
  tipemc: number;
  codram: string;
  insest: string;
  cgccpf: number;
  endcli: string;
  cplend: string;
  cepcli: number;
  baicli: string;
  cidcli: string;
  sigufs: string;
  codpai: string;
}

export async function runClienteSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    const rows = (await runSqlViaSoap(query)) as ClienteRow[];

    for (const row of rows) {
      const data = { ...row, cgccpf: BigInt(row.cgccpf) };
      await prisma.cliente.upsert({
        where: { codcli: row.codcli },
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

// Cadastro de clientes muda pouco — roda 1x por dia às 3h20. O modo incremental só
// roda quando disparado manualmente pela tela de administração de sincronização.
export function scheduleClienteSync(): void {
  cron.schedule(CRON_EXPR, () => runClienteSync());
}
