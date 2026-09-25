// Espelho local da tabela E501TCP do Senior ERP (C. Pagar - Títulos - Dados Gerais), tabela
// inteira, sem recorte fixo — mesmo desenho do CaxHub_Atlas. `obstcp` é extra do CaxHub (o
// modal do card de RDV da Home mostra a observação do título). Mesmo molde de
// tituloReceberSync.ts, espelhando E501TCP em vez de E301TCR.
import cron from "node-cron";
import { runSqlViaSoapPaginated } from "../soap/client";
import { prisma } from "../db/prisma";
import { filtroDoJob } from "./filtrosAtivos";
import { montarQuerySenior, extrairTabela } from "./consultaSenior";
import { executarVarreduraDoJob } from "./varrerRemovidos";
import { upsertEmLote, ColunaUpsert, LinhaUpsert } from "./upsertEmLote";
import { tamanhoLoteConfigurado } from "./politicaLote";
import { Prisma } from "@prisma/client";

export const JOB_NAME = "titulos_pagar-sync";
export const CRON_EXPR = "10 4 * * *";
// Mesma incerteza documentada em tituloReceberSync.ts: DatGer é "data da geração do
// registro", não necessariamente atualizada em toda mudança de situação — melhor
// aproximação disponível.
export const CAMPO_DATA: string | null = "DatGer";
export const BASE_QUERY = `SELECT codemp AS codemp, codfil AS codfil, numtit AS numtit, codtpt AS codtpt, codfor AS codfor, codtns AS codtns, sittit AS sittit, datemi AS datemi, datent AS datent, vctori AS vctori, vctpro AS vctpro, vlrori AS vlrori, vlrabe AS vlrabe, codfpg AS codfpg, codpor AS codpor, codmoe AS codmoe, ctafin AS ctafin, ctared AS ctared, codccu AS codccu, numprj AS numprj, codfpj AS codfpj, obstcp AS obstcp FROM e501tcp`;

function montarQuery(desde?: Date): string {
  const predicados: string[] = [];
  const filtro = filtroDoJob(JOB_NAME, desde ? "alterados" : "todos", desde);
  const admJaConfigurouCorte = desde != null && CAMPO_DATA != null && filtro.camposCobertos.has(CAMPO_DATA.toLowerCase());
  if (desde && !admJaConfigurouCorte) predicados.push(`${CAMPO_DATA} >= '${desde.toISOString().slice(0, 10)}'`);
  predicados.push(...filtro.predicadosSql);
  return montarQuerySenior(BASE_QUERY, predicados);
}

export interface TituloPagarRow {
  codemp: number;
  codfil: number;
  numtit: string;
  codtpt: string;
  codfor: number;
  codtns: string;
  sittit: string;
  datemi: string;
  datent: string;
  vctori: string;
  vctpro: string;
  vlrori: number;
  vlrabe?: number;
  codfpg?: number;
  codpor: string;
  codmoe?: string;
  ctafin?: number;
  ctared?: number;
  codccu?: string;
  numprj?: number;
  codfpj?: number;
  obstcp?: string;
}

// Colunas do INSERT em lote, na ordem usada em LinhaUpsert.valores — cast conferido contra
// schema.prisma (TituloPagar): vlrori/vlrabe Decimal(15,2).
export const COLUNAS_TITULO_PAGAR: ColunaUpsert[] = [
  { nome: "codemp", cast: "int" },
  { nome: "codfil", cast: "int" },
  { nome: "numtit", cast: "text" },
  { nome: "codtpt", cast: "text" },
  { nome: "codfor", cast: "int" },
  { nome: "codtns", cast: "text" },
  { nome: "sittit", cast: "text" },
  { nome: "datemi", cast: "date" },
  { nome: "datent", cast: "date" },
  { nome: "vctori", cast: "date" },
  { nome: "vctpro", cast: "date" },
  { nome: "vlrori", cast: "numeric" },
  { nome: "vlrabe", cast: "numeric" },
  { nome: "codfpg", cast: "int" },
  { nome: "codpor", cast: "text" },
  { nome: "codmoe", cast: "text" },
  { nome: "ctafin", cast: "int" },
  { nome: "ctared", cast: "int" },
  { nome: "codccu", cast: "text" },
  { nome: "numprj", cast: "int" },
  { nome: "codfpj", cast: "int" },
  { nome: "obstcp", cast: "text" },
];

// `String(...).slice(0,10)` pra data, nunca `new Date(v)` — "2025-03-14" é UTC mas
// "2025-03-14T00:00:00" é local, e em America/Sao_Paulo isso desloca o dia.
export function linhaDeTituloPagar(row: TituloPagarRow): LinhaUpsert {
  return {
    chave: `${row.codemp}-${row.codfil}-${row.numtit}-${row.codtpt}-${row.codfor}`,
    valores: [
      String(row.codemp),
      String(row.codfil),
      row.numtit,
      row.codtpt,
      String(row.codfor),
      row.codtns,
      row.sittit,
      String(row.datemi).slice(0, 10),
      String(row.datent).slice(0, 10),
      String(row.vctori).slice(0, 10),
      String(row.vctpro).slice(0, 10),
      row.vlrori.toFixed(2),
      row.vlrabe != null ? row.vlrabe.toFixed(2) : null,
      row.codfpg != null ? String(row.codfpg) : null,
      row.codpor,
      row.codmoe?.trim() ? row.codmoe.trim() : null,
      row.ctafin != null ? String(row.ctafin) : null,
      row.ctared != null ? String(row.ctared) : null,
      row.codccu != null ? row.codccu : null,
      row.numprj != null ? String(row.numprj) : null,
      row.codfpj != null ? String(row.codfpj) : null,
      row.obstcp != null ? row.obstcp : null,
    ],
  };
}

export async function runTituloPagarSync(desde?: Date): Promise<void> {
  const query = montarQuery(desde);
  const inicio = new Date();
  try {
    const inicioFetch = Date.now();
    const rows = (await runSqlViaSoapPaginated(query, [
      "codemp",
      "codfil",
      "numtit",
      "codtpt",
      "codfor",
    ])) as TituloPagarRow[];
    const msFetch = Date.now() - inicioFetch;

    const inicioEscrita = Date.now();
    const resultado = await upsertEmLote(rows.map(linhaDeTituloPagar), {
      tabela: "titulos_pagar",
      colunas: COLUNAS_TITULO_PAGAR,
      colunasPk: ["codemp", "codfil", "numtit", "codtpt", "codfor"],
      carimbo: inicio,
      tamanhoLote: tamanhoLoteConfigurado(JOB_NAME),
    });
    const msEscrita = Date.now() - inicioEscrita;

    const varredura = await executarVarreduraDoJob<Prisma.TituloPagarWhereInput>(prisma.tituloPagar, {
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

// O agendamento automático sempre roda completo (sem "desde") — o modo incremental
// só é usado quando disparado manualmente pela tela de administração de sincronização.
export function scheduleTituloPagarSync(): void {
  cron.schedule(CRON_EXPR, () => runTituloPagarSync());
}
