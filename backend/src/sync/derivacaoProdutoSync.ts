import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "derivacoes_produto-sync";
export const CRON_EXPR = "45 5 * * *";
// Mesmo raciocínio de produtoSync.ts (DatAlt em branco em registro novo perderia registro no
// modo Alterados) — a query original do Senior (fornecida pelo Vitor, 24/08/2026) trata
// DatGer/DatAlt de PRODUTO e DERIVAÇÃO juntos com OR (é uma consulta com JOIN); aqui, como cada
// tabela virou um job próprio, o corte usa só o par de datas de e075der.
export const CAMPO_DATA: string | null = "DatAlt";
export const BASE_QUERY = `SELECT codemp AS codemp, codpro AS codpro, codder AS codder, desder AS desder, descpl AS descpl, codba2 AS codbar, tipcn2 AS tipcn2, vlrcn2 AS vlrcn2, tipcn3 AS tipcn3, vlrcn3 AS vlrcn3, pesbru AS pesbru, pesliq AS pesliq, tolpes AS tolpes, volder AS volder, codemb AS codemb, qtdemb AS qtdemb, codref AS codref FROM e075der`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && (filtro.camposCobertos.has("datger") || filtro.camposCobertos.has("datalt"));
  if (desde && !admJaConfigurouCorte) {
    const data = desde.toISOString().slice(0, 10);
    predicados.push(`(datger >= '${data}' OR datalt >= '${data}')`);
  }
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface DerivacaoProdutoRow {
  codemp: number;
  codpro: string;
  codder: string;
  desder?: string;
  descpl?: string;
  codbar?: string;
  tipcn2?: string;
  vlrcn2?: number;
  tipcn3?: string;
  vlrcn3?: number;
  pesbru?: number;
  pesliq?: number;
  tolpes?: number;
  volder?: number;
  codemb?: number;
  qtdemb?: number;
  codref?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codpro", cast: "text" },
  { nome: "codder", cast: "text" },
  { nome: "desder", cast: "text" },
  { nome: "descpl", cast: "text" },
  { nome: "codbar", cast: "text" },
  { nome: "tipcn2", cast: "text" },
  { nome: "vlrcn2", cast: "numeric" },
  { nome: "tipcn3", cast: "text" },
  { nome: "vlrcn3", cast: "numeric" },
  { nome: "pesbru", cast: "numeric" },
  { nome: "pesliq", cast: "numeric" },
  { nome: "tolpes", cast: "numeric" },
  { nome: "volder", cast: "numeric" },
  { nome: "codemb", cast: "int" },
  { nome: "qtdemb", cast: "numeric" },
  { nome: "codref", cast: "text" },
];

function linhaDe(row: DerivacaoProdutoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codpro}-${row.codder}`,
    valores: [
      String(row.codemp),
      row.codpro,
      row.codder,
      row.desder != null ? row.desder : null,
      row.descpl != null ? row.descpl : null,
      row.codbar != null ? row.codbar : null,
      row.tipcn2 != null ? row.tipcn2 : null,
      row.vlrcn2 != null ? row.vlrcn2.toFixed(6) : null,
      row.tipcn3 != null ? row.tipcn3 : null,
      row.vlrcn3 != null ? row.vlrcn3.toFixed(6) : null,
      row.pesbru != null ? row.pesbru.toFixed(5) : null,
      row.pesliq != null ? row.pesliq.toFixed(5) : null,
      row.tolpes != null ? row.tolpes.toFixed(3) : null,
      row.volder != null ? row.volder.toFixed(5) : null,
      row.codemb != null ? String(row.codemb) : null,
      row.qtdemb != null ? row.qtdemb.toFixed(5) : null,
      row.codref != null ? row.codref : null,
    ],
  };
}

export async function runDerivacaoProdutoSync(desde?: Date): Promise<void> {
  // Instante da execução, carimbado em toda linha vista nesta rodada — é o que permite
  // descobrir depois quem NÃO veio (ver src/sync/varrerRemovidos.ts). Tem que ser
  // capturado antes do primeiro upsert.
  const inicio = new Date();
  const QUERY = montarQuery(desde);
  try {
    // Consultas grandes (>~30 mil linhas) fazem o serviço do Senior devolver
    // uma resposta vazia/truncada — por isso sempre paginamos com ORDER BY
    // pela chave primária.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codpro", "codder"])) as DerivacaoProdutoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "derivacoes_produto",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codpro", "codder"],
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
    // const varredura = await varrerRemovidos<Prisma.DerivacaoProdutoWhereInput>(prisma.derivacaoProduto, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e075der`,
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

// Derivação muda pouco — roda 1x por dia às 5h45, logo depois de produtos-sync (5h40): é
// filha de Produto (FK codemp+codpro), precisa do pai já carregado num banco vazio.
export function scheduleDerivacaoProdutoSync(): void {
  cron.schedule(CRON_EXPR, () => runDerivacaoProdutoSync());
}
