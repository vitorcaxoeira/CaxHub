import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "titulos_receber-sync";
export const CRON_EXPR = "0 4 * * *";
// Não há campo de "alteração" dedicado nessa tabela — DatGer é "data da geração do
// registro". Um título muda de situação (baixas, protesto) sem necessariamente
// atualizar DatGer, então o modo incremental pode não capturar toda mudança de status;
// mesmo assim, é a melhor aproximação disponível ("geração ou alteração").
export const CAMPO_DATA: string | null = "DatGer";
const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, codcli AS codcli, sittit AS sittit, datemi AS datemi, vctori AS vctori, vctpro AS vctpro, vlrori AS vlrori, vlrabe AS vlrabe, codpor AS codpor FROM e301tcr`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface TituloReceberRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codcli: number;
  sittit: string;
  datemi: string;
  vctori: string;
  vctpro: string;
  vlrori: number;
  vlrabe?: number;
  codpor?: string;
}

export async function runTituloReceberSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
    ])) as TituloReceberRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt, codcli: row.codcli, sittit: row.sittit, datemi: new Date(row.datemi), vctori: new Date(row.vctori), vctpro: new Date(row.vctpro), vlrori: row.vlrori, vlrabe: row.vlrabe, codpor: row.codpor };
      await prisma.tituloReceber.upsert({
        where: { codemp_codfil_numtit_codtpt: { codemp: row.codemp, codfil: row.codfil, numtit: row.numtit, codtpt: row.codtpt } },
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
export function scheduleTituloReceberSync(): void {
  cron.schedule(CRON_EXPR, () => runTituloReceberSync());
}
