import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { filtroDoJob } from "./filtrosAtivos";
import { executarVarreduraDoJob, DelegateEspelho } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";

// Parte comum das syncs dos contratos de COMPRA do Senior (E460CTR / E460CCS / E460REA) — custo-hora real do consultor PJ (18/11/2026). As três
// tabelas são pequenas (centenas a poucos milhares de linhas), sem corte por data e sem DatAlt confiável: sempre completas, mesmo molde de
// projetoSync.ts. Só muda a query, as colunas e a linha — por isso o corpo do job mora aqui.

/** Senior grava " " no lugar de texto vazio — `trim` e vazio vira NULL (uma só representação de "sem valor"). */
export function textoOuNulo(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

export function inteiroOuNulo(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

export function numeroOuNulo(v: number | string | null | undefined): string | null {
  return v == null ? null : String(v);
}

/** Data "vazia" do Senior é 1900-12-31 (nunca uma data real nestes contratos): vira NULL. Devolve só AAAA-MM-DD (nunca `new Date`, que desloca o dia). */
export function dataOuNula(v: string | null | undefined): string | null {
  if (v == null) return null;
  const dia = String(v).slice(0, 10);
  return dia === "1900-12-31" ? null : dia;
}

/** Data que faz parte da CHAVE (não aceita nulo): fica como veio, inclusive 1900-12-31 (= item sem competência). */
export function dataDaChave(v: string): string {
  return String(v).slice(0, 10);
}

export interface DefinicaoSyncContrato<R> {
  jobName: string;
  query: string;
  /** Aliases da chave primária na ordem do ORDER BY da paginação. */
  chavePaginacao: string[];
  tabela: string;
  colunas: ColunaUpsert[];
  colunasPk: string[];
  linhaDe: (row: R) => LinhaUpsert;
  /** Delegate Prisma do model (pra varredura de removidos). */
  delegate: DelegateEspelho<Record<string, never>>;
}

export async function executarSyncContrato<R>(def: DefinicaoSyncContrato<R>): Promise<void> {
  const inicio = new Date();
  const query = montarQuerySenior(def.query, filtroDoJob(def.jobName, "todos").predicadosSql);
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, def.chavePaginacao)) as R[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(def.linhaDe), {
      tabela: def.tabela,
      colunas: def.colunas,
      colunasPk: def.colunasPk,
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(def.jobName),
    });
    const msEscrita = Date.now() - inicioEscrita;

    // Espelho só-leitura: escopo `{}` (tabela toda). Varredura nasce "desligada" — promoção pela tela é decisão manual.
    const varredura = await executarVarreduraDoJob<Record<string, never>>(def.delegate, {
      jobName: def.jobName,
      tabelaSenior: extrairTabela(def.query),
      inicio,
      linhasProcessadas: resultado.linhasProcessadas,
    });

    await prisma.syncLog.create({
      data: {
        jobName: def.jobName,
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
      data: { jobName: def.jobName, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
    });
    console.error(`[${def.jobName}] falhou:`, message);
  }
}
