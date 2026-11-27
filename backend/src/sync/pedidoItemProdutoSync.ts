import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "pedidos_itens_produto-sync";
export const CRON_EXPR = "45 6 * * *";
// Itens de produto dos pedidos (E120IPD): aba "Itens de Produto" da visualização do pedido. Poucas dezenas de linhas: sempre completa.
export const CAMPO_DATA: string | null = null;
export const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumPed AS numped, SeqIpd AS seqipd, CodPro AS codpro, CodDer AS codder, CplIpd AS cplipd, QtdPed AS qtdped, QtdAEn AS qtdaen, QtdFat AS qtdfat, QtdCan AS qtdcan, QtdAbe AS qtdabe, UniMed AS unimed, PreUni AS preuni, CodMoe AS codmoe, VlrLiq AS vlrliq, DatEnt AS datent, SitIpd AS sitipd FROM E120IPD`;

function montarQuery(desde?: Date): string {
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  return montarQuerySenior(BASE_QUERY, [...filtro.predicadosSql]);
}

interface PedidoItemProdutoRow {
  codemp: number;
  codfil: number;
  numped: number;
  seqipd: number;
  codpro?: string;
  codder?: string;
  cplipd?: string;
  qtdped: number;
  qtdaen?: number;
  qtdfat?: number;
  qtdcan?: number;
  qtdabe?: number;
  unimed?: string;
  preuni?: number;
  codmoe?: string;
  vlrliq?: number;
  datent?: string;
  sitipd: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numped", cast: "int" },
  { nome: "seqipd", cast: "int" },
  { nome: "codpro", cast: "text" },
  { nome: "codder", cast: "text" },
  { nome: "cplipd", cast: "text" },
  { nome: "qtdped", cast: "numeric" },
  { nome: "qtdaen", cast: "numeric" },
  { nome: "qtdfat", cast: "numeric" },
  { nome: "qtdcan", cast: "numeric" },
  { nome: "qtdabe", cast: "numeric" },
  { nome: "unimed", cast: "text" },
  { nome: "preuni", cast: "numeric" },
  { nome: "codmoe", cast: "text" },
  { nome: "vlrliq", cast: "numeric" },
  { nome: "datent", cast: "date" },
  { nome: "sitipd", cast: "int" },
];

function linhaDe(row: PedidoItemProdutoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numped}-${row.seqipd}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numped),
      String(row.seqipd),
      row.codpro != null ? row.codpro : null,
      row.codder != null ? row.codder : null,
      row.cplipd != null ? row.cplipd : null,
      row.qtdped.toFixed(5),
      row.qtdaen != null ? row.qtdaen.toFixed(5) : null,
      row.qtdfat != null ? row.qtdfat.toFixed(5) : null,
      row.qtdcan != null ? row.qtdcan.toFixed(5) : null,
      row.qtdabe != null ? row.qtdabe.toFixed(5) : null,
      row.unimed != null ? row.unimed : null,
      row.preuni != null ? row.preuni.toFixed(10) : null,
      row.codmoe != null ? row.codmoe : null,
      row.vlrliq != null ? row.vlrliq.toFixed(2) : null,
      row.datent != null ? String(row.datent).slice(0, 10) : null,
      String(row.sitipd),
    ],
  };
}

export async function runPedidoItemProdutoSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "numped", "seqipd"])) as PedidoItemProdutoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "pedidos_itens_produto",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numped", "seqipd"],
      carimbo: inicio,
    });
    const msEscrita = Date.now() - inicioEscrita;

    // DETECÇÃO DE EXCLUSÃO NO SENIOR (src/sync/varrerRemovidos.ts) — já ligada: toda tabela
    // espelho do Senior nasce com o controle completo (schema + carimbo + varredura +
    // registry), nunca só o schema — convenção do projeto desde 10/09/2026 (ver
    // sempre-criar-controle-de-removidos-tabela-senior no segundo cérebro). A tabela só
    // COMEÇA em "desligada" (default do model ConfiguracaoVarredura, sem linha salva) — não
    // marca nada sozinha até alguém promover pela tela (Administração > Sincronização ERP).
    //
    // Se esta tabela for de MÃO DUPLA (o CaxHub também escreve nela, não só lê do Senior):
    // trocar esta chamada por `varrerRemovidos()` direto (não este wrapper) com um escopo
    // que exclua o registro nascido localmente e ainda não confirmado lá (ex.:
    // `{ origemCaxHub: false }`) — ver atividadeConsultorSync.ts/ratSync.ts pro padrão.
    const varredura = await executarVarreduraDoJob<Prisma.PedidoItemProdutoWhereInput>(prisma.pedidoItemProduto, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(BASE_QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
      desde,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query: QUERY,
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
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

export function schedulePedidoItemProdutoSync(): void {
  cron.schedule(CRON_EXPR, () => runPedidoItemProdutoSync());
}
