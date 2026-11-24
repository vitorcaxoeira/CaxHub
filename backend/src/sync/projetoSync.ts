import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

export const JOB_NAME = "projetos-sync";
export const CRON_EXPR = "5 5 * * *";
// Sem corte por data: são ~170 projetos, sempre completo (e DatAtu nem sempre é preenchida).
export const CAMPO_DATA: string | null = null;
// Só o essencial pra Rentabilidade (17/11/2026): identificação, cliente, CC, situação, vigência e
// o `USU_Cli0800` (cliente no 0800 antigo). As outras ~120 colunas da E615PRJ são bloqueio
// orçamentário, controle físico e contas padrão — fora de escopo.
export const QUERY = `SELECT CodEmp AS codemp, NumPrj AS numprj, CodFil AS codfil, CodTpj AS codtpj, NomPrj AS nomprj, AbrPrj AS abrprj, CodCli AS codcli, CliFat AS clifat, CodCcu AS codccu, SitPrj AS sitprj, PrjApr AS prjapr, PrjSup AS prjsup, DatIpj AS datipj, DatFpj AS datfpj, USU_Cli0800 AS cli0800 FROM e615prj`;

interface ProjetoRow {
  codemp: number;
  numprj: number;
  codfil: number;
  codtpj: number;
  nomprj?: string | null;
  abrprj: string;
  codcli?: number | null;
  clifat?: number | null;
  codccu?: string | null;
  sitprj?: string | null;
  prjapr?: string | null;
  prjsup?: number | null;
  datipj?: string | null;
  datfpj?: string | null;
  cli0800?: number | null;
}

const COLUNAS: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "numprj", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "codtpj", cast: "int" },
  { nome: "nomprj", cast: "text" },
  { nome: "abrprj", cast: "text" },
  { nome: "codcli", cast: "int" },
  { nome: "clifat", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "sitprj", cast: "text" },
  { nome: "prjapr", cast: "text" },
  { nome: "prjsup", cast: "int" },
  { nome: "datipj", cast: "date" },
  { nome: "datfpj", cast: "date" },
  { nome: "cli0800", cast: "int" },
];

// Texto do Senior vem preenchido com espaço quando vazio (CodCcu = " ") — `trim` e vazio → NULL,
// senão um projeto "sem CC" apareceria com CC " " e furaria qualquer JOIN/filtro por centro de custo.
function textoOuNulo(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function inteiroOuNulo(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}
function dataOuNula(v: string | null | undefined): string | null {
  return v == null ? null : String(v).slice(0, 10);
}

function linhaDe(row: ProjetoRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.numprj}`,
    valores: [
      String(row.codemp),
      String(row.numprj),
      String(row.codfil),
      String(row.codtpj),
      textoOuNulo(row.nomprj),
      row.abrprj,
      inteiroOuNulo(row.codcli),
      inteiroOuNulo(row.clifat),
      textoOuNulo(row.codccu),
      textoOuNulo(row.sitprj),
      textoOuNulo(row.prjapr),
      inteiroOuNulo(row.prjsup),
      dataOuNula(row.datipj),
      dataOuNula(row.datfpj),
      inteiroOuNulo(row.cli0800),
    ],
  };
}

export async function runProjetoSync(): Promise<void> {
  const inicio = new Date();
  const query = montarQuerySenior(QUERY, filtroDoJob(JOB_NAME, "todos").predicadosSql);
  try {
    // Paginado com ORDER BY pela chave primária, como todo job do projeto.
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, ["codemp", "numprj"])) as ProjetoRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "projetos",
      colunas: COLUNAS,
      colunasPk: ["codemp", "numprj"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // Espelho só-leitura: escopo `{}` (tabela toda). Varredura nasce "desligada" (default de
    // ConfiguracaoVarredura) — promoção pela tela é decisão manual.
    const varredura = await executarVarreduraDoJob<Prisma.ProjetoWhereInput>(prisma.projeto, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
    });

    await prisma.syncLog.create({
      data: {
        jobName: JOB_NAME,
        query,
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
      data: { jobName: JOB_NAME, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${JOB_NAME}] falhou:`, message);
  }
}

// Cadastro de projetos muda pouco — roda 1x por dia às 5h05.
export function scheduleProjetoSync(): void {
  cron.schedule(CRON_EXPR, runProjetoSync);
}
