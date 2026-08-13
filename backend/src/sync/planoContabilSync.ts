import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { carimbo } from "./varrerRemovidos";
import { derivarPais } from "../domain/hierarquiaPlano";

export const JOB_NAME = "plano_contabil-sync";
export const CRON_EXPR = "50 4 * * *";
export const CAMPO_DATA: string | null = "DatAlt";
// nivcta/mskgcc/gructa/sitcta acrescentados em 13/08/2026: o Senior já entrega o nível da
// conta e a máscara do grupo, então a hierarquia deixou de ser deduzida do comprimento de
// `clacta` com larguras chumbadas no código (ver domain/hierarquiaPlano.ts).
const BASE_QUERY = `SELECT codemp AS codemp, ctared AS ctared, descta AS descta, clacta AS clacta, defgru AS defgru, natcta AS natcta, anasin AS anasin, despar AS despar, nivcta AS nivcta, mskgcc AS mskgcc, gructa AS gructa, sitcta AS sitcta FROM e045pla`;

function montarQuery(desde?: Date): string {
  if (!desde) return BASE_QUERY;
  return `${BASE_QUERY} WHERE ${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`;
}

interface PlanoContabilRow {
  codemp: number;
  ctared: number;
  descta: string;
  clacta: string;
  defgru: string;
  natcta: string;
  anasin: string;
  despar?: string;
  nivcta?: number;
  mskgcc?: string;
  gructa?: number;
  sitcta?: string;
}

export async function runPlanoContabilSync(desde?: Date): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  const QUERY = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "ctared"])) as PlanoContabilRow[];

    for (const row of rows) {
      const data = { codemp: row.codemp, ctared: row.ctared, descta: row.descta, clacta: row.clacta, defgru: row.defgru, natcta: row.natcta, anasin: row.anasin, despar: row.despar, nivcta: row.nivcta, mskgcc: row.mskgcc, gructa: row.gructa, sitcta: row.sitcta, ...carimbo(inicio) };
      await prisma.planoContabil.upsert({
        where: { codemp_ctared: { codemp: row.codemp, ctared: row.ctared } },
        update: data,
        create: data,
      });
    }

    // Conta-pai: único campo derivado desta tabela — o Senior não tem "CtaPai" em E045PLA
    // (só E044CCU.CcuPai, pro centro de custo). Roda DEPOIS do laço de upsert porque precisa
    // do plano inteiro em mãos pra achar o pai de cada conta, e por empresa porque `clacta`
    // só é único dentro de uma empresa. Num sync incremental (`desde` preenchido) as contas
    // não alteradas continuam no banco, então lê do banco em vez de usar `rows`.
    const empresasTocadas = [...new Set(rows.map((r) => r.codemp))];
    for (const codemp of empresasTocadas) {
      const contas = await prisma.planoContabil.findMany({
        where: { codemp },
        select: { ctared: true, clacta: true, nivcta: true, mskgcc: true, paiCtared: true },
      });
      const pais = derivarPais(
        contas.map((c) => ({ codigo: c.ctared, classificacao: c.clacta, nivel: c.nivcta, mascara: c.mskgcc }))
      );
      for (const conta of contas) {
        const paiCtared = pais.get(conta.ctared) ?? null;
        if (paiCtared === conta.paiCtared) continue; // nada mudou — não gasta UPDATE
        await prisma.planoContabil.update({
          where: { codemp_ctared: { codemp, ctared: conta.ctared } },
          data: { paiCtared },
        });
      }
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
    // const varredura = await varrerRemovidos<Prisma.PlanoContabilWhereInput>(prisma.planoContabil, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e045pla`,
    // });

    await prisma.syncLog.create({
      // Ao ligar a varredura, acrescentar aqui pra ela aparecer no painel:
      //   message: varredura.resumo,
      //   varreduraModo: varredura.modo,
      //   varreduraDetectados: varredura.candidatos,
      //   varreduraInicio: inicio,
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

// Plano de contas contábil muda pouco — roda 1x por dia às 4h50. O modo incremental só
// roda quando disparado manualmente pela tela de administração de sincronização.
export function schedulePlanoContabilSync(): void {
  cron.schedule(CRON_EXPR, () => runPlanoContabilSync());
}
