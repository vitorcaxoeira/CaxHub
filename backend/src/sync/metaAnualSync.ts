import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";

export const JOB_NAME = "metas_anuais-sync";
export const CRON_EXPR = "15 6 * * *";
// Tabela pequena/customizada (USU_TMetaAnual) sem nenhum campo de auditoria (UsuGer/DatGer/
// etc.) no dicionário — só os 5 campos de negócio existem. Sem candidato a "alterado desde",
// mesma lógica conservadora do `DatPal` em empresaSync.ts: sem sync incremental, só completo.
export const CAMPO_DATA: string | null = null;
// "Data_Referencia" (01/01/<ano>) da query original do Vitor não entra como coluna — é
// derivável de `anomet` no ponto de uso (mesmo raciocínio de não duplicar regra de negócio na
// sincronização já aplicado a `codref` em derivacoes_produto).
export const BASE_QUERY = `SELECT USU_CodEmp AS codemp, USU_CodFil AS codfil, USU_AnoMet AS anomet, USU_VlrMet AS vlrmet, USU_PerCre AS percre FROM usu_tmetaanual`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface MetaAnualRow {
  codemp: number;
  codfil: number;
  anomet: number;
  vlrmet: number;
  percre: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "anomet", cast: "int" },
  { nome: "vlrmet", cast: "numeric" },
  { nome: "percre", cast: "numeric" },
];

function linhaDe(row: MetaAnualRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.anomet}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.anomet),
      row.vlrmet.toFixed(2),
      row.percre.toFixed(2),
    ],
  };
}

export async function runMetaAnualSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "anomet"])) as MetaAnualRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "metas_anuais",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "anomet"],
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
    // const varredura = await varrerRemovidos<Prisma.MetaAnualWhereInput>(prisma.metaAnual, {
    //   jobName: JOB_NAME,
    //   inicio,
    //   linhasProcessadas: rows.length,
    //   escopo: {},
    //   queryContagemOrigem: `SELECT COUNT(*) AS total FROM usu_tmetaanual`,
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

// Metas anuais mudam pouco (1 linha por empresa/filial/ano) — roda 1x por dia às 6h15.
export function scheduleMetaAnualSync(): void {
  cron.schedule(CRON_EXPR, () => runMetaAnualSync());
}
