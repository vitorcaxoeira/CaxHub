import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

const JOB_NAME = "atividades_consultor-sync";
const QUERY = `SELECT USU_QtdHor AS qtdhor, USU_CodEmp AS codemp, USU_CodPro AS codpro, USU_SeqIte AS seqite, USU_CODFOR AS codfor, USU_SeqAti AS seqati, USU_SitReg AS sitreg, USU_DatGer AS datger, USU_HorGer AS horger, USU_UsuGer AS usuger, USU_PerLib AS perlib, USU_FasId AS fasid, USU_SelSol AS selsol FROM USU_TE077ATI`;

interface AtividadeConsultorRow {
  qtdhor?: number;
  codemp: number;
  codpro: number;
  seqite: number;
  codfor: number;
  seqati: number;
  sitreg?: string;
  datger?: string;
  horger?: number;
  usuger?: number;
  perlib?: number;
  fasid: number;
  selsol?: string;
}

// Essa tabela é a única de mão dupla do projeto (ver comentário do model
// AtividadeConsultor no schema.prisma) — a PK local é o `id` autoincrement do CaxHub,
// não o `seqati` do Senior. O upsert casa por `seqati` (único), não por `id`.
export async function runAtividadeConsultorSync(): Promise<void> {
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária real da tabela no Senior (USU_SeqAti / seqati).
    const rows = (await runSqlViaSoapPaginated(QUERY, ["seqati"])) as AtividadeConsultorRow[];

    // seqite=0 no Senior significa "sem item de proposta vinculado" — ignorado.
    const validas = rows.filter((row) => row.seqite !== 0);

    for (const row of validas) {
      const data = {
        codemp: row.codemp,
        codpro: row.codpro,
        seqite: row.seqite,
        codfor: row.codfor,
        qtdhor: row.qtdhor,
        sitreg: row.sitreg,
        datger: row.datger != null ? new Date(row.datger) : null,
        horger: row.horger,
        usuger: row.usuger,
        perlib: row.perlib,
        fasid: row.fasid,
        selsol: row.selsol,
      };
      await prisma.atividadeConsultor.upsert({
        where: { seqati: BigInt(row.seqati) },
        update: data,
        create: { ...data, seqati: BigInt(row.seqati) },
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
export function scheduleAtividadeConsultorSync(): void {
  cron.schedule("0 4 * * *", runAtividadeConsultorSync);
}
