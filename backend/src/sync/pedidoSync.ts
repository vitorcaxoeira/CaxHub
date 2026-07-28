import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "pedidos-sync";
export const CRON_EXPR = "35 4 * * *"; // horário livre, sem dependência de outro job
export const CAMPO_DATA: string | null = "DatEmi";
const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumPed AS numped, TipPed AS tipped, PrcPed AS prcped, TnsPro AS tnspro, TnsSer AS tnsser, DatEmi AS datemi, HorEmi AS horemi, DatPrv AS datprv, ObsPed AS obsped, VlrLiq AS vlrliq, ObsMot AS obsmot, CodCli AS codcli, PedCli AS pedcli, CodCpg AS codcpg, CodFpg AS codfpg, SitPed AS sitped, usu_numrat AS numrat FROM E120PED`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface PedidoRow {
  codemp: number;
  codfil: number;
  numped: number;
  tipped?: number;
  prcped?: number;
  tnspro?: string;
  tnsser?: string;
  datemi: string;
  horemi?: number;
  datprv?: string;
  obsped?: string;
  vlrliq?: number;
  obsmot?: string;
  codcli: number;
  pedcli?: string;
  codcpg: string;
  codfpg?: number;
  sitped: number;
  numrat?: number;
}

export async function runPedidoSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "codfil", "numped"])) as PedidoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfil: row.codfil, numped: row.numped, tipped: row.tipped, prcped: row.prcped, tnspro: row.tnspro, tnsser: row.tnsser, datemi: new Date(row.datemi), horemi: row.horemi, datprv: row.datprv != null ? new Date(row.datprv) : null, obsped: row.obsped, vlrliq: row.vlrliq, obsmot: row.obsmot, codcli: row.codcli, pedcli: row.pedcli, codcpg: row.codcpg, codfpg: row.codfpg, sitped: row.sitped, numrat: row.numrat != null ? BigInt(row.numrat) : null };
      await prisma.pedido.upsert({
        where: { codemp_codfil_numped: { codemp: row.codemp, codfil: row.codfil, numped: row.numped } },
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

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental só é
// usado quando disparado manualmente pela tela de administração de sincronização.
export function schedulePedidoSync(): void {
  cron.schedule(CRON_EXPR, () => runPedidoSync());
}
