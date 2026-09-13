import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { varrerRemovidos } from "./varrerRemovidos";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdRat } from "../audit/identidadeEntidade";

export const JOB_NAME = "rat-sync";
export const CRON_EXPR = "15 4 * * *"; // logo depois de atividades_consultor-sync (0 4 * * *)
export const CAMPO_DATA: string | null = "USU_DATEMI";
export const BASE_QUERY =`SELECT USU_CODEMP AS codemp, USU_CODFOR AS codfor, USU_NUMPRJ AS numprj, USU_CODFPJ AS codfpj, USU_NUMRAT AS numrat, USU_DATEMI AS datemi, USU_DATAPR AS dataapr, USU_SITRAT AS sitrat, USU_OBSRAT AS obsrat, USU_USUFOR AS usufor, USU_CodPro AS codpro, USU_CodCli AS codcli, USU_DepExe AS depexe FROM USU_TE777RAT`;

// Fase 1 do plano de filtros na importação: acumulador de predicados
// (sync/consultaSenior.ts), não concatenação — lista vazia devolve BASE_QUERY intacta.
function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  // Pedido do Vitor (21/08/2026): se o admin já salvou um predicado explícito no campo de
  // data (Filtro(Alterados), inclusive com a variável "última sincronização"), ele substitui
  // a injeção automática por inteiro em vez de empilhar os dois — "editável de verdade".
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
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
// `inicio` tem default pra não quebrar runRatSyncPorNumrat abaixo (que não roda varredura —
// escopo de 1 RAT só marcaria a tabela inteira como suspeita) — o carimbo em si é seguro em
// qualquer chamada, só documenta quando a linha foi vista.
// Estado de uma RAT já existente ANTES do upsert — usado tanto pra saber "quem é nova"
// (ausente deste Map) quanto, pra quem já existe, comparar sitrat antes/depois (ver
// auditarMudancaSituacao). `id` só é lido AQUI (antes do upsert) porque, pra linha que já
// existe, o autoincrement já existe há muito — diferente da linha NOVA, cujo id só nasce
// depois do INSERT (ver auditarRatsCriadas, que por isso relê depois).
interface RatExistenteAntes {
  id: number;
  codemp: number;
  codpro: number | null;
  numrat: number | null;
  sitrat: number | null;
}

async function ratsExistentesAntes(rows: RatRow[]): Promise<Map<string, RatExistenteAntes>> {
  if (rows.length === 0) return new Map();
  const existentes = await prisma.rat.findMany({
    where: { OR: rows.map((r) => ({ codemp: r.codemp, numprj: r.numprj, codfpj: r.codfpj, numrat: r.numrat })) },
    select: { id: true, codemp: true, codpro: true, numprj: true, codfpj: true, numrat: true, sitrat: true },
  });
  return new Map(existentes.map((r) => [`${r.codemp}-${r.numprj}-${r.codfpj}-${r.numrat}`, r]));
}

// Detecção LEVE de RAT nova, pra auditoria (RAT_CRIADA, 13/09/2026) — só o suficiente pra saber
// se uma linha é genuinamente nova, sem portar este arquivo pro padrão híbrido completo de
// propostaSync.ts (que também audita toda UPDATE com diff de campo — ver auditarMudancaSituacao
// abaixo pro único campo que hoje tem esse tratamento). Roda DEPOIS do upsert (`id` autoincrement
// só existe a partir daí) — chamado tanto por runRatSync (cron completo) quanto por
// runRatSyncPorNumrat ("Sinc. ERP" manual), já que os dois passam por executarUpsert.
async function auditarRatsCriadas(rows: RatRow[], existentesAntes: Map<string, RatExistenteAntes>): Promise<void> {
  const rowsNovas = rows.filter((r) => !existentesAntes.has(`${r.codemp}-${r.numprj}-${r.codfpj}-${r.numrat}`));
  if (rowsNovas.length === 0) return;

  const criadas = await prisma.rat.findMany({
    where: { OR: rowsNovas.map((r) => ({ codemp: r.codemp, numprj: r.numprj, codfpj: r.codfpj, numrat: r.numrat })) },
    select: { id: true, codemp: true, codpro: true, numrat: true },
  });
  for (const rat of criadas) {
    await criarEventoAuditoria({
      origem: "integracao_senior",
      codemp: rat.codemp,
      codpro: rat.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.RAT,
      entidadeId: entidadeIdRat(rat.id),
      entidadeRotulo: `RAT ${rat.numrat}`,
      eventoTipo: EVENTOS_AUDITORIA.RAT_CRIADA,
      alteracoes: null,
      metadata: { origemCriacao: "senior" },
      correlationId: randomUUID(),
    });
  }
}

