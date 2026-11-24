import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";

export const JOB_NAME = "pedidos_itens_servico-sync";
export const CRON_EXPR = "35 6 * * *";
// Itens de serviço dos pedidos (E120ISP): base do realizado de Licenças da Gestão de Metas (itens com rateio na conta 177). ~14 mil linhas: sempre completa.
export const CAMPO_DATA: string | null = null;
export const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumPed AS numped, SeqIsp AS seqisp, CodSer AS codser, CplIsp AS cplisp, QtdPed AS qtdped, PreUni AS preuni, VlrBru AS vlrbru, VlrLiq AS vlrliq, SitIsp AS sitisp, CtaFin AS ctafin, CodRep AS codrep FROM E120ISP`;

function montarQuery(desde?: Date): string {
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  return montarQuerySenior(BASE_QUERY, [...filtro.predicadosSql]);
}

interface PedidoItemServicoRow {
  codemp: number;
  codfil: number;
  numped: number;
  seqisp: number;
  codser?: string;
  cplisp?: string;
  qtdped: number;
  preuni: number;
  vlrbru?: number;
  vlrliq?: number;
  sitisp: number;
  ctafin?: number;
  codrep?: number;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numped", cast: "int" },
  { nome: "seqisp", cast: "int" },
  { nome: "codser", cast: "text" },
  { nome: "cplisp", cast: "text" },
  { nome: "qtdped", cast: "numeric" },
  { nome: "preuni", cast: "numeric" },
  { nome: "vlrbru", cast: "numeric" },
  { nome: "vlrliq", cast: "numeric" },
  { nome: "sitisp", cast: "int" },
  { nome: "ctafin", cast: "int" },
  { nome: "codrep", cast: "int" },
];

function linhaDe(row: PedidoItemServicoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numped}-${row.seqisp}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numped),
      String(row.seqisp),
      row.codser != null ? row.codser : null,
      row.cplisp != null ? row.cplisp : null,
      row.qtdped.toFixed(5),
      row.preuni.toFixed(10),
      row.vlrbru != null ? row.vlrbru.toFixed(2) : null,
      row.vlrliq != null ? row.vlrliq.toFixed(2) : null,
      String(row.sitisp),
      row.ctafin != null ? String(row.ctafin) : null,
      row.codrep != null ? String(row.codrep) : null,
    ],
  };
}

export async function runPedidoItemServicoSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "numped", "seqisp"])) as PedidoItemServicoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "pedidos_itens_servico",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numped", "seqisp"],
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
    const varredura = await executarVarreduraDoJob<Prisma.PedidoItemServicoWhereInput>(prisma.pedidoItemServico, {
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

export function schedulePedidoItemServicoSync(): void {
  cron.schedule(CRON_EXPR, () => runPedidoItemServicoSync());
}
