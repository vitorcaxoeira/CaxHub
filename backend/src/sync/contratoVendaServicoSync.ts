import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { fotografarCarteiraSemFalhar } from "../domain/metasComercial/carteira";

export const JOB_NAME = "contratos_venda_servicos-sync";
export const CRON_EXPR = "25 6 * * *";
// Sem DatAlt no dicionário de E160CVS (itens de serviço dos contratos): DatGer só marca a criação e perderia alterações de preço/situação.
// Tabela pequena (centenas a poucos milhares de linhas): sempre completa.
export const CAMPO_DATA: string | null = null;
export const BASE_QUERY = `SELECT CodEmp AS codemp, CodFil AS codfil, NumCtr AS numctr, DatCpt AS datcpt, SeqCvs AS seqcvs, CodSer AS codser, CplCvs AS cplcvs, QtdCvs AS qtdcvs, PreUni AS preuni, SitCvs AS sitcvs, IniRea AS inirea, UltRea AS ultrea, IniVig AS inivig, DatUft AS datuft FROM E160CVS`;

function montarQuery(desde?: Date): string {
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  return montarQuerySenior(BASE_QUERY, [...filtro.predicadosSql]);
}

interface ContratoVendaServicoRow {
  codemp: number;
  codfil: number;
  numctr: number;
  datcpt: string;
  seqcvs: number;
  codser?: string;
  cplcvs: string;
  qtdcvs: number;
  preuni: number;
  sitcvs: string;
  inirea?: string;
  ultrea?: string;
  inivig?: string;
  datuft?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numctr", cast: "int" },
  { nome: "datcpt", cast: "date" },
  { nome: "seqcvs", cast: "int" },
  { nome: "codser", cast: "text" },
  { nome: "cplcvs", cast: "text" },
  { nome: "qtdcvs", cast: "numeric" },
  { nome: "preuni", cast: "numeric" },
  { nome: "sitcvs", cast: "text" },
  { nome: "inirea", cast: "date" },
  { nome: "ultrea", cast: "date" },
  { nome: "inivig", cast: "date" },
  { nome: "datuft", cast: "date" },
];

function linhaDe(row: ContratoVendaServicoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numctr}-${row.datcpt}-${row.seqcvs}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      String(row.numctr),
      String(row.datcpt).slice(0, 10),
      String(row.seqcvs),
      row.codser != null ? row.codser : null,
      row.cplcvs,
      row.qtdcvs.toFixed(5),
      row.preuni.toFixed(10),
      row.sitcvs,
      row.inirea != null ? String(row.inirea).slice(0, 10) : null,
      row.ultrea != null ? String(row.ultrea).slice(0, 10) : null,
      row.inivig != null ? String(row.inivig).slice(0, 10) : null,
      row.datuft != null ? String(row.datuft).slice(0, 10) : null,
    ],
  };
}

export async function runContratoVendaServicoSync(desde?: Date): Promise<void> {
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
    const rows = (await runSqlViaSoapPaginated(QUERY, ["codemp", "codfil", "numctr", "datcpt", "seqcvs"])) as ContratoVendaServicoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "contratos_venda_servicos",
      colunas: COLUNAS,
      colunasPk: ["codemp", "codfil", "numctr", "datcpt", "seqcvs"],
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
    const varredura = await executarVarreduraDoJob<Prisma.ContratoVendaServicoWhereInput>(prisma.contratoVendaServico, {
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
    // Gestão de Metas do Comercial: a carteira de mensalidades (RVTR101) depende destas tabelas; refaz a foto do mês.
    await fotografarCarteiraSemFalhar(JOB_NAME);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.create({
      data: { jobName: JOB_NAME, query: QUERY, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Itens de serviço dos contratos (preço e quantidade de cada serviço): 6h25, logo depois do cabeçalho dos contratos (6h20).
export function scheduleContratoVendaServicoSync(): void {
  cron.schedule(CRON_EXPR, () => runContratoVendaServicoSync());
}