// Auditoria de mudança de SITUAÇÃO (RAT_SITUACAO_ALTERADA_SENIOR, 13/09/2026) — achado real:
// mudar `sitrat` direto no Senior (ex.: Fechado -> Digitado de novo) e sincronizar não deixava
// NENHUM rastro, só RAT_CRIADA (que só cobre linha nova). Escopo deliberadamente estreito a só
// este campo — não todo campo espelhado da RAT, como PROPOSTA_ALTERADA faz pra Proposta — por
// ser o único que já mostrou um caso de uso real até agora. Roda DEPOIS do upsert (mesmo timing
// de auditarRatsCriadas, por consistência, embora aqui o `id` já fosse conhecido antes).
async function auditarMudancaSituacao(rows: RatRow[], existentesAntes: Map<string, RatExistenteAntes>): Promise<void> {
  for (const row of rows) {
    const antes = existentesAntes.get(`${row.codemp}-${row.numprj}-${row.codfpj}-${row.numrat}`);
    if (!antes) continue; // linha nova — RAT_CRIADA já cobre, sem "situação anterior" pra comparar
    const situacaoDepois = row.sitrat ?? null;
    if (antes.sitrat === situacaoDepois) continue; // nada mudou

    await criarEventoAuditoria({
      origem: "integracao_senior",
      codemp: antes.codemp,
      codpro: antes.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.RAT,
      entidadeId: entidadeIdRat(antes.id),
      entidadeRotulo: `RAT ${row.numrat}`,
      eventoTipo: EVENTOS_AUDITORIA.RAT_SITUACAO_ALTERADA_SENIOR,
      alteracoes: { sitrat: { de: antes.sitrat, para: situacaoDepois, rotulo: "Situação" } },
      metadata: null,
      correlationId: randomUUID(),
    });
  }
}

async function executarUpsert(query: string, inicio: Date = new Date()): Promise<number> {
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat"])) as RatRow[];
  const existentesAntes = await ratsExistentesAntes(rows);
  const resultado = await upsertEmLote(rows.map(linhaDe), {
    tabela: "rats",
    colunas: COLUNAS,
    colunasPk: ["codemp", "numprj", "codfpj", "numrat"],
    carimbo: inicio,
  });
  await auditarRatsCriadas(rows, existentesAntes);
  await auditarMudancaSituacao(rows, existentesAntes);
  return resultado.linhasProcessadas;
}

export async function runRatSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const total = await executarUpsert(query, inicio);

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // MÃO DUPLA: chamada MANUAL (não `executarVarreduraDoJob`) porque o escopo aqui SEMPRE
    // precisa excluir `origemCaxHub: true` (rascunho criado no CaxHub, ainda sem numrat
    // confirmado no Senior) além do filtro salvo, se houver.
    const filtro = filtroDoJob(JOB_NAME, "todos");
    const filtroNaoEscopavel = filtro.predicadosSql.length > 0 && filtro.escopoLocal === null;
    const varredura =
      desde || filtroNaoEscopavel
        ? null
        : await varrerRemovidos<Prisma.RatWhereInput>(prisma.rat, {
            jobName: JOB_NAME,
            inicio,
            linhasProcessadas: total,
            escopo: { origemCaxHub: false, ...(filtro.escopoLocal ?? {}) } as Prisma.RatWhereInput,
            queryContagemOrigem: montarQuerySenior(`SELECT COUNT(*) AS total FROM USU_TE777RAT`, filtro.predicadosSql),
          });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${total} linha(s) em ${((Date.now() - inicio.getTime()) / 1000).toFixed(1)}s` +
          (varredura ? ` — ${varredura.resumo}` : ""),
        varreduraModo: varredura?.modo ?? null,
        varreduraDetectados: varredura?.candidatos ?? null,
        varreduraInicio: varredura ? inicio : null,
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
