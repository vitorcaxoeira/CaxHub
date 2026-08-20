import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";

export const JOB_NAME = "orcamentos_contabeis-sync";
// Só tem DatGer no dicionário do Senior pra esta tabela — mesma lógica conservadora do
// comentário sobre DatPal em empresaSync.ts: não dá pra confiar nele como "alterado desde".
export const CRON_EXPR = "10 5 * * *";
export const CAMPO_DATA: string | null = null;
const QUERY = `SELECT codemp AS codemp, codfil AS codfil, mesano AS mesano, ctared AS ctared, codccu AS codccu, ctafin AS ctafin, vlrrat AS vlrrat FROM e650rto`;

interface OrcamentoContabilRow {
  codemp: number;
  codfil: number;
  mesano: string;
  ctared: number;
  codccu: string;
  ctafin: number;
  vlrrat: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (OrcamentoContabil): vlrrat Decimal(17,2), codccu VarChar(9) (por isso
// ::text, nunca ::varchar(9) — trunca em silêncio).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "mesano", cast: "date" },
  { nome: "ctared", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "ctafin", cast: "int" },
  { nome: "vlrrat", cast: "numeric" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)` — "2025-03-14" é UTC mas
// "2025-03-14T00:00:00" é local, e em America/Sao_Paulo isso desloca o dia (mesano já vem
// 100% alinhado no dia 1, então o recorte é seguro). `vlrrat.toFixed(2)` nunca number cru.
function linhaDe(row: OrcamentoContabilRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.mesano}-${row.ctared}-${row.codccu}-${row.ctafin}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.mesano).slice(0, 10),
      String(row.ctared),
      row.codccu,
      String(row.ctafin),
      row.vlrrat.toFixed(2),
    ],
  };
}

export async function runOrcamentoContabilSync(): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(QUERY, [
      "codemp",
      "codfil",
      "mesano",
      "ctared",
      "codccu",
      "ctafin",
    ])) as OrcamentoContabilRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "orcamentos_contabeis",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "mesano", "ctared", "codccu", "ctafin"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

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
    //   import { varrerRemovidos } from "./varrerRemovidos";
    // e registrar o JOB_NAME em src/sync/politicaVarredura.ts começando por "simular" —
    // nunca direto em "marcar", sem antes conferir os detectados contra o ERP.
    //
    // const varredura = await varrerRemovidos<Prisma.OrcamentoContabilWhereInput>(prisma.orcamentoContabil, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e650rto`,
    // });

    await prisma.syncLog.create({
      // Ao ligar a varredura, acrescentar aqui pra ela aparecer no painel:
      //   message: `${resultado.linhasProcessadas} linhas em ...s — ${varredura.resumo}`,
      //   varreduraModo: varredura.modo,
      //   varreduraDetectados: varredura.candidatos,
      //   varreduraInicio: inicio,
      data: {
        jobName: JOB_NAME,
        query: QUERY,
        status: "success",
        message:
          `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
          `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)`,
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

// Roda 1x por dia às 5h10, independente das outras tabelas contábeis. Sem CAMPO_DATA — só
// sincroniza no modo completo.
export function scheduleOrcamentoContabilSync(): void {
  cron.schedule(CRON_EXPR, () => runOrcamentoContabilSync());
}
