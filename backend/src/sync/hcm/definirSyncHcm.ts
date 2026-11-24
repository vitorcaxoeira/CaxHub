import { runSqlViaSoapPaginated } from "../../soap/client";
import { prisma } from "../../db/prisma";
import { tabelaSenior } from "../../config/sistemaSenior";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "../upsertEmLote";
import { montarQuerySenior, extrairTabela } from "../consultaSenior";
import { filtroDoJob } from "../filtrosAtivos";
import { executarVarreduraDoJob } from "../varrerRemovidos";
import { tamanhoLoteConfigurado } from "../politicaLote";
import { predicadoCorteIncremental } from "../dialetoSenior";
import { delegatePorTabelaLocal } from "../recorteRetroativo";
import { ColunaHcm, TabelaHcm } from "./tabelasHcm";

// Um job de sincronização por tabela do HCM, montado a partir da declaração em tabelasHcm.ts em vez
// de 27 arquivos copiados. O comportamento é o mesmo dos jobs do ERP (empresaSync.ts,
// movimentoEstoqueSync.ts): consulta paginada, upsert em lote com carimbo `visto_em_sync`, varredura
// de removidos (política por job, desligada por padrão), filtro configurável na tela e linha no
// SyncLog. A única diferença é o sistema: todo SOAP do job vai para o HCM.

const SISTEMA = "hcm" as const;

export function queryBaseHcm(t: TabelaHcm): string {
  const colunas = t.colunas.map((c) => `${c.origem} AS ${c.origem}`).join(", ");
  return `SELECT ${colunas} FROM ${tabelaSenior(t.tabela, SISTEMA)}`;
}

// O Senior grava "sem data" como 31/12/1900 (às vezes 30/12/1899). Em coluna que não é chave isso
// vira NULL: um "desligado em 1900" faria qualquer média de tempo de casa sair absurda.
const ANO_SEM_DATA = 1901;

export function valorParaUpsert(coluna: ColunaHcm, bruto: unknown): string | null {
  if (bruto == null || bruto === "") return null;
  switch (coluna.cast) {
    case "date": {
      const texto = String(bruto).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
      if (!coluna.pk && Number(texto.slice(0, 4)) < ANO_SEM_DATA) return null;
      return texto;
    }
    case "int":
    case "bigint": {
      const n = Number(bruto);
      return Number.isFinite(n) ? String(Math.trunc(n)) : null;
    }
    case "numeric": {
      const n = Number(bruto);
      return Number.isFinite(n) ? String(n) : null;
    }
    default:
      // Postgres recusa o caractere NUL em text; o Senior às vezes o deixa em campo de texto livre.
      return String(bruto).replace(/\u0000/g, "");
  }
}

function colunasUpsert(t: TabelaHcm): ColunaUpsert[] {
  return t.colunas.map((c) => ({ nome: c.origem, cast: c.cast === "date" ? "date" : c.cast === "text" ? "text" : c.cast }));
}

export interface SyncHcm {
  jobName: string;
  queryBase: string;
  /** Nome como entra no FROM (com prefixo do banco do HCM, se houver). */
  tabelaSenior: string;
  run: (desde?: Date) => Promise<void>;
}

export function definirSyncHcm(t: TabelaHcm): SyncHcm {
  const base = queryBaseHcm(t);
  const pk = t.colunas.filter((c) => c.pk).map((c) => c.origem);
  const colunas = colunasUpsert(t);

  function montarQuery(desde?: Date): string {
    const predicados: string[] = [];
    const filtro = filtroDoJob(t.jobName, desde ? "alterados" : "todos", desde);
    const admJaConfigurouCorte = desde != null && t.campoData != null && filtro.camposCobertos.has(t.campoData.toLowerCase());
    if (desde && t.campoData && !admJaConfigurouCorte) predicados.push(predicadoCorteIncremental(t.campoData, desde, SISTEMA));
    predicados.push(...filtro.predicadosSql);
    return montarQuerySenior(base, predicados);
  }

  function linhaDe(row: Record<string, unknown>): LinhaUpsert {
    const valores = t.colunas.map((c) => valorParaUpsert(c, row[c.origem]));
    // PK nunca é nula (o upsert falharia no ON CONFLICT): linha sem chave completa é descartada na
    // origem pelo filtro abaixo, então aqui só juntamos.
    return { chave: pk.map((p) => String(row[p])).join("|"), valores };
  }

  async function run(desde?: Date): Promise<void> {
    const inicio = new Date();
    const query = montarQuery(desde);
    try {
      const inicioFetch = Date.now();
      const rows = (await runSqlViaSoapPaginated(query, pk, undefined, SISTEMA)) as Record<string, unknown>[];
      const msFetch = Date.now() - inicioFetch;

      const validas = rows.filter((r) => pk.every((p) => r[p] != null));

      const inicioEscrita = Date.now();
      const resultado = await upsertEmLote(validas.map(linhaDe), {
        tabela: t.tabelaLocal,
        colunas,
        colunasPk: pk,
        carimbo: inicio,
        tamanhoLote: tamanhoLoteConfigurado(t.jobName),
      });
      const msEscrita = Date.now() - inicioEscrita;

      const varredura = await executarVarreduraDoJob<object>(delegatePorTabelaLocal(t.tabelaLocal), {
        jobName: t.jobName,
        tabelaSenior: extrairTabela(base),
        sistema: SISTEMA,
        inicio,
        linhasProcessadas: rows.length,
        desde,
      });

      await prisma.syncLog.create({
        data: {
          jobName: t.jobName,
          query,
          status: "success",
          message:
            `${resultado.linhasProcessadas} linhas em ${((msFetch + msEscrita) / 1000).toFixed(1)}s ` +
            `(fetch ${(msFetch / 1000).toFixed(1)}s, escrita ${(msEscrita / 1000).toFixed(1)}s, ${resultado.lotes} lotes)` +
            (validas.length < rows.length ? ` — ${rows.length - validas.length} sem chave completa, descartadas` : "") +
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
        data: { jobName: t.jobName, query, status: "error", message, duracaoMs: Date.now() - inicio.getTime() },
      });
      console.error(`[${t.jobName}] falhou:`, message);
    }
  }

  return { jobName: t.jobName, queryBase: base, tabelaSenior: extrairTabela(base), run };
}

/** Os jobs do HCM, na ordem de dependência de tabelasHcm.ts. Montados uma vez, no import. */
export function definirTodosSyncsHcm(tabelas: TabelaHcm[]): { tabela: TabelaHcm; sync: SyncHcm }[] {
  return tabelas.map((tabela) => ({ tabela, sync: definirSyncHcm(tabela) }));
}
