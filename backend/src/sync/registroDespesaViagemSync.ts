import cron from "node-cron";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, emLotes, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { carimbo, varrerRemovidos } from "./varrerRemovidos";
import { criarEventoAuditoria } from "../audit/registrarEvento";
import { ENTIDADES_AUDITORIA, EVENTOS_AUDITORIA } from "../audit/taxonomia";
import { entidadeIdRat } from "../audit/identidadeEntidade";

export const JOB_NAME = "registros_despesa_viagem-sync";
export const CRON_EXPR = "20 5 * * *";
// Sem campo de "última alteração" no dicionário desta tabela — só sincroniza no modo
// completo (mesma lógica conservadora do DatPal em empresaSync.ts).
export const CAMPO_DATA: string | null = null;
export const BASE_QUERY =`SELECT USU_CODEMP AS codemp, USU_NUMRAT AS numrat, USU_SEQRDV AS seqrdv, USU_DATEMI AS datemi, USU_DESRDV AS desrdv, USU_TIPDES AS tipdes, USU_MODDES AS moddes, USU_QTDRDV AS qtdrdv, USU_VLRUNT AS vlrunt, USU_VLRTOT AS vlrtot, USU_FATRDV AS fatrdv, USU_REERDV AS reerdv, USU_ROTID AS rotid, USU_HORDES AS hordes, USU_NIDPSO AS nidpso FROM USU_TE777RDV`;

interface RegistroDespesaViagemRow {
  codemp: number;
  numrat: number;
  seqrdv: number;
  datemi?: string;
  desrdv?: string;
  tipdes?: number;
  moddes?: string;
  qtdrdv?: number;
  vlrunt?: number;
  vlrtot?: number;
  fatrdv?: string;
  reerdv?: string;
  rotid?: number;
  hordes?: number;
  nidpso?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (RegistroDespesaViagem): vlrunt/vlrtot Decimal(9,2). `id` (autoincrement) e
// `origemCaxHub`/`enviadoEmSenior` (nunca tocados por este sync — origemCaxHub protege
// despesa lançada pelo consultor no CaxHub) ficam de fora de propósito: uma coluna ausente
// do lote não é tocada pelo DO UPDATE e, no INSERT, recebe o DEFAULT do schema — mesmo
// comportamento que o upsert linha-a-linha já tinha. Carimbo (`visto_em_sync`/
// `removido_em_senior`) ligado em 10/09/2026 via `carimbo: inicio` abaixo, no `upsertEmLote`.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "numrat", cast: "int" },
  { nome: "seqrdv", cast: "int" },
  { nome: "datemi", cast: "date" },
  { nome: "desrdv", cast: "text" },
  { nome: "tipdes", cast: "int" },
  { nome: "moddes", cast: "text" },
  { nome: "qtdrdv", cast: "int" },
  { nome: "vlrunt", cast: "numeric" },
  { nome: "vlrtot", cast: "numeric" },
  { nome: "fatrdv", cast: "text" },
  { nome: "reerdv", cast: "text" },
  { nome: "rotid", cast: "int" },
  { nome: "hordes", cast: "int" },
  { nome: "nidpso", cast: "int" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)`. `!= null` (não `!== undefined`)
// trata ausência de chave e null da mesma forma.
function linhaDe(row: RegistroDespesaViagemRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numrat}-${row.seqrdv}`,
    valores: [
      String(row.codemp),
      String(row.numrat),
      String(row.seqrdv),
      row.datemi ? String(row.datemi).slice(0, 10) : null,
      row.desrdv != null ? row.desrdv : null,
      row.tipdes != null ? String(row.tipdes) : null,
      // ' ' (espaço) = despesa avulsa no Senior; grava NULL pro espelho não carregar o lixo.
      row.moddes?.trim() ? row.moddes : null,
      row.qtdrdv != null ? String(row.qtdrdv) : null,
      row.vlrunt != null ? row.vlrunt.toFixed(2) : null,
      row.vlrtot != null ? row.vlrtot.toFixed(2) : null,
      row.fatrdv != null ? row.fatrdv : null,
      row.reerdv != null ? row.reerdv : null,
      row.rotid != null ? String(row.rotid) : null,
      row.hordes != null ? String(row.hordes) : null,
      row.nidpso != null ? String(row.nidpso) : null,
    ],
  };
}

