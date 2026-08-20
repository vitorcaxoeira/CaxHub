import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { varrerRemovidos } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

export const JOB_NAME = "lancamentos_contabeis-sync";
// Sem campo de "última alteração" confiável no dicionário do Senior pra esta tabela —
// mesma lógica conservadora do comentário sobre DatPal em empresaSync.ts: melhor não
// sincronizar "alterados" do que filtrar por um campo que pode deixar linha de fora.
export const CRON_EXPR = "0 5 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT codemp AS codemp, numlct AS numlct, sitlct AS sitlct, orilct AS orilct, cpllct AS cpllct, numlot AS numlot FROM e640lct`;

interface LancamentoContabilRow {
  codemp: number;
  numlct: number;
  sitlct: number;
  orilct: string;
  cpllct?: string;
  numlot?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (LancamentoContabil): numlct BigInt.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "numlct", cast: "bigint" },
  { nome: "sitlct", cast: "int" },
  { nome: "orilct", cast: "text" },
  { nome: "cpllct", cast: "text" },
  { nome: "numlot", cast: "int" },
];

// `!= null` (não `!== undefined`) pra tratar ausência de chave e null da mesma forma — os
// dois colapsam pra null explícito no lote.
function linhaDe(row: LancamentoContabilRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numlct}`,
    valores: [
      String(row.codemp),
      String(row.numlct),
      String(row.sitlct),
      row.orilct,
      row.cpllct != null ? row.cpllct : null,
      row.numlot != null ? String(row.numlot) : null,
    ],
  };
}

export async function runLancamentoContabilSync(): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "numlct"])) as LancamentoContabilRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "lancamentos_contabeis",
      colunas: COLUNAS,
      colunasPk: ["codemp", "numlct"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 20/08/2026 a
    // pedido do Vitor: lançamento contábil tem manutenção pesada do lado do Senior (edição e
    // remoção frequentes, não é cadastro estático), e o upsert em lote só cobre incluir/
    // alterar. Sem isso, registro removido no Senior virava fantasma permanente no espelho.
    // Começa em "simular" (politicaVarredura.ts) — nunca direto em "marcar". Escopo `{}`:
    // espelho só-leitura (Senior -> CaxHub), sem escrita de volta, então não há registro
    // "nascido no CaxHub" pra excluir do escopo.
    const varredura = await varrerRemovidos<Prisma.LancamentoContabilWhereInput>(prisma.lancamentoContabil, {
      jobName: JOB_NAME,
      inicio,
      linhasProcessadas: rows.length,
      escopo: {},
      queryContagemOrigem: `SELECT COUNT(*) AS total FROM e640lct`,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: QUERY,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes) — ${varredura.resumo}`,
        varreduraModo: varredura.modo,
        varreduraDetectados: varredura.candidatos,
        varreduraInicio: inicio,
        duracaoMs: Date.now() - inicio.getTime(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Roda 1x por dia às 5h, depois do plano contábil de que depende. Sem CAMPO_DATA — só
// sincroniza no modo completo.
export function scheduleLancamentoContabilSync(): void {
  cron.schedule(CRON_EXPR, () => runLancamentoContabilSync());
}
