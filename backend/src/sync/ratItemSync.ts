import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "rat-item-sync";
export const CRON_EXPR = "30 4 * * *"; // depois de rat-sync (15 4 * * *) — RatItem.ratId depende de Rat já existir
export const CAMPO_DATA: string | null = "USU_DatReg";
const BASE_QUERY = `SELECT USU_CODEMP AS codemp, USU_NUMPRJ AS numprj, USU_NUMRAT AS numrat, USU_SEQRAT AS seqrat, USU_CODSER AS codser, USU_DATATI AS datati, USU_HORINI AS horini, USU_HORFIM AS horfim, USU_DESATI AS desati, USU_CodPro AS codpro, USU_SeqIte AS seqite, USU_CodFas AS codfas, USU_DatReg AS datreg, USU_SeqAti AS seqati FROM USU_TE777IAT`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface RatItemRow {
  codemp: number;
  numprj?: number;
  numrat: number;
  seqrat: number;
  codser?: string;
  datati?: string;
  horini?: number;
  horfim?: number;
  desati?: string;
  codpro?: number;
  seqite?: number;
  codfas?: number;
  datreg?: string;
  seqati?: number;
}

// Linha de apontamento (IAT) — espelho parcial de USU_TE777IAT (ver comentário do model
// RatItem no schema.prisma). Roda sempre DEPOIS de rat-sync (ver CRON_EXPR): cada linha
// precisa achar o `Rat` local correspondente antes de poder ser gravada.
//
// `numrat` sozinho NÃO identifica uma RAT com segurança — confirmado com dado real do
// Senior (existem RATs de propostas diferentes reaproveitando o mesmo numrat sob o mesmo
// codemp). `codpro` (presente nos dois lados) desempata em todos os casos encontrados,
// por isso o casamento usa (codemp, numrat, codpro) em vez da chave natural "oficial"
// (que exigiria numprj/codfpj, não disponíveis nesta tabela).
export async function runRatItemSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  try {
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat", "seqrat"])) as RatItemRow[];

    for (const row of rows) {
      const rat = await prisma.rat.findFirst({
        where: { codemp: row.codemp, numrat: row.numrat, codpro: row.codpro ?? null },
      });
      if (!rat) {
        console.warn(`[${JOB_NAME}] RatItem órfão (codemp=${row.codemp}, numrat=${row.numrat}, codpro=${row.codpro}) — Rat correspondente ainda não sincronizado, linha ignorada`);
        continue;
      }

      const data = {
        ratId: rat.id,
        codemp: row.codemp,
        numprj: row.numprj ?? null,
        numrat: row.numrat,
        seqrat: row.seqrat,
        codser: row.codser ?? null,
        datati: row.datati != null ? new Date(row.datati) : null,
        horini: row.horini ?? null,
        horfim: row.horfim ?? null,
        desati: row.desati ?? null,
        codpro: row.codpro ?? null,
        seqite: row.seqite ?? null,
        codfas: row.codfas ?? null,
        datreg: row.datreg != null ? new Date(row.datreg) : null,
        seqati: row.seqati != null ? BigInt(row.seqati) : null,
        origemCaxHub: false,
      };
      await prisma.ratItem.upsert({
        where: { codemp_numrat_seqrat: { codemp: row.codemp, numrat: row.numrat, seqrat: row.seqrat } },
        update: data,
        create: data,
      });
    }

    await prisma.syncLog.create({ data: { jobName: JOB_NAME, query, status: "success" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({ data: { jobName: JOB_NAME, query, status: "error", message } });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental só é
// usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleRatItemSync(): void {
  cron.schedule(CRON_EXPR, () => runRatItemSync());
}
