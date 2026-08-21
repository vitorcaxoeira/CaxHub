import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

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

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores. `"dataApr"` precisa das
// aspas que upsertEmLote já aplica em todo nome de coluna — é a única coluna do projeto sem
// @map, então o Postgres guarda o nome exatamente como está no schema Prisma (misto), não
// lowercase. `origemCaxHub` sempre "false": o upsert antigo também forçava isso em TODO
// update, não só create — mesmo comportamento preservado aqui (ver runRat abaixo).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfor", cast: "int" },
  { nome: "numprj", cast: "int" },
  { nome: "codfpj", cast: "int" },
  { nome: "numrat", cast: "int" },
  { nome: "datemi", cast: "date" },
  { nome: "dataApr", cast: "date" },
  { nome: "sitrat", cast: "int" },
  { nome: "obsrat", cast: "text" },
  { nome: "usufor", cast: "int" },
  { nome: "codpro", cast: "int" },
  { nome: "codcli", cast: "int" },
  { nome: "depexe", cast: "int" },
  { nome: "origemCaxHub", cast: "boolean" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma.
function linhaDe(row: RatRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numprj}-${row.codfpj}-${row.numrat}`,
    valores: [
      String(row.codemp),
      String(row.codfor),
      String(row.numprj),
      String(row.codfpj),
      String(row.numrat),
      row.datemi != null ? String(row.datemi).slice(0, 10) : null,
      row.dataapr != null ? String(row.dataapr).slice(0, 10) : null,
      row.sitrat != null ? String(row.sitrat) : null,
      row.obsrat != null ? row.obsrat : null,
      row.usufor != null ? String(row.usufor) : null,
      row.codpro != null ? String(row.codpro) : null,
      row.codcli != null ? String(row.codcli) : null,
      row.depexe != null ? String(row.depexe) : null,
      "false",
    ],
  };
}

// Cabeçalho de RAT (Registro de Atividade Técnica) — espelho parcial de USU_TE777RAT
// (só os campos usados hoje, ver comentário do model Rat no schema.prisma). Igual a
// AtividadeConsultor, é uma tabela de mão dupla, mas aqui a chave natural completa
// (codemp+numprj+codfpj+numrat) só existe depois que o Senior confirma o documento — o
// CaxHub cria localmente sem numrat (ver POST /apontamentos/confirmar), e essa leitura
// NUNCA cria linha com numrat nulo (as 4 colunas da chave são NOT NULL na origem).
async function executarUpsert(query: string): Promise<number> {
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat"])) as RatRow[];
  const resultado = await upsertEmLote(rows.map(linhaDe), {
    tabela: "rats",
    colunas: COLUNAS,
    colunasPk: ["codemp", "numprj", "codfpj", "numrat"],
  });
  return resultado.linhasProcessadas;
}

export async function runRatSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const total = await executarUpsert(query);
    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: `${total} linha(s) em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s`,
        duracaoMs: Date.now() - inicio.getTime(),
      },
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
