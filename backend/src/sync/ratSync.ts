import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";

export const JOB_NAME = "rat-sync";
export const CRON_EXPR = "15 4 * * *"; // logo depois de atividades_consultor-sync (0 4 * * *)
export const CAMPO_DATA: string | null = "USU_DATEMI";
const BASE_QUERY = `SELECT USU_CODEMP AS codemp, USU_CODFOR AS codfor, USU_NUMPRJ AS numprj, USU_CODFPJ AS codfpj, USU_NUMRAT AS numrat, USU_DATEMI AS datemi, USU_DATAPR AS dataapr, USU_SITRAT AS sitrat, USU_OBSRAT AS obsrat, USU_USUFOR AS usufor, USU_CodPro AS codpro, USU_CodCli AS codcli, USU_DepExe AS depexe FROM USU_TE777RAT`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface RatRow {
  codemp: number;
  codfor: number;
  numprj: number;
  codfpj: number;
  numrat: number;
  datemi?: string;
  dataapr?: string;
  sitrat?: number;
  obsrat?: string;
  usufor?: number;
  codpro?: number;
  codcli?: number;
  depexe?: number;
}

// Cabeçalho de RAT (Registro de Atividade Técnica) — espelho parcial de USU_TE777RAT
// (só os campos usados hoje, ver comentário do model Rat no schema.prisma). Igual a
// AtividadeConsultor, é uma tabela de mão dupla, mas aqui a chave natural completa
// (codemp+numprj+codfpj+numrat) só existe depois que o Senior confirma o documento — o
// CaxHub cria localmente sem numrat (ver POST /apontamentos/confirmar), e essa leitura
// NUNCA cria linha com numrat nulo (as 4 colunas da chave são NOT NULL na origem).
async function executarUpsert(query: string): Promise<number> {
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat"])) as RatRow[];

  for (const row of rows) {
    const data = {
      codemp: row.codemp,
      codfor: row.codfor,
      numprj: row.numprj,
      codfpj: row.codfpj,
      numrat: row.numrat,
      datemi: row.datemi != null ? new Date(row.datemi) : null,
      dataApr: row.dataapr != null ? new Date(row.dataapr) : null,
      sitrat: row.sitrat ?? null,
      obsrat: row.obsrat ?? null,
      usufor: row.usufor ?? null,
      codpro: row.codpro ?? null,
      codcli: row.codcli ?? null,
      depexe: row.depexe ?? null,
      origemCaxHub: false,
    };
    await prisma.rat.upsert({
      where: {
        codemp_numprj_codfpj_numrat: {
          codemp: row.codemp,
          numprj: row.numprj,
          codfpj: row.codfpj,
          numrat: row.numrat,
        },
      },
      update: data,
      create: data,
    });
  }
  return rows.length;
}

export async function runRatSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    await executarUpsert(query);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "success", duracaoMs: Date.now() - inicio.getTime() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Sincroniza só o cabeçalho da RAT com esse numrat — usado pela ação manual "Sinc. ERP"
// em "Meus Apontamentos" (ver POST /rats/:id/sincronizar). Diferente de runRatSync
// (job agendado, engole erro e só loga em SyncLog), propaga erro pro chamador: é uma
// ação síncrona disparada por clique, a rota HTTP precisa saber se falhou pra avisar o
// usuário. `codemp`/`numrat` vêm do próprio Rat já gravado localmente (nunca input
// direto do usuário), interpolados como number — mesmo padrão de montarQuery com datas.
//
// Devolve se a RAT ainda existe no Senior (rows.length > 0) — o chamador usa isso pra
// desvincular o cabeçalho (Rat.numrat) quando o documento inteiro sumiu de lá, mesmo
// espírito de desvincularItensAusentesNoSenior pros itens.
export async function runRatSyncPorNumrat(codemp: number, numrat: number): Promise<boolean> {
  const query = `${BASE_QUERY} WHERE USU_CODEMP = ${codemp} AND USU_NUMRAT = ${numrat}`;
  const total = await executarUpsert(query);
  await prisma.syncLog.create({ data: { jobName: JOB_NAME, query, status: "success" } });
  return total > 0;
}

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental só é
// usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleRatSync(): void {
  cron.schedule(CRON_EXPR, () => runRatSync());
}
