import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "produtos-sync";
export const CRON_EXPR = "40 5 * * *";
// DatAlt fica em branco em registro recém-criado que nunca foi alterado — usar só DatAlt faria
// o modo Alterados perder produto novo (nunca capturado depois, porque a linha nunca teria
// DatAlt preenchido). A própria query da tela de Produtos/Derivações do Senior, fornecida pelo
// Vitor pra este pedido (24/08/2026), trata DatGer/DatAlt com OR pelo mesmo motivo — replicado
// abaixo em vez do padrão de campo único usado no resto do projeto. CAMPO_DATA aqui é só a
// referência exposta pro registry (suportaAlterados) e pro filtro admin — a injeção automática
// do corte usa os dois campos, não só este.
export const CAMPO_DATA: string | null = "DatAlt";
export const BASE_QUERY = `SELECT codemp AS codemp, codpro AS codpro, despro AS despro, cplpro AS cplpro, desnfv AS desnfv, codfam AS codfam, unimed AS unimed, unime2 AS unime2, unime3 AS unime3, tippro AS tippro, codori AS codori FROM e075pro`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  // Mesma lógica de "admin já configurou o corte" de planoContabilSync.ts, mas checando os
  // dois campos de data candidatos — se o admin salvou um predicado explícito em QUALQUER um
  // dos dois, ele substitui a injeção automática por inteiro.
  const admJaConfigurouCorte = desde != null && (filtro.camposCobertos.has("datger") || filtro.camposCobertos.has("datalt"));
  if (desde && !admJaConfigurouCorte) {
    const data = desde.toISOString().slice(0, 10);
    predicados.push(`(datger >= '${data}' OR datalt >= '${data}')`);
  }
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface ProdutoRow {
  codemp: number;
  codpro: string;
  despro: string;
  cplpro?: string;
  desnfv?: string;
  codfam: string;
  unimed: string;
  unime2?: string;
  unime3?: string;
  tippro: string;
  codori: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codpro", cast: "text" },
  { nome: "despro", cast: "text" },
  { nome: "cplpro", cast: "text" },
  { nome: "desnfv", cast: "text" },
  { nome: "codfam", cast: "text" },
  { nome: "unimed", cast: "text" },
  { nome: "unime2", cast: "text" },
  { nome: "unime3", cast: "text" },
  { nome: "tippro", cast: "text" },
  { nome: "codori", cast: "text" },
];

function linhaDe(row: ProdutoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codpro}`,
    valores: [
      String(row.codemp),
      row.codpro,
      row.despro,
      row.cplpro != null ? row.cplpro : null,
      row.desnfv != null ? row.desnfv : null,
      row.codfam,
      row.unimed,
      row.unime2 != null ? row.unime2 : null,
      row.unime3 != null ? row.unime3 : null,
      row.tippro,
      row.codori,
    ],
  };
}

export async function runProdutoSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codpro"])) as ProdutoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "produtos",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codpro"],
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
    // const varredura = await varrerRemovidos<Prisma.ProdutoWhereInput>(prisma.produto, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM e075pro`,
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

// Cadastro de produtos muda pouco — roda 1x por dia às 5h40. O modo incremental só roda
// quando disparado manualmente pela tela de administração de sincronização.
export function scheduleProdutoSync(): void {
  cron.schedule(CRON_EXPR, () => runProdutoSync());
}
