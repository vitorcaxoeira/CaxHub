import cron from "node-cron";
import { runSqlViaSoap } from "../soap/client";
import { prisma } from "../db/prisma";
import { filtroDoJob } from "./filtrosAtivos";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";
import { Prisma } from "@prisma/client";

export const JOB_NAME = "fornecedor-sync";
export const CRON_EXPR = "50 3 * * *";
export const CAMPO_DATA: string | null = "DatAtu";
export const BASE_QUERY = `SELECT
  codfor AS codfor, nomfor AS nomfor, apefor AS apefor, tipfor AS tipfor,
  tipmer AS tipmer, codram AS codram, insest AS insest, cgccpf AS cgccpf,
  endfor AS endfor, cplend AS cplend, cepfor AS cepfor, baifor AS baifor,
  cidfor AS cidfor, sigufs AS sigufs, codpai AS codpai, sitfor AS sitfor
FROM e095for`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

interface FornecedorRow {
  codfor: number;
  nomfor: string;
  apefor: string;
  tipfor: string;
  tipmer: string;
  codram: string | null;
  insest: string | null;
  cgccpf: number | null;
  endfor: string | null;
  cplend: string | null;
  cepfor: number | null;
  baifor: string | null;
  cidfor: string | null;
  sigufs: string | null;
  codpai: string | null;
  sitfor: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores.
const COLUNAS: ColunaUpsert[] = [
  { nome: "codfor", cast: "int" },
  { nome: "nomfor", cast: "text" },
  { nome: "apefor", cast: "text" },
  { nome: "tipfor", cast: "text" },
  { nome: "tipmer", cast: "text" },
  { nome: "codram", cast: "text" },
  { nome: "insest", cast: "text" },
  { nome: "cgccpf", cast: "bigint" },
  { nome: "endfor", cast: "text" },
  { nome: "cplend", cast: "text" },
  { nome: "cepfor", cast: "int" },
  { nome: "baifor", cast: "text" },
  { nome: "cidfor", cast: "text" },
  { nome: "sigufs", cast: "text" },
  { nome: "codpai", cast: "text" },
  { nome: "sitfor", cast: "text" },
];

function linhaDe(row: FornecedorRow): LinhaUpsert {
  return {
    chave: String(row.codfor),
    valores: [
      String(row.codfor),
      row.nomfor,
      row.apefor,
      row.tipfor,
      row.tipmer,
      row.codram != null ? row.codram : null,
      row.insest != null ? row.insest : null,
      // Diferente de Cliente.cgccpf (obrigatório): aqui o dicionário do Senior marca o
      // campo como anulável, e a base tem fornecedor sem CNPJ/CPF cadastrado.
      row.cgccpf != null ? String(row.cgccpf) : null,
      row.endfor != null ? row.endfor : null,
      row.cplend != null ? row.cplend : null,
      row.cepfor != null ? String(row.cepfor) : null,
      row.baifor != null ? row.baifor : null,
      row.cidfor != null ? row.cidfor : null,
      row.sigufs != null ? row.sigufs : null,
      row.codpai != null ? row.codpai : null,
      row.sitfor,
    ],
  };
}

export async function runFornecedorSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoap(query)) as FornecedorRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDe), {
      tabela: "fornecedores",
      colunas: COLUNAS,
      colunasPk: ["codfor"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    const varredura = await executarVarreduraDoJob<Prisma.FornecedorWhereInput>(prisma.fornecedor, {
      jobName: JOB_NAME,
      tabelaSenior: extrairTabela(BASE_QUERY),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
      desde,
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

// Cadastro de fornecedores muda pouco — roda 1x por dia às 3h25, logo depois de
// cliente-sync (3h20). O modo incremental só roda quando disparado manualmente pela tela
// de administração de sincronização.
export function scheduleFornecedorSync(): void {
  cron.schedule(CRON_EXPR, () => runFornecedorSync());
}
