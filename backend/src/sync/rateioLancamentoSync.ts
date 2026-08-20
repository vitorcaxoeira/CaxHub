import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { carimbo } from "./varrerRemovidos";

export const JOB_NAME = "rateios_lancamento-sync";
// Sem campo de "última alteração" confiável no dicionário do Senior pra esta tabela — mesma
// lógica conservadora do comentário sobre DatPal em empresaSync.ts.
export const CRON_EXPR = "5 5 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT codemp AS codemp, numlct AS numlct, ctared AS ctared, codccu AS codccu, debcre AS debcre, datlct AS datlct, vlrrat AS vlrrat, sitrat AS sitrat FROM e640rat`;

interface RateioLancamentoRow {
  codemp: number;
  numlct: number;
  ctared: number;
  codccu: string;
  debcre?: string;
  datlct: string;
  vlrrat: number;
  sitrat: number;
}

export async function runRateioLancamentoSync(): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "numlct", "ctared", "codccu"])) as RateioLancamentoRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, numlct: BigInt(row.numlct), ctared: row.ctared, codccu: row.codccu, debcre: row.debcre, datlct: new Date(row.datlct), vlrrat: row.vlrrat, sitrat: row.sitrat, ...carimbo(inicio) };
      await prisma.rateioLancamento.upsert({
        where: { codemp_numlct_ctared_codccu: { codemp: row.codemp, numlct: BigInt(row.numlct), ctared: row.ctared, codccu: row.codccu } },
        update: data,
        create: data,
      });
    }

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — vem comentada de
    // propósito: ligar a varredura exige duas decisões que um gerador não tem como
    // adivinhar, e o default de politicaVarredura.ts é "desligada" justamente pra tabela
    // nova nunca começar a marcar registro sozinha.
    //   1. ESCOPO — precisa excluir registro nascido no CaxHub, se esta tabela for de mão
    //      dupla (ex.: { origemCaxHub: false }), senão ele é acusado de removido.
    //   2. CONTAGEM NA ORIGEM — tem que repetir exatamente o mesmo FROM/WHERE da QUERY
    //      acima, incluindo filtro aplicado às linhas dentro do laço, senão a guarda
    //      acusa truncamento onde não houve.
    //
    // Pra ligar: descomentar o bloco, acrescentar aos imports
    //   import { Prisma } from "@prisma/client";
    //   import { carimbo, varrerRemovidos } from "./varrerRemovidos";
    // e registrar o JOB_NAME em src/sync/politicaVarredura.ts começando por "simular" —
    // nunca direto em "marcar", sem antes conferir os detectados contra o ERP.
    //
    // const varredura = await varrerRemovidos<Prisma.RateioLancamentoWhereInput>(prisma.rateioLancamento, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e640rat`,
    // });

    await prisma.syncLog.create({
      // Ao ligar a varredura, acrescentar aqui pra ela aparecer no painel:
      //   message: varredura.resumo,
      //   varreduraModo: varredura.modo,
      //   varreduraDetectados: varredura.candidatos,
      //   varreduraInicio: inicio,
      data: { jobName: JOB_NAME, query: QUERY, status: "success", duracaoMs: Date.now() - inicio.getTime() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Roda 1x por dia às 5h05, depois de lancamentos_contabeis-sync (0 5 * * *) — o rateio
// depende do lançamento já existir. Sem CAMPO_DATA — só sincroniza no modo completo.
export function scheduleRateioLancamentoSync(): void {
  cron.schedule(CRON_EXPR, () => runRateioLancamentoSync());
}