// Detecção LEVE de RDV nova, pra auditoria (DESPESA_CRIADA, 13/09/2026) — mesmo espírito de
// chavesRatAindaNaoExistentes/auditarRatsCriadas em ratSync.ts: duas metades separadas pelo
// upsert em lote no meio, porque `id` é autoincrement (só existe depois de gravada).
async function chavesDespesaAindaNaoExistentes(rows: RegistroDespesaViagemRow[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  // `emLotes` (14/09/2026): rows pode ter dezenas de milhares de linhas (varredura completa) —
  // um `findMany` só, com 1 condição OR por linha, derrubou a VPS de produção por falta de
  // memória (ver comentário de emLotes em upsertEmLote.ts).
  const existentesAntes = await emLotes(rows, (lote) =>
    prisma.registroDespesaViagem.findMany({
      where: { OR: lote.map((r) => ({ codemp: r.codemp, numrat: r.numrat, seqrdv: r.seqrdv })) },
      select: { codemp: true, numrat: true, seqrdv: true },
    })
  );
  const chavesExistentesAntes = new Set(existentesAntes.map((r) => `${r.codemp}-${r.numrat}-${r.seqrdv}`));
  return new Set(
    rows.map((r) => `${r.codemp}-${r.numrat}-${r.seqrdv}`).filter((chave) => !chavesExistentesAntes.has(chave))
  );
}

async function auditarDespesasCriadas(rows: RegistroDespesaViagemRow[], chavesNovas: Set<string>): Promise<void> {
  const rowsNovas = rows.filter((r) => chavesNovas.has(`${r.codemp}-${r.numrat}-${r.seqrdv}`));
  if (rowsNovas.length === 0) return;

  const criadas = await emLotes(rowsNovas, (lote) =>
    prisma.registroDespesaViagem.findMany({
      where: { OR: lote.map((r) => ({ codemp: r.codemp, numrat: r.numrat, seqrdv: r.seqrdv })) },
      select: { id: true, codemp: true, numrat: true, tipdes: true },
    })
  );
  // Despesa não tem FK pra Rat.id — resolve pela chave natural (codemp+numrat), em lotes (mesmo
  // cuidado de tamanho do `emLotes` acima — `criadas` normalmente é pequeno, mas nada garante
  // isso sempre).
  const chavesRat = [...new Set(criadas.map((c) => `${c.codemp}-${c.numrat}`))];
  const rats =
    chavesRat.length > 0
      ? await emLotes(criadas, (lote) =>
          prisma.rat.findMany({
            where: { OR: lote.map((c) => ({ codemp: c.codemp, numrat: c.numrat })) },
            select: { id: true, codemp: true, codpro: true, numrat: true },
          })
        )
      : [];
  const ratPorChave = new Map(rats.map((r) => [`${r.codemp}-${r.numrat}`, r]));

  for (const despesa of criadas) {
    const rat = ratPorChave.get(`${despesa.codemp}-${despesa.numrat}`);
    if (!rat) continue; // RAT ainda não sincronizada localmente — sem RAT, sem entidade pra auditar sob
    await criarEventoAuditoria({
      origem: "integracao_senior",
      codemp: rat.codemp,
      codpro: rat.codpro,
      entidadeTipo: ENTIDADES_AUDITORIA.RAT,
      entidadeId: entidadeIdRat(rat.id),
      entidadeRotulo: `RAT ${rat.numrat}`,
      eventoTipo: EVENTOS_AUDITORIA.DESPESA_CRIADA,
      alteracoes: null,
      metadata: { origemCriacao: "senior", despesaId: despesa.id, tipdes: despesa.tipdes },
      correlationId: randomUUID(),
    });
  }
}

// Despesa de viagem lançada numa RAT — 15.034 linhas em 13/08/2026 (paginado por segurança,
// mesmo abaixo do limite de ~30 mil onde o Senior costuma truncar a resposta).
export async function runRegistroDespesaViagemSync(): Promise<void> {
  const inicio = new Date();
  // Fase 1 do plano de filtros na importação: predicados vazios hoje, devolve BASE_QUERY intacta.
  const query = montarQuerySenior(BASE_QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat", "seqrdv"])) as RegistroDespesaViagemRow[];
    const msFetch = Date.now() - inicioFetch;

    const chavesNovas = await chavesDespesaAindaNaoExistentes(rows);

    // Casa pela chave natural DO SENIOR (@@unique), não pela PK local `id` — mesma lógica
    // de ratItemSync. Despesa criada no CaxHub tem seqrdv nulo, então nunca entra neste
    // upsert: é isso que a impede de ser sobrescrita por uma despesa do ERP que tenha
    // calhado de receber o mesmo número.
    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "registros_despesa_viagem",
      colunas: COLUNAS,
      colunasPk: ["codemp", "numrat", "seqrdv"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    await auditarDespesasCriadas(rows, chavesNovas);

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 10/09/2026
    // (porte do CaxHub_Atlas, convenção nova: sempre completo desde a criação da tabela).
    // MÃO DUPLA: chamada MANUAL (não `executarVarreduraDoJob`) porque o escopo aqui SEMPRE
    // precisa excluir `origemCaxHub: true` (despesa lançada pelo consultor no CaxHub, ainda
    // sem seqrdv confirmado no Senior) além do filtro salvo, se houver.
    const filtro = filtroDoJob(JOB_NAME, "todos");
    const filtroNaoEscopavel = filtro.predicadosSql.length > 0 && filtro.escopoLocal === null;
    const varredura = filtroNaoEscopavel
      ? null
      : await varrerRemovidos<Prisma.RegistroDespesaViagemWhereInput>(prisma.registroDespesaViagem, {
          jobName: JOB_NAME,
          inicio,
          linhasProcessadas: resultado.linhasProcessadas,
          escopo: { origemCaxHub: false, ...(filtro.escopoLocal ?? {}) } as Prisma.RegistroDespesaViagemWhereInput,
          queryContagemOrigem: montarQuerySenior(`SELECT COUNT(*) AS total FROM USU_TE777RDV`, filtro.predicadosSql),
        });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)` +
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

// Sincroniza só as despesas da RAT com esse numrat — usado pela ação manual "Sinc. ERP" em
// "Meus Apontamentos" (ver POST /rats/:id/sincronizar), mesmo espírito de
// runRatItemSyncPorNumrat em ratItemSync.ts: consulta filtrada, upsert linha a linha (poucas
// linhas por RAT — não precisa do upsert em lote da varredura completa), erro propaga pro
// chamador em vez de só logar (é assim que o botão sabe reportar falha ao consultor).
export async function runRegistroDespesaViagemSyncPorNumrat(codemp: number, numrat: number): Promise<void> {
  const query = `${BASE_QUERY} WHERE USU_CODEMP = ${codemp} AND USU_NUMRAT = ${numrat}`;
  const inicio = new Date();
  const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numrat", "seqrdv"])) as RegistroDespesaViagemRow[];

  // RAT já é conhecida (escopo desta função é sempre 1 RAT específica, chamada por
  // POST /rats/:id/sincronizar) — resolvida uma vez só, fora do laço, pra auditar
  // DESPESA_CRIADA (13/09/2026) sem N+1.
  const rat = await prisma.rat.findFirst({ where: { codemp, numrat }, select: { id: true, codemp: true, codpro: true, numrat: true } });

  // origemCaxHub/enviadoEmSenior de propósito fora do payload — mesma proteção do upsert em
  // lote acima: despesa lançada pelo consultor nunca tem seqrdv, então nunca cai neste upsert.
  // Carimbo aplicado (seguro mesmo num sync parcial — só documenta quando a linha foi vista);
  // SEM chamada de varredura aqui: escopo de 1 RAT só marcaria a tabela inteira como suspeita
  // (mesmo raciocínio de runRatItemSyncPorNumrat em ratItemSync.ts).
  for (const row of rows) {
    const data = {
      codemp: row.codemp,
      numrat: row.numrat,
      seqrdv: row.seqrdv,
      datemi: row.datemi ? new Date(row.datemi) : null,
      desrdv: row.desrdv ?? null,
      tipdes: row.tipdes ?? null,
      moddes: row.moddes?.trim() ? row.moddes : null,
      qtdrdv: row.qtdrdv ?? null,
      vlrunt: row.vlrunt ?? null,
      vlrtot: row.vlrtot ?? null,
      fatrdv: row.fatrdv ?? null,
      reerdv: row.reerdv ?? null,
      rotid: row.rotid ?? null,
      hordes: row.hordes ?? null,
      nidpso: row.nidpso ?? null,
      ...carimbo(inicio),
    };
    // Existência checada ANTES do upsert (linha a linha, poucas despesas por RAT — sem custo
    // relevante) pra saber se é criação de verdade, não atualização de uma já conhecida.
    const existiaAntes = await prisma.registroDespesaViagem.findUnique({
      where: { codemp_numrat_seqrdv: { codemp: row.codemp, numrat: row.numrat, seqrdv: row.seqrdv } },
      select: { id: true },
    });
    const gravada = await prisma.registroDespesaViagem.upsert({
      where: { codemp_numrat_seqrdv: { codemp: row.codemp, numrat: row.numrat, seqrdv: row.seqrdv } },
      update: data,
      create: data,
    });
    if (!existiaAntes && rat) {
      await criarEventoAuditoria({
        origem: "integracao_senior",
        codemp: rat.codemp,
        codpro: rat.codpro,
        entidadeTipo: ENTIDADES_AUDITORIA.RAT,
        entidadeId: entidadeIdRat(rat.id),
        entidadeRotulo: `RAT ${rat.numrat}`,
        eventoTipo: EVENTOS_AUDITORIA.DESPESA_CRIADA,
        alteracoes: null,
        metadata: { origemCriacao: "senior", despesaId: gravada.id, tipdes: gravada.tipdes },
        correlationId: randomUUID(),
      });
    }
  }

  await prisma.syncLog.create({
    data: { jobName: JOB_NAME, query, status: "success", message: `${rows.length} despesa(s) no Senior (RAT ${codemp}/${numrat})` },
  });
}

// Despesa de viagem muda pouco depois de lançada — roda 1x por dia às 5h20.
export function scheduleRegistroDespesaViagemSync(): void {
  cron.schedule(CRON_EXPR, runRegistroDespesaViagemSync);
}
