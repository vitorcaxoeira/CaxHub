import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { varrerRemovidos } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "rateios_lancamento-sync";
// Sem campo de "última alteração" confiável no dicionário do Senior pra esta tabela — mesma
// lógica conservadora do comentário sobre DatPal em empresaSync.ts.
export const CRON_EXPR = "5 5 * * *";
export const CAMPO_DATA: string | null = null;
export const QUERY =`SELECT codemp AS codemp, numlct AS numlct, ctared AS ctared, codccu AS codccu, debcre AS debcre, datlct AS datlct, vlrrat AS vlrrat, sitrat AS sitrat FROM e640rat`;

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

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — casts conferidos contra
// schema.prisma (RateioLancamento): numlct BigInt, vlrrat Decimal(17,2), codccu VarChar(9)
// (por isso ::text, nunca ::varchar(9) — cast largo pra coluna estreita preserva o erro de
// truncamento em vez de truncar em silêncio).
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "numlct", cast: "bigint" },
  { nome: "ctared", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "debcre", cast: "text" },
  { nome: "datlct", cast: "date" },
  { nome: "vlrrat", cast: "numeric" },
  { nome: "sitrat", cast: "int" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)` — "2025-03-14" é UTC mas
// "2025-03-14T00:00:00" é local, e em America/Sao_Paulo isso desloca o dia. `vlrrat.toFixed(2)`
// nunca number cru (Decimal(17,2) no schema). `!= null` (não `!== undefined`) pra tratar
// ausência de chave e null da mesma forma — os dois colapsam pra null explícito no lote.
function linhaDe(row: RateioLancamentoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numlct}-${row.ctared}-${row.codccu}`,
    valores: [
      String(row.codemp),
      String(row.numlct),
      String(row.ctared),
      row.codccu,
      row.debcre != null ? row.debcre : null,
      String(row.datlct).slice(0, 10),
      row.vlrrat.toFixed(2),
      String(row.sitrat),
    ],
  };
}

export async function runRateioLancamentoSync(): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  // Fase 4 do plano de filtros na importação: filtro salvo (por dimensão ou específico desta
  // tabela) entra na mesma lista de predicados da Fase 1.
  const filtro = filtroDoJob(JOB_NAME, "todos");
  const query = montarQuerySenior(QUERY, filtro.predicadosSql);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numlct", "ctared", "codccu"])) as RateioLancamentoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "rateios_lancamento",
      colunas: COLUNAS,
      colunasPk: ["codemp", "numlct", "ctared", "codccu"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — ligada em 20/08/2026 a
    // pedido do Vitor: rateio/lançamento tem manutenção pesada do lado do Senior (edição e
    // remoção frequentes, não é cadastro estático), e o upsert em lote só cobre incluir/
    // alterar. Sem isso, registro removido no Senior virava fantasma permanente no espelho.
    // Começa em "simular" (politicaVarredura.ts) — nunca direto em "marcar". Escopo `{}`:
    // espelho só-leitura (Senior -> CaxHub), sem escrita de volta, então não há registro
    // "nascido no CaxHub" pra excluir do escopo.
    //
    // Fase 4 do plano de filtros: com filtro ativo, esse escopo `{}` vira o `escopoLocal`
    // resolvido (mesmo predicado, na coluna espelhada) e a contagem de origem recebe o MESMO
    // WHERE — sem isso a varredura compararia "linhas do recorte filtrado" contra "total da
    // tabela inteira" e acusaria truncamento onde não houve. Quando o filtro toca campo NÃO
    // espelhado (sem escopo local possível), a varredura fica desligada nessa rodada — rodar
    // sem escopo marcaria a base inteira como removida.
    const filtroNaoEscopavel = filtro.predicadosSql.length > 0 && filtro.escopoLocal === null;
    const varredura = filtroNaoEscopavel
      ? null
      : await varrerRemovidos<Prisma.RateioLancamentoWhereInput>(prisma.rateioLancamento, {
          jobName: JOB_NAME,
          inicio,
          linhasProcessadas: rows.length,
          escopo: (filtro.escopoLocal ?? {}) as Prisma.RateioLancamentoWhereInput,
          queryContagemOrigem: montarQuerySenior(`SELECT COUNT(*) AS total FROM e640rat`, filtro.predicadosSql),
        });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
        status: "success",
        message: varredura
          ? `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
            `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes) — ${varredura.resumo}`
          : `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
            `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes), ` +
            `sem varredura (filtro ativo em campo não espelhado: ${filtro.motivoNaoEscopavel})`,
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

// Roda 1x por dia às 5h05, depois de lancamentos_contabeis-sync (0 5 * * *) — o rateio
// depende do lançamento já existir. Sem CAMPO_DATA — só sincroniza no modo completo.
export function scheduleRateioLancamentoSync(): void {
  cron.schedule(CRON_EXPR, () => runRateioLancamentoSync());
}
